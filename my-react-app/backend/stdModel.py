import asyncio
import os
import shutil
import subprocess
import tempfile
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import librosa # Lib สำหรับโหลดไฟล์เสียงและสกัด MFCC feature
import numpy as np # คำนวณ Matrix/Vector, DTW, z-score
import requests # Lib สำหรับดึงเสียงต้นแบบจาก Supabase

# Lib สำหรับโหลดโมเดล wav2vec2 ของ HuggingFace โดยถอดเสียงภาษาไทยแบบ CTC
import torch
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

# URL บน Supabase
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
SUPABASE_BUCKET_URL = f"{SUPABASE_URL}/storage/v1/object/public/sentences-audio"

WORDS_TABLE = "Sentence"                # ตารางที่เก็บข้อความประโยค
WORDS_COLUMNS = ("pronunciation",)      # คอลัมน์ข้อความไทยที่เว้นวรรคแยกคำ
WORDS_FALLBACK_COLUMN = "thai"          # ข้อความไทยเต็ม (ไม่ได้แบ่งคำ) ใช้ในกรณีที่คอลัมน์แบ่งคำไม่สามารถใช้งานได้
WORDS_FILE_COLUMN = "audio_file_name"   # ค้นหาสำรองด้วยชื่อไฟล์เสียง (ค้นหลักด้วยคอลัมน์ sentence_id)

# กำหนดค่า
SR = 22050              # sample rate สำหรับสกัด feature
HOP_LENGTH = 512        # hop ของ MFCC (1 Frame = 512 samples = 512/22050 sec ~ 23 ms)
W2V_SR = 16000          # sample rate ที่ wav2vec2 ต้องการ
TRIM_DB = 20            # threshold ตัดเสียงเงียบหัว-ท้าย 20 Decibel
PASS_THRESHOLD = 0.65   # เกณฑ์ Distance <= 0.65 ถือว่าผ่าน
EPS = 1e-8              # ค่าต่ำสุดสำหรับ MFCC เพื่อป้องกัน log(0) ใน DTW (cosine distance)

# เกณฑ์รายคำสำหรับคำสั้น
SHORT_WORD_FRAMES = 10        # คำที่ต้นแบบมี MFCC < 10 เฟรม (~230 ms) ถือว่าสั้น
SHORT_WORD_THRESHOLD = 0.75   # เกณฑ์ที่ผ่อนให้คำสั้น

# ความน่าเชื่อถือของ alignment
LOW_CONF_LOGPROB = -3.0       # conf ต่ำกว่านี้ = โมเดลไม่ค่อยมั่นใจ
UNRELIABLE_WORD_RATIO = 0.5   # สัดส่วนคำที่ conf ต่ำเกินเกณฑ์

# ไฟล์เสียงของผู้ใช้งานที่ถูกส่งมา
MIN_AUDIO_BYTES = 1000        # ขนาดไฟล์ขั้นต่ำ ถ้าน้อยกว่านี้ถือว่าไฟล์ว่างหรือสั้นเกินไป
MIN_AUDIO_SEC = 0.3           # หลัง trim ถ้าสั้นกว่านี้ถือว่าไม่มีเสียงพูด
MIN_PEAK = 1e-3               # แอมพลิจูดสูงสุดต่ำกว่านี้ถือว่าเงียบสนิท
FFMPEG_TIMEOUT = 30           # วินาที

# ── Cache / การทำงานพร้อมกัน ──
WORD_CACHE_TTL = float(os.environ.get("WORD_CACHE_TTL", 300))          # รายการคำ (วินาที)
WORD_NEG_CACHE_TTL = float(os.environ.get("WORD_NEG_CACHE_TTL", 60))   # กรณีไม่พบแถว
REF_CACHE_TTL = float(os.environ.get("REF_CACHE_TTL", 3600))           # MFCC + ขอบเขตคำของเสียงต้นแบบ
REF_CACHE_SIZE = int(os.environ.get("REF_CACHE_SIZE", 64))
MAX_CONCURRENT_INFERENCE = int(os.environ.get("MAX_CONCURRENT_INFERENCE", 2))

class AudioInputError(Exception):
    """ไฟล์เสียงที่ผู้ใช้ส่งมาใช้ไม่ได้ (ไม่มีไฟล์/ว่าง/เงียบ/สั้น/ถอดรหัสไม่ได้)"""

class TTLCache:
    """cache ที่มีอายุและขนาดจำกัด (thread-safe)"""

    def __init__(self, ttl, maxsize=128):
        self.ttl = ttl
        self.maxsize = maxsize
        self._data = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        now = time.monotonic()
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return False, None
            expires, value = item
            if expires <= now:
                del self._data[key]
                return False, None
            self._data.move_to_end(key)
            return True, value

    def put(self, key, value, ttl=None):
        expires = time.monotonic() + (self.ttl if ttl is None else ttl)
        with self._lock:
            self._data[key] = (expires, value)
            self._data.move_to_end(key)
            while len(self._data) > self.maxsize:
                self._data.popitem(last=False)

    def clear(self):
        with self._lock:
            self._data.clear()

WORD_CACHE = TTLCache(WORD_CACHE_TTL, maxsize=512)
REF_CACHE = TTLCache(REF_CACHE_TTL, maxsize=REF_CACHE_SIZE)
_INFER_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_INFERENCE)

def clear_caches():
    """ล้าง cache ทั้งหมด"""
    WORD_CACHE.clear()
    REF_CACHE.clear()
    SENTENCE_LIST_CACHE.clear()
    MATCH_FEAT_CACHE.clear()


# โหลดโมเดล Wav2Vec2 ภาษาไทย
MODEL_ID = "airesearch/wav2vec2-large-xlsr-53-th"
processor = Wav2Vec2Processor.from_pretrained(MODEL_ID)
w2v_model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID)
w2v_model.eval()
VOCAB = processor.tokenizer.get_vocab()
BLANK_ID = processor.tokenizer.pad_token_id

# ดึงข้อความจากฐานข้อมูล
MIN_VOCAB_COVERAGE = 0.8   # ข้อความต้องมีตัวอักษรที่โมเดลรู้จัก (อักษรไทย) อย่างน้อยเท่านี้ จึงใช้ได้

def _file_basename(identifier):
    # /api/topics ส่ง audio_file_name ให้แอปเป็น path ใน bucket
    # แต่คอลัมน์ audio_file_name ใน DB เก็บแค่ชื่อไฟล์ จึงต้องตัดชื่อโฟลเดอร์ออกก่อนค้น
    return str(identifier or "").split("?")[0].rstrip("/").rsplit("/", 1)[-1]

def _fetch_sentence_row(filters):
    # select=* : ไม่ระบุชื่อคอลัมน์เอง เพื่อไม่ให้ติด HTTP 400 กรณีชื่อคอลัมน์สะกดต่างจากที่คาดไว้
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/{WORDS_TABLE}",
        params={"select": "*", **filters, "limit": 1}, # เลือกทุก Column + filter + นำมาแถวเดียว
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        timeout=10,
    )
    if response.status_code != 200:
        raise RuntimeError(f"query ตาราง {WORDS_TABLE} ไม่สำเร็จ (HTTP {response.status_code})")
    rows = response.json()
    return rows[0] if rows else None

def _segmented_column(row):
    # คืนชื่อคอลัมน์ข้อความที่เว้นวรรคแยกคำที่มีอยู่จริงในแถว (ดู WORDS_COLUMNS) หรือ None ถ้าไม่มีสักชื่อ
    for name in WORDS_COLUMNS:
        if name in row:
            return name
    return None

def _usable_words(text):
    # แยกคำตามเว้นวรรค คืน None ถ้าว่าง หรือเป็นอักษรที่โมเดลไม่รู้จัก
    words = str(text or "").split() # แปลงเป็น string แล้วแยกตามช่องว่าง
    chars = [c for w in words for c in w] # รวมทุกตัวอักษรของทุกคำอยู่ใน list เดียว
    if not chars:
        return None
    known = sum(1 for c in chars if c in VOCAB) # นับจำนวนตัวอักษร (ไทย) ที่โมเดลรู้จัก
    return words if known / len(chars) >= MIN_VOCAB_COVERAGE else None

def _lookup_words(identifier, sentence_id=None):
    # ค้นรายการคำของประโยคด้วย sentence_id เป็นหลัก
    # ถ้าไม่เจอ ค้นด้วยชื่อไฟล์เปล่า ๆ (ตัดโฟลเดอร์ออก) แล้วค่อยลองค่าเต็มตามที่ส่งมา
    sid = str(sentence_id).strip() if sentence_id is not None else ""
    sid = sid if sid.isdigit() and int(sid) > 0 else "" # รับเฉพาะ int > 0
    basename = _file_basename(identifier)

    cache_key = f"id:{sid}" if sid else f"file:{basename or identifier}"
    hit, cached = WORD_CACHE.get(cache_key)
    if hit:
        if not cached:
            return None, None
        return list(cached[0]), cached[1]

    if not SUPABASE_KEY:
        raise RuntimeError("ยังไม่ได้ตั้งค่า SUPABASE_KEY (environment variable)")

    row = None
    if sid:
        row = _fetch_sentence_row({"sentence_id": f"eq.{sid}"})
        # ยอมรับแถวที่ค้นด้วย sentence_id ก็ต่อเมื่อชื่อไฟล์เสียงในแถวสอดคล้องกับไฟล์ที่ประเมินอยู่
        if row is not None and basename:
            row_name = str(row.get(WORDS_FILE_COLUMN) or "")
            row_url = str(row.get("audio_url") or "")
            consistent = (
                not row_name
                or row_name == basename
                or str(identifier).endswith(row_name)
                or row_name.endswith(basename)
                or (row_url != "" and basename in row_url)   # audio_url คือที่มาของ path ที่แอปได้รับ
            )
            if not consistent:
                row = None
    if row is None and basename:
        row = _fetch_sentence_row({WORDS_FILE_COLUMN: f"eq.{basename}"})
    if row is None and identifier and str(identifier) != basename:
        row = _fetch_sentence_row({WORDS_FILE_COLUMN: f"eq.{identifier}"})
    if row is None and basename:
        # สำรองสุดท้าย: ค้นจาก audio_url ที่ลงท้ายด้วยชื่อไฟล์
        row = _fetch_sentence_row({"audio_url": f"like.*{basename}"})

    words, source = None, None
    if row:
        # ใช้คอลัมน์ที่แบ่งคำแล้วเป็นหลัก ถ้าไม่มี/ไม่ใช่อักษรไทย ให้ใช้ thai
        for column in [c for c in (_segmented_column(row), WORDS_FALLBACK_COLUMN) if c]:
            words = _usable_words(row.get(column))
            if words:
                source = column
                break
    if words:
        WORD_CACHE.put(cache_key, (tuple(words), source))
    else:
        WORD_CACHE.put(cache_key, None, ttl=WORD_NEG_CACHE_TTL)
    return words, source # return เป็น words, source โดย source คือชื่อคอลัมน์ที่ใช้ (None ถ้าไม่พบ)

def fetch_word_list(identifier, sentence_id=None):
    # หารายการคำของประโยค (None ถ้าไม่พบ)
    return _lookup_words(identifier, sentence_id)[0] 


# ตรวจสอบรูปแบบไฟล์เสียงจากเนื้อไฟล์จริงว่าเป็น .wav หรือไม่
def _is_wav(path):
    with open(path, "rb") as f:
        head = f.read(12)
    return head[:4] == b"RIFF" and head[8:12] == b"WAVE"

def _find_ffmpeg():
    found = shutil.which("ffmpeg") # หา ffmpeg ใน PATH ของระบบ
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None

def _decode_with_ffmpeg(path):
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        raise AudioInputError("เซิร์ฟเวอร์ยังถอดรหัสไฟล์เสียงรูปแบบนี้ไม่ได้ (ต้องติดตั้ง ffmpeg: pip install imageio-ffmpeg)")
    fd, out_path = tempfile.mkstemp(suffix=".wav") # สร้างไฟล์ชั่วคราวสำหรับผลลัพธ์ .wav ที่แปลงแล้ว
    os.close(fd)
    try:
        subprocess.run(
            [ffmpeg, "-y", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "wav", out_path],
            check=True, capture_output=True, timeout=FFMPEG_TIMEOUT,
        )
        y, _ = librosa.load(out_path, sr=SR, mono=True) # โหลดไฟล์ .wav ที่แปลงแล้วด้วย librosa เป็น array
        return y
    except subprocess.TimeoutExpired: # ffmpeg ถอดรหัสช้าเกินไป
        raise AudioInputError("ถอดรหัสไฟล์เสียงใช้เวลานานเกินไป กรุณาอัดใหม่") from None
    except subprocess.CalledProcessError: # ffmpeg ถอดรหัสไม่สำเร็จ ไฟล์เสียหรือไม่รองรับ
        raise AudioInputError("ไฟล์เสียงเสียหายหรือเป็นรูปแบบที่ไม่รองรับ กรุณาอัดใหม่") from None
    except Exception:
        raise AudioInputError("ไฟล์เสียงเสียหายหรือเป็นรูปแบบที่ไม่รองรับ กรุณาอัดใหม่") from None
    finally:
        if os.path.exists(out_path):
            os.remove(out_path) # ลบไฟล์ชั่วคราวทิ้ง

def _decode_audio(path):
    def direct():
        return librosa.load(path, sr=SR, mono=True)[0] # โหลดไฟล์เสียงด้วย librosa โดยตรง (ถ้าเป็น .wav ที่ librosa รองรับได้)

    order = [direct, lambda: _decode_with_ffmpeg(path)] # base case ลองโหลดด้วย librosa
    if not _is_wav(path): # ถ้าไม่ใช่ .wav ให้ลองด้วย ffmpeg ก่อน
        order.reverse()

    ffmpeg_err = None
    for attempt in order:
        try:
            return attempt()
        except AudioInputError as e:
            ffmpeg_err = ffmpeg_err or e
        except Exception:
            pass
    raise ffmpeg_err or AudioInputError("ไฟล์เสียงเสียหายหรือเป็นรูปแบบที่ไม่รองรับ กรุณาอัดใหม่")


""" Main Functions for Pronunciation Evaluation """

def load_audio(path):
    # โหลดเสียง (SR) และตัดเสียงเงียบหัว-ท้าย
    if not path or not os.path.isfile(path):
        raise AudioInputError("ไม่พบไฟล์เสียงที่ส่งมา กรุณาอัดเสียงใหม่")
    if os.path.getsize(path) < MIN_AUDIO_BYTES:
        raise AudioInputError("ไฟล์เสียงว่างเปล่าหรือสั้นเกินไป กรุณาอัดเสียงใหม่")

    y = _decode_audio(path) # ถอดรหัสเป็น array
    if y.size == 0 or not np.all(np.isfinite(y)):
        raise AudioInputError("ไฟล์เสียงไม่มีข้อมูลเสียงที่ใช้ได้ กรุณาอัดเสียงใหม่")
    if float(np.max(np.abs(y))) < MIN_PEAK:
        raise AudioInputError("ไม่ได้ยินเสียงพูด กรุณาพูดใกล้ไมโครโฟนมากขึ้นแล้วอัดใหม่")

    y, _ = librosa.effects.trim(y, top_db=TRIM_DB) # ตัดช่วงเสียงเงียบหัว-ท้าย
    if len(y) < MIN_AUDIO_SEC * SR: # หาก trim แล้วสั้นกว่า 0.3 วินาที ถือว่าเสียงสั้นเกินไป
        raise AudioInputError("เสียงสั้นเกินไป กรุณาอัดเสียงใหม่")
    return y # คืนค่าสัญญาณเสียงเป็น array ที่ trim แล้ว


# Feature Extraction (MFCC 13 มิติ + z-score)
def zscore(block):
    # ทำ z-score norm ต่อแถว ตามแกนเวลา
    return (block - np.mean(block, axis=1, keepdims=True)) / (
        np.std(block, axis=1, keepdims=True) + 1e-6
    )

def extract_features(y):
    # สกัด MFCC 13 มิติ ได้ shape (13, จำนวน frame)
    mfcc = librosa.feature.mfcc(y=y, sr=SR, n_mfcc=13, hop_length=HOP_LENGTH)
    return zscore(mfcc) # นำไป norm เพื่อลดผลกระทบของระดับเสียงหรือไมค์ที่ต่างกัน

def distance_to_percentage(dist, max_dist=1.2):
    if dist < 0:
        dist = 0
    score = max(0.0, (1.0 - (dist / max_dist))) * 100
    return round(score, 2)


# DTW (Dynamic Time Warping) สำหรับเปรียบเทียบเสียงต้นแบบกับเสียงผู้ใช้
def dtw_distance(feat_a, feat_b):
    # EPS ป้องกัน log(0) ที่ไม่สามารถนำไปคำนวณ cosine ได้
    a = feat_a + EPS
    b = feat_b + EPS
    try:
        # d = matrix ของ distance, wp = warping path (index ของ frame ที่ match กัน)
        d, wp = librosa.sequence.dtw(X=a, Y=b, metric="cosine")
        if np.isfinite(d[-1, -1]):
            return float(d[-1, -1]) / len(wp) # norm ด้วยความยาว path เพื่อไม่ให้ประโยคที่ยาวมีค่า distance สูงเกินไป
    except Exception:
        pass # เทียบระยะห่างทำ DTW ไม่ได้
    return float("inf")


# CTC Forced Alignment สำหรับหาระยะเวลาเริ่มต้น-สิ้นสุดของแต่ละคำในเสียงผู้ใช้
def ctc_forced_align(log_probs, targets, blank):
    # log_probs: (T เฟรม, จำนวน vocab), targets: ลำดับ token id ที่ต้องการ align
    targets = np.asarray(targets)
    T = log_probs.shape[0] # จำนวนเฟรมของเสียงผู้ใช้จาก wav2vec2
    L = len(targets)
    if L == 0:
        raise ValueError("ไม่มี token ให้ align")

    # นับคู่ token ซ้ำติดกัน (CTC ต้องมี blank คั่น)
    repeats = int(np.sum(targets[1:] == targets[:-1])) if L > 1 else 0
    need = L + repeats # จำนวนเฟรมขั้นต่ำที่ต้องมี
    if T < need:
        raise ValueError(
            f"เสียงสั้นเกินไปสำหรับข้อความนี้ (ต้องการอย่างน้อย {need} เฟรม "
            f"เพราะมี {L} ตัวอักษร ซ้ำติดกัน {repeats} คู่ แต่มีเพียง {T} เฟรม)"
        )

    S = 2 * L + 1 # จำนวน state ใน trellis: blank, token, blank, token, ..., blank
    NEG = -1e30 # แทนค่า -อนันต์ (ใช้ค่าจริงเพื่อเลี่ยงปัญหา inf ในการคำนวณ)
    ext = np.full(S, blank, dtype=np.int64) # สร้างลำดับขยายเริ่มด้วย blank ทุกช่อง
    ext[1::2] = targets # ใส่ token ลงตำแหน่งคี่ (1,3,5,...) ตำแหน่งคู่เป็น blank
    emit = log_probs[:, ext] # ดึง log prob ของแต่ละ state ในแต่ละเฟรม shape (T, S)

    skip_ok = np.zeros(S, dtype=bool) # ระบุว่า state ไหนกระโดดข้ามจาก s-2 มาได้
    for s in range(2, S):
         # ข้ามได้เมื่อเป็น token (ไม่ใช่ blank) และไม่ซ้ำกับ token ก่อนหน้า
        skip_ok[s] = ext[s] != blank and ext[s] != ext[s - 2]

    # ตาราง Dynamic Programming เก็บ log prob สูงสุดของแต่ละ state ในแต่ละเฟรม
    dp = np.full((T, S), NEG)
    # ตาราง BackPointer เก็บทิศทางย้อนกลับของ state ที่ดีที่สุด (0=stay, 1=from s-1, 2=from s-2)
    bp = np.zeros((T, S), dtype=np.int8)
    dp[0, 0] = emit[0, 0] # frame แรกเริ่มที่ blank state แรก
    dp[0, 1] = emit[0, 1] # frame แรกเริ่มที่ token state แรก
    idx = np.arange(S) # index state ไว้ใช้เลือกค่าแบบ Vectorized

    for t in range(1, T): # วนแต่ละ frame เวลาของเสียงผู้ใช้
        stay = dp[t - 1] # 0 = stay (อยู่ที่ state เดิม)
        p1 = np.full(S, NEG)
        p1[1:] = dp[t - 1, :-1] # 1 = from s-1 (มาจาก state ก่อนหน้า 1 ช่อง)
        p2 = np.full(S, NEG)
        p2[2:] = dp[t - 1, :-2] # 2 = from s-2 (มาจาก state ก่อนหน้า 2 ช่อง)
        p2[~skip_ok] = NEG
        cand = np.stack([stay, p1, p2]) # รวม log prob ของแต่ละทิศทางเป็น matrix shape (3, S)
        best = cand.argmax(axis=0) # เลือกตัวเลือกทิี่มี log prob สูงสุดของแต่ละ state
        dp[t] = cand[best, idx] + emit[t] # คะแนนสะสม = คะแนนตัวเลือก + log prob เฟรมนี้
        bp[t] = best

    s = S - 1 if dp[-1, S - 1] >= dp[-1, S - 2] else S - 2
    # state สุดท้ายต้องจบที่ blank ท้าย หรือ token สุดท้าย เลือกอันที่คะแนนดีกว่า
    if dp[-1, s] <= NEG / 2:
        raise ValueError("ไม่สามารถ align ได้ (เสียงสั้นเกินไปสำหรับข้อความ)")

    path = np.zeros(T, dtype=np.int64)
    for t in range(T - 1, -1, -1): # ย้อนรอยจากเฟรมสุดท้ายไปเฟรมแรก
        path[t] = s # บันทึก state ของเฟรมนี้
        s -= int(bp[t, s]) # ถอย state ตามตัวเลือกที่จำไว้
    return path # คืนลำดับ state (คี่ = token, คู่ = blank)

def word_to_token_ids(word):
    return [VOCAB[c] for c in word if c in VOCAB] # แปลงแต่ละตัวอักษรเป็น token id ข้ามตัวที่ไม่รู้จัก

def align_words(y, words):
    # แปลง sample rate จาก 22050 เป็น 16000 ให้ตรงกับที่โมเดลต้องการ
    y16 = librosa.resample(y, orig_sr=SR, target_sr=W2V_SR)
    inputs = processor(y16, return_tensors="pt", sampling_rate=W2V_SR).input_values
    with _INFER_SLOTS:
        with torch.inference_mode():
            logits = w2v_model(inputs).logits
    lp = torch.log_softmax(logits, dim=-1)[0].numpy()
    T = lp.shape[0] # จำนวนเฟรมของโมเดล
    frame_dur = (len(y16) / W2V_SR) / T # ระยะเวลาต่อเฟรม (วินาที) = ความยาวเสียง / จำนวนเฟรม

    kept_words, tokens, owner = [], [], [] # คำที่ใช้ได้, token รวมทุกคำ, ดัชนีคำเจ้าของแต่ละ token
    for w in words:
        ids = word_to_token_ids(w) # แปลงคำเป็น token
        if not ids: # ถ้าไม่มีคำที่ token โมเดลรู้จัก ข้ามไปเลย
            continue
        kept_words.append(w) # เก็บคำ
        for i in ids:
            tokens.append(i) # เพิ่ม token ต่อท้ายลำดับรวม
            owner.append(len(kept_words) - 1) # จดว่า token นี้เป็นของคำลำดับที่เท่าไร
    if not kept_words:
        raise ValueError("ไม่มีคำที่ align ได้")

    path = ctc_forced_align(lp, np.array(tokens), BLANK_ID) # หาว่าแต่ละเฟรมอยู่ state ไหน

    n_tok = len(tokens) # จำนวน token ทั้งหมด
    first = np.full(n_tok, -1) # เฟรมแรกที่ token นั้นปรากฏ
    last = np.full(n_tok, -1) # เฟรมสุดท้ายที่ token นั้นปรากฏ
    for t, s in enumerate(path):
        if s % 2 == 1:
            k = s // 2
            if first[k] < 0:
                first[k] = t
            last[k] = t

    peak = [float(lp[first[k]:last[k] + 1, tokens[k]].max()) for k in range(n_tok)]

    owner = np.array(owner)
    w_first, w_last, conf = [], [], [] # เฟรมเริ่ม/จบ/ความมั่นใจของแต่ละคำ
    for wi in range(len(kept_words)):
        idx = np.where(owner == wi)[0]
        w_first.append(first[idx[0]]) # เฟรมเริ่มของคำ = เฟรมแรกของ token แรก
        w_last.append(last[idx[-1]]) # เฟรมจบ = เฟรมสุดท้ายของ token สุดท้าย
        conf.append(float(np.mean([peak[k] for k in idx]))) # ความมั่นใจคำ = ค่าเฉลี่ยของ token ในคำ

    starts = [0.0] # คำแรกเริ่มที่เฟรม 0
    for i in range(1, len(kept_words)):
        # ขอบเขตระหว่างคำ = จุดกึ่งกลางของช่องว่างระหว่างคำก่อนหน้ากับคำนี้
        starts.append((w_last[i - 1] + 1 + w_first[i]) / 2.0)
    ends = starts[1:] + [float(T)] # จบของแต่ละคำ = เริ่มของคำถัดไป คำสุดท้ายจบที่ท้ายเสียง

    return [
        {
            "word": kept_words[i], # ตัวคำ
            "start_time": starts[i] * frame_dur, # เวลาเริ่ม (วินาที)
            "end_time": ends[i] * frame_dur, # เวลาจบ (วินาที)
            "conf": conf[i], # ความมั่นใจของโมเดล
        }
        for i in range(len(kept_words))
    ]


# Word Segmentation to Arrays & Word-Level Evaluation
def segment_features_to_word_arrays(feat, boundaries):
    total = feat.shape[1]
    out = []
    for b in boundaries:
        s = int(round(b["start_time"] * SR / HOP_LENGTH))
        e = int(round(b["end_time"] * SR / HOP_LENGTH))
        s = min(max(0, s), total - 1)
        e = min(max(s + 1, e), total)
        out.append({"word": b["word"], "array": feat[:, s:e], "conf": b.get("conf")})
    return out

def threshold_for_word(ref_frames, base=PASS_THRESHOLD):
    return max(base, SHORT_WORD_THRESHOLD) if ref_frames < SHORT_WORD_FRAMES else base

def evaluate_word_arrays(ref_words, user_words, pass_threshold=PASS_THRESHOLD):
    results = []
    for r, u in zip(ref_words, user_words):
        if r["word"] != u["word"]:
            raise ValueError("ลำดับคำของ ref/user ไม่ตรงกัน")
        dist = dtw_distance(r["array"], u["array"])
        finite = bool(np.isfinite(dist))
        ref_frames = int(r["array"].shape[1])
        threshold = threshold_for_word(ref_frames, pass_threshold)
        user_conf = u["conf"]
        # low_conf = โมเดลแทบไม่ได้ยินคำนี้ในเสียงผู้ใช้ (ทั้งที่เสียงต้นแบบฟังออก) นับเป็นคำที่ผิดด้วย
        # ถ้าเสียงต้นแบบเองก็ conf ต่ำ แปลว่าโมเดลไม่ถนัดคำนี้ จึงไม่ตัดสินจาก conf (ใช้ DTW อย่างเดียว)
        user_low = user_conf is not None and user_conf < LOW_CONF_LOGPROB
        ref_low = r.get("conf") is not None and r["conf"] < LOW_CONF_LOGPROB
        low_conf = bool(user_low and not ref_low)
        results.append({
            "word": r["word"],
            "dist": round(dist, 3) if finite else None,
            "threshold": threshold,
            "ref_frames": ref_frames,
            "user_frames": int(u["array"].shape[1]),
            "user_conf": round(user_conf, 3) if user_conf is not None else None,
            "low_conf": low_conf,
            "status": "PASS" if finite and dist <= threshold and not low_conf else "NEEDS_IMPROVEMENT",
        })
    return results


# ดาวน์โหลดเสียงต้นแบบจาก Supabase + Cache
def fetch_audio_from_supabase(audio_path_or_url):
    if str(audio_path_or_url).startswith("http"):
        file_url = audio_path_or_url
    else:
        file_url = f"{SUPABASE_BUCKET_URL}/{audio_path_or_url}"

    try:
        response = requests.get(file_url, timeout=15)
    except requests.RequestException as e:
        raise RuntimeError(f"ดาวน์โหลดเสียงต้นแบบไม่สำเร็จ: {e}") from e

    if response.status_code != 200:
        raise FileNotFoundError(f"ไม่สามารถดึงไฟล์ {audio_path_or_url} จาก Supabase ได้ (HTTP {response.status_code})")

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    temp_file.write(response.content)
    temp_file.close()
    return temp_file.name

def get_reference(audio_file_name, word_list):
    key_words = tuple(word_list) if word_list else None
    hit, entry = REF_CACHE.get(audio_file_name)
    if hit and entry["words"] == key_words:
        return entry

    temp_path = None
    try:
        temp_path = fetch_audio_from_supabase(audio_file_name)
        try:
            y_ref = load_audio(temp_path)
        except AudioInputError as e:
            raise RuntimeError(f"ไฟล์เสียงต้นแบบ {audio_file_name} ใช้ไม่ได้: {e}") from e
        feat_ref = extract_features(y_ref)

        bounds, align_error = None, None
        if key_words:
            try:
                bounds = align_words(y_ref, list(key_words))
            except ValueError as e:
                align_error = str(e)

        entry = {"words": key_words, "feat": feat_ref, "bounds": bounds, "align_error": align_error}
        REF_CACHE.put(audio_file_name, entry)
        return entry
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


# Compare Result
# =========================================================
def compare_result(rec_history_id, audio_file_name, user_audio_path, user_id=None, sentence_id=None,
                   words_text=None, **kwargs):
    # words_text = คอลัมน์ pronunciation (แบ่งคำแล้ว) ที่ Node อ่านจากตารางส่งมาให้
    # ค่าอื่นที่ไม่ได้ใช้ (เช่น thai_text) ถูกรับไว้ใน **kwargs
    y_user = load_audio(user_audio_path)
    feat_user = extract_features(y_user)

    word_evals = []
    word_level = False
    note = None
    words_source = None

    word_list = _usable_words(words_text) if words_text else None
    if word_list:
        words_source = WORDS_COLUMNS[0]
    else:
        try:
            word_list, words_source = _lookup_words(audio_file_name, sentence_id)
        except Exception as e:
            word_list = None
            note = f"ดึงรายการคำจาก Supabase ไม่ได้: {e} (ใช้ distance ทั้งประโยคแทน)"

    ref = get_reference(audio_file_name, word_list)
    feat_ref = ref["feat"]

    if word_list is None:
        note = note or f"ไม่พบรายการคำสำหรับ {audio_file_name} (ใช้ distance ทั้งประโยคแทน)"
    elif ref["bounds"] is None:
        note = f"ประเมินรายคำไม่ได้: {ref['align_error']} (ใช้ distance ทั้งประโยคแทน)"
    else:
        try:
            ref_bounds = ref["bounds"]
            user_bounds = align_words(y_user, [b["word"] for b in ref_bounds])
            ref_arrays = segment_features_to_word_arrays(feat_ref, ref_bounds)
            user_arrays = segment_features_to_word_arrays(feat_user, user_bounds)
            word_evals = evaluate_word_arrays(ref_arrays, user_arrays)
            word_level = True
        except ValueError as e:
            note = f"ประเมินรายคำไม่ได้: {e} (ใช้ distance ทั้งประโยคแทน)"

    if word_level:
        # ทุกคำที่ไม่ผ่าน (DTW เกินเกณฑ์ หรือโมเดลไม่ได้ยินคำนั้น) ถูกชี้ให้ผู้ใช้เสมอ
        wrong_words = [w["word"] for w in word_evals if w["status"] != "PASS"]
        is_passed = not wrong_words
        dists = [w["dist"] for w in word_evals if w["dist"] is not None]
        dist = float(np.mean(dists)) if len(dists) == len(word_evals) else float("inf")
        if is_passed:
            message = "ออกเสียงถูกทุกคำ"
        else:
            message = "ควรปรับปรุงคำ: " + ", ".join(wrong_words)
            n_unheard = sum(1 for w in word_evals if w["low_conf"])
            if n_unheard / len(word_evals) >= UNRELIABLE_WORD_RATIO:
                message = "ฟังเสียงไม่ชัดหรือไม่ตรงกับประโยค " + message
    else:
        wrong_words = []
        dist = dtw_distance(feat_ref, feat_user)
        is_passed = bool(np.isfinite(dist) and dist <= PASS_THRESHOLD)
        message = "ผ่าน" if is_passed else "ไม่ผ่าน (ตรวจได้เฉพาะระดับประโยค)"

    finite = bool(np.isfinite(dist))
    evaluation_result = {
        "status": "PASS" if is_passed else "FAIL",
        "is_passed": is_passed,
        "score_percentage": distance_to_percentage(dist) if finite else 0.0,
        "dtw_distance": round(dist, 4) if finite else None,
        "threshold_used": PASS_THRESHOLD,
        "word_level": word_level,
        "words": word_evals,
        "wrong_words": wrong_words,
        "message": message,
        # คอลัมน์ที่ใช้แบ่งคำ ("pronunciation" = แบ่งคำแล้ว, "thai" = ไม่ได้แบ่งคำ, None = ไม่ได้รายการคำ)
        "words_source": words_source,
    }
    if note:
        evaluation_result["note"] = note

    db_record = {
        "rec_history_id": rec_history_id,
        "evaluation_result": evaluation_result
    }
    if user_id is not None:
        db_record["user_id"] = user_id
    if sentence_id is not None:
        db_record["sentence_id"] = sentence_id

    return evaluation_result, db_record

async def compare_result_async(*args, **kwargs):
    """ใช้ใน endpoint แบบ async def ไม่ให้บล็อก event loop ของ FastAPI"""
    return await asyncio.to_thread(compare_result, *args, **kwargs)


# Speak to Match: เทียบเสียงผู้ใช้กับเสียงต้นแบบของทุกประโยคใน Supabase
# จัดอันดับทุกประโยคด้วย MFCC + chroma + DTW  2) เอาอันดับ 1 ไปประเมินรายคำแบบปกติ แล้วตัดสินว่าตรงจริงหรือไม่
MATCH_MIN_PASS_RATIO = 0.5     # ต้องพูดผ่านอย่างน้อยสัดส่วนนี้ของคำในประโยค (2 คำ = 1 คำ, 3 คำ = 2 คำ, 4 คำ = 2 คำ) และอย่างน้อย 1 คำ
MATCH_OPEN_ENDED_STRICTNESS = 0.6   # การค้นคำแบบไม่บังคับตำแหน่งมีอิสระมากกว่า จึงต้องใกล้กว่าเกณฑ์ปกติ (เกณฑ์ปกติ x ค่านี้) ค่านี้ยังไม่ได้ปรับจากเสียงจริง
MATCH_SHORT_FRAMES = 15        # คำที่ต้นแบบสั้นกว่านี้ (~350 ms) หาเจอได้ง่ายแม้ไม่ได้พูด จึงไม่รับจากการค้นแบบไม่บังคับตำแหน่ง
MATCH_SHORT_STRICT_DISTANCE = 0.5   # คำสั้นต้องใกล้ขนาดนี้ในการประเมินปกติถึงจะนับว่าผ่านตอน match
MATCH_EVAL_TOP_K = 3           # เอาประโยคที่ใกล้ที่สุดกี่อันดับแรกไปประเมินรายคำ (กันกรณีพูดไม่ครบแล้ว DTW ทั้งประโยคจัดอันดับพลาด)
MATCH_MAX_DISTANCE = PASS_THRESHOLD   # ใช้แทนเมื่อประเมินรายคำไม่ได้: distance รวมต้องไม่เกินค่านี้
MATCH_FETCH_WORKERS = int(os.environ.get("MATCH_FETCH_WORKERS", 8))   # ดาวน์โหลดเสียงต้นแบบพร้อมกันกี่ไฟล์
MATCH_MAX_SENTENCES = int(os.environ.get("MATCH_MAX_SENTENCES", 1000))

SENTENCE_LIST_CACHE = TTLCache(WORD_CACHE_TTL, maxsize=1)             # รายการประโยคทั้งหมด
MATCH_FEAT_CACHE = TTLCache(REF_CACHE_TTL, maxsize=2048)              # MFCC ของเสียงต้นแบบแต่ละประโยค

def _fetch_all_sentences():
    """อ่านประโยคทั้งหมดที่มีไฟล์เสียงจากตาราง Sentence (cache ไว้ช่วงสั้น ๆ)"""
    hit, cached = SENTENCE_LIST_CACHE.get("all")
    if hit:
        return cached
    if not SUPABASE_KEY:
        raise RuntimeError("ยังไม่ได้ตั้งค่า SUPABASE_KEY (environment variable)")
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/{WORDS_TABLE}",
        params={"select": "*", "limit": MATCH_MAX_SENTENCES},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        timeout=15,
    )
    if response.status_code != 200:
        raise RuntimeError(f"query ตาราง {WORDS_TABLE} ไม่สำเร็จ (HTTP {response.status_code})")
    rows = [r for r in response.json() if r.get("audio_url") or r.get(WORDS_FILE_COLUMN)]
    SENTENCE_LIST_CACHE.put("all", rows)
    return rows

def extract_match_features(y):
    """ฟีเจอร์สำหรับจับคู่ประโยค: MFCC 13 มิติ + chroma 12 มิติ (z-score แล้วต่อกัน)
    chroma ช่วยจับโทน/ระดับเสียงที่ MFCC อย่างเดียวแยกได้ไม่ดี"""
    mfcc = extract_features(y)
    chroma = zscore(librosa.feature.chroma_stft(y=y, sr=SR, hop_length=HOP_LENGTH))
    frames = min(mfcc.shape[1], chroma.shape[1])
    return np.vstack([mfcc[:, :frames], chroma[:, :frames]])

def _reference_features(row):
    """ฟีเจอร์ MFCC+chroma ของเสียงต้นแบบประโยคนี้ (None ถ้าดาวน์โหลด/ถอดรหัสไม่ได้) cache ไว้ใช้ซ้ำ"""
    source = row.get("audio_url") or row.get(WORDS_FILE_COLUMN)
    hit, feat = MATCH_FEAT_CACHE.get(source)
    if hit:
        return feat
    temp_path = None
    try:
        temp_path = fetch_audio_from_supabase(source)
        feat = extract_match_features(load_audio(temp_path))
    except Exception:
        return None   # ข้ามประโยคที่เสียงมีปัญหา ไม่ให้ทั้งการจับคู่ล้ม (ไม่ cache เผื่อลองใหม่ได้)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
    MATCH_FEAT_CACHE.put(source, feat)
    return feat

def enough_words_passed(passed, total):
    """ผ่านอย่างน้อยครึ่งหนึ่งของคำในประโยค (และอย่างน้อย 1 คำ)"""
    return total > 0 and passed >= 1 and passed >= MATCH_MIN_PASS_RATIO * total

def subsequence_distance(query, target):
    """ระยะ DTW ของ query กับ 'ช่วงใดก็ได้' ของ target (เริ่ม/จบตรงไหนของ target ก็ได้) หารด้วยความยาว path
    ใช้ตรวจว่าคำ/เสียงหนึ่งปรากฏอยู่ที่ไหนสักแห่งในเสียงอีกชุด โดยไม่ต้องรู้ว่าอยู่ตำแหน่งไหน"""
    try:
        cost, path = librosa.sequence.dtw(X=query + EPS, Y=target + EPS, metric="cosine", subseq=True)
        end = int(path[0, 1])
        if np.isfinite(cost[-1, end]):
            return float(cost[-1, end]) / len(path)
    except Exception:
        pass
    return float("inf")

def _open_ended_words(row, audio_name, feat_user):
    """ประเมินรายคำแบบไม่บังคับตำแหน่ง ใช้ตอนผู้ใช้พูดไม่ครบประโยค:
    แต่ละคำของเสียงต้นแบบถูกค้นหาในเสียงผู้ใช้ทั้งก้อน (subsequence DTW) คำที่ไม่ได้พูดจะหาไม่เจอ
    ต่างจากการประเมินปกติที่บังคับ align ทุกคำลงบนเสียงผู้ใช้ ซึ่งพังเมื่อพูดมาแค่บางคำ"""
    word_list = _usable_words(row.get("pronunciation")) or _usable_words(row.get("thai"))
    if not word_list:
        return []
    ref = get_reference(audio_name, word_list)
    if not ref["bounds"]:
        return []
    results = []
    for item in segment_features_to_word_arrays(ref["feat"], ref["bounds"]):
        frames = int(item["array"].shape[1])
        threshold = round(threshold_for_word(frames) * MATCH_OPEN_ENDED_STRICTNESS, 3)
        cost = subsequence_distance(item["array"], feat_user)
        finite = bool(np.isfinite(cost))
        results.append({
            "word": item["word"],
            "dist": round(cost, 3) if finite else None,
            "threshold": threshold,
            "ref_frames": frames,
            "status": "PASS" if finite and cost <= threshold else "NEEDS_IMPROVEMENT",
        })
    return results

def _evaluate_candidate(row, user_audio_path, distance, feat_user):
    """ประเมินเสียงผู้ใช้กับประโยคนี้ คืน (matched, words, passed, total)
    ประเมิน 2 แบบแล้วรวมผลรายคำ (แต่ละคำเอาผลที่ dist ต่ำกว่า):
      - แบบปกติ: align ทุกคำลงบนเสียงผู้ใช้ (เหมาะเมื่อพูดครบประโยค)
      - แบบไม่บังคับตำแหน่ง: ค้นแต่ละคำในเสียงผู้ใช้ทั้งก้อน (เหมาะเมื่อพูดมาแค่บางคำ)"""
    audio_name = row.get("audio_url") or row.get(WORDS_FILE_COLUMN)
    normal = []
    try:
        evaluation, _ = compare_result(
            rec_history_id="match",
            audio_file_name=audio_name,
            user_audio_path=user_audio_path,
            sentence_id=row.get("sentence_id"),
            words_text=row.get("pronunciation"),
        )
        if evaluation["word_level"]:
            normal = evaluation["words"]
        else:
            dtw = evaluation["dtw_distance"]
            if dtw is not None and dtw <= MATCH_MAX_DISTANCE:
                return True, [], 0, 0
    except (AudioInputError, ValueError, RuntimeError, FileNotFoundError):
        pass

    try:
        open_ended = _open_ended_words(row, audio_name, feat_user)
    except (AudioInputError, ValueError, RuntimeError, FileNotFoundError):
        open_ended = []

    if normal and open_ended and [w["word"] for w in normal] == [w["word"] for w in open_ended]:
        def better(a, b):   # เอาผลที่ผ่าน/ใกล้กว่า
            if (a["status"] == "PASS") != (b["status"] == "PASS"):
                return a if a["status"] == "PASS" else b
            return a if (a["dist"] if a["dist"] is not None else 9) <= (b["dist"] if b["dist"] is not None else 9) else b
        words = [better(a, b) for a, b in zip(normal, open_ended)]
    else:
        words = normal or open_ended

    if words:
        for w in words:
            frames = w.get("ref_frames") or 0
            if w["status"] == "PASS" and frames < MATCH_SHORT_FRAMES:
                if w.get("dist") is None or w["dist"] > MATCH_SHORT_STRICT_DISTANCE:
                    w["status"] = "NEEDS_IMPROVEMENT"
        long_words = [w for w in words if (w.get("ref_frames") or 0) >= MATCH_SHORT_FRAMES]
        if long_words and not any(w["status"] == "PASS" for w in long_words):
            for w in words:    # มีคำยาวแต่ไม่มีคำยาวไหนผ่านเลย แปลว่าคำสั้นที่ผ่านน่าจะบังเอิญ
                w["status"] = "NEEDS_IMPROVEMENT"
        passed = sum(1 for w in words if w["status"] == "PASS")
        return enough_words_passed(passed, len(words)), words, passed, len(words)
    return distance <= MATCH_MAX_DISTANCE, [], 0, 0

def match_sentence(user_audio_path, candidates=None):
    """หาประโยคที่เสียงผู้ใช้ใกล้เคียงที่สุดจากเสียงต้นแบบทั้งระบบ (ส่งกลับอันดับเดียว)

    ขั้น 1: เทียบ MFCC + chroma ด้วย DTW กับทุกประโยค เอา MATCH_EVAL_TOP_K อันดับแรก
    ขั้น 2: ประเมินแต่ละประโยคแบบปกติ (รายคำ) ประโยคที่ "ตรง" คือพูดผ่านอย่างน้อยครึ่งของคำในประโยคนั้น
            (หรือประเมินรายคำไม่ได้และ distance รวมไม่เกิน MATCH_MAX_DISTANCE)
            ถ้ามีหลายประโยคที่ตรง เลือกอันที่ dist เฉลี่ยของทุกคำต่ำสุด เสมอกันดูสัดส่วนคำผ่าน แล้วค่อยดู DTW

    candidates: (ไม่บังคับ) list ของ { sentence_id } เพื่อจำกัดวงการค้นหา ถ้าไม่ส่งจะค้นทั้งระบบ
    returns: { matched: bool, matched_sentence_id, matched_detail, matched_label, matched_image_url,
               distance, words, words_passed, words_total }
             ถ้า matched=False ฟิลด์ matched_* เป็น None
    """
    y_user = load_audio(user_audio_path)
    feat_user = extract_match_features(y_user)
    feat_user_mfcc = feat_user[:13]   # ส่วน MFCC ใช้ประเมินรายคำ (ชุดเดียวกับการประเมินปกติ)

    rows = _fetch_all_sentences()
    if candidates:
        wanted = {str(c.get("sentence_id")) for c in candidates if isinstance(c, dict)}
        rows = [r for r in rows if str(r.get("sentence_id")) in wanted]
    if not rows:
        raise ValueError("ไม่มีประโยคให้จับคู่")

    with ThreadPoolExecutor(max_workers=MATCH_FETCH_WORKERS) as pool:
        features = list(pool.map(_reference_features, rows))

    ranked = []
    for row, feat_ref in zip(rows, features):
        if feat_ref is None:
            continue
        # เสียงครบทั้งประโยค -> เทียบทั้งก้อน / พูดมาแค่บางส่วน -> ผู้ใช้เป็นช่วงหนึ่งของต้นแบบ เอาค่าที่ใกล้กว่า
        dist = min(dtw_distance(feat_ref, feat_user), subsequence_distance(feat_user, feat_ref))
        if np.isfinite(dist):
            ranked.append((dist, row))
    if not ranked:
        raise RuntimeError("ไม่สามารถอ่านเสียงต้นแบบของประโยคใดได้เลย")
    ranked.sort(key=lambda item: item[0])

    best = None   # (key, dist, row, words, passed, total)
    for dist, row in ranked[:MATCH_EVAL_TOP_K]:
        ok, words, passed, total = _evaluate_candidate(row, user_audio_path, dist, feat_user_mfcc)
        if not ok:
            continue
        # คัดเลือกจากประโยคที่ "ตรง" แล้ว: ประโยคที่คำของเสียงต้นแบบใกล้เสียงผู้ใช้ที่สุดโดยรวม (dist เฉลี่ยทุกคำต่ำสุด)
        # เสมอกันดูสัดส่วนคำที่ผ่าน แล้วค่อยดู DTW ทั้งประโยค
        word_dists = [w["dist"] if w.get("dist") is not None else 1.0 for w in words]
        closeness = float(np.mean(word_dists)) if word_dists else dist
        key = (-closeness, passed / total if total else 0.0, -dist)
        if best is None or key > best[0]:
            best = (key, dist, row, words, passed, total)

    result = {
        "matched": best is not None,
        "matched_sentence_id": None,
        "matched_detail": None,
        "matched_label": None,
        "matched_image_url": None,
        "distance": round(best[1] if best else ranked[0][0], 4),
        "words": [],
        "words_passed": 0,
        "words_total": 0,
    }
    if best:
        _, _, row, words, passed, total = best
        result.update({
            "matched_sentence_id": str(row.get("sentence_id")),
            "matched_detail": row.get("thai") or "",
            "matched_label": row.get("label") or row.get("thai") or "",
            "matched_image_url": row.get("image_url"),
            "words": words,
            "words_passed": passed,
            "words_total": total,
        })
    return result
import json
import os

import librosa
import numpy as np
import torch
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

REF_FOLDER = "refaudio/"
USER_FOLDER = "useraudio/"
METADATA_PATH = "word_metadata.json"

# ─────────────────────────────────────────────────────
# ค่าคงที่รวมไว้ที่เดียว (sr / hop ต้องใช้ชุดเดียวกันทั้งไฟล์)
# ─────────────────────────────────────────────────────
SR = 22050              # sample rate สำหรับสกัด feature
HOP_LENGTH = 512        # hop ของ MFCC/Chroma (ใช้แปลงเวลา -> เฟรม)
W2V_SR = 16000          # sample rate ที่ wav2vec2 ต้องการ
TRIM_DB = 20            # threshold ตัดเสียงเงียบหัว-ท้าย
# ── ค่าจับคู่ประโยค: ตั้งให้เหมือนโค้ดต้นฉบับที่ match ถูก ──
L1_DIVISOR = "path"        # ตัวหาร Layer 1: "path" = len(wp) | "max_t" = max(t_ref, t_user) | "none" = ต้นทุนสะสมตรง ๆ
L2_DIVISOR = "max_t"       # ตัวหาร Layer 2 (ต้นฉบับใช้ max(t_ref, t_user))
TRIGGER_THRESHOLD = 0.10  # ถ้า top1/top2 ต่างกันน้อยกว่านี้ ให้ใช้ Layer 2
TOP_K_LAYER2 = 2        # จำนวนผู้เข้ารอบที่ Layer 2 ตรวจซ้ำ (ต้นฉบับ = 2)
PASS_THRESHOLD = 0.65   # threshold รายคำ (ควร calibrate กับข้อมูลจริง)
EPS = 1e-8

# ─────────────────────────────────────────────────────
# โหลดโมเดล Wav2Vec2 ภาษาไทย (ใช้ทำ CTC forced alignment)
# ─────────────────────────────────────────────────────
MODEL_ID = "airesearch/wav2vec2-large-xlsr-53-th"
processor = Wav2Vec2Processor.from_pretrained(MODEL_ID)
w2v_model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID)
w2v_model.eval()
VOCAB = processor.tokenizer.get_vocab()
BLANK_ID = processor.tokenizer.pad_token_id

# ─────────────────────────────────────────────────────
# โหลด "รายการคำ" ของแต่ละประโยค Reference
# ใช้เฉพาะข้อความของคำตามลำดับ (ไม่ใช้เวลาใน metadata อีกต่อไป
# เพราะ wav2vec2 จะหาขอบเขตเวลาเองทั้งฝั่ง ref และ user)
# รองรับทั้งรูปแบบเดิม [{"word":..., "start_time":..., ...}] และ ["คำ1", "คำ2"]
# ─────────────────────────────────────────────────────
def load_word_lists(path):
    if not os.path.exists(path):
        print(f"⚠️ ไม่พบไฟล์ {path} กรุณาตรวจสอบตำแหน่งไฟล์")
        return {}
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    out = {}
    for fname, items in raw.items():
        words = [it["word"] if isinstance(it, dict) else str(it) for it in items]
        out[fname] = [w for w in words if w.strip()]
    return out

WORD_LISTS = load_word_lists(METADATA_PATH)

# ─────────────────────────────────────────────────────
# Feature Extraction
# MFCC และ Chroma ใช้การ normalize แบบเดียวกัน: z-score ต่อสัมประสิทธิ์
# (ลบ mean หาร std ตลอดประโยค) เหมือนโค้ดต้นฉบับ
# ─────────────────────────────────────────────────────
def load_audio(path):
    """โหลด (SR) และตัดเสียงเงียบหัว-ท้าย
    สัญญาณที่ trim แล้วนี้ใช้ทั้งสกัด feature และทำ alignment
    เวลาทุกอย่างจึงอ้างอิงจุดเริ่มต้นเดียวกัน"""
    y, _ = librosa.load(path, sr=SR)
    y, _ = librosa.effects.trim(y, top_db=TRIM_DB)
    return y

def zscore(block):
    return (block - np.mean(block, axis=1, keepdims=True)) / (
        np.std(block, axis=1, keepdims=True) + 1e-6
    )

def extract_features(y):
    """Layer 1: MFCC 13 มิติ (z-score)"""
    mfcc = librosa.feature.mfcc(y=y, sr=SR, n_mfcc=13, hop_length=HOP_LENGTH)
    return zscore(mfcc)

def extract_fusion_features(y):
    """Layer 2: MFCC (13) + Chroma (12) = 25 มิติ ใช้ z-score แบบเดียวกัน"""
    chroma = librosa.feature.chroma_stft(
        y=y, sr=SR, n_chroma=12, hop_length=HOP_LENGTH
    )
    return np.vstack([extract_features(y), zscore(chroma)])

# ─────────────────────────────────────────────────────
# DTW
# ทั้งประโยค: ตัวหารตาม L1_DIVISOR / L2_DIVISOR
# รายคำ: หารด้วย len(wp) เสมอ
# ─────────────────────────────────────────────────────
def dtw_distance(feat_a, feat_b, norm="path"):
    """คืนค่า distance (inf ถ้าคำนวณไม่ได้) — DTW แบบไม่จำกัดเส้นทาง
    norm: "max_t" = cost / max(t_a, t_b), "path" = cost / len(wp), "none" = cost สะสมตรง ๆ"""
    a = feat_a + EPS
    b = feat_b + EPS
    try:
        d, wp = librosa.sequence.dtw(X=a, Y=b, metric="cosine")
        if np.isfinite(d[-1, -1]):
            cost = float(d[-1, -1])
            if norm == "max_t":
                return cost / max(a.shape[1], b.shape[1])
            if norm == "path":
                return cost / len(wp)
            return cost
    except Exception:
        pass
    return float("inf")

# ─────────────────────────────────────────────────────
# CTC forced alignment (Viterbi) — เขียนเองเพื่อไม่พึ่ง torchaudio ที่เปลี่ยน API บ่อย
# ─────────────────────────────────────────────────────
def ctc_forced_align(log_probs, targets, blank):
    """log_probs: (T, C), targets: ลำดับ token id
    คืน path: state ที่แต่ละเฟรมอยู่ (คี่ = token index s//2, คู่ = blank)"""
    T = log_probs.shape[0]
    L = len(targets)
    if L == 0:
        raise ValueError("ไม่มี token ให้ align")
    if T < L:
        raise ValueError("เสียงสั้นเกินไปสำหรับข้อความนี้")

    S = 2 * L + 1
    NEG = -1e30
    ext = np.full(S, blank, dtype=np.int64)
    ext[1::2] = targets
    emit = log_probs[:, ext]  # (T, S)

    skip_ok = np.zeros(S, dtype=bool)
    for s in range(2, S):
        skip_ok[s] = ext[s] != blank and ext[s] != ext[s - 2]

    dp = np.full((T, S), NEG)
    bp = np.zeros((T, S), dtype=np.int8)
    dp[0, 0] = emit[0, 0]
    dp[0, 1] = emit[0, 1]
    idx = np.arange(S)

    for t in range(1, T):
        stay = dp[t - 1]
        p1 = np.full(S, NEG)
        p1[1:] = dp[t - 1, :-1]
        p2 = np.full(S, NEG)
        p2[2:] = dp[t - 1, :-2]
        p2[~skip_ok] = NEG
        cand = np.stack([stay, p1, p2])
        best = cand.argmax(axis=0)
        dp[t] = cand[best, idx] + emit[t]
        bp[t] = best

    s = S - 1 if dp[-1, S - 1] >= dp[-1, S - 2] else S - 2
    if dp[-1, s] <= NEG / 2:
        raise ValueError("ไม่สามารถ align ได้ (เสียงสั้นเกินไปสำหรับข้อความ)")

    path = np.zeros(T, dtype=np.int64)
    for t in range(T - 1, -1, -1):
        path[t] = s
        s -= int(bp[t, s])
    return path

def word_to_token_ids(word):
    """แปลงคำเป็น token id ทีละตัวอักษร (ข้ามตัวที่ไม่อยู่ใน vocab)"""
    missing = [c for c in word if c not in VOCAB]
    if missing:
        print(f"⚠️ ตัวอักษรไม่อยู่ใน vocab ของโมเดล (ข้าม): {''.join(missing)} ในคำ '{word}'")
    return [VOCAB[c] for c in word if c in VOCAB]

def align_words(y, words):
    """ใช้ wav2vec2 + CTC forced alignment หาขอบเขตเวลาของแต่ละคำ
    ใช้ได้ทั้งเสียง ref และ user (เวลาเป็นวินาทีนับจากต้นสัญญาณที่ trim แล้ว)

    CTC ให้ 'จุดยอด' ของแต่ละตัวอักษรเพียง 1-2 เฟรม จึงกำหนดขอบเขตคำเป็น
    จุดกึ่งกลางระหว่างตัวอักษรสุดท้ายของคำก่อนหน้า กับตัวอักษรแรกของคำถัดไป
    (คำแรกเริ่มที่ 0 คำสุดท้ายจบที่ท้ายสัญญาณ) เพื่อให้ครอบคลุมทั้งคำ
    """
    y16 = librosa.resample(y, orig_sr=SR, target_sr=W2V_SR)
    inputs = processor(y16, return_tensors="pt", sampling_rate=W2V_SR).input_values
    with torch.no_grad():
        logits = w2v_model(inputs).logits
    lp = torch.log_softmax(logits, dim=-1)[0].numpy()
    T = lp.shape[0]
    frame_dur = (len(y16) / W2V_SR) / T

    kept_words, tokens, owner = [], [], []
    for w in words:
        ids = word_to_token_ids(w)
        if not ids:
            print(f"⚠️ ข้ามคำ '{w}' (ไม่มี token ที่ใช้ได้)")
            continue
        kept_words.append(w)
        for i in ids:
            tokens.append(i)
            owner.append(len(kept_words) - 1)
    if not kept_words:
        raise ValueError("ไม่มีคำที่ align ได้")

    path = ctc_forced_align(lp, np.array(tokens), BLANK_ID)

    n_tok = len(tokens)
    first = np.full(n_tok, -1)
    last = np.full(n_tok, -1)
    for t, s in enumerate(path):
        if s % 2 == 1:
            k = s // 2
            if first[k] < 0:
                first[k] = t
            last[k] = t

    owner = np.array(owner)
    w_first, w_last, conf = [], [], []
    for wi in range(len(kept_words)):
        idx = np.where(owner == wi)[0]
        w_first.append(first[idx[0]])
        w_last.append(last[idx[-1]])
        conf.append(float(np.mean([lp[first[k], tokens[k]] for k in idx])))

    starts = [0.0]
    for i in range(1, len(kept_words)):
        starts.append((w_last[i - 1] + 1 + w_first[i]) / 2.0)
    ends = starts[1:] + [float(T)]

    return [
        {
            "word": kept_words[i],
            "start_time": starts[i] * frame_dur,
            "end_time": ends[i] * frame_dur,
            "conf": conf[i],  # avg log-prob ของตัวอักษรในคำ (ต่ำ = โมเดลไม่ค่อยมั่นใจ)
        }
        for i in range(len(kept_words))
    ]

# ─────────────────────────────────────────────────────
# Word Segmentation to Arrays & Word-Level Evaluation
# ใช้ list ตามลำดับ (ไม่ใช้ dict ที่คำซ้ำจะถูกเขียนทับ)
# ─────────────────────────────────────────────────────
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

def evaluate_word_arrays(ref_words, user_words, pass_threshold=PASS_THRESHOLD):
    results = []
    for r, u in zip(ref_words, user_words):
        assert r["word"] == u["word"], "ลำดับคำของ ref/user ไม่ตรงกัน"
        dist = dtw_distance(r["array"], u["array"], norm="path")
        results.append({
            "word": r["word"],
            "dist": round(dist, 3),
            "ref_frames": r["array"].shape[1],
            "user_frames": u["array"].shape[1],
            "user_conf": u["conf"],
            "status": "PASS" if dist <= pass_threshold else "NEEDS_IMPROVEMENT",
        })
    return results

# ─────────────────────────────────────────────────────
# Reference cache: คำนวณ feature / alignment ของ ref ครั้งเดียว
# ─────────────────────────────────────────────────────
REF_CACHE = {}

def build_ref_cache():
    for f in sorted(os.listdir(REF_FOLDER)):
        if not f.lower().endswith(".wav"):
            continue
        try:
            y = load_audio(os.path.join(REF_FOLDER, f))
        except Exception as e:
            print(f"⚠️ โหลด ref ไม่ได้: {f} ({e})")
            continue
        REF_CACHE[f] = {"y": y, "mfcc": extract_features(y), "fusion": None, "align": None}
        if f not in WORD_LISTS:
            print(f"⚠️ ไม่มีรายการคำสำหรับ {f} (จะข้ามการประเมินรายคำ)")

def get_ref_features(ref_file, kind):
    c = REF_CACHE[ref_file]
    if kind == "fusion":
        if c["fusion"] is None:
            c["fusion"] = extract_fusion_features(c["y"])
        return c["fusion"]
    return c["mfcc"]

def get_ref_alignment(ref_file):
    c = REF_CACHE[ref_file]
    if c["align"] is None:
        c["align"] = align_words(c["y"], WORD_LISTS[ref_file])
    return c["align"]

# ─────────────────────────────────────────────────────
# Matching & Selector Logic
# ─────────────────────────────────────────────────────
def run_smart_selector(user_filename):
    u_path = os.path.join(USER_FOLDER, user_filename)
    y_user = load_audio(u_path)
    feat_user_mfcc = extract_features(y_user)
    feat_user_fusion = None

    # --- LAYER 1: MFCC Matching ---
    results = []
    for r_file in REF_CACHE:
        dist = dtw_distance(
            get_ref_features(r_file, "mfcc"), feat_user_mfcc,
            norm=L1_DIVISOR,
        )
        results.append({"Ref": r_file, "Dist": dist, "Layer": "Layer 1 (MFCC)", "kind": "mfcc"})
    results.sort(key=lambda x: x["Dist"])

    if not results or not np.isfinite(results[0]["Dist"]):
        print(f"\n❌ ไม่สามารถจับคู่ประโยคสำหรับ {user_filename}")
        return None

    # --- LAYER 2: MFCC + Chroma ตรวจซ้ำเมื่อ top1/top2 ใกล้กันมาก ---
    if len(results) >= 2:
        d1, d2 = results[0]["Dist"], results[1]["Dist"]
        if np.isfinite(d2) and (d2 - d1) / (d1 + EPS) < TRIGGER_THRESHOLD:
            feat_user_fusion = extract_fusion_features(y_user)
            k = min(TOP_K_LAYER2, len(results))
            layer2 = []
            for cand in results[:k]:
                dist = dtw_distance(
                    get_ref_features(cand["Ref"], "fusion"), feat_user_fusion,
                    norm=L2_DIVISOR,
                )
                layer2.append({
                    "Ref": cand["Ref"], "Dist": dist,
                    "Layer": "Layer 2 (MFCC + Chroma)", "kind": "fusion",
                })
            layer2.sort(key=lambda x: x["Dist"])
            # ผู้เข้ารอบจัดอันดับใหม่ด้วย Layer 2 ส่วนที่เหลือคงอันดับ Layer 1
            # (distance คนละสเกล เทียบข้ามกลุ่มไม่ได้)
            results = layer2 + results[k:]

    best = results[0]
    print(f"\n📢 วิเคราะห์ประโยค: {user_filename}")
    print(f"{'Rank':<6} | {'Reference':<35} | {'Distance'} | {'Decided By'}")
    print("-" * 80)
    for i, res in enumerate(results[:3], 1):
        print(f"{i:<6} | {res['Ref']:<35} | {res['Dist']:>8.3f} | {res['Layer']}")
    print("-" * 80)
    print(f">>> ประโยคที่ตรงกันที่สุด: {best['Ref']}")

    # ── Word-Level Evaluation ──
    word_evals = []
    ref_file = best["Ref"]
    if ref_file not in WORD_LISTS:
        print("\nℹ️ ไม่พบรายการคำสำหรับไฟล์นี้ (ข้ามการประเมินย่อย)")
        return {"user": user_filename, "best_ref": ref_file, "ranking": results, "words": word_evals}

    try:
        kind = best["kind"]
        ref_feat = get_ref_features(ref_file, kind)
        if kind == "fusion":
            user_feat = feat_user_fusion
        else:
            user_feat = feat_user_mfcc

        # 1. ขอบเขตคำของ ref และ user ด้วย wav2vec2 (ใช้ข้อความคำชุดเดียวกัน)
        ref_bounds = get_ref_alignment(ref_file)
        words = [b["word"] for b in ref_bounds]
        user_bounds = align_words(y_user, words)

        # 2. หั่น feature เป็น array รายคำ
        ref_arrays = segment_features_to_word_arrays(ref_feat, ref_bounds)
        user_arrays = segment_features_to_word_arrays(user_feat, user_bounds)

        # 3. เทียบรายคำ
        word_evals = evaluate_word_arrays(ref_arrays, user_arrays)

        print("\n🔍 ผลประเมินการออกเสียงรายคำ (Word Array vs Word Array):")
        for item in word_evals:
            icon = "✅" if item["status"] == "PASS" else "❌"
            print(
                f"   {icon} คำว่า: {item['word']:<8} | Distance: {item['dist']:<6} | "
                f"Frames (Ref/User): {item['ref_frames']}/{item['user_frames']} | "
                f"Align conf: {item['user_conf']:.2f} | สถานะ: {item['status']}"
            )
    except ValueError as e:
        print(f"\n⚠️ ประเมินรายคำไม่ได้: {e}")

    return {"user": user_filename, "best_ref": ref_file, "ranking": results, "words": word_evals}

# ─────────────────────────────────────────────────────
# Batch Matching
# ─────────────────────────────────────────────────────
def run_batch_matching():
    user_files = [f for f in os.listdir(USER_FOLDER) if f.lower().endswith(".wav")]
    if not user_files:
        print("❌ ไม่พบไฟล์ .wav ใน newuser/")
        return []

    build_ref_cache()
    if not REF_CACHE:
        print("❌ ไม่พบไฟล์ .wav ใน newref/")
        return []

    print(f"\n🔍 เริ่มตรวจสอบทั้งหมด {len(user_files)} ไฟล์\n")
    return [run_smart_selector(u) for u in user_files]

if __name__ == "__main__":
    run_batch_matching()
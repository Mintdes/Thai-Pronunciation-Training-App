from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from typing import Optional
import asyncio
import os
import re
import tempfile
import traceback
import uvicorn
import jwt

load_dotenv()

# 🎯 นำเข้าฟังก์ชันจาก stdModel
# compare_result_async รันงานหนัก (librosa/wav2vec2/DTW) ใน thread ไม่บล็อก event loop ของ FastAPI
# AudioInputError = ไฟล์เสียงผู้ใช้ใช้ไม่ได้ (ไม่มีไฟล์/ว่าง/เงียบ/สั้น/เสีย) ข้อความไทยพร้อมแสดงให้ผู้ใช้
from stdModel import compare_result_async, match_sentence, AudioInputError

app = FastAPI(title="Thai Pronunciation Evaluation API")

# ตรวจ JWT token เดียวกับที่ฝั่ง Node (APIServer.cjs) ออกให้ตอน login
# JWT ตรวจสอบตัวเองได้ (self-contained) ไม่ต้องต่อ DB เดียวกับ Node แค่ใช้ JWT_SECRET ตัวเดียวกัน
JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError(
        "Missing required environment variable: JWT_SECRET. "
        "ต้องตั้งให้ตรงกับค่าที่ใช้ใน APIServer.cjs (ฝั่ง Node) เพื่อให้ตรวจ token เดียวกันได้"
    )

def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบก่อนใช้งาน")

    token = authorization[len("Bearer "):]
    try:
        # jsonwebtoken (ฝั่ง Node) เซ็นด้วย HS256 เป็นค่า default อยู่แล้ว ให้ตรงกัน
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload  # { userId, email }
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่")

# จำกัดขนาดไฟล์เสียงสูงสุด กันเซิร์ฟเวอร์โดน DOS ด้วยไฟล์ใหญ่ผิดปกติ
MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024  # 10MB

# จำกัด origin ให้เหมือนฝั่ง APIServer.cjs
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/pronounce/evaluate")
async def evaluate_pronunciation(
    # audio เป็น optional เพื่อให้ตอบ 400 พร้อมข้อความไทยเองเมื่อไม่ได้ส่งไฟล์มา
    # (ถ้าใช้ File(...) FastAPI จะตอบ 422 พร้อม detail เป็น list ที่แอปอ่านไม่ออก)
    audio: Optional[UploadFile] = File(None),
    sentence_id: str = Form(None),
    id: str = Form(None),
    audio_file_name: str = Form(None),
    sentence_file_name: str = Form(None),
    rec_history_id: str = Form(...),
    thai_text: str = Form(""),
    # ข้อความไทยที่แบ่งคำด้วยเว้นวรรคแล้ว (คอลัมน์ pronunciation) ที่ Node อ่านผ่าน Prisma แล้วส่งมา
    # stdModel ใช้ก่อนการอ่านตารางผ่าน Supabase REST (กันกรณีติด RLS/คีย์ anon อ่านไม่ได้)
    words_text: str = Form(""),
    current_user: dict = Depends(get_current_user)
):
    temp_user_audio_path = None
    try:
        # รวมค่าเพื่อรองรับทั้งสองชื่อ
        # ไม่ตั้งค่าเริ่มต้นเป็น "1"
        # (None = ให้ stdModel ค้นด้วยชื่อไฟล์เสียงแทน)
        resolved_sentence_id = sentence_id or id or None
        resolved_audio_file = audio_file_name or sentence_file_name or ""

        if audio is None:
            raise HTTPException(status_code=400, detail="ไม่ได้รับไฟล์เสียง กรุณาอัดเสียงใหม่")

        content = await audio.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="ไฟล์เสียงว่างเปล่า กรุณาอัดเสียงใหม่")

        if len(content) > MAX_AUDIO_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"ไฟล์เสียงมีขนาดใหญ่เกินไป (จำกัดไม่เกิน {MAX_AUDIO_SIZE_BYTES // (1024*1024)}MB)"
            )

        # บันทึกลง Temp File โดยคงนามสกุลเดิมไว้ (wav/m4a/webm ฯลฯ)
        # stdModel ตรวจชนิดไฟล์จากเนื้อไฟล์จริง
        suffix = os.path.splitext(audio.filename or "")[1].lower()
        if not re.fullmatch(r"\.[a-z0-9]{1,5}", suffix):
            suffix = ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(content)
            temp_user_audio_path = temp_file.name

        print(f"📦 Received user audio file size: {os.path.getsize(temp_user_audio_path)} bytes")

        eval_result, db_record = await compare_result_async(
            user_id=current_user["userId"],
            rec_history_id=rec_history_id,
            sentence_id=resolved_sentence_id,
            audio_file_name=resolved_audio_file,
            user_audio_path=temp_user_audio_path,
            thai_text=thai_text,
            words_text=words_text
        )

        return {"success": True, "data": eval_result}

    except HTTPException:
        raise
    except AudioInputError as e:
        # ไฟล์เสียงผู้ใช้ใช้ไม่ได้ (เงียบ/สั้น/เสีย ฯลฯ): ข้อความเขียนให้ผู้ใช้อ่านได้ ไม่มีรายละเอียดภายใน
        print(f"⚠️ Bad user audio: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        # ไม่พบเสียงต้นแบบของประโยคนี้ใน Supabase (ปัญหาข้อมูล ไม่ใช่ความผิดของผู้ใช้) log ไว้ ตอบข้อความทั่วไป
        print(f"❌ Reference audio missing: {e}")
        raise HTTPException(status_code=404, detail="ไม่พบเสียงต้นแบบของประโยคนี้ กรุณาลองประโยคอื่นหรือแจ้งผู้ดูแล")
    except Exception as e:
        # แสดงชนิด exception + traceback เต็ม (บาง exception เช่น NoBackendError มี str(e) ว่างเปล่า)
        print(f"❌ Traceback Error: {type(e).__name__}: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดในการประมวลผลเสียง กรุณาลองใหม่อีกครั้ง")
    finally:
        if temp_user_audio_path and os.path.exists(temp_user_audio_path):
            os.remove(temp_user_audio_path)

@app.post("/api/pronounce/match")
async def match_pronunciation(
    audio: UploadFile = File(...),
    # (ไม่บังคับ) JSON string ของ list[{ sentence_id }] เพื่อจำกัดประโยคที่จะเทียบ ไม่ส่ง = เทียบทั้งระบบ
    candidates: str = Form(""),
    current_user: dict = Depends(get_current_user)
):
    """
    Speak to Match: เทียบเสียงผู้ใช้กับเสียงต้นแบบของทุกประโยคใน Supabase (ผ่าน stdModel)
    แล้วตอบประโยคที่ใกล้เคียงที่สุด (candidates ไม่บังคับ: ใช้จำกัดวงการค้นหา)
    """
    import json
    temp_user_audio_path = None
    try:
        content = await audio.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="ไฟล์เสียงที่ส่งมามีขนาด 0 Bytes")
        if len(content) > MAX_AUDIO_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"ไฟล์เสียงใหญ่เกิน {MAX_AUDIO_SIZE_BYTES // (1024*1024)}MB"
            )

        candidates_list = None
        if candidates.strip():
            try:
                candidates_list = json.loads(candidates)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="รูปแบบ candidates ไม่ถูกต้อง (ต้องเป็น JSON array)")
            if not isinstance(candidates_list, list):
                raise HTTPException(status_code=400, detail="candidates ต้องเป็น JSON array")

        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
            temp_file.write(content)
            temp_user_audio_path = temp_file.name

        # match_sentence ใช้ CPU หนัก: รันใน thread ไม่ให้บล็อก event loop
        result = await asyncio.to_thread(match_sentence, temp_user_audio_path, candidates_list)
        return {"success": True, "data": result}

    except HTTPException:
        raise
    except AudioInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ValueError, RuntimeError) as e:
        # ไม่มีประโยค/เสียงต้นแบบให้เทียบ (ปัญหาข้อมูลฝั่งระบบ ไม่ใช่ความผิดผู้ใช้)
        print(f"❌ match_pronunciation no reference: {e}")
        raise HTTPException(status_code=404, detail="ไม่พบเสียงต้นแบบสำหรับเทียบ กรุณาลองใหม่ภายหลังหรือแจ้งผู้ดูแล")
    except Exception as e:
        print(f"❌ match_pronunciation error: {type(e).__name__}: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="เกิดข้อผิดพลาดในการจับคู่เสียง กรุณาลองใหม่")
    finally:
        if temp_user_audio_path and os.path.exists(temp_user_audio_path):
            os.remove(temp_user_audio_path)


if __name__ == "__main__":
    # 🎯 แก้ไข: เดิม reload=True ถูก hardcode ไว้ตายตัว ซึ่งเหมาะกับตอน dev เท่านั้น
    # เปลี่ยนให้ควบคุมผ่าน env var แทน (ปิดเป็นค่าเริ่มต้น) กันเผื่อสคริปต์นี้ถูกรันขึ้นจริง
    # โดยไม่ได้ตั้งใจเปิด dev mode ทิ้งไว้
    dev_reload = os.environ.get("DEV_RELOAD", "false").lower() == "true"
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=dev_reload)

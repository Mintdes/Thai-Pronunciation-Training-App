import * as FileSystem from 'expo-file-system/legacy';

const RECORDINGS_DIR = FileSystem.documentDirectory + 'recordings/';
const MAX_FILES = 50;        // เก็บไว้แค่ 50 ไฟล์ล่าสุด
const MAX_AGE_DAYS = 7;      // หรือลบไฟล์ที่เก่ากว่า 7 วัน

// เรียกครั้งแรกตอนแอปเปิด เพื่อให้แน่ใจว่าโฟลเดอร์มีอยู่
async function ensureDirExists() {
  const dirInfo = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
  }
}

// เรียกทุกครั้งหลังบันทึกเสียงใหม่ หรือตอนเปิดแอป
export async function cleanupOldRecordings() {
  await ensureDirExists();
  const files = await FileSystem.readDirectoryAsync(RECORDINGS_DIR);

  // ดึงข้อมูลวันที่แก้ไขของแต่ละไฟล์
  const fileInfos = await Promise.all(
    files.map(async (name) => {
      const path = RECORDINGS_DIR + name;
      const info = await FileSystem.getInfoAsync(path, { md5: false });
      return { name, path, modificationTime: info.modificationTime };
    })
  );

  const now = Date.now() / 1000;
  const maxAgeSeconds = MAX_AGE_DAYS * 24 * 60 * 60;

  // 1. ลบไฟล์ที่เก่าเกินกำหนด
  const stillValid = [];
  for (const file of fileInfos) {
    if (now - file.modificationTime > maxAgeSeconds) {
      await FileSystem.deleteAsync(file.path, { idempotent: true });
    } else {
      stillValid.push(file);
    }
  }

  // 2. ถ้ายังเกินจำนวนสูงสุด ให้ลบไฟล์เก่าสุดออกจนเหลือ MAX_FILES
  if (stillValid.length > MAX_FILES) {
    stillValid.sort((a, b) => a.modificationTime - b.modificationTime); // เก่าสุดอยู่หน้า
    const toDelete = stillValid.slice(0, stillValid.length - MAX_FILES);
    for (const file of toDelete) {
      await FileSystem.deleteAsync(file.path, { idempotent: true });
    }
  }
}

// เรียกตอนบันทึกเสียงเสร็จ เพื่อย้ายไฟล์จาก temp ของ expo-av เข้าโฟลเดอร์ที่จัดการ
// (ก่อนหน้านี้ไฟล์นี้ไม่ได้ถูก export/import ไปใช้ที่ไหนเลย จึงไม่มีการล้างไฟล์เก่าจริง)
// 🎯 แก้ไข: เดิม hardcode นามสกุลไฟล์ปลายทางเป็น '.m4a' เสมอ ทำให้ไฟล์ iOS (.wav จริง)
// ถูกเปลี่ยนนามสกุลผิด ตอนนี้ดึงนามสกุลจาก tempUri เดิมแทน
export async function saveRecording(tempUri) {
  await ensureDirExists();
  const extensionMatch = tempUri.match(/\.[a-zA-Z0-9]+$/);
  const extension = extensionMatch ? extensionMatch[0] : '.m4a';
  const fileName = `recording_${Date.now()}${extension}`;
  const newPath = RECORDINGS_DIR + fileName;
  await FileSystem.moveAsync({ from: tempUri, to: newPath });
  await cleanupOldRecordings(); // เช็คลบไฟล์เก่าทุกครั้งที่บันทึกใหม่
  return newPath;
}

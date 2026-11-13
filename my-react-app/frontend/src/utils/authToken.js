import AsyncStorage from '@react-native-async-storage/async-storage';

// 🎯 เพิ่มใหม่: เก็บ JWT token ที่ได้จากตอน login ไว้ (persist ผ่าน AsyncStorage เหมือน learningStats.js
// เพื่อให้ยังล็อกอินค้างอยู่ได้แม้ปิดแอปแล้วเปิดใหม่) backend ตอนนี้ต้องการ token นี้แนบไปกับ
// endpoint ที่ต้องยืนยันตัวตน (เช่น เปลี่ยนอีเมล) ผ่าน header 'Authorization: Bearer <token>'

const TOKEN_STORAGE_KEY = 'thaiApp.authToken';

export async function saveAuthToken(token) {
  try {
    await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch (err) {
    console.error('saveAuthToken failed', err);
  }
}

export async function loadAuthToken() {
  try {
    return await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
  } catch (err) {
    console.error('loadAuthToken failed', err);
    return null;
  }
}

export async function clearAuthToken() {
  try {
    await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch (err) {
    console.error('clearAuthToken failed', err);
  }
}

// Helper: สร้าง headers พร้อม Authorization แนบไปกับ fetch ที่ต้องยืนยันตัวตน
export function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

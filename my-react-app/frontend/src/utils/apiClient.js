import { authHeaders } from './authToken';

// 🎯 เพิ่มใหม่: รวม fetch call ไปหา backend ให้เป็น helper เดียว
// เดิม header 'ngrok-skip-browser-warning': 'true' ถูก copy-paste มือซ้ำในทุกไฟล์ที่ยิง fetch
// (LoginScreen.js, ChangeEmailScreen.js, PracticeScreen.js, learningStats.js) เสี่ยงพิมพ์ผิด/
// ลืมใส่ในจุดใหม่ ๆ ที่เพิ่มเข้ามาทีหลัง รวมเป็นจุดเดียวตรงนี้แทน
//
// หมายเหตุ: ไม่ใช้กับ multipart/form-data (เช่น อัปโหลดไฟล์เสียง/รูป) เพราะ browser/RN ต้อง
// เป็นคนเซ็ต Content-Type + boundary เอง ถ้าเราตั้ง Content-Type ทับจะพังทันที ดูพารามิเตอร์
// isFormData ด้านล่าง

export async function apiFetch(url, { method = 'GET', body, token, isFormData = false, extraHeaders = {} } = {}) {
  const headers = {
    'ngrok-skip-browser-warning': 'true',
    ...authHeaders(token),
    ...extraHeaders,
  };

  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  return response;
}

// อ่าน response เป็น JSON อย่างปลอดภัย: ถ้า server/ngrok ตอบเป็น HTML (ขึ้นต้นด้วย '<')
// จะไม่ throw "JSON Parse error: Unexpected character: <" แต่ log ต้นเหตุแล้วคืน { message } แทน
// ใช้แทน response.json() ได้เลย และดู log '[Non-JSON]' ใน Metro เพื่อรู้ว่า HTML มาจากไหน
export async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    console.warn('[Non-JSON]', response.url, response.status, text.slice(0, 300));
    return { message: `Server error (HTTP ${response.status})` };
  }
}
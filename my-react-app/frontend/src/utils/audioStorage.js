import { supabase } from './supabaseClient';

// 🎯 แก้ไข: เดิม bucket ชื่อ 'audio' ถูก hardcode ไว้ตายตัว ใช้ไม่ได้กับ bucket อื่น
// (เช่น 'sentences-audio' ที่ ChooseSentenceScreen.js ต้องใช้) เพิ่ม parameter bucket
// โดยยังคง default เป็น 'audio' ไว้เผื่อโค้ดเดิมที่เรียกแบบ argument เดียว
export function getAudioUrl(fileName, bucket = 'audio') {
  const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
  return data.publicUrl;
}
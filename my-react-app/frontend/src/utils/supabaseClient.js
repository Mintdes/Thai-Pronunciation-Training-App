import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// 🎯 แก้ไข: เดิมถ้าลืมตั้งค่า .env แอปจะ crash ด้วย error ภายในของ library เอง
// (เช่น "supabaseUrl is required.") ซึ่งไม่บอกสาเหตุจริงให้ dev รู้ชัดเจน
// เพิ่ม validation ที่บอกตรง ๆ ว่าต้องตั้งค่าตัวแปรอะไรใน .env
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing Supabase config: please set EXPO_PUBLIC_SUPABASE_URL and ' +
    'EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file (see .env.example if available).'
  );
}

// 🎯 เพิ่มกลับมา (เดิมมีใน supabaseAudio_m.js แต่หายไปตอนย้ายมาใช้ .env):
// - AsyncStorage: ให้ session ของ Supabase Auth คงอยู่ข้ามการปิด-เปิดแอป
// - react-native-url-polyfill: จำเป็นสำหรับ Supabase client บน React Native
//   เพราะ RN engine (Hermes) ไม่มี URL API ในตัวแบบ browser/Node
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
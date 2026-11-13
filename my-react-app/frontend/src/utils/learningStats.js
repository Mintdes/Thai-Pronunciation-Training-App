import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../screens/LoginScreen';
import { apiFetch } from './apiClient';

// จัดการสถิติการเรียน (บทเรียนที่จบ / แบบฝึกหัดที่จบ / Weekly ที่จบ)
// เก็บไว้ผ่าน AsyncStorage (RN ไม่มี localStorage) — interface (ชื่อฟังก์ชัน + shape ของ stats) ยังใช้เหมือนเดิม
// หมายเหตุ: ฟังก์ชันที่เขียนข้อมูล (recordExercise) เป็น async เพราะ
// AsyncStorage เป็น API แบบ async ล้วน ผู้เรียกใช้ต้อง await ผลลัพธ์ก่อนนำไป setState

const STORAGE_KEY_PREFIX = 'thaiApp.learningStats';

// 🎯 แก้ไข: เดิม STORAGE_KEY เป็นค่าคงที่ตัวเดียวทั้งเครื่อง ไม่แยกตาม user เลย ถ้ามีคนสอง
// account ใช้เครื่องเดียวกัน (login คนละครั้ง) แล้วดันออฟไลน์ตอนเพิ่งสลับ account พอดี
// (fetchStatsFromServer ล้มเหลว) จะเห็น local cache ของบัญชีเก่าแทน ต้องแยก key ตาม user
// รับ userKey (แนะนำให้ใช้ email ที่ normalize แล้ว) มา suffix ต่อท้าย key เสมอ
const getStorageKey = (userKey) => `${STORAGE_KEY_PREFIX}:${userKey || 'anonymous'}`;

// 🎯 แก้ไข: เดิมจำนวนประโยคต่อระดับ (TOTAL_SENTENCES_BY_LEVEL) hardcode ไว้ในไฟล์นี้ ซึ่งไม่ตรงกับ
// ความจริงอีกต่อไปเพราะประโยคทั้งหมดมาจาก DB (admin เพิ่ม/ลบ/ย้ายได้) ตอนนี้ดึงรายการประโยคจริง
// แยกตามระดับจาก server (GET /api/sentence-index) แล้วคิด % จากรายการนั้นแทน

const DEFAULT_STATS = {
  exercisesCompleted: 0,
  completedSentenceIds: [], // เก็บรายการ "thai text" ของประโยคที่เคยฝึกผ่านแล้ว (dedup)
};

// 🎯 แก้ไข: field เก่าที่เลิกใช้แล้ว (practiceHistory / streakDays / totalMinutes / lastActiveDate)
// - practiceHistory: ย้ายไปบันทึกที่ backend ตาราง PracticeAttempt ตอนเรียก /api/pronounce/evaluate
// - streakDays / totalMinutes / lastActiveDate: ยกเลิกฟีเจอร์ streak และเวลาเรียน
// ฟังก์ชันนี้ตัด field เหล่านี้ที่อาจค้างอยู่ใน cache ของเครื่อง หรือที่ server ส่งมา ออก
// ไม่ให้ถูก push กลับขึ้นไปอีก
const stripLegacyFields = (stats) => {
  const { practiceHistory, streakDays, totalMinutes, lastActiveDate, ...rest } = stats;
  return rest;
};

// 🎯 เพิ่มใหม่: exercisesCompleted = จำนวนประโยคที่พูดผ่านแล้ว (ไม่ซ้ำ) = completedSentenceIds.length เสมอ
// เดิมนับทุกครั้งที่ฝึก (รวมไม่ผ่าน/พูดซ้ำ) ค่าเก่าที่ค้างใน cache/DB จึงสูงเกินจริง
// ฟังก์ชันนี้ทำให้ค่าตรงกับนิยามใหม่ทุกครั้งที่โหลด (ทั้งจาก AsyncStorage และจาก server)
// 🎯 ประโยค Weekly เก็บใน completedSentenceIds ด้วย key 'weekly:<sentence_id>' แต่ "ไม่นับ" เป็น Exercise
// แยกไปนับเป็น Weekly Completed แทน (ดู getWeeklyCompleted)
const WEEKLY_KEY_PREFIX = 'weekly:';
const isWeeklyKey = (id) => typeof id === 'string' && id.startsWith(WEEKLY_KEY_PREFIX);
const countExercises = (ids) => (Array.isArray(ids) ? ids.filter((id) => !isWeeklyKey(id)).length : 0);

const normalizeStats = (stats) => ({
  ...stats,
  exercisesCompleted: countExercises(stats.completedSentenceIds),
});

export async function loadStats(userKey) {
  try {
    const raw = await AsyncStorage.getItem(getStorageKey(userKey));
    if (!raw) return { ...DEFAULT_STATS };
    const parsed = JSON.parse(raw);
    return normalizeStats(stripLegacyFields({ ...DEFAULT_STATS, ...parsed }));
  } catch (err) {
    console.error('loadStats failed', err);
    return { ...DEFAULT_STATS };
  }
}

export async function saveStats(stats, userKey) {
  try {
    await AsyncStorage.setItem(getStorageKey(userKey), JSON.stringify(stats));
  } catch (err) {
    console.error('saveStats failed', err);
  }
}

// ----------------------------------------------------
// 🎯 เพิ่มใหม่: ผูกสถิติกับ user จริงผ่าน backend แทนที่จะอยู่แค่ใน AsyncStorage ของเครื่อง
// AsyncStorage ยังใช้เป็น local cache ต่อไป (ให้แอปใช้งานได้แม้ออฟไลน์/backend ล่มชั่วคราว)
// แต่ตอน login แล้วจะพยายามดึงค่าจริงจาก server มาก่อนเสมอ และ push การเปลี่ยนแปลงขึ้นไปด้วย
// ----------------------------------------------------

// โหลดสถิติ: ถ้ามี token พยายามดึงจาก server ก่อน (source of truth) ถ้าเน็ตหลุด/ไม่มี token
// ค่อย fallback ไปใช้ค่าที่ cache ไว้ใน AsyncStorage แทน
export async function fetchStatsFromServer(token, userKey) {
  if (!token) return null;
  try {
    const response = await apiFetch(`${API_URL}/api/learning-stats`, { method: 'GET', token });
    if (!response.ok) return null;
    const data = await response.json();
    const stats = normalizeStats(stripLegacyFields({ ...DEFAULT_STATS, ...data.stats }));
    await saveStats(stats, userKey); // อัปเดต local cache (ของ user คนนี้เท่านั้น) ให้ตรงกับ server
    return stats;
  } catch (err) {
    console.error('fetchStatsFromServer failed (ใช้ local cache แทน)', err);
    return null;
  }
}

// บันทึกขึ้น server แบบ best-effort — ถ้าส่งไม่สำเร็จ (ออฟไลน์/backend ล่ม) จะไม่ throw
// เพราะ local cache (AsyncStorage) ยังมีค่าล่าสุดอยู่แล้วเสมอ ไม่ทำให้ผู้ใช้เสียข้อมูลระหว่างใช้งาน
export async function pushStatsToServer(stats, token) {
  if (!token) return;
  try {
    const response = await apiFetch(`${API_URL}/api/learning-stats`, { method: 'PUT', body: stats, token });
    if (!response.ok) {
      const body = await readJson(response);
      console.warn('pushStatsToServer: server rejected', response.status, body?.message);
    }
  } catch (err) {
    console.warn('pushStatsToServer network error:', err?.name, err?.message);
  }
}

// เรียกตอนฝึกออกเสียงจบ 1 ครั้ง (ได้ผลประเมินกลับมาแล้ว)
// 🎯 แก้ไข: นิยามใหม่ — 1 exercise = 1 ประโยคที่พูดผ่านเป็นครั้งแรก
// sentenceMeta: { passed } — ถ้าไม่ผ่าน หรือเคยผ่านประโยคนี้แล้ว จะไม่เปลี่ยนสถิติใดๆ
// (เดิมบวก exercisesCompleted ทุกครั้งที่ฝึก ไม่ว่าจะผ่านหรือไม่) ฝึกไม่ผ่านยังฝึกซ้ำได้จนกว่าจะผ่าน
// หมายเหตุ: ประวัติรายครั้ง + timestamp ไม่ได้เก็บที่นี่ server บันทึกเองตอนประเมินผล (PracticeAttempt)
export async function recordExercise(stats, sentenceId, token, userKey, sentenceMeta = {}) {
  const passed = sentenceMeta.passed === true;
  const alreadyCompleted = !!sentenceId && stats.completedSentenceIds.includes(sentenceId);
  if (!passed || !sentenceId || alreadyCompleted) {
    return stats;
  }

  const nextCompletedIds = [...stats.completedSentenceIds, sentenceId];
  const next = {
    ...stats,
    exercisesCompleted: countExercises(nextCompletedIds),
    completedSentenceIds: nextCompletedIds,
  };
  await saveStats(next, userKey);
  pushStatsToServer(next, token);
  return next;
}

// ดึงรายการประโยค (thai text) แยกตามระดับ { easy: [...], medium: [...] } จาก server
// คืน null ถ้าดึงไม่ได้ (ผู้เรียกควรคงค่าเดิมไว้)
export async function fetchLevelSentenceIndex() {
  try {
    const response = await fetch(API_URL + '/api/sentence-index', {
      headers: { 'ngrok-skip-browser-warning': 'true' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      easy: data.easy || [],
      medium: data.medium || [],
      // 🎯 เพิ่มใหม่: ประโยคจัดกลุ่มตามบท { easy: [{ title, sentences: [thai...] }], medium: [...] }
      topics: { easy: data.topics?.easy || [], medium: data.topics?.medium || [] },
    };
  } catch (err) {
    console.error('fetchLevelSentenceIndex failed', err);
    return null;
  }
}

// 🎯 แก้ไข: นิยามใหม่ — 1 lesson = 1 บท (topic) ที่ผ่านครบทุกประโยคในบทนั้น
// (เดิมนับเป็นจำนวนประโยคที่ผ่าน ซึ่งซ้ำกับ exercises) levelSentences มาจาก fetchLevelSentenceIndex()
// ถ้ายังโหลดไม่เสร็จ คืน 0
export function isTopicCompleted(stats, topicSentences) {
  if (!Array.isArray(topicSentences) || topicSentences.length === 0) return false;
  const done = new Set(stats.completedSentenceIds);
  return topicSentences.every((thai) => done.has(thai));
}

export function getLessonsCompleted(stats, levelSentences = null) {
  const topicsByLevel = levelSentences?.topics;
  if (!topicsByLevel) return 0;
  let count = 0;
  for (const levelId of ['easy', 'medium']) {
    for (const topic of topicsByLevel[levelId] ?? []) {
      if (isTopicCompleted(stats, topic.sentences)) count += 1;
    }
  }
  return count;
}

// จำนวน "แบบฝึกหัด" ที่จบ = จำนวนประโยค (ไม่ซ้ำ) ในบทเรียนที่พูดผ่านแล้ว (ไม่รวมประโยค Weekly)
export function getExercisesCompleted(stats) {
  return countExercises(stats.completedSentenceIds);
}

// จำนวนประโยค Weekly (ไม่ซ้ำ) ที่พูดผ่านแล้ว — แยกจาก Exercise Completed
export function getWeeklyCompleted(stats) {
  return Array.isArray(stats.completedSentenceIds) ? stats.completedSentenceIds.filter(isWeeklyKey).length : 0;
}

// % ความคืบหน้าของระดับนั้น = ประโยคที่ฝึกผ่านแล้ว (นับเฉพาะที่ยังมีอยู่ในระดับนั้นจริง) / ประโยคทั้งหมดในระดับ
// levelSentences: ผลจาก fetchLevelSentenceIndex() — ถ้ายังโหลดไม่เสร็จ/ระดับนั้นไม่มีประโยค คืน 0
export function getOverallProgressPercent(stats, levelId = 'easy', levelSentences = null) {
  const list = levelSentences?.[levelId] ?? [];
  if (list.length === 0) return 0;
  const inLevel = new Set(list);
  const done = stats.completedSentenceIds.filter((id) => inLevel.has(id)).length;
  return Math.min(100, Math.round((done / list.length) * 100));
}
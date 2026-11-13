import { supabase } from './supabaseClient';

// 🎯 helper กลาง: แปลง sentenceItem ให้พร้อมส่งเข้า PracticeScreen (มี audio.uri แล้ว)
//
// รองรับ 2 แบบ:
//   1. Sentence จาก DB (Topic+Sentence table) — มี audio_url โดยตรง → ใช้เลย ไม่ query ซ้ำ
//   2. Sentence แบบ hardcode เดิม — ไม่มี audio_url → query SentenceFile ตาม sentence_id
//
// คืน null ถ้าหาเสียงไม่ได้
export async function resolveSentenceAudio(sentenceItem) {
  if (!sentenceItem?.sentence_id) return null;

  // Fast-path: ถ้า sentence มี audio_url จาก DB แล้ว ใช้เลย (ไม่ต้อง query SentenceFile)
  if (sentenceItem.audio_url) {
    return {
      sentence_id: sentenceItem.sentence_id,
      audio_file_name: sentenceItem.audio_file_name || '',
      thai: sentenceItem.thai,
      karaoke: sentenceItem.karaoke,
      eng: sentenceItem.eng,
      image: sentenceItem.image || (sentenceItem.image_url ? { uri: sentenceItem.image_url } : undefined),
      audio: { uri: sentenceItem.audio_url },
    };
  }

  // Legacy-path: hardcode sentences ที่ไม่มี audio_url → ดึงจาก SentenceFile
  try {
    const { data, error } = await supabase
      .from('SentenceFile')
      .select('audio_file_name')
      .eq('sentence_id', Number(sentenceItem.sentence_id))
      .maybeSingle();

    if (error) {
      console.error('resolveSentenceAudio: Database Error:', error.message);
      return null;
    }

    if (!data || !data.audio_file_name) {
      console.warn('⚠️ resolveSentenceAudio: หาข้อมูลชื่อไฟล์ไม่เจอใน Database สำหรับ ID:', sentenceItem.sentence_id);
      return null;
    }

    const fileName = data.audio_file_name.trim();

    const { data: storageData } = supabase.storage
      .from('sentences-audio')
      .getPublicUrl(fileName);

    return {
      sentence_id: sentenceItem.sentence_id,
      audio_file_name: fileName,
      thai: sentenceItem.thai,
      karaoke: sentenceItem.karaoke,
      eng: sentenceItem.eng,
      image: sentenceItem.image,
      audio: { uri: storageData.publicUrl },
    };
  } catch (err) {
    console.error('resolveSentenceAudio failed:', err.message);
    return null;
  }
}
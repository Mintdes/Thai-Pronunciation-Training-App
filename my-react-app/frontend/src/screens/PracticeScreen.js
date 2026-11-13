import {
  AudioQuality,
  createAudioPlayer,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, ScrollView, Text } from 'react-native';
import styled from 'styled-components/native';
import microphoneImg from '../assets/microphone.png';
import previousImg from '../assets/previous.png';
import recordImg from '../assets/recordingbutton.png';
import speakerImg from '../assets/speaker.png';
import { saveRecording } from '../utils/recordingManager';
import { API_URL } from './LoginScreen';

const ViewContainer = styled.View`
  width: 100%;
  align-items: center;
  margin-top: 20px;
`;

const HeaderRow = styled.View`
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const TextBackButton = styled.TouchableOpacity`
  width: 30px;
`;
const PreviousButton = styled.Image`
  width: 30px;
  height: 30px;
  resize-mode: contain;
`;

const WhiteCard = styled.View`
  width: 100%;
  background-color: white;
  border-radius: 30px;
  padding: 25px 20px;
  align-items: center;
  margin-bottom: 20px;
`;

const Illustration = styled.Image`
  width: 120px;
  height: 120px;
  resize-mode: contain;
  margin-bottom: 25px;
  margin-top: -20px;
`;

const ThaiPhrase = styled.Text`
  font-size: 24px;
  font-family: 'Sarabun_700Bold';
  color: #000;
  line-height: 40px;
  text-align: center;
  align-self: stretch;
`;

const PronunciationText = styled.Text`
  font-size: 18px;
  font-family: 'Sarabun_600SemiBold_Italic';
  color: #f97316;
  margin: 10px 0;
  text-align: center;
`;

const EngTranslation = styled.Text`
  font-size: 18px;
  color: #222;
  font-family: 'Sarabun_500Medium';
  text-align: center;
  align-self: stretch;
`;

const SpeakerButton = styled.TouchableOpacity``;

const SpeakerIcon = styled.Image`
  width: 40px;
  height: 40px;
  resize-mode: contain;
  margin-top: 20px;
`;

const RecordButton = styled.Image`
  width: 40px;
  height: 40px;
  resize-mode: contain;
`;

const MicrophoneButton = styled.Image`
  width: 40px;
  height: 40px;
  resize-mode: contain;
`;

const WaveformRow = styled.View`
  width: 100%;
  height: 70px;
  background-color: #ffffff;
  border-radius: 20px;
  border-color: #000000;
  border-width: 1px;
  margin-bottom: 20px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 0 10px;
`;

const WaveBar = styled(Animated.View)`
  width: 4px;
  border-radius: 2px;
  background-color: #f97316;
`;

const MicButton = styled.TouchableOpacity`
  width: 70px;
  height: 70px;
  background-color: ${(props) => (props.isRecording ? '#fb7e7e' : '#fb7e7e')};
  border-radius: 35px;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
`;

const TapToSpeakText = styled.Text`
  font-size: 14px;
  font-family: 'Sarabun_500Medium';
  color: ${(props) => (props.isRecording ? '#dc2626' : '#333')};
`;

const ResultContainer = styled.View`
  margin-top: 10px;
  padding: 15px;
  background-color: ${(props) => (props.isPassed ? '#f0fdf4' : '#fef2f2')};
  border-radius: 20px;
  align-items: center;
  width: 100%;
  border-width: 1px;
  border-color: ${(props) => (props.isPassed ? '#bbf7d0' : '#fecaca')};
`;

const ScoreText = styled.Text`
  font-size: 16px;
  font-family: 'Sarabun_700Bold';
  color: ${(props) => (props.isPassed ? '#16a34a' : '#dc2626')};
`;

// 🎯 แสดงผลรายคำแบบใน wordPracticeScreen: เขียว = ออกเสียงถูก, แดง = ควรปรับปรุง
const WordsRow = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 5px;
`;

const WordChip = styled.View`
  background-color: ${(props) => (props.isPassed ? '#dcfce7' : '#fee2e2')};
  border-color: ${(props) => (props.isPassed ? '#16a34a' : '#dc2626')};
  border-width: 1px;
  border-radius: 12px;
  padding: 4px 10px;
  margin: 3px;
`;

const WordText = styled.Text`
  font-size: 16px;
  font-family: 'Sarabun_600SemiBold';
  color: ${(props) => (props.isPassed ? '#16a34a' : '#dc2626')};
`;

// 🎯 ปุ่ม "ประโยคถัดไป" / "จบบทเรียน"
const NextButton = styled.TouchableOpacity`
  margin-top: 10px;
  background-color: #000000;
  padding: 12px 30px;
  border-radius: 999px;
  align-items: center;
  opacity: ${(props) => (props.disabled ? 0.6 : 1)};
`;

const NextButtonText = styled.Text`
  color: #ffffff;
  font-size: 14px;
  font-family: 'Sarabun_700Bold';
`;

// ปุ่ม Completed (ประโยค Weekly): แสดงแทนปุ่ม Next Sentence / End of this Lesson เมื่อพูดผ่าน กดแล้วกลับหน้า Home (onBack)
const CompletedBadge = styled.TouchableOpacity`
  margin-top: 10px;
  background-color: #16a34a;
  padding: 12px 30px;
  border-radius: 999px;
  align-items: center;
`;

const TryAgainButton = styled.TouchableOpacity`
  background-color: #f97316;
  padding: 14px 40px;
  border-radius: 999px;
  align-items: center;
  margin-bottom: 12px;
`;

const NUM_BARS = 24;

// อัดเสียงสั้นกว่านี้ถือว่าไม่ได้พูด (มิลลิวินาที) ไม่ส่งขึ้น server
const MIN_RECORDING_MS = 400;

// ชนิดไฟล์เสียงที่แต่ละอุปกรณ์อัดออกมาจริง: iOS = .wav, Android = .m4a (AAC), เว็บ = .webm/.mp4
// ส่ง mime ตามนามสกุลของไฟล์จริง ไม่ติดป้าย wav ให้ไฟล์ที่ไม่ใช่ wav
// (server ถอดรหัสด้วย ffmpeg ตามเนื้อไฟล์ ไม่เชื่อป้าย/นามสกุล)
const AUDIO_MIME_BY_EXT = {
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  caf: 'audio/x-caf',
  '3gp': 'audio/3gpp',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
};

function getAudioMimeType(uri) {
  const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(uri || '');
  const ext = match ? match[1].toLowerCase() : 'wav';
  return AUDIO_MIME_BY_EXT[ext] || 'application/octet-stream';
}

const RECORDING_OPTIONS = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 128000,
  isMeteringEnabled: true,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    extension: '.wav',
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

// allowRetryAfterPass: พูดผ่านแล้วแสดงปุ่ม Try again แทนปุ่มไมค์ (false = ไม่มีปุ่มอะไรอีก เช่นในหน้า Assessment)
// isWeekly: ฝึกประโยค Weekly -> พูดผ่านแล้วขึ้น Completed แทน Next Sentence / End of this Lesson
// maxRetries: จำนวนครั้งที่พูดใหม่ได้เมื่อยังไม่ผ่าน (null = ไม่จำกัด) พอหมดแล้วซ่อนปุ่มไมค์
// onRecordingChange: เรียกทุกครั้งที่สถานะอัดเสียงเปลี่ยน (true/false) ให้หน้าแม่ใช้ซ่อน/แสดงปุ่มอื่น เช่น Skip
function PracticeScreen({
  onBack, phraseData, authToken, onExerciseComplete, onNext, isLastSentence, isLoadingNext,
  allowRetryAfterPass = true, maxRetries = null, isWeekly = false,
  onRecordingChange,
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState(null);
  const [attempts, setAttempts] = useState(0);   // จำนวนครั้งที่ประเมินแล้วสำหรับประโยคนี้

  const recorder = useAudioRecorder(RECORDING_OPTIONS);

  const soundRef = useRef(null);
  const scrollRef = useRef(null);
  const playIdRef = useRef(0);
  const meteringIntervalRef = useRef(null);
  const barAnimsRef = useRef(
    Array.from({ length: NUM_BARS }, () => new Animated.Value(4))
  );

  // 🎯 ดึงผลการตรวจรายคำจาก evaluationResult
  const wordResults = evaluationResult?.words ?? [];
  const wrongWords = evaluationResult?.wrong_words ?? [];
  const hasPassed = Boolean(evaluationResult?.is_passed);
  const retriesExhausted = !hasPassed && maxRetries !== null && attempts > maxRetries;

  // หยุดและปล่อยเสียงที่กำลังเล่นอยู่ทันที (synchronous) พร้อมทำให้คำสั่งเล่นที่ยัง await ค้างอยู่หมดอายุ
  // กันกรณีกดรัว ๆ / ออกจากหน้า ระหว่างที่ยังรอ setAudioModeAsync แล้วไปสร้าง player ซ้อนขึ้นมาทีหลัง
  const stopAudio = () => {
    playIdRef.current += 1;
    const player = soundRef.current;
    soundRef.current = null;
    if (player) {
      try { player.pause(); } catch (e) { /* ignore */ }
      try { player.remove(); } catch (e) { /* ignore */ }
    }
  };

  const handlePlayAudio = async () => {
    if (!phraseData?.audio) return;
    // ทุกครั้งที่กด: หยุดเสียงเดิมก่อน แล้วเริ่มเล่นใหม่ตั้งแต่ต้น
    stopAudio();
    const myPlayId = playIdRef.current;
    try {
      // กำลังอัดเสียงอยู่ -> ยุติการอัดอัตโนมัติ (ทิ้งเสียงที่อัดค้างไว้) ก่อนเล่นเสียงต้นแบบ
      if (recorder.isRecording) {
        await cancelRecording();
        if (myPlayId !== playIdRef.current) return;
      }

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });

      // ระหว่างรอ มีการกดใหม่ / เปลี่ยนหน้า / เริ่มอัดเสียง -> ยกเลิกการเล่นนี้
      if (myPlayId !== playIdRef.current) return;

      const source = typeof phraseData.audio === 'string'
        ? { uri: phraseData.audio }
        : phraseData.audio;

      const player = createAudioPlayer(source);
      player.volume = 1.0;
      soundRef.current = player;
      player.play();
    } catch (err) {
      console.error('Play audio error:', err);
      Alert.alert('Error', 'ไม่สามารถเล่นไฟล์เสียงต้นแบบได้');
    }
  };

  const updateWaveformFromMetering = (meteringDb) => {
    const normalized = Math.min(1, Math.max(0, (meteringDb + 60) / 60));
    barAnimsRef.current.forEach((anim) => {
      const jitter = 0.6 + Math.random() * 0.4;
      const height = 4 + normalized * 60 * jitter;
      Animated.timing(anim, {
        toValue: height,
        duration: 100,
        useNativeDriver: false,
      }).start();
    });
  };

  const startRecording = async () => {
    stopAudio();   // กำลังเล่นเสียงต้นแบบอยู่ ให้หยุดก่อนอัดเสียง
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Denied', 'Please allow microphone access.');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync();
      recorder.record();

      meteringIntervalRef.current = setInterval(() => {
        try {
          const recStatus = recorder.getStatus();
          if (typeof recStatus.metering === 'number') {
            updateWaveformFromMetering(recStatus.metering);
          }
        } catch (e) {
          // ignore error on stop
        }
      }, 120);

      setIsRecording(true);
      setEvaluationResult(null);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'ไม่สามารถเริ่มอัดเสียงได้');
    }
  };

  // ยกเลิกการอัดเสียงที่กำลังทำอยู่แบบ "ทิ้ง" (ไม่ส่งไปประเมิน และไม่นับเป็น attempt)
  // ใช้ตอนผู้ใช้กดฟังเสียงต้นแบบระหว่างอัด เพราะเสียงที่อัดไว้ครึ่งทางไม่ควรถูกประเมิน
  const cancelRecording = async () => {
    if (meteringIntervalRef.current) {
      clearInterval(meteringIntervalRef.current);
      meteringIntervalRef.current = null;
    }
    setIsRecording(false);
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch (e) {
      // ignore: ถึงหยุดไม่สำเร็จก็ไม่ควรขวางการเล่นเสียงต้นแบบ
    }
  };

  const stopRecording = async () => {
    if (!recorder.isRecording) return;
    setIsRecording(false);

    if (meteringIntervalRef.current) {
      clearInterval(meteringIntervalRef.current);
      meteringIntervalRef.current = null;
    }

    try {
      // อ่านความยาวก่อน stop (ถ้า API ให้มา) เพื่อกันการกดอัดแล้วหยุดทันที
      let durationMs = null;
      try {
        durationMs = recorder.getStatus().durationMillis;
      } catch (e) {
        // ไม่มีค่าความยาว -> ข้ามการตรวจนี้ ให้ server ตรวจแทน
      }

      await recorder.stop();
      const tempUri = recorder.uri;

      if (!tempUri) {
        Alert.alert('ไม่พบไฟล์เสียง', 'อัดเสียงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return;
      }
      if (typeof durationMs === 'number' && durationMs < MIN_RECORDING_MS) {
        Alert.alert('เสียงสั้นเกินไป', 'กดปุ่มไมค์ พูดประโยคให้จบ แล้วกดอีกครั้งเพื่อหยุด');
        return;
      }

      const savedUri = await saveRecording(tempUri);
      await sendAudioToModel(savedUri);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'หยุดอัดเสียงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
  };

  const sendAudioToModel = async (audioUri) => {
    setIsProcessing(true);

    const audioMimeType = getAudioMimeType(audioUri);

    try {
      const result = await FileSystem.uploadAsync(
        `${API_URL}/api/pronounce/evaluate`,
        audioUri,
        {
          fieldName: 'audio',
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          mimeType: audioMimeType,
          parameters: {
            id: String(phraseData?.id || phraseData?.sentence_id || ''),
            sentence_id: String(phraseData?.sentence_id || phraseData?.id || ''),
            audio_file_name: phraseData?.audio_file_name || phraseData?.sentence_file_name || '',
            sentence_file_name: phraseData?.audio_file_name || phraseData?.sentence_file_name || '',
            rec_history_id: `REC_${Date.now()}`,
          },
          headers: {
            Accept: 'application/json',
            'ngrok-skip-browser-warning': 'true',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
        }
      );

      if (result.status < 200 || result.status >= 300) {
        console.error('Server returned error:', result.body);
        // 4xx จาก backend (เช่น ไม่มีไฟล์เสียง/เสียงเงียบ) ส่งข้อความภาษาไทยมาใน detail -> แสดงให้ผู้ใช้อ่านรู้เรื่อง
        let detail = null;
        try {
          const errBody = JSON.parse(result.body);
          detail = typeof errBody?.detail === 'string' ? errBody.detail : errBody?.message;
        } catch (e) {
          // ไม่ใช่ JSON (เช่น หน้า HTML ของ ngrok)
        }
        if (result.status >= 400 && result.status < 500 && detail) {
          Alert.alert('ตรวจเสียงไม่ได้', detail);
        } else {
          Alert.alert('Server Error', detail || `เซิร์ฟเวอร์ตอบกลับด้วย Status: ${result.status}`);
        }
        return;
      }

      const parsedResult = JSON.parse(result.body);
      if (parsedResult.success) {
        setEvaluationResult(parsedResult.data);
        setAttempts((n) => n + 1);
        if (typeof onExerciseComplete === 'function') {
          onExerciseComplete(phraseData, parsedResult.data);
        }
      } else {
        Alert.alert('Evaluation failed', parsedResult.detail || parsedResult.message || 'เกิดข้อผิดพลาดในการประมวลผล');
      }
    } catch (err) {
      console.error('Upload/Network Error:', err);
      Alert.alert('Error', 'การตอบกลับจากเซิร์ฟเวอร์ไม่ถูกต้อง หรือติดหน้า ngrok warning');
    } finally {
      setIsProcessing(false);
    }
  };

  // แจ้งหน้าแม่ทุกครั้งที่เริ่ม/หยุดอัดเสียง (ตอน mount จะแจ้ง false ด้วย จึงรีเซ็ตสถานะให้อัตโนมัติเมื่อเปลี่ยนประโยค)
  useEffect(() => {
    if (typeof onRecordingChange === 'function') onRecordingChange(isRecording);
  }, [isRecording]);

  useEffect(() => {
    setEvaluationResult(null);
    setAttempts(0);
    setIsRecording(false);
    stopAudio();   // เปลี่ยนประโยค -> หยุดเสียงที่ค้างอยู่ทันที
  }, [phraseData?.sentence_id]);

  // หน้าจอเล็กอาจมองไม่เห็นส่วนล่าง: เลื่อนลงให้เองเมื่อเริ่มอัดเสียง (เห็นคลื่นเสียง/ปุ่มหยุด)
  // และเมื่อมีผลประเมินออกมา (เห็นผลลัพธ์และปุ่ม Next / Try again)
  useEffect(() => {
    if (!isRecording && !evaluationResult) return undefined;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    return () => clearTimeout(t);
  }, [isRecording, evaluationResult]);

  useEffect(() => {
    return () => {
      if (meteringIntervalRef.current) clearInterval(meteringIntervalRef.current);
      stopAudio();   // ออกจากหน้านี้ -> หยุดเสียงทันที และยกเลิกคำสั่งเล่นที่ยังรออยู่
    };
  }, []);

  return (
    // ห่อด้วย ScrollView เพื่อให้เลื่อนดูส่วนที่เกินจอได้ รองรับอุปกรณ์ที่ความสูงหน้าจอต่างกัน
    <ScrollView
      ref={scrollRef}
      style={{ width: '100%' }}
      contentContainerStyle={{ alignItems: 'center', paddingBottom: 30 }}
      showsVerticalScrollIndicator={false}
    >
      <ViewContainer>
        <WhiteCard>
          <HeaderRow>
            <TextBackButton onPress={onBack}>
              <PreviousButton source={previousImg} />
            </TextBackButton>
          </HeaderRow>

          <Illustration source={phraseData?.image} />
          <ThaiPhrase>{phraseData?.thai || 'ไม่มีข้อมูล'}</ThaiPhrase>
          <PronunciationText>{phraseData?.karaoke || phraseData?.roman || ''}</PronunciationText>
          <EngTranslation>{phraseData?.eng || ''}</EngTranslation>

          <SpeakerButton onPress={handlePlayAudio}>
            <SpeakerIcon source={speakerImg} />
          </SpeakerButton>

          {isProcessing && (
            <Text style={{ fontSize: 12, color: '#f97316', fontFamily: 'Sarabun_600SemiBold', marginTop: 10 }}>
              ⏳ Analyzing your pronunciation...
            </Text>
          )}

          {/* 🎯 UI แสดงผลลัพธ์จาก Backend */}
          {evaluationResult && !isRecording && (
            <ResultContainer isPassed={evaluationResult.is_passed}>
              <ScoreText isPassed={evaluationResult.is_passed}>
                {evaluationResult.is_passed ? 'Passed' : 'Not Pass'}
              </ScoreText>
              <Text style={{ fontSize: 12, marginTop: 4, color: evaluationResult.is_passed ? '#16a34a' : '#dc2626' }}>
                {evaluationResult.is_passed ? 'Excellent Pronunciation!' : 'Keep trying!'}
              </Text>

              {/* แสดงคำรายคำตามแบบ wordPracticeScreen */}
              {wordResults.length > 0 && (
                <>
                  <WordsRow>
                    {wordResults.map((w, i) => (
                      <WordChip key={`${w.word}-${i}`} isPassed={w.status === 'PASS'}>
                        <WordText isPassed={w.status === 'PASS'}>{w.word}</WordText>
                      </WordChip>
                    ))}
                  </WordsRow>
                  <Text style={{ fontSize: 12, marginTop: 5, fontFamily: 'Sarabun_500Medium', color: '#333', textAlign: 'center' }}>
                    {wrongWords.length === 0
                      ? 'pronounced correctly'
                      : `Improve word: ${wrongWords.join(', ')}`}
                  </Text>
                </>
              )}

              {/* ตรวจได้เฉพาะระดับประโยค */}
              {!evaluationResult.is_passed && wordResults.length === 0 && (
                <Text style={{ fontSize: 12, marginTop: 5, fontFamily: 'Sarabun_500Medium', color: '#333', textAlign: 'center' }}>
                  ยังระบุคำที่ผิดไม่ได้ (ตรวจได้เฉพาะภาพรวมของประโยค)
                </Text>
              )}

              {/* 🎯 ปุ่ม "ประโยคถัดไป" / "จบบทเรียน" จะปรากฏเมื่อผ่านทุกคำ (is_passed เป็น true) เท่านั้น */}
              {evaluationResult.is_passed && isWeekly && (
                <CompletedBadge onPress={onBack} activeOpacity={0.7}>
                  <NextButtonText>Completed</NextButtonText>
                </CompletedBadge>
              )}
              {evaluationResult.is_passed && !isWeekly && typeof onNext === 'function' && (
                <NextButton onPress={onNext} disabled={isLoadingNext} activeOpacity={0.7}>
                  <NextButtonText>
                    {isLoadingNext ? 'Loading..' : isLastSentence ? 'End of this Lesson' : 'Next Sentence  ➜'}
                  </NextButtonText>
                </NextButton>
              )}
            </ResultContainer>
          )}
        </WhiteCard>

        {isRecording && (
          <WaveformRow>
            {barAnimsRef.current.map((anim, i) => (
              <WaveBar key={i} style={{ height: anim }} />
            ))}
          </WaveformRow>
        )}

        {hasPassed ? (
          // พูดผ่านแล้ว: เอาปุ่มไมค์ออก ให้เหลือ Try again (ถ้าอนุญาต) เพื่อฝึกซ้ำ
          allowRetryAfterPass && !isRecording && (
            <TryAgainButton onPress={startRecording} activeOpacity={0.8}>
              <NextButtonText>Try again</NextButtonText>
            </TryAgainButton>
          )
        ) : retriesExhausted ? (
          <TapToSpeakText isRecording={false}>No more attempts for this sentence</TapToSpeakText>
        ) : (
          <>
            <MicButton isRecording={isRecording} onPress={isRecording ? stopRecording : startRecording}>
              {isRecording ? (
                <RecordButton source={recordImg} />
              ) : (
                <MicrophoneButton source={microphoneImg} />
              )}
            </MicButton>

            <TapToSpeakText isRecording={isRecording}>
              {isRecording ? 'Tap to stop and evaluate' : 'Tap to speak'}
            </TapToSpeakText>
          </>
        )}
      </ViewContainer>
    </ScrollView>
  );
}

export default PracticeScreen;
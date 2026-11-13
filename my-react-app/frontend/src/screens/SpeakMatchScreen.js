import {
    AudioQuality,
    IOSOutputFormat,
    requestRecordingPermissionsAsync,
    setAudioModeAsync,
    useAudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Platform, ScrollView, Text } from 'react-native';
import styled from 'styled-components/native';
import chickMatchImg from '../assets/chickMatch.png';
import microphoneImg from '../assets/microphone.png';
import previousImg from '../assets/previous.png';
import { saveRecording } from '../utils/recordingManager';

// หน้า Speak to Match: พูดประโยคอะไรก็ได้ แล้วระบบเทียบเสียงกับเสียงต้นแบบของทุกประโยคใน Supabase
// (backend ใช้ stdModel เทียบ MFCC + DTW) และบอกว่าใกล้เคียงประโยคไหนที่สุด
// authToken : ใช้เรียก /api/pronounce/match
// apiUrl    : base URL ของ backend
// onBack    : กดปุ่มย้อนกลับ
const MATCH_RECORDING_OPTIONS = {
    extension: '.m4a',
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 128000,
    isMeteringEnabled: true,   // เปิดเพื่อใช้ค่าระดับเสียงขับ waveform
    android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
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

const Container = styled.View`
  width: 100%;
  flex: 1;
  margin-top: 20px;
`;

const HeaderRow = styled.View`
  width: 100%;
  flex-direction: row;
  align-items: center;
`;

const TextBackButton = styled.TouchableOpacity`
  width: 30px;
`;

const PreviousButton = styled.Image`
  width: 30px;
  height: 30px;
  resize-mode: contain;
`;

const HeaderTitle = styled.Text`
  flex: 1;
  font-size: 20px;
  font-family: 'Sarabun_700Bold';
  color: #222;
  text-align: center;
  margin-right: 30px;
`;

const Card = styled.View`
  width: 100%;
  background-color: white;
  border-radius: 30px;
  padding: 20px 20px;
  align-items: center;
  margin-top: 20px;
`;

const ChickImage = styled.Image`
  width: 100px;
  height: 100px;
  resize-mode: contain;
  margin-bottom: 10px;
`;

const HeadlineText = styled.Text`
  font-size: 20px;
  font-family: 'Sarabun_700Bold';
  color: #222;
  text-align: center;
  line-height: 30px;
  margin-bottom: 8px;
`;

const HintText = styled.Text`
  font-size: 12px;
  font-family: 'Sarabun_500Medium';
  color: #555;
  text-align: center;
  line-height: 22px;
`;

const MicCircle = styled.TouchableOpacity`
  width: 65px;
  height: 65px;
  border-radius: 48px;
  background-color: ${(props) => (props.isRecording ? '#dc2626' : '#f97316')};
  align-items: center;
  justify-content: center;
  margin-top: 15px;
  opacity: ${(props) => (props.disabled ? 0.6 : 1)};
`;

const MicIcon = styled.Image`
  width: 40px;
  height: 40px;
  resize-mode: contain;
  tint-color: white;
`;

// waveform ตอนอัดเสียง (สไตล์เดียวกับ PracticeScreen)
const NUM_BARS = 24;

const WaveformRow = styled.View`
  width: 100%;
  height: 70px;
  background-color: #ffffff;
  border-radius: 20px;
  border-color: #000000;
  border-width: 1px;
  margin-top: 15px;
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

const StatusText = styled.Text`
  margin-top: 14px;
  font-size: 14px;
  font-family: 'Sarabun_600SemiBold';
  color: ${(props) => (props.isRecording ? '#dc2626' : '#333')};
`;

const ResultTitle = styled.Text`
  font-size: 18px;
  font-family: 'Sarabun_700Bold';
  color: #222;
  margin-bottom: 6px;
`;

const SentenceItem = styled.View`
  width: 100%;
  flex-direction: row;
  align-items: center;
  gap: 14px;
  padding: 12px;
  margin-top: 4px;
  background-color: #f0fdf4;
  border-width: 1px;
  border-color: #bbf7d0;
  border-radius: 20px;
`;

const SentenceImage = styled.Image`
  width: 70px;
  height: 70px;
  border-radius: 16px;
  background-color: #f3f4f6;
  resize-mode: cover;
`;

const SentenceImagePlaceholder = styled.View`
  width: 70px;
  height: 70px;
  border-radius: 16px;
  background-color: #dcfce7;
  align-items: center;
  justify-content: center;
`;

const SentenceTextBox = styled.View`
  flex: 1;
`;

const SentenceTag = styled.Text`
  font-size: 11px;
  font-family: 'Sarabun_700Bold';
  color: #000000;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
`;

const SentenceLabelText = styled.Text`
  font-size: 17px;
  font-family: 'Sarabun_700Bold';
  color: #166534;
  line-height: 24px;
`;

const SentenceThaiText = styled.Text`
  font-size: 14px;
  font-family: 'Sarabun_500Medium';
  color: #4b5563;
  margin-top: 2px;
`;

const WordsSection = styled.View`
  width: 100%;
  margin-top: 18px;
`;

const WordsTitle = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_700Bold';
  color: ${(props) => (props.wrong ? '#dc2626' : '#16a34a')};
  margin-bottom: 8px;
`;

const WordsRow = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
`;

const WordChip = styled.View`
  background-color: ${(props) => (props.wrong ? '#fee2e2' : '#dcfce7')};
  border-width: 1px;
  border-color: ${(props) => (props.wrong ? '#fca5a5' : '#86efac')};
  border-radius: 999px;
  padding: 6px 14px;
`;

const WordChipText = styled.Text`
  font-size: 15px;
  font-family: 'Sarabun_600SemiBold';
  color: ${(props) => (props.wrong ? '#dc2626' : '#15803d')};
`;

function WordsList({ title, words, wrong }) {
    if (!words.length) return null;
    return (
        <WordsSection>
            <WordsTitle wrong={wrong}>{title}</WordsTitle>
            <WordsRow>
                {words.map((w, i) => (
                    <WordChip key={`${w.word}-${i}`} wrong={wrong}>
                        <WordChipText wrong={wrong}>{w.word}</WordChipText>
                    </WordChip>
                ))}
            </WordsRow>
        </WordsSection>
    );
}

function SpeakMatchScreen({ authToken, apiUrl, onBack }) {
    const recorder = useAudioRecorder(MATCH_RECORDING_OPTIONS);
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [matchResult, setMatchResult] = useState(null);

    const meteringIntervalRef = useRef(null);
    const barAnimsRef = useRef(
        Array.from({ length: NUM_BARS }, () => new Animated.Value(4))
    );

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

    const stopMetering = () => {
        if (meteringIntervalRef.current) {
            clearInterval(meteringIntervalRef.current);
            meteringIntervalRef.current = null;
        }
        barAnimsRef.current.forEach((anim) => anim.setValue(4));   // รีเซ็ตแท่งกลับเป็นเส้นเรียบ
    };

    // ออกจากหน้านี้ระหว่างอัด -> เลิกอ่านระดับเสียง
    useEffect(() => () => {
        if (meteringIntervalRef.current) clearInterval(meteringIntervalRef.current);
    }, []);

    const sendMatchRequest = async (audioUri) => {
        if (!authToken || !apiUrl) {
            Alert.alert('ไม่พบ token', 'กรุณาเข้าสู่ระบบก่อน');
            return;
        }
        setIsProcessing(true);
        const isAndroid = Platform.OS === 'android';
        const audioMimeType = isAndroid ? 'audio/m4a' : 'audio/wav';
        try {
            const result = await FileSystem.uploadAsync(`${apiUrl}/api/pronounce/match`, audioUri, {
                fieldName: 'audio',
                httpMethod: 'POST',
                uploadType: FileSystem.FileSystemUploadType.MULTIPART,
                mimeType: audioMimeType,
                headers: {
                    Accept: 'application/json',
                    'ngrok-skip-browser-warning': 'true',
                    Authorization: `Bearer ${authToken}`,
                },
            });
            if (result.status < 200 || result.status >= 300) {
                Alert.alert('Server Error', `สถานะ: ${result.status}`);
                return;
            }
            const parsed = JSON.parse(result.body);
            if (parsed.success) {
                setMatchResult(parsed.data);
            } else {
                Alert.alert('ไม่สำเร็จ', parsed.detail || 'เกิดข้อผิดพลาด');
            }
        } catch (err) {
            console.error('Match upload error:', err);
            Alert.alert('Error', 'ส่งเสียงไม่สำเร็จ กรุณาลองใหม่');
        } finally {
            setIsProcessing(false);
        }
    };

    const handlePress = async () => {
        if (isRecording) {
            setIsRecording(false);
            stopMetering();
            try {
                await recorder.stop();
                const tempUri = recorder.uri;
                if (!tempUri) return;
                const savedUri = await saveRecording(tempUri);
                await sendMatchRequest(savedUri);
            } catch (err) {
                console.error('Stop recording error:', err);
                Alert.alert('Error', 'หยุดอัดเสียงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
            }
            return;
        }

        try {
            const { granted } = await requestRecordingPermissionsAsync();
            if (!granted) {
                Alert.alert('Permission Denied', 'กรุณาอนุญาตให้ใช้ไมโครโฟน');
                return;
            }
            await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
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

            setMatchResult(null);
            setIsRecording(true);
        } catch (err) {
            console.error('Start recording error:', err);
            Alert.alert('Error', 'ไม่สามารถเริ่มอัดเสียงได้');
        }
    };

    return (
        <Container>
            {/* ส่วนหัว (ปุ่มย้อนกลับ + ชื่อหน้า) อยู่นอก ScrollView จึงไม่เลื่อนตามเนื้อหา */}
            <HeaderRow>
                <TextBackButton onPress={onBack}>
                    <PreviousButton source={previousImg} />
                </TextBackButton>
                <HeaderTitle>Speak to Match</HeaderTitle>
            </HeaderRow>

            <ScrollView
                style={{ flex: 1, width: '100%' }}
                contentContainerStyle={{ paddingBottom: 40 }}
                showsVerticalScrollIndicator={false}
            >
                <Card>
                    <ChickImage source={chickMatchImg} />
                    <HeadlineText>Let's test which sentence your speech is closest to!</HeadlineText>
                    <HintText>Tap the mic and say any sentence. We will compare your voice with every reference sentence in the system.</HintText>

                    {isRecording && (
                        <WaveformRow>
                            {barAnimsRef.current.map((anim, i) => (
                                <WaveBar key={i} style={{ height: anim }} />
                            ))}
                        </WaveformRow>
                    )}

                    <MicCircle isRecording={isRecording} onPress={handlePress} disabled={isProcessing} activeOpacity={0.8}>
                        {isProcessing ? <ActivityIndicator color="#fff" size="large" /> : <MicIcon source={microphoneImg} />}
                    </MicCircle>
                    <StatusText isRecording={isRecording}>
                        {isProcessing ? 'Processing...' : isRecording ? 'Tap to stop' : 'Tap to speak'}
                    </StatusText>
                </Card>

                {matchResult && !isRecording && !isProcessing && (
                    <Card>
                        {matchResult.matched ? (
                            <>
                                <SentenceItem>
                                    {matchResult.matched_image_url ? (
                                        <SentenceImage source={{ uri: matchResult.matched_image_url }} />
                                    ) : (
                                        <SentenceImagePlaceholder>
                                            <Text style={{ fontSize: 30 }}>🗣️</Text>
                                        </SentenceImagePlaceholder>
                                    )}
                                    <SentenceTextBox>
                                        <SentenceTag>Sentence Matched</SentenceTag>
                                        <SentenceLabelText>
                                            {matchResult.matched_label || matchResult.matched_detail || '-'}
                                        </SentenceLabelText>
                                    </SentenceTextBox>
                                </SentenceItem>

                                {Array.isArray(matchResult.words) && matchResult.words.length > 0 && (
                                    <>
                                        <WordsList
                                            title="Words you pronounced correctly"
                                            words={matchResult.words.filter((w) => w.status === 'PASS')}
                                        />
                                        <WordsList
                                            title="Words to improve"
                                            words={matchResult.words.filter((w) => w.status !== 'PASS')}
                                            wrong
                                        />
                                    </>
                                )}
                            </>
                        ) : (
                            <>
                                <ResultTitle>No matching sentence found</ResultTitle>
                                <HintText>
                                    Your speech did not match any sentence closely enough. Try again, speak clearly and stay close to the microphone.
                                </HintText>
                            </>
                        )}
                    </Card>
                )}
            </ScrollView>
        </Container>
    );
}

export default SpeakMatchScreen;
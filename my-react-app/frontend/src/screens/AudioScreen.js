import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import styled from 'styled-components/native';
import previousImg from '../assets/previous.png';
import { API_URL } from './LoginScreen';

// หน้าฟังเสียงประโยคอย่างเดียว: แสดงรายการประโยคแยกตามบทเรียน (ไม่แบ่งระดับ)
// แต่ละแถวมี รูป (image_url) + label + ปุ่ม Play/Pause (เล่นทีละไฟล์ ไฟล์ใหม่จะหยุดไฟล์เดิม)
//
// authToken : ใช้เรียก /api/topics
// onBack    : กดปุ่มย้อนกลับ
const LEVEL_IDS = ['easy', 'medium'];

const normalizeTitle = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();

// รวมบทเรียนจากทุกระดับเข้าด้วยกัน (ชื่อบทเรียนเดียวกันรวมเป็นกลุ่มเดียว) เหลือเฉพาะประโยคที่มีไฟล์เสียง
export function mergeLessons(topicLists) {
    const byTitle = new Map();
    for (const topics of topicLists) {
        for (const topic of topics || []) {
            const sentences = (topic.sentences || []).filter((s) => s && s.audio_url);
            if (sentences.length === 0) continue;
            const key = normalizeTitle(topic.title);
            const existing = byTitle.get(key);
            if (existing) {
                existing.sentences.push(...sentences);
            } else {
                byTitle.set(key, { key, title: topic.title, sentences: [...sentences] });
            }
        }
    }
    return [...byTitle.values()];
}

const ScreenContainer = styled.View`
  width: 100%;
  flex: 1;
  margin-top: 20px;
`;

const HeaderRow = styled.View`
  width: 100%;
  flex-direction: row;
  align-items: center;
  margin-bottom: 10px;
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

const LessonCard = styled.View`
  width: 100%;
  background-color: white;
  border-radius: 24px;
  padding: 16px;
  margin-top: 15px;
`;

const LessonTitle = styled.Text`
  font-size: 17px;
  font-family: 'Sarabun_700Bold';
  color: #222;
  margin-bottom: 6px;
  margin-left: 5px;
`;

const SentenceRow = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 10px;
  margin-top: 8px;
  border-radius: 16px;
  border-width: 1px;
  background-color: ${(props) => (props.active ? '#fff7ed' : '#fafafa')};
  border-color: ${(props) => (props.active ? '#fdba74' : '#eeeeee')};
`;

const SentenceImage = styled.Image`
  width: 64px;
  height: 64px;
  border-radius: 12px;
  background-color: #f3f4f6;
  resize-mode: cover;
`;

const ImagePlaceholder = styled.View`
  width: 64px;
  height: 64px;
  border-radius: 12px;
  background-color: #f3f4f6;
  align-items: center;
  justify-content: center;
`;

const SentenceLabel = styled.Text`
  flex: 1;
  font-size: 15px;
  font-family: 'Sarabun_600SemiBold';
  color: #222;
`;

const PlayCircle = styled.View`
  width: 40px;
  height: 40px;
  border-radius: 22px;
  background-color: ${(props) => (props.active ? '#f97316' : '#fb7e7e')};
  align-items: center;
  justify-content: center;
`;

const CenterBox = styled.View`
  padding: 40px 20px;
  align-items: center;
`;

const MessageText = styled.Text`
  font-size: 14px;
  font-family: 'Sarabun_500Medium';
  color: #666;
  text-align: center;
  margin-top: 10px;
`;

const RetryButton = styled.TouchableOpacity`
  margin-top: 16px;
  background-color: #f97316;
  padding: 12px 30px;
  border-radius: 999px;
`;

const RetryText = styled.Text`
  color: #fff;
  font-size: 14px;
  font-family: 'Sarabun_700Bold';
`;

function PlayIcon() {
    return (
        <Svg width={20} height={20} viewBox="0 0 24 24">
            <Path d="M8 5v14l11-7z" fill="#fff" />
        </Svg>
    );
}

function PauseIcon() {
    return (
        <Svg width={20} height={20} viewBox="0 0 24 24">
            <Rect x={6} y={5} width={4} height={14} rx={1} fill="#fff" />
            <Rect x={14} y={5} width={4} height={14} rx={1} fill="#fff" />
        </Svg>
    );
}

function AudioScreen({ authToken, onBack }) {
    const [lessons, setLessons] = useState([]);
    const [loadState, setLoadState] = useState('loading');   // loading | ready | error
    const [loadError, setLoadError] = useState('');
    const [activeId, setActiveId] = useState(null);          // ประโยคที่ถูกเลือกเล่นอยู่
    const [isPlaying, setIsPlaying] = useState(false);

    const playerRef = useRef(null);
    const subRef = useRef(null);
    const finishedRef = useRef(false);
    const loadIdRef = useRef(0);
    const playIdRef = useRef(0);   // token ของคำสั่งเล่นล่าสุด: คำสั่งที่ยัง await ค้างอยู่แล้วถูกแทนที่จะถูกยกเลิก

    const releasePlayer = useCallback(() => {
        playIdRef.current += 1;
        try { subRef.current?.remove?.(); } catch (e) { /* ignore */ }
        subRef.current = null;
        try { playerRef.current?.pause?.(); } catch (e) { /* ignore */ }
        try { playerRef.current?.remove?.(); } catch (e) { /* ignore */ }
        playerRef.current = null;
        finishedRef.current = false;
    }, []);

    const loadLessons = useCallback(async () => {
        const loadId = ++loadIdRef.current;
        setLoadState('loading');
        setLoadError('');
        try {
            const headers = {
                'ngrok-skip-browser-warning': 'true',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            };
            const lists = await Promise.all(
                LEVEL_IDS.map(async (levelId) => {
                    const res = await fetch(`${API_URL}/api/topics?level=${levelId}`, { headers });
                    if (!res.ok) throw new Error(`โหลดบทเรียนไม่สำเร็จ (HTTP ${res.status})`);
                    const data = await res.json();
                    return data.topics || [];
                })
            );
            if (loadId !== loadIdRef.current) return;
            setLessons(mergeLessons(lists));
            setLoadState('ready');
        } catch (err) {
            if (loadId !== loadIdRef.current) return;
            setLoadError(err?.message || 'โหลดบทเรียนไม่สำเร็จ');
            setLoadState('error');
        }
    }, [authToken]);

    useEffect(() => {
        loadLessons();
        return () => {
            loadIdRef.current += 1;
            releasePlayer();
        };
    }, [loadLessons, releasePlayer]);

    const startNew = async (sentence) => {
        releasePlayer();
        const myPlayId = playIdRef.current;
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldRouteThroughEarpiece: false });
        // ระหว่างรอ มีการกดประโยคอื่น / ออกจากหน้า -> ยกเลิกการเล่นนี้ ไม่สร้าง player ซ้อน
        if (myPlayId !== playIdRef.current) return;
        const player = createAudioPlayer({ uri: sentence.audio_url });
        player.volume = 1.0;
        subRef.current = player.addListener('playbackStatusUpdate', (status) => {
            if (playerRef.current !== player) return;
            if (status.didJustFinish) {
                finishedRef.current = true;
                setIsPlaying(false);
            }
        });
        playerRef.current = player;
        setActiveId(sentence.sentence_id);
        player.play();
        setIsPlaying(true);
    };

    const handleToggle = async (sentence) => {
        try {
            const player = playerRef.current;
            if (player && activeId === sentence.sentence_id) {
                if (isPlaying) {
                    player.pause();
                    setIsPlaying(false);
                } else {
                    if (finishedRef.current) {
                        await player.seekTo(0);   // เล่นจบแล้ว: กลับไปเริ่มต้นใหม่
                        finishedRef.current = false;
                    }
                    player.play();
                    setIsPlaying(true);
                }
                return;
            }
            await startNew(sentence);
        } catch (err) {
            console.error('Play audio error:', err);
            releasePlayer();
            setActiveId(null);
            setIsPlaying(false);
            Alert.alert('Error', 'ไม่สามารถเล่นไฟล์เสียงได้');
        }
    };

    const handleBack = () => {
        releasePlayer();
        onBack?.();
    };

    return (
        <ScreenContainer>
            <HeaderRow>
                <TextBackButton onPress={handleBack}>
                    <PreviousButton source={previousImg} />
                </TextBackButton>
                <HeaderTitle>Listen the Sentence</HeaderTitle>
            </HeaderRow>

            {loadState === 'loading' && (
                <CenterBox>
                    <ActivityIndicator size="large" color="#f97316" />
                </CenterBox>
            )}

            {loadState === 'error' && (
                <CenterBox>
                    <MessageText>{loadError}</MessageText>
                    <RetryButton onPress={loadLessons}>
                        <RetryText>Try again</RetryText>
                    </RetryButton>
                </CenterBox>
            )}

            {loadState === 'ready' && lessons.length === 0 && (
                <CenterBox>
                    <MessageText>ยังไม่มีไฟล์เสียงให้ฟัง</MessageText>
                </CenterBox>
            )}

            {loadState === 'ready' && lessons.length > 0 && (
                <ScrollView
                    style={{ flex: 1, width: '100%' }}
                    contentContainerStyle={{ paddingBottom: 30 }}
                    showsVerticalScrollIndicator={false}
                >
                    {lessons.map((lesson) => (
                        <LessonCard key={lesson.key}>
                            <LessonTitle>{lesson.title}</LessonTitle>
                            {lesson.sentences.map((s) => {
                                const active = activeId === s.sentence_id;
                                const playing = active && isPlaying;
                                return (
                                    <SentenceRow
                                        key={s.sentence_id}
                                        active={active}
                                        activeOpacity={0.7}
                                        onPress={() => handleToggle(s)}
                                    >
                                        {s.image_url ? (
                                            <SentenceImage source={{ uri: s.image_url }} />
                                        ) : (
                                            <ImagePlaceholder>
                                                <Text style={{ fontSize: 22 }}>🎧</Text>
                                            </ImagePlaceholder>
                                        )}
                                        <SentenceLabel numberOfLines={2}>{s.label || s.thai}</SentenceLabel>
                                        <PlayCircle active={active}>
                                            {playing ? <PauseIcon /> : <PlayIcon />}
                                        </PlayCircle>
                                    </SentenceRow>
                                );
                            })}
                        </LessonCard>
                    ))}
                </ScrollView>
            )}
        </ScreenContainer>
    );
}

export default AudioScreen;
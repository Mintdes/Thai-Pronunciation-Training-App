import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, ScrollView, Text, View } from 'react-native';
import styled from 'styled-components/native';
import checkImg from '../assets/check.png';
import EasyIconImg from '../assets/chick.webp';
import MediumIconImg from '../assets/chick1.png';
import assessImg from '../assets/evaluating.png';
import previousImg from '../assets/previous.png';
import wrongImg from '../assets/wrong.png';
import { supabase } from '../utils/supabaseClient'; // 🎯 นำเข้า supabase client เพื่อดึงจากตาราง Sentence โดยตรง
import PracticeScreen from './PracticeScreen';

export const LEVELS = {
    easy: { id: 'easy', title: 'Beginner', icon: EasyIconImg, color: '#c6f6d5' },
    medium: { id: 'medium', title: 'Medium', icon: MediumIconImg, color: '#feebc8' },
};

export const ASSESSMENT_PLAN = [
    { level: LEVELS.easy, count: 3 },
    { level: LEVELS.medium, count: 2 },
];

export const PASS_COUNT_FOR_MEDIUM = 3;

// ถ้ายังไม่ผ่าน พูดใหม่ได้อีกกี่ครั้ง (รวมเป็นพูดได้สูงสุด 1 + MAX_RETRIES ครั้งต่อประโยค)
export const MAX_RETRIES = 2;

const TOTAL_QUESTIONS = ASSESSMENT_PLAN.reduce((sum, p) => sum + p.count, 0);

export function shuffle(items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function pickRandom(items, n) {
    return shuffle(items).slice(0, n);
}

// 🎯 ปรับปรุงคีย์อ้างอิงให้รองรับ id และ audio_file_name ของตาราง Sentence
const sentenceKey = (p) => String(p.sentence_id ?? p.id ?? p.audio_file_name ?? p.audio_file);
const isUsableSentence = (p) => Boolean(p && (p.audio_url || p.audio_file_name || p.audio_file || p.audio));

export function buildQuestions(plan, loaded) {
    const used = new Set();
    const questions = [];

    plan.forEach(({ level, count }, i) => {
        const seen = new Set();
        const pool = [];
        for (const p of Array.isArray(loaded[i]) ? loaded[i] : []) {
            if (!isUsableSentence(p)) continue;
            const k = sentenceKey(p);
            if (used.has(k) || seen.has(k)) continue;
            seen.add(k);
            pool.push(p);
        }

        const actualCount = Math.min(count, pool.length);
        for (const phrase of pickRandom(pool, actualCount)) {
            used.add(sentenceKey(phrase));
            questions.push({ level, phrase });
        }
    });

    return questions;
}

export function recommendLevel(passedCount) {
    return passedCount >= PASS_COUNT_FOR_MEDIUM ? LEVELS.medium : LEVELS.easy;
}

const ScreenContainer = styled.View`
  width: 100%;
  align-items: center;
  margin-top: 20px;
`;

const Card = styled.View`
  width: 100%;
  background-color: white;
  border-radius: 30px;
  padding: 25px 20px;
  align-items: center;
  margin-bottom: 20px;
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

const Title = styled.Text`
  font-size: 20px;
  font-family: 'Sarabun_700Bold';
  color: #222;
  margin: 5px;
  text-align: center;
`;

const BodyText = styled.Text`
  font-size: 14px;
  font-family: 'Sarabun_500Medium';
  color: #444;
  text-align: center;
  margin-top: 6px;
`;

const IllustrationImage = styled.Image`
  width: 150px;
  height: 150px;
  resize-mode: contain;
  margin: 10px 0;
`;

const InfoRow = styled.View`
  width: 100%;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
`;

const InfoDot = styled.View`
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background-color: ${(props) => props.color || '#feebc8'};
  align-items: center;
  justify-content: center;
`;

const PrimaryButton = styled.TouchableOpacity`
  background-color: #f97316;
  border-radius: 25px;
  padding: 16px 25px;
  width: 100%;
  align-items: center;
  margin-top: 20px;
  opacity: ${(props) => (props.disabled ? 0.5 : 1)};
`;

const SecondaryButton = styled.TouchableOpacity`
  background-color: #222222;
  border-radius: 25px;
  padding: 14px 25px;
  width: 100%;
  align-items: center;
  margin-top: 12px;
`;

const ButtonText = styled.Text`
  color: white;
  font-size: 16px;
  font-family: 'Sarabun_700Bold';
`;

const ProgressWrap = styled.View`
  width: 100%;
  margin-top: 8px;
`;

const ProgressMetaRow = styled.View`
  width: 100%;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`;

const ProgressText = styled.Text`
  font-size: 14px;
  font-family: 'Sarabun_700Bold';
  color: #222;
`;

const LevelBadge = styled.View`
  background-color: ${(props) => props.bgColor};
  border-radius: 12px;
  padding: 3px 12px;
`;

const LevelBadgeText = styled.Text`
  font-size: 12px;
  font-family: 'Sarabun_600SemiBold';
  color: ${(props) => props.textColor || '#222'};
`;

const ProgressBarRow = styled.View`
  width: 100%;
  flex-direction: row;
  gap: 6px;
`;

const ProgressSegment = styled.View`
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background-color: ${(props) => (props.state === 'done' ? '#f97316' : props.state === 'current' ? '#fdba74' : '#e5e7eb')};
`;

const SkipTouchable = styled.TouchableOpacity`
  margin-top: 4px;
  padding: 8px 12px;
`;

const SkipText = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_500Medium';
  color: #666;
  text-decoration-line: underline;
`;

const ResultHint = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_600SemiBold';
  color: ${(props) => (props.isPassed ? '#16a34a' : '#dc2626')};
  background-color: ${(props) => (props.isPassed ? '#f0fdf4' : '#fef2f2')};
  border-width: 1px;
  border-color: ${(props) => (props.isPassed ? '#bbf7d0' : '#fecaca')};
  border-radius: 999px;
  padding: 6px 16px;
  overflow: hidden;
  text-align: center;
`;

const NextButton = styled.TouchableOpacity`
  background-color: #000000;
  padding: 12px 30px;
  border-radius: 999px;
  align-items: center;
  margin-top: 10px;
`;

const NextButtonText = styled.Text`
  color: #ffffff;
  font-size: 14px;
  font-family: 'Sarabun_700Bold';
`;

const ScoreBox = styled.View`
  width: 100px;
  height: 100px;
  background-color: ${(props) => props.bgColor};
  border-radius: 24px;
  justify-content: center;
  align-items: center;
  margin: 10px 0;
`;

const BigIconImage = styled.Image`
  width: 52px;
  height: 52px;
  resize-mode: contain;
`;

const ScoreLabel = styled.Text`
  font-size: 15px;
  font-family: 'Sarabun_600SemiBold';
  color: #222;
`;

const ResultRow = styled.View`
  width: 100%;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 12px 4px;
  border-bottom-width: ${(props) => (props.isLast ? 0 : 1)}px;
  border-bottom-color: #eeeeee;
`;

const ResultList = styled.View`
  width: 100%;
  margin-top: 10px;
  border-top-width: 1px;
  border-top-color: #eeeeee;
`;

const ResultMarkBox = styled.View`
  width: 22px;
  align-items: center;
  justify-content: center;
`;

const MarkIcon = styled.Image`
  width: 18px;
  height: 18px;
  resize-mode: contain;
`;

const ResultMark = styled.Text`
  font-size: 16px;
  font-family: 'Sarabun_700Bold';
  color: ${(props) => (props.isPassed ? '#16a34a' : '#dc2626')};
`;

const ResultPhrase = styled.Text`
  flex: 1;
  font-size: 16px;
  font-family: 'Sarabun_600SemiBold';
  color: #222;
`;

const ErrorText = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_500Medium';
  color: #dc2626;
  text-align: center;
  margin-top: 10px;
`;

// ---------- Popup ยืนยัน (ใช้ทั้งตอน Skip และตอนออกจากการวัดระดับ) ----------
const DialogBackdrop = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.55);
  align-items: center;
  justify-content: center;
  padding: 0 28px;
`;

const DialogCard = styled(Animated.View)`
  width: 100%;
  max-width: 360px;
  background-color: #ffffff;
  border-radius: 30px;
  padding: 28px 24px 22px;
  align-items: center;
  elevation: 12;
  shadow-color: #000;
  shadow-opacity: 0.2;
  shadow-radius: 20px;
  shadow-offset: 0px 8px;
`;

const DialogTitle = styled.Text`
  font-size: 20px;
  font-family: 'Sarabun_700Bold';
  color: #222;
  text-align: center;
`;

const DialogMessage = styled.Text`
  font-size: 14px;
  font-family: 'Sarabun_500Medium';
  color: #555;
  text-align: center;
  line-height: 22px;
  margin-top: 8px;
`;

const DialogStayButton = styled.TouchableOpacity`
  width: 100%;
  background-color: #f97316;
  border-radius: 25px;
  padding: 15px 20px;
  align-items: center;
  margin-top: 22px;
`;

const DialogLeaveButton = styled.TouchableOpacity`
  width: 100%;
  border-radius: 25px;
  border-width: 1.5px;
  border-color: ${(props) => props.color};
  padding: 13px 20px;
  align-items: center;
  margin-top: 10px;
`;

const DialogLeaveText = styled.Text`
  font-size: 15px;
  font-family: 'Sarabun_700Bold';
  color: ${(props) => props.color};
`;

// ข้อความ/สีของแต่ละ popup: stay = ปุ่มปลอดภัย (อยู่ต่อ) / leave = ปุ่มที่ทำสิ่งนั้นจริง
const DIALOGS = {
    skip: {
        title: 'Skip this sentence?',
        message: 'It will be counted as not passed and will affect your suggested level.',
        stayText: 'Keep practicing',
        leaveText: 'Skip sentence',
        leaveColor: '#444444',
    },
    exit: {
        title: 'Exit assessment?',
        message: 'Your progress in this assessment will be lost.',
        stayText: 'Continue assessment',
        leaveText: 'Exit',
        leaveColor: '#dc2626',
    },
};

function ConfirmDialog({ visible, config, onStay, onLeave }) {
    const scale = useRef(new Animated.Value(0.9)).current;

    useEffect(() => {
        if (!visible) return;
        scale.setValue(0.9);
        Animated.spring(scale, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }).start();
    }, [visible]);

    return (
        <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onStay}>
            <DialogBackdrop>
                <DialogCard style={{ transform: [{ scale }] }}>
                    <DialogTitle>{config.title}</DialogTitle>
                    <DialogMessage>{config.message}</DialogMessage>

                    <DialogStayButton onPress={onStay} activeOpacity={0.8}>
                        <ButtonText>{config.stayText}</ButtonText>
                    </DialogStayButton>
                    <DialogLeaveButton onPress={onLeave} color={config.leaveColor} activeOpacity={0.7}>
                        <DialogLeaveText color={config.leaveColor}>{config.leaveText}</DialogLeaveText>
                    </DialogLeaveButton>
                </DialogCard>
            </DialogBackdrop>
        </Modal>
    );
}

function AssessScreen({ authToken, loadSentences, onBack, onFinish }) {
    const [phase, setPhase] = useState('intro');
    const [loadState, setLoadState] = useState('loading');
    const [loadError, setLoadError] = useState('');
    const [questions, setQuestions] = useState([]);
    const [index, setIndex] = useState(0);
    const [results, setResults] = useState({});
    const [isRecording, setIsRecording] = useState(false);   // กำลังอัดเสียงอยู่ -> ซ่อนปุ่ม Skip
    const [dialog, setDialog] = useState(null);              // null | 'skip' | 'exit'
    const lastDialogRef = useRef('exit');                    // เก็บเนื้อหา popup ล่าสุดไว้ให้ตอน fade out ไม่กระพริบ
    if (dialog) lastDialogRef.current = dialog;

    const loaderRef = useRef(loadSentences);
    loaderRef.current = loadSentences;
    const loadIdRef = useRef(0);

    // 🎯 ฟังก์ชันดึงประโยคจากตาราง Sentence ใน Supabase โดยตรง
    const fetchSentencesFromDb = async (levelId) => {
        const { data, error } = await supabase
            .from('Sentence')
            .select('*')
            .eq('level', levelId)
            .eq('is_weekly', false);   // ไม่เอาประโยค Weekly มาใช้วัดระดับ (ปกติใช้ loader จาก /api/topics อยู่แล้ว)

        if (error || !data || data.length === 0) {
            console.warn(`ไม่พบข้อมูลประโยคในตาราง Sentence สำหรับ level: ${levelId}`);
            return [];
        }

        return data.map((item) => {
            let audioUri = item.audio_url;
            if (!audioUri && item.audio_file_name) {
                const { data: storageData } = supabase.storage
                    .from('sentences-audio')
                    .getPublicUrl(item.audio_file_name.trim());
                audioUri = storageData?.publicUrl;
            }

            return {
                sentence_id: String(item.sentence_id ?? item.id),
                sentence_file_name: item.audio_file_name,
                thai: item.thai,
                karaoke: item.karaoke || '',
                eng: item.eng || '',
                label: item.label || item.thai,
                pronunciation: item.pronunciation || '',
                audio_file: item.audio_file_name,
                audio: { uri: audioUri },
                // PracticeScreen แสดงรูปจาก phraseData.image (รูปแบบ { uri })
                image: item.image_url ? { uri: item.image_url } : undefined,
            };
        });
    };

    const loadQuestions = async () => {
        const loadId = ++loadIdRef.current;
        setLoadState('loading');
        setLoadError('');
        try {
            // ใช้ loader ที่ส่งเข้ามา หากไม่มีจะดึงจาก fetchSentencesFromDb (ตาราง Sentence) อัตโนมัติ
            const fetchFn = typeof loaderRef.current === 'function' ? loaderRef.current : fetchSentencesFromDb;

            const loaded = await Promise.all(
                ASSESSMENT_PLAN.map(({ level, count }) => fetchFn(level.id, count))
            );

            if (loadId !== loadIdRef.current) return;
            setQuestions(buildQuestions(ASSESSMENT_PLAN, loaded));
            setLoadState('ready');
        } catch (err) {
            if (loadId !== loadIdRef.current) return;
            console.error('Assessment load error:', err);
            setLoadError(err?.message || 'โหลดประโยคไม่สำเร็จ');
            setLoadState('error');
        }
    };

    useEffect(() => {
        loadQuestions();
        return () => {
            loadIdRef.current += 1;
        };
    }, []);

    const startTest = () => {
        if (loadState !== 'ready') return;
        setResults({});
        setIndex(0);
        setPhase('test');
    };

    const retake = () => {
        setPhase('intro');
        loadQuestions();
    };

    const confirmExit = () => setDialog('exit');
    const confirmSkip = () => setDialog('skip');
    const closeDialog = () => setDialog(null);

    const handleDialogLeave = () => {
        const type = dialog;
        setDialog(null);
        if (type === 'skip') skipCurrent();
        else if (type === 'exit') onBack?.();
    };

    const goNext = () => {
        if (index < questions.length - 1) {
            setIndex(index + 1);
        } else {
            setPhase('result');
        }
    };

    const skipCurrent = () => {
        setResults((prev) => ({ ...prev, [index]: { passed: false, skipped: true } }));
        goNext();
    };

    const passedCount = Object.values(results).filter((r) => r.passed).length;
    const recommended = recommendLevel(passedCount);

    const renderIntro = () => (
        <Card>
            <HeaderRow>
                <TextBackButton onPress={onBack}>
                    <PreviousButton source={previousImg} />
                </TextBackButton>
            </HeaderRow>
            <IllustrationImage source={assessImg} />
            <Title>Pronunciation assessment</Title>
            <BodyText>
                Read {TOTAL_QUESTIONS} random sentences aloud and we will suggest the level to start with.
            </BodyText>

            {ASSESSMENT_PLAN.map(({ level, count }) => (
                <InfoRow key={level.id}>
                    <InfoDot color={level.color}>
                        <Text style={{ fontSize: 13, fontFamily: 'Sarabun_700Bold', color: '#222' }}>{count}</Text>
                    </InfoDot>
                    <Text style={{ fontSize: 14, fontFamily: 'Sarabun_500Medium', color: '#222' }}>
                        {level.title} sentences
                    </Text>
                </InfoRow>
            ))}
            <BodyText>
                Pass {PASS_COUNT_FOR_MEDIUM} or more sentences to start at Medium. Otherwise we suggest Beginner.
            </BodyText>

            {loadState === 'error' && <ErrorText>{loadError}</ErrorText>}

            {loadState === 'error' ? (
                <PrimaryButton onPress={loadQuestions}>
                    <ButtonText>Try again</ButtonText>
                </PrimaryButton>
            ) : (
                <PrimaryButton onPress={startTest} disabled={loadState !== 'ready'}>
                    {loadState === 'loading' ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <ButtonText>Start assessment</ButtonText>
                    )}
                </PrimaryButton>
            )}
        </Card>
    );

    const renderTest = () => {
        const current = questions[index];
        if (!current) return null;
        const currentResult = results[index];
        const retriesLeft = Math.max(0, MAX_RETRIES - Math.max(0, (currentResult?.attempts || 0) - 1));
        const isLast = index === questions.length - 1;

        return (
            <>
                <ProgressWrap>
                    <ProgressMetaRow>
                        <ProgressText>
                            Sentence {index + 1} of {questions.length}
                        </ProgressText>
                        <LevelBadge bgColor={current.level.color}>
                            <LevelBadgeText>{current.level.title}</LevelBadgeText>
                        </LevelBadge>
                    </ProgressMetaRow>
                    <ProgressBarRow>
                        {questions.map((_, i) => (
                            <ProgressSegment key={i} state={i < index ? 'done' : i === index ? 'current' : 'todo'} />
                        ))}
                    </ProgressBarRow>
                </ProgressWrap>

                <PracticeScreen
                    key={`${index}-${sentenceKey(current.phrase)}`}
                    phraseData={current.phrase}
                    authToken={authToken}
                    onBack={confirmExit}
                    allowRetryAfterPass={false}
                    maxRetries={MAX_RETRIES}
                    onRecordingChange={setIsRecording}
                    onExerciseComplete={(_phrase, result) =>
                        setResults((prev) => ({
                            ...prev,
                            [index]: {
                                passed: Boolean(prev[index]?.passed || result?.is_passed),
                                skipped: false,
                                attempts: (prev[index]?.attempts || 0) + 1,
                            },
                        }))
                    }
                />

                {currentResult ? (
                    // marginTop ติดลบ: ดึงข้อความขึ้นมาใกล้ปุ่มไมค์ (ลบช่องว่าง padding ล่างของ PracticeScreen)
                    <View style={{ width: '100%', alignItems: 'center', marginTop: -22 }}>
                        <ResultHint isPassed={currentResult.passed}>
                            {currentResult.passed
                                ? 'Passed!'
                                : retriesLeft > 0
                                    ? `You can try again (${retriesLeft} ${retriesLeft === 1 ? 'try' : 'tries'} left), or continue.`
                                    : 'No tries left. Continue to the next sentence.'}
                        </ResultHint>
                        {/* ซ่อนปุ่ม Next ระหว่างพูดซ้ำ (กำลังอัดเสียง) */}
                        {!isRecording && (
                            <NextButton onPress={goNext} activeOpacity={0.7}>
                                <NextButtonText>{isLast ? 'See my result' : 'Next sentence  ➜'}</NextButtonText>
                            </NextButton>
                        )}
                    </View>
                ) : (
                    // ซ่อนปุ่ม Skip ระหว่างอัดเสียง และขอให้ยืนยันก่อน skip จริง
                    !isRecording && (
                        <SkipTouchable onPress={confirmSkip}>
                            <SkipText>Skip this sentence</SkipText>
                        </SkipTouchable>
                    )
                )}
            </>
        );
    };

    const renderResult = () => (
        <Card>
            <Title>Your result</Title>
            <BodyText>
                You passed {passedCount} of {questions.length} sentences
            </BodyText>

            <ScoreBox bgColor={recommended.color}>
                <BigIconImage source={recommended.icon} />
                <ScoreLabel>{recommended.title}</ScoreLabel>
            </ScoreBox>

            <Title>We suggest starting at {recommended.title}</Title>
            <BodyText>
                {recommended.id === 'medium'
                    ? 'Your pronunciation is already good. Medium sentences will be a good challenge.'
                    : 'Start with basic sentences first to build a solid foundation. You can change level anytime.'}
            </BodyText>

            <ResultList>
                {questions.map((q, i) => {
                    const r = results[i];
                    const passed = Boolean(r?.passed);
                    // ป้ายท้ายแถว: ผ่าน / ไม่ผ่าน / ข้าม (ข้ามถือว่าไม่ผ่าน แต่แยกสีให้เห็นต่าง)
                    const badge = r?.skipped
                        ? { label: 'Skipped', bg: '#e5e7eb', text: '#4b5563' }
                        : passed
                            ? { label: 'Passed', bg: '#dcfce7', text: '#15803d' }
                            : { label: 'Not passed', bg: '#fee2e2', text: '#b91c1c' };
                    return (
                        <ResultRow key={`${i}-${sentenceKey(q.phrase)}`} isLast={i === questions.length - 1}>
                            <ResultMarkBox>
                                <MarkIcon source={passed ? checkImg : wrongImg} />
                            </ResultMarkBox>
                            <ResultPhrase numberOfLines={1}>{q.phrase?.label || q.phrase?.thai || q.phrase?.eng || `Sentence ${i + 1}`}</ResultPhrase>
                            <LevelBadge bgColor={badge.bg}>
                                <LevelBadgeText textColor={badge.text}>{badge.label}</LevelBadgeText>
                            </LevelBadge>
                        </ResultRow>
                    );
                })}
            </ResultList>

            <PrimaryButton onPress={() => onFinish?.(recommended)}>
                <ButtonText>Start at {recommended.title}</ButtonText>
            </PrimaryButton>
            <SecondaryButton onPress={retake}>
                <ButtonText>Retake with new sentences</ButtonText>
            </SecondaryButton>
            <SkipTouchable onPress={onBack}>
                <SkipText>Choose level myself</SkipText>
            </SkipTouchable>
        </Card>
    );

    return (
        <ScrollView
            style={{ flex: 1, width: '100%' }}
            contentContainerStyle={{ alignItems: 'center', paddingBottom: 30 }}
            showsVerticalScrollIndicator={false}
        >
            <ScreenContainer>
                {phase === 'intro' && renderIntro()}
                {phase === 'test' && renderTest()}
                {phase === 'result' && renderResult()}
            </ScreenContainer>

            <ConfirmDialog
                visible={dialog !== null}
                config={DIALOGS[lastDialogRef.current]}
                onStay={closeDialog}
                onLeave={handleDialogLeave}
            />
        </ScrollView>
    );
}

export default AssessScreen;
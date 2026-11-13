import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import styled from 'styled-components/native';
import checkImg from '../assets/check.png';

import { resolveSentenceAudio } from '../utils/resolveSentenceAudio';
import { API_URL } from './LoginScreen';

const TopBar = styled.View`
  width: 100%;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin: 20px 0 5px;
`;

const BackButton = styled.TouchableOpacity``;
const BackButtonText = styled.Text`
  font-size: 14px;
  font-family: 'Sarabun_500Medium';
  color: #333;
  margin-left: 10px;
`;

const ProgressText = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_700Bold';
  color: #555;
  margin-right: 10px;
`;

const PageTitle = styled.Text`
  font-size: 18px;
  font-family: 'Sarabun_700Bold';
  color: #222;
  margin: 5px 0 15px 0;
  text-align: center;
`;

const TopicGroup = styled.View`
  width: 100%;
  gap: 5px;
  margin-bottom: 10px;
`;

const TopicHeaderCard = styled.TouchableOpacity`
  width: 100%;
  background-color: #c6f6d5;
  border-radius: 20px;
  padding: 15px 20px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const TopicLeftSection = styled.View`
  flex: 1;
  flex-shrink: 1;
  flex-direction: row;
  align-items: center;
  gap: 15px;
`;

const IconContainer = styled.View`
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`;

const TopicTitle = styled.Text`
  flex: 1;
  flex-shrink: 1;
  font-size: 18px;
  line-height: 28px;
  font-family: 'Sarabun_700Bold';
  color: #222;
`;

const StatusText = styled.Text`
  font-size: 12px;
  color: ${(props) => (props.$passed ? '#15803d' : '#555')};
  font-family: ${(props) => (props.$passed ? "'Sarabun_700Bold'" : "'Sarabun_500Medium'")};
`;

const ArrowCircle = styled.View`
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  background-color: #222;
  border-radius: 13px;
  justify-content: center;
  align-items: center;
  transform: ${(props) => (props.isOpen ? 'rotate(-90deg)' : 'rotate(0deg)')};
`;

const ArrowCircleText = styled.Text`
  color: white;
  font-size: 12px;
`;

const SubListWrapper = styled.View`
  width: 100%;
  background-color: #f3f4f6;
  border-radius: 20px;
  padding: 15px;
  gap: 10px;
  margin-bottom: 10px;
`;

const SentenceItemRow = styled.TouchableOpacity`
  width: 100%;
  background-color: white;
  border-radius: 12px;
  padding: 15px 15px;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
`;

const RadioCircle = styled.View`
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-width: 2px;
  border-color: ${(props) => (props.$done ? '#16a34a' : '#aaa')};
  background-color: ${(props) => (props.$done ? '#16a34a' : 'transparent')};
  border-radius: 9px;
  align-items: center;
  justify-content: center;
`;

// ไอคอนเช็คสำหรับประโยคที่ทำแล้ว
const CheckIcon = styled.Image`
  width: 19px;
  height: 19px;
  flex-shrink: 0;
`;

const SentenceText = styled.Text`
  flex: 1;
  flex-shrink: 1;
  font-size: 16px;
  line-height: 26px;
  padding-top: 2px;
  font-family: 'Sarabun_500Medium';
  color: #333;
`;

const ImageIcon = styled.Image`
  width: 50px;
  height: 50px;
  resize-mode: contain;
`;

// ใช้แสดงเฉพาะบทที่ยังไม่มี icon_url ในตาราง Topic
const IconPlaceholder = styled.View`
  width: 50px;
  height: 50px;
  border-radius: 25px;
  background-color: #ffffff;
  align-items: center;
  justify-content: center;
`;

const EmptyTopicText = styled.Text`
  font-size: 13px;
  color: #999;
  font-family: 'Sarabun_500Medium';
  padding: 4px 4px 14px;
`;

// cache หัวข้อ+ประโยคต่อระดับ: เปิดหน้าซ้ำแล้วแสดงทันที (อยู่ได้จนปิดแอป) และเก็บลง AsyncStorage ไว้เปิดแอปครั้งถัดไป
const topicsMemoryCache = {};
const TOPICS_STORAGE_PREFIX = 'thaiApp.topicsCache:';

function ChooseSentenceScreen({
  onBack,
  onSelectSentence,
  initialTopic,
  onTopicToggle,
  overallProgress = 0,
  currentLevel,
  completedSentenceIds = [],
}) {
  const levelId = currentLevel?.id || 'easy';
  const [openTopic, setOpenTopic] = useState(initialTopic || '');
  const [dbTopics, setDbTopics] = useState(topicsMemoryCache[levelId] || []);
  const [isLoadingDb, setIsLoadingDb] = useState(!topicsMemoryCache[levelId]);

  // คำนวณสถานะผ่านจากประโยคที่ทำเสร็จ
  const completedSet = new Set(completedSentenceIds);
  const isSentenceDone = (item) => !!item?.thai && completedSet.has(item.thai);
  const isTopicPassed = (topic) =>
    Array.isArray(topic.sentences) && topic.sentences.length > 0 && topic.sentences.every(isSentenceDone);

  // ดึงหัวข้อและประโยคจาก Backend/DB ตาม level ปัจจุบัน
  // stale-while-revalidate: แสดงข้อมูลจาก cache (หน่วยความจำ -> AsyncStorage) ทันที แล้วรีเฟรชจาก server เบื้องหลัง
  useEffect(() => {
    let cancelled = false;
    const memCached = topicsMemoryCache[levelId];
    setDbTopics(memCached || []);
    setIsLoadingDb(!memCached);

    (async () => {
      if (!memCached) {
        try {
          const raw = await AsyncStorage.getItem(TOPICS_STORAGE_PREFIX + levelId);
          const saved = raw ? JSON.parse(raw) : null;
          if (Array.isArray(saved) && saved.length > 0 && !cancelled) {
            topicsMemoryCache[levelId] = saved;
            setDbTopics(saved);
            setIsLoadingDb(false);
          }
        } catch (e) {
          // อ่าน cache ไม่ได้ -> รอข้อมูลจาก server ตามปกติ
        }
      }

      try {
        const r = await fetch(`${API_URL}/api/topics?level=${levelId}`, {
          headers: { 'ngrok-skip-browser-warning': 'true' },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (Array.isArray(data.topics)) {
          topicsMemoryCache[levelId] = data.topics;
          AsyncStorage.setItem(TOPICS_STORAGE_PREFIX + levelId, JSON.stringify(data.topics)).catch(() => { });
          if (!cancelled) setDbTopics(data.topics);
        }
      } catch (err) {
        console.warn('ChooseSentenceScreen: โหลด topics จาก DB ไม่สำเร็จ', err);
      } finally {
        if (!cancelled) setIsLoadingDb(false);
      }
    })();

    return () => { cancelled = true; };
  }, [levelId]);

  // หัวข้อทั้งหมดมาจากตาราง Topic (ชื่อ + icon_url) ผ่าน /api/topics
  const hasAnyContent = dbTopics.length > 0;

  const toggleTopic = (topicName) => {
    const nextTopic = openTopic === topicName ? '' : topicName;
    setOpenTopic(nextTopic);
    if (onTopicToggle) {
      onTopicToggle(nextTopic);
    }
  };

  const handlePickSentence = async (sentenceItem, topicList, index) => {
    const resolved = await resolveSentenceAudio(sentenceItem);
    if (!resolved) return;
    onSelectSentence(resolved, topicList, index);
  };

  return (
    <ScrollView style={{ width: '100%' }} contentContainerStyle={{ paddingTop: 10, gap: 15 }}>
      <TopBar>
        <BackButton onPress={onBack}>
          <BackButtonText>ᐊ  Back</BackButtonText>
        </BackButton>
        <ProgressText>Progress {overallProgress}%</ProgressText>
      </TopBar>

      <PageTitle>Choose the lesson</PageTitle>

      {!hasAnyContent && !isLoadingDb && (
        <PageTitle style={{ fontSize: 14, fontWeight: '500', color: '#777' }}>
          ยังไม่มีบทเรียนสำหรับระดับนี้ในตอนนี้ กลับไปเลือกระดับ Beginner เพื่อฝึกต่อได้เลย
        </PageTitle>
      )}

      {/* หัวข้อ + icon จากตาราง Topic */}
      {dbTopics.map((topic) => {
        const topicKey = `db-${topic.id}`;
        return (
          <TopicGroup key={topicKey}>
            <TopicHeaderCard onPress={() => toggleTopic(topicKey)}>
              <TopicLeftSection>
                <IconContainer>
                  {topic.icon_url ? (
                    <ImageIcon source={{ uri: topic.icon_url }} />
                  ) : (
                    <IconPlaceholder>
                      <TopicTitle style={{ flex: 0, flexShrink: 0, fontSize: 22, lineHeight: 30 }}>📖</TopicTitle>
                    </IconPlaceholder>
                  )}
                  <StatusText $passed={isTopicPassed(topic)}>
                    {isTopicPassed(topic) ? 'pass' : 'not pass'}
                  </StatusText>
                </IconContainer>
                <TopicTitle>{topic.title}</TopicTitle>
              </TopicLeftSection>
              <ArrowCircle isOpen={openTopic === topicKey}>
                <ArrowCircleText>▶</ArrowCircleText>
              </ArrowCircle>
            </TopicHeaderCard>

            {openTopic === topicKey && (
              <SubListWrapper>
                {topic.sentences.length === 0 ? (
                  <EmptyTopicText>ยังไม่มีประโยคในบทนี้</EmptyTopicText>
                ) : (
                  topic.sentences.map((item, index) => (
                    <SentenceItemRow
                      key={item.sentence_id}
                      onPress={() => handlePickSentence(item, topic.sentences, index)}
                    >
                      {isSentenceDone(item) ? (
                        <CheckIcon source={checkImg} resizeMode="contain" />
                      ) : (
                        <RadioCircle />
                      )}
                      <SentenceText>{item.label}</SentenceText>
                    </SentenceItemRow>
                  ))
                )}
              </SubListWrapper>
            )}
          </TopicGroup>
        );
      })}

      {/* สัญลักษณ์แสดงสถานะกำลังโหลดข้อมูลจาก DB */}
      {isLoadingDb && (
        <View style={{ paddingVertical: 12, alignItems: 'center' }}>
          <ActivityIndicator size="small" color="#888" />
        </View>
      )}
    </ScrollView>
  );
}

export default ChooseSentenceScreen;
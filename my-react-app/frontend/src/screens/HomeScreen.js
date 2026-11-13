import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import styled from 'styled-components/native';
// รูปภาพ import แบบเดิมได้เลย metro bundler ของ RN รองรับ require รูปผ่าน import เหมือน webpack/vite
import EasyIconImg from '../assets/chick.webp';
import MediumIconImg from '../assets/chick1.png';
import microphoneImg from '../assets/microphone.png';
import speakerImg from '../assets/speaker.png';

// 🎯 แก้ไข: เดิม ContentWrapper เป็น View ธรรมดาที่สูงตามเนื้อหา + padding-bottom 80px ไม่มี scroll
// พอจอเล็ก (เช่น Android emulator) การ์ดล่างเลยล้นจอและโดน BottomBar ทับ ดูอัดกันมาก
// เปลี่ยนเป็น flex: 1 (กินพื้นที่ที่เหลือใต้ header) แล้วให้เนื้อหาเลื่อนได้ใน ScrollView ด้านล่าง
const ContentWrapper = styled.View`
  flex: 1;
  width: 100%;
  margin-top: 10px;
`;

const SectionCard = styled.View`
  background-color: white;
  border-radius: 35px;
  padding: 25px 20px;
`;

// ป้าย Completed มุมขวาบนของกล่อง Weekly Sentence (SectionCard เป็นตัวอ้างอิงตำแหน่ง)
const CompletedBadge = styled.View`
  position: absolute;
  top: 18px;
  right: 18px;
  background-color: #dcfce7;
  border-color: #16a34a;
  border-width: 1px;
  border-radius: 999px;
  padding: 4px 12px;
`;

const CompletedBadgeText = styled.Text`
  font-size: 12px;
  font-family: 'Sarabun_700Bold';
  color: #16a34a;
`;

const CardTitle = styled.Text`
  margin-bottom: 15px;
  font-size: 18px;
  font-family: 'Sarabun_700Bold';
  color: #222;
`;

const WeeklyQuoteBox = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 10px; 
  margin-bottom: 20px;
`;

const QuoteColumn = styled.View`
  flex: 1;
  gap: 4px;
`;

const QuoteEngText = styled.Text`
  font-size: 14px;
  color: #777;
  line-height: 20px;
  font-family: 'Sarabun_400Regular';
`;

const QuoteText = styled.Text`
  font-size: 16px;
  color: #333;
  line-height: 26px;
  font-family: 'Sarabun_400Regular';
`;

const AudioButton = styled.TouchableOpacity`
  padding: 5px;
`;
const AudioButtonText = { fontSize: 24 };

const DarkActionButton = ({ onPress, children }) => (
  <DarkActionTouchable onPress={onPress}>
    <DarkActionText>{children}</DarkActionText>
  </DarkActionTouchable>
);
const DarkActionTouchable = styled.TouchableOpacity`
  width: 100%;
  background-color: #222222;
  border-radius: 25px;
  padding: 14px;
  align-items: center;
`;
const DarkActionText = styled.Text`
  color: white;
  font-size: 16px;
  font-family: 'Sarabun_700Bold';
`;

const FlexHeader = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
`;

const ChangeTextLink = styled.Text`
  color: #f97316;
  font-size: 14px;
  font-family: 'Sarabun_500Medium';
`;

const StatusProgressCard = styled.View`
  width: 100%;
  background-color: ${(props) => props.bgColor || '#c6f6d5'};
  border-radius: 25px;
  padding: 15px;
  gap: 15px;
`;

const StatusInfoRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 15px;
`;

const SpeakerIcon = styled.Image`
  width: 35px;
  height: 35px;
  resize-mode: contain;
`;

const LevelEmoji = styled.Image`
  width: 60px;
  height: 60px;
  resize-mode: contain;
`;

const ProgressBarContainer = styled.View`
  width: 100%;
  height: 14px;
  background-color: white;
  border-radius: 10px;
  overflow: hidden;
`;

const ProgressBarFill = styled.View`
  width: ${(props) => props.$percent || 0}%;
  height: 100%;
  background-color: #f97316;
`;

const ProgressPercentText = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_600SemiBold';
  color: #333;
  margin-left: 5px;
`;

const PrimaryOrangeButton = ({ onPress, children }) => (
  <PrimaryOrangeTouchable onPress={onPress}>
    <PrimaryOrangeText>{children}</PrimaryOrangeText>
  </PrimaryOrangeTouchable>
);
const PrimaryOrangeTouchable = styled.TouchableOpacity`
  width: 100%;
  background-color: #f97316;
  border-radius: 25px;
  padding: 15px;
  align-items: center;
  margin: 15px 0 10px;
`;
const PrimaryOrangeText = styled.Text`
  color: white;
  font-size: 18px;
  font-family: 'Sarabun_700Bold';
`;

// --- Modal เลือกระดับ ---
const ModalOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.4);
  justify-content: center;
  align-items: center;
`;

// --- Bottom Tab Bar (Home / Speak to Match / Play All) ---
const BottomBar = styled.View`
  position: absolute;
  bottom: -35px;
  left: -20px;
  right: -20px;
  flex-direction: row;
  align-items: flex-end;
  justify-content: space-around;
  padding: 12px 16px 30px;
  background-color: #ffffff;
  border-top-left-radius: 32px;
  border-top-right-radius: 32px;
  elevation: 12;
  shadow-color: #000;
  shadow-opacity: 0.08;
  shadow-radius: 12px;
  shadow-offset: 0px -4px;
`;

const TabItem = styled.TouchableOpacity`
  flex: 1;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
`;

const TabLabel = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_500Medium';
  color: ${(props) => (props.active ? '#f97316' : '#555')};
`;

const TAB_ICON_SIZE = 28;

const HomeIcon = ({ color = '#444' }) => (
  <Svg width={TAB_ICON_SIZE} height={TAB_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
  </Svg>
);

const ModalCard = styled.View`
  background-color: #ffffff;
  width: 300px;
  border-radius: 25px;
  padding: 25px;
`;

const CloseButton = styled.TouchableOpacity`
  position: absolute;
  top: 25px;
  right: 20px;
`;

const LevelOptionsContainer = styled.View`
  gap: 12px;
  margin-top: 15px;
`;

const LevelCard = styled.TouchableOpacity`
  background-color: ${(props) => props.bgColor};
  border-radius: 20px;
  padding: 15px;
  flex-direction: row;
  align-items: center;
`;

const LevelIconImage = styled.Image`
  width: 50px;
  height: 50px;
  resize-mode: contain;
`;

// weeklySentence: ประโยค Weekly ของระดับปัจจุบันจาก DB (Sentence.is_weekly = true) หรือ null ถ้ายังไม่มี
// weeklyCompleted: เคยพูดผ่านประโยค Weekly นี้แล้วหรือยัง (ติดแล้วไม่หาย แม้ฝึกซ้ำ)
// onTryWeekly: กด "I want to try!" -> เข้าหน้าฝึกเฉพาะประโยค Weekly
function HomeScreen({
  currentLevel, onChangeLevel, onContinue, onPlayAll, onGoHome, onSpeakMatch, onTryWeekly,
  weeklySentence = null, weeklyCompleted = false, overallProgress = 0,
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const weeklyPlayerRef = useRef(null);
  const weeklyPlayIdRef = useRef(0);   // token ของคำสั่งเล่นล่าสุด: คำสั่งที่ยัง await ค้างอยู่แล้วถูกแทนที่จะถูกยกเลิก

  // หยุดและปล่อยเสียงที่เล่นอยู่ทันที พร้อมทำให้คำสั่งเล่นที่ยังรออยู่หมดอายุ (กันกด 🔊 รัว ๆ แล้วเสียงซ้อนกัน)
  const releaseWeeklyPlayer = () => {
    weeklyPlayIdRef.current += 1;
    const player = weeklyPlayerRef.current;
    weeklyPlayerRef.current = null;
    if (player) {
      try { player.pause?.(); } catch (e) { /* ignore */ }
      try { player.remove?.(); } catch (e) { /* ignore */ }
    }
  };

  // เปลี่ยนประโยค/ระดับ หรือออกจากหน้านี้ -> หยุดและปล่อยตัวเล่นเสียงเดิม
  useEffect(() => {
    releaseWeeklyPlayer();
  }, [weeklySentence?.sentence_id]);
  useEffect(() => releaseWeeklyPlayer, []);

  const isMedium = currentLevel.id === 'medium';

  const contentData = {
    // ข้อความ Weekly มาจากคอลัมน์ thai ของตาราง Sentence (admin เพิ่มจากหน้า AdminScreen)
    quote: weeklySentence?.thai ? `"${weeklySentence.thai}"` : 'No weekly sentence available for this level this week',
    // คำแปลภาษาอังกฤษของประโยค Weekly (คอลัมน์ eng)
    eng: weeklySentence?.eng || '',
    emoji: isMedium ? MediumIconImg : EasyIconImg,
    title: isMedium ? 'Medium' : 'Beginner',
    bgColor: isMedium ? '#feebc8' : '#c6f6d5',
  };

  const handleSelectNewLevel = (levelConfig) => {
    onChangeLevel(levelConfig);
    setIsModalOpen(false);
  };

  // เล่นไฟล์เสียงต้นแบบของประโยค Weekly (audio_url ที่ admin อัดไว้) ด้วยไอคอนลำโพง
  const handlePlayWeeklyQuote = async () => {
    if (!weeklySentence?.audio_url) {
      Alert.alert('No audio available', 'This weekly sentence does not have an audio file available.');
      return;
    }
    try {
      // ทุกครั้งที่กด: หยุดเสียงเดิมก่อน แล้วเริ่มเล่นใหม่ตั้งแต่ต้น
      releaseWeeklyPlayer();
      const myPlayId = weeklyPlayIdRef.current;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldRouteThroughEarpiece: false });
      // ระหว่างรอ มีการกดใหม่ / เปลี่ยนหน้า / เปลี่ยนประโยค -> ยกเลิกการเล่นนี้ ไม่สร้าง player ซ้อน
      if (myPlayId !== weeklyPlayIdRef.current) return;
      const player = createAudioPlayer({ uri: weeklySentence.audio_url });
      player.volume = 1.0;
      weeklyPlayerRef.current = player;
      player.play();
    } catch (err) {
      console.error('Play weekly audio error:', err);
      Alert.alert('Failed to play audio', 'Please try again later.');
    }
  };

  const handleTryWeekly = () => {
    if (!weeklySentence) {
      Alert.alert('No weekly sentence available', 'There is no weekly sentence available for this level at the moment.');
      return;
    }
    onTryWeekly?.();
  };

  return (
    <ContentWrapper>
      {/* 🎯 เนื้อหาเลื่อนได้ + เว้นล่างให้พ้น BottomBar ไม่ให้การ์ดสุดท้ายโดนทับ */}
      {/* ล็อกไม่ให้เลื่อน (scrollEnabled=false) */}
      <ScrollView
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: 20, paddingBottom: 120 }}
      >
        <SectionCard>
          {weeklyCompleted && (
            <CompletedBadge>
              <CompletedBadgeText>Completed</CompletedBadgeText>
            </CompletedBadge>
          )}
          <CardTitle>Weekly Sentence</CardTitle>
          <WeeklyQuoteBox>
            <QuoteColumn>
              <QuoteText>{contentData.quote}</QuoteText>
              {!!contentData.eng && <QuoteEngText>{contentData.eng}</QuoteEngText>}
            </QuoteColumn>
            <AudioButton onPress={handlePlayWeeklyQuote}>
              <SpeakerIcon source={speakerImg} />
            </AudioButton>
          </WeeklyQuoteBox>
          <DarkActionButton onPress={handleTryWeekly}>I want to try!</DarkActionButton>
        </SectionCard>

        <SectionCard style={{ paddingBottom: 15 }}>
          <FlexHeader>
            <CardTitle style={{ marginBottom: 0 }}>Current Level</CardTitle>
            <TouchableOpacity onPress={() => setIsModalOpen(true)}>
              <ChangeTextLink>change</ChangeTextLink>
            </TouchableOpacity>
          </FlexHeader>

          <StatusProgressCard bgColor={contentData.bgColor}>
            <StatusInfoRow>
              <LevelEmoji source={contentData.emoji} />
              <View style={{ alignItems: 'flex-start' }}>
                <Text style={{ fontSize: 16, fontFamily: 'Sarabun_700Bold' }}>{contentData.title}</Text>
                <Text style={{ marginTop: 2, fontSize: 14, color: '#444', fontFamily: 'Sarabun_400Regular' }}>
                  Basic Sentence
                </Text>
              </View>
            </StatusInfoRow>

            <ProgressBarContainer>
              <ProgressBarFill $percent={overallProgress} />
            </ProgressBarContainer>
            <ProgressPercentText>Progress {overallProgress}%</ProgressPercentText>
          </StatusProgressCard>

          <PrimaryOrangeButton onPress={onContinue}>▶ Continue</PrimaryOrangeButton>
        </SectionCard>
      </ScrollView>

      {/* Bottom Tab Bar: Home | Speak to Match | Play All */}
      <BottomBar>
        <TabItem onPress={onGoHome} activeOpacity={0.7}>
          <HomeIcon />
          <TabLabel>Home</TabLabel>
        </TabItem>

        {/* เปิดหน้า SpeakMatchScreen (หน้าแยก) */}
        <TabItem onPress={onSpeakMatch} activeOpacity={0.7}>
          <SpeakerIcon source={microphoneImg} style={{ width: TAB_ICON_SIZE, height: TAB_ICON_SIZE, tintColor: '#444' }} />
          <TabLabel>Speak to Match</TabLabel>
        </TabItem>

        {/* เปิดหน้า AudioScreen (รายการประโยคแยกตามบทเรียน กดฟังได้ทีละไฟล์) */}
        <TabItem onPress={onPlayAll} activeOpacity={0.7}>
          <SpeakerIcon source={speakerImg} style={{ width: TAB_ICON_SIZE, height: TAB_ICON_SIZE }} />
          <TabLabel>Play Audio</TabLabel>
        </TabItem>
      </BottomBar>

      <Modal transparent visible={isModalOpen} animationType="fade" onRequestClose={() => setIsModalOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setIsModalOpen(false)}>
          <ModalOverlay>
            <TouchableWithoutFeedback onPress={() => { }}>
              <ModalCard>
                <CloseButton onPress={() => setIsModalOpen(false)}>
                  <Text style={{ fontSize: 18, color: '#666' }}>✕</Text>
                </CloseButton>
                <Text style={{ fontSize: 18, fontFamily: 'Sarabun_600SemiBold' }}>
                  Select Difficulty Level
                </Text>

                <LevelOptionsContainer>
                  <LevelCard
                    bgColor="#c6f6d5"
                    onPress={() => handleSelectNewLevel({ id: 'easy', title: 'Beginner', icon: EasyIconImg, color: '#c6f6d5' })}
                  >
                    <LevelIconImage source={EasyIconImg} />
                    <View style={{ alignItems: 'flex-start', marginLeft: 12 }}>
                      <Text style={{ fontSize: 18, fontFamily: 'Sarabun_600SemiBold' }}>Beginner</Text>
                      <Text style={{ marginTop: 2, fontSize: 12, color: '#555', fontFamily: 'Sarabun_400Regular' }}>
                        Basic Phrase and Sentence
                      </Text>
                    </View>
                  </LevelCard>

                  <LevelCard
                    bgColor="#feebc8"
                    onPress={() => handleSelectNewLevel({ id: 'medium', title: 'Medium', icon: MediumIconImg, color: '#feebc8' })}
                  >
                    <LevelIconImage source={MediumIconImg} />
                    <View style={{ alignItems: 'flex-start', marginLeft: 12 }}>
                      <Text style={{ fontSize: 18, fontFamily: 'Sarabun_600SemiBold' }}>Medium</Text>
                      <Text style={{ marginTop: 2, fontSize: 12, color: '#555', fontFamily: 'Sarabun_400Regular' }}>
                        Interactive Sentence
                      </Text>
                    </View>
                  </LevelCard>
                </LevelOptionsContainer>
              </ModalCard>
            </TouchableWithoutFeedback>
          </ModalOverlay>
        </TouchableWithoutFeedback>
      </Modal>
    </ContentWrapper>
  );
}

export default HomeScreen;
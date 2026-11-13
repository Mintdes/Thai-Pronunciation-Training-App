import {
  Sarabun_400Regular,
  Sarabun_400Regular_Italic,
  Sarabun_500Medium,
  Sarabun_500Medium_Italic,
  Sarabun_600SemiBold,
  Sarabun_600SemiBold_Italic,
  Sarabun_700Bold,
  Sarabun_700Bold_Italic,
  useFonts,
} from '@expo-google-fonts/sarabun';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import styled from 'styled-components/native';

import AdminScreen from './src/screens/AdminScreen';
import AssessScreen from './src/screens/AssessScreen';
import AudioScreen from './src/screens/AudioScreen';
import ChangeEmailScreen from './src/screens/ChangeEmailScreen';
import ChooseSentenceScreen from './src/screens/ChooseSentenceScreen';
import HomeScreen from './src/screens/HomeScreen';
import LoginScreen, { API_URL } from './src/screens/LoginScreen';
import PracticeScreen from './src/screens/PracticeScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SpeakMatchScreen from './src/screens/SpeakMatchScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';

import EasyIconImg from './src/assets/chick.webp';
import ProfileImg from './src/assets/dog.png';

import { apiFetch } from './src/utils/apiClient';
import { clearAuthToken, loadAuthToken, saveAuthToken } from './src/utils/authToken';
import {
  fetchLevelSentenceIndex,
  fetchStatsFromServer,
  getExercisesCompleted,
  getLessonsCompleted,
  getOverallProgressPercent,
  getWeeklyCompleted,
  loadStats,
  recordExercise,
} from './src/utils/learningStats';
import { resolveSentenceAudio } from './src/utils/resolveSentenceAudio';

SplashScreen.preventAutoHideAsync();

const ACTIVE_LEVEL_STORAGE_PREFIX = 'thaiApp.activeLevel';
const getActiveLevelStorageKey = (userKey) => `${ACTIVE_LEVEL_STORAGE_PREFIX}:${userKey || 'anonymous'}`;

const saveActiveLevel = async (level, userKey) => {
  try {
    await AsyncStorage.setItem(getActiveLevelStorageKey(userKey), JSON.stringify(level));
  } catch (err) {
    console.error('saveActiveLevel failed', err);
  }
};

const loadActiveLevel = async (userKey) => {
  try {
    const raw = await AsyncStorage.getItem(getActiveLevelStorageKey(userKey));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('loadActiveLevel failed', err);
    return null;
  }
};

// ระดับเริ่มต้นภายในแอป (ใช้เป็นค่า fallback ให้โค้ดที่อ่าน activeLevel.id ไม่พัง)
// ผู้ใช้จะถือว่า "เลือกระดับแล้ว" ก็ต่อเมื่อ hasChosenLevel เป็น true เท่านั้น
const DEFAULT_ACTIVE_LEVEL = { id: 'easy', title: 'Beginner', icon: EasyIconImg, color: '#c6f6d5' };

if (Text.defaultProps == null) Text.defaultProps = {};
Text.defaultProps.style = { fontFamily: 'Sarabun_400Regular' };

if (TextInput.defaultProps == null) TextInput.defaultProps = {};
TextInput.defaultProps.style = { fontFamily: 'Sarabun_400Regular' };

const AppContainer = styled(SafeAreaView)`
  flex: 1;
  background-color: #fcebd2;
  align-items: center;
  justify-content: center;
`;

const MainCard = styled.View`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #fdf6ec;
  padding: 35px 20px;
`;

const HeaderIcons = styled.View`
  width: 100%;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-top: 30px;
  margin-bottom: 28px;
`;

const RightIconsGroup = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 16px;
`;

const ProfileIcon = styled.TouchableOpacity`
  align-items: center;
`;
const ProfileIconLabel = styled.Text`
  font-family: 'Sarabun_400Regular';
  font-size: 12px;
`;

const ProfileImagePlaceholder = styled.Image`
  width: 50px;
  height: 50px;
  border-radius: 25px;
  background-color: #fcebd2;
  border-width: 2px;
  border-color: #333;
  margin-bottom: 5px;
`;

const HeaderTextContainer = styled.View`
  flex: 1;
  margin-right: 12px;
`;

const GreetingText = styled.Text`
  font-family: 'Sarabun_700Bold';
  font-size: 20px;
  color: #222;
  line-height: 30px;
  padding-left: 10px;
`;

const UserSubtitle = styled.Text`
  font-family: 'Sarabun_400Regular';
  font-size: 14px;
  color: #555;
  margin-top: 6px;
  padding-left: 10px;
`;

// คำทักทายตามเวลาประเทศไทย (UTC+7) คำนวณจาก UTC เอง ไม่ขึ้นกับ time zone ของเครื่อง
const THAILAND_UTC_OFFSET_HOURS = 7;
function getThaiGreeting(now = Date.now()) {
  const hour = new Date(now + THAILAND_UTC_OFFSET_HOURS * 3600 * 1000).getUTCHours();
  if (hour >= 4 && hour < 12) return 'Good Morning';
  if (hour >= 12 && hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Sarabun_400Regular,
    Sarabun_400Regular_Italic,
    Sarabun_500Medium,
    Sarabun_500Medium_Italic,
    Sarabun_600SemiBold,
    Sarabun_600SemiBold_Italic,
    Sarabun_700Bold,
    Sarabun_700Bold_Italic,
  });

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [currentView, setCurrentView] = useState('welcome');
  // หน้าที่ผู้ใช้อยู่ก่อนกดเข้า Profile / Admin จากแถบ header (welcome หรือ home) เพื่อให้ปุ่มย้อนกลับกลับไปหน้านั้นให้ถูก
  const [returnView, setReturnView] = useState('home');
  const [greeting, setGreeting] = useState(getThaiGreeting());

  // อัปเดตคำทักทายทุกนาที เผื่อเปิดแอปค้างไว้ข้ามช่วงเวลา
  useEffect(() => {
    const timer = setInterval(() => setGreeting(getThaiGreeting()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [isAdmin, setIsAdmin] = useState(false);

  const [activeLevel, setActiveLevel] = useState(DEFAULT_ACTIVE_LEVEL);
  // ผู้ใช้เลือกหรือวัดระดับแล้วหรือยัง (ใช้แสดง "Not selected yet" ที่หน้า Profile แทนการโชว์ Beginner ให้คนที่ยังไม่ได้เลือก)
  const [hasChosenLevel, setHasChosenLevel] = useState(false);
  const [selectedPhrase, setSelectedPhrase] = useState(null);
  const [topicSentences, setTopicSentences] = useState([]);
  const [topicSentenceIndex, setTopicSentenceIndex] = useState(0);
  const [isLoadingNextSentence, setIsLoadingNextSentence] = useState(false);
  const [currentTopic, setCurrentTopic] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [authToken, setAuthToken] = useState(null);

  const [learningStats, setLearningStats] = useState({
    exercisesCompleted: 0,
    completedSentenceIds: [],
  });
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [levelSentences, setLevelSentences] = useState(null);
  // ประโยค Weekly ของระดับที่เปิดอยู่ ({ level, sentence }) เก็บ level ไว้กันแสดงของระดับเก่าตอนสลับระดับ
  const [weeklyData, setWeeklyData] = useState({ level: null, sentence: null });

  useEffect(() => {
    loadStats()
      .then((stats) => {
        setLearningStats(stats);
        setStatsLoaded(true);
      })
      .catch((err) => {
        console.error('[TEST] loadStats rejected:', err);
        setStatsLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (fontsLoaded && statsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, statsLoaded]);

  useEffect(() => {
    (async () => {
      const storedToken = await loadAuthToken();
      if (!storedToken) {
        setIsRestoringSession(false);
        return;
      }

      try {
        const response = await apiFetch(`${API_URL}/api/auth/me`, {
          method: 'GET',
          token: storedToken,
        });

        if (response.ok) {
          const data = await response.json();
          setIsLoggedIn(true);
          setAuthToken(storedToken);
          setUserEmail(data.user.email);
          setUserName(data.user.username);
          try {
            const roleRes = await apiFetch(`${API_URL}/api/auth/me/role`, { method: 'GET', token: storedToken });
            if (roleRes.ok) {
              const roleData = await roleRes.json();
              setIsAdmin(roleData.role === 'admin');
            }
          } catch (_) { }
          await goToHomeOrWelcome(data.user.email);
        } else {
          await clearAuthToken();
        }
      } catch (err) {
        console.error('Restore session failed', err);
      } finally {
        setIsRestoringSession(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !authToken) return;
    (async () => {
      const serverStats = await fetchStatsFromServer(authToken, userEmail);
      if (serverStats) {
        setLearningStats(serverStats);
      }
    })();
  }, [isLoggedIn, authToken, userEmail]);

  useEffect(() => {
    if (!isLoggedIn) return;
    if (!['home', 'choose_sentence', 'profile'].includes(currentView)) return;
    (async () => {
      const index = await fetchLevelSentenceIndex();
      if (index) setLevelSentences(index);
    })();
  }, [isLoggedIn, currentView]);

  // โหลดประโยค Weekly ของระดับปัจจุบันทุกครั้งที่กลับมาหน้า Home / เปลี่ยนระดับ
  useEffect(() => {
    if (!isLoggedIn || currentView !== 'home') return undefined;
    let cancelled = false;
    const levelId = activeLevel.id;
    (async () => {
      let sentence = null;
      try {
        const res = await fetch(`${API_URL}/api/weekly?level=${levelId}`, {
          headers: { 'ngrok-skip-browser-warning': 'true' },
        });
        if (res.ok) {
          const data = await res.json();
          sentence = data.sentence || null;
        }
      } catch (err) {
        console.warn('โหลดประโยค Weekly ไม่สำเร็จ', err);
      }
      if (!cancelled) setWeeklyData({ level: levelId, sentence });
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn, currentView, activeLevel.id]);

  const learningStatsRef = useRef(learningStats);
  useEffect(() => {
    learningStatsRef.current = learningStats;
  }, [learningStats]);

  const authTokenRef = useRef(authToken);
  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  const goToHomeOrWelcome = async (userKey) => {
    const savedLevel = await loadActiveLevel(userKey);
    if (savedLevel) {
      setActiveLevel(savedLevel);
      setHasChosenLevel(true);
      setCurrentView('home');
    } else {
      // ผู้ใช้ใหม่/ยังไม่เคยเลือกระดับ: ล้างระดับที่อาจค้างจากบัญชีก่อนหน้าในรอบที่เปิดแอป
      setActiveLevel(DEFAULT_ACTIVE_LEVEL);
      setHasChosenLevel(false);
      setCurrentView('welcome');
    }
  };

  const handleLoadAssessmentSentences = async (levelId, count) => {
    try {
      // 🎯 ดึงจาก Backend Node API แทนการยิง Supabase ตรง ๆ
      const response = await fetch(`${API_URL}/api/topics?level=${levelId}`, {
        headers: {
          'ngrok-skip-browser-warning': 'true',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });

      if (!response.ok) {
        console.warn(`ดึงข้อมูลบทเรียนสำหรับ level: ${levelId} ไม่สำเร็จ (HTTP ${response.status})`);
        return [];
      }

      const data = await response.json();

      // รวมประโยคจากทุก topic ใน level นั้นออกมาเป็น array เดียว
      const allSentences = (data.topics || []).flatMap((topic) => topic.sentences || []);

      if (allSentences.length === 0) {
        console.warn(`⚠️ ไม่พบข้อมูลประโยคสำหรับ level: ${levelId}`);
        return [];
      }

      // แมปรูปแบบให้ตรงกับที่ AssessScreen และ PracticeScreen ใช้งาน
      return allSentences.map((item) => ({
        sentence_id: String(item.sentence_id || item.id),
        audio_file_name: item.audio_file_name,
        thai: item.thai,
        karaoke: item.karaoke || '',
        eng: item.eng || '',
        label: item.label || item.thai,
        pronunciation: item.pronunciation || '',
        audio_file: item.audio_file_name,
        audio: { uri: item.audio_url },
        // PracticeScreen แสดงรูปจาก phraseData.image (รูปแบบ { uri })
        image: item.image_url ? { uri: item.image_url } : undefined,
      }));
    } catch (err) {
      console.error('handleLoadAssessmentSentences error:', err);
      return [];
    }
  };

  const weeklySentence = weeklyData.level === activeLevel.id ? weeklyData.sentence : null;
  // สถานะ Completed ของ Weekly เก็บใน completedSentenceIds ด้วย key 'weekly:<sentence_id>' (ไม่ปนกับประโยคในบทเรียนปกติ
  // และไม่นับเข้า % ความคืบหน้าของระดับ) เมื่อพูดผ่านแล้วไม่ถูกลบ แม้กลับมาฝึกซ้ำแล้วไม่ผ่าน
  const weeklyKey = (sentenceId) => `weekly:${sentenceId}`;
  const weeklyCompleted = !!weeklySentence
    && learningStats.completedSentenceIds.includes(weeklyKey(weeklySentence.sentence_id));

  const handleTryWeekly = async () => {
    if (!weeklySentence) return;
    const resolved = await resolveSentenceAudio(weeklySentence);
    if (!resolved) {
      Alert.alert('ไม่สามารถโหลดประโยค Weekly ได้', 'กรุณาลองใหม่อีกครั้ง');
      return;
    }
    // หน้าฝึกมีเฉพาะประโยค Weekly ประโยคเดียว
    setSelectedPhrase({ ...resolved, isWeekly: true });
    setTopicSentences([weeklySentence]);
    setTopicSentenceIndex(0);
    setCurrentView('practice');
  };

  const handleExerciseComplete = async (phraseData, evaluationData) => {
    const completionKey = phraseData?.isWeekly ? weeklyKey(phraseData.sentence_id) : phraseData?.thai;
    const updated = await recordExercise(learningStats, completionKey, authToken, userEmail, {
      passed: typeof evaluationData?.is_passed === 'boolean' ? evaluationData.is_passed : null,
    });
    setLearningStats(updated);
  };

  const handleNextSentence = async () => {
    const nextIndex = topicSentenceIndex + 1;

    if (nextIndex >= topicSentences.length) {
      setCurrentView('choose_sentence');
      return;
    }

    setIsLoadingNextSentence(true);
    const nextResolved = await resolveSentenceAudio(topicSentences[nextIndex]);
    setIsLoadingNextSentence(false);

    if (!nextResolved) {
      Alert.alert('ไม่สามารถโหลดประโยคถัดไปได้', 'กรุณาลองใหม่อีกครั้ง');
      return;
    }

    setSelectedPhrase(nextResolved);
    setTopicSentenceIndex(nextIndex);
  };

  const handleConfirmSelection = (chosenLevelInfo) => {
    setActiveLevel(chosenLevelInfo);
    setHasChosenLevel(true);
    saveActiveLevel(chosenLevelInfo, userEmail);
    setCurrentView('home');
  };

  const handleAuthSuccess = async (emailFromLogin, usernameFromLogin, token) => {
    setIsLoggedIn(true);
    setUserEmail(emailFromLogin);
    if (usernameFromLogin) setUserName(usernameFromLogin);
    if (token) {
      setAuthToken(token);
      try {
        const roleRes = await apiFetch(`${API_URL}/api/auth/me/role`, { method: 'GET', token });
        if (roleRes.ok) {
          const roleData = await roleRes.json();
          setIsAdmin(roleData.role === 'admin');
        }
      } catch (_) { }
    }
    await goToHomeOrWelcome(emailFromLogin);
  };

  // เปิดหน้าจากแถบ header (Profile / Admin): จำหน้าปัจจุบันไว้ แล้วค่อยสลับไป
  // กดซ้ำจากหน้า profile/admin เองไม่เกิดขึ้น เพราะ header ซ่อนอยู่ในหน้าเหล่านั้น
  const openFromHeader = (view) => {
    setReturnView(currentView === 'welcome' ? 'welcome' : 'home');
    setCurrentView(view);
  };

  const handleGoToProfile = () => openFromHeader('profile');

  const handleChangeEmail = () => {
    setCurrentView('change_email');
  };

  const handleChangeEmailSuccess = (newEmail, newToken) => {
    setUserEmail(newEmail);
    if (newToken) {
      setAuthToken(newToken);
      saveAuthToken(newToken);
    }
    setCurrentView('profile');
  };

  const handleLogOut = async () => {
    if (authToken) {
      try {
        await apiFetch(`${API_URL}/api/auth/logout`, {
          method: 'POST',
          token: authToken,
        });
      } catch (err) {
        console.error('Logout request failed (จะยังคง log out ฝั่งเครื่องต่อไป)', err);
      }
    }

    setIsLoggedIn(false);
    setSelectedPhrase(null);
    setAuthToken(null);
    setIsAdmin(false);
    // ล้างข้อมูลของผู้ใช้เดิม ไม่ให้ค้างไปโผล่ในบัญชีถัดไป
    setActiveLevel(DEFAULT_ACTIVE_LEVEL);
    setHasChosenLevel(false);
    setCurrentTopic('');
    setUserName('');
    setUserEmail('');
    clearAuthToken();
    setReturnView('home');
    setCurrentView('welcome');
  };

  const renderCurrentView = () => {
    if (isRestoringSession) {
      return null;
    }
    if (!isLoggedIn) {
      return <LoginScreen onLoginSuccess={handleAuthSuccess} />;
    }
    if (currentView === 'welcome') {
      return (
        <WelcomeScreen
          onConfirmSelection={handleConfirmSelection}
          onNavigateToLogin={() => setIsLoggedIn(false)}
          onNavigateToAssess={() => setCurrentView('assess')}
        />
      );
    }
    if (currentView === 'assess') {
      return (
        <AssessScreen
          authToken={authToken}
          loadSentences={handleLoadAssessmentSentences}
          onBack={() => setCurrentView('welcome')}
          onFinish={(recommendedLevel) => {
            handleConfirmSelection(recommendedLevel);
          }}
        />
      );
    }
    if (currentView === 'home') {
      return (
        <HomeScreen
          currentLevel={activeLevel}
          onChangeLevel={(newLevel) => {
            setActiveLevel(newLevel);
            setHasChosenLevel(true);
            saveActiveLevel(newLevel, userEmail);
          }}
          onContinue={() => setCurrentView('choose_sentence')}
          onPlayAll={() => setCurrentView('audio')}
          onGoHome={() => setCurrentView('welcome')}
          onSpeakMatch={() => setCurrentView('speak_match')}
          onTryWeekly={handleTryWeekly}
          weeklySentence={weeklySentence}
          weeklyCompleted={weeklyCompleted}
          overallProgress={getOverallProgressPercent(learningStats, activeLevel.id, levelSentences)}
          allSentences={topicSentences}
          authToken={authToken}
          apiUrl={API_URL}
        />
      );
    }
    if (currentView === 'speak_match') {
      return (
        <SpeakMatchScreen
          authToken={authToken}
          apiUrl={API_URL}
          onBack={() => setCurrentView('home')}
        />
      );
    }
    if (currentView === 'audio') {
      return <AudioScreen authToken={authToken} onBack={() => setCurrentView('home')} />;
    }
    if (currentView === 'choose_sentence') {
      return (
        <ChooseSentenceScreen
          onBack={() => setCurrentView('home')}
          initialTopic={currentTopic}
          onTopicToggle={(topic) => setCurrentTopic(topic)}
          currentLevel={activeLevel}
          overallProgress={getOverallProgressPercent(learningStats, activeLevel.id, levelSentences)}
          completedSentenceIds={learningStats.completedSentenceIds}
          onSelectSentence={(phraseData, topicList, index) => {
            setSelectedPhrase(phraseData);
            setTopicSentences(topicList || []);
            setTopicSentenceIndex(index ?? 0);
            setCurrentView('practice');
          }}
        />
      );
    }
    if (currentView === 'practice') {
      return (
        <PracticeScreen
          onBack={() => setCurrentView(selectedPhrase?.isWeekly ? 'home' : 'choose_sentence')}
          isWeekly={!!selectedPhrase?.isWeekly}
          phraseData={selectedPhrase}
          authToken={authToken}
          onExerciseComplete={handleExerciseComplete}
          onNext={handleNextSentence}
          isLastSentence={topicSentenceIndex >= topicSentences.length - 1}
          isLoadingNext={isLoadingNextSentence}
        />
      );
    }
    if (currentView === 'profile') {
      return (
        <ProfileScreen
          userName={userName}
          userEmail={userEmail}
          avatarSrc={ProfileImg}
          overallProgress={getOverallProgressPercent(learningStats, activeLevel.id, levelSentences)}
          currentLevel={{ id: activeLevel.id, title: activeLevel.title }}
          learningStats={{
            lessonsCompleted: getLessonsCompleted(learningStats, levelSentences),
            exercisesCompleted: getExercisesCompleted(learningStats),
            // นับแยกจาก Exercise: เฉพาะ key 'weekly:<sentence_id>' ที่พูดผ่านแล้ว
            weeklyCompleted: getWeeklyCompleted(learningStats),
          }}
          onResume={() => setCurrentView(returnView)}
          backLabel={returnView === 'welcome' ? 'Back' : 'Resume Learning'}
          onLogout={handleLogOut}
          onChangeEmail={handleChangeEmail}
          isAdmin={isAdmin}
          levelChosen={hasChosenLevel}
        />
      );
    }
    if (currentView === 'change_email') {
      return (
        <ChangeEmailScreen
          currentEmail={userEmail}
          authToken={authToken}
          onCancel={() => setCurrentView('profile')}
          onSuccess={handleChangeEmailSuccess}
        />
      );
    }
    if (currentView === 'admin') {
      return (
        <AdminScreen
          authToken={authToken}
          onBack={() => setCurrentView(returnView)}
        />
      );
    }
    return null;
  };

  const showHeader =
    isLoggedIn &&
    currentView !== 'choose_sentence' &&
    currentView !== 'practice' &&
    currentView !== 'profile' &&
    currentView !== 'change_email' &&
    currentView !== 'admin' &&
    currentView !== 'assess' &&
    currentView !== 'audio' &&
    currentView !== 'speak_match';

  if (!fontsLoaded || isRestoringSession) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fdf6ec' }}>
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  return (
    <AppContainer>
      <StatusBar style="dark" />
      <MainCard>
        {showHeader && (
          <HeaderIcons>
            <HeaderTextContainer>
              <GreetingText>{greeting}, {userName}</GreetingText>
              <UserSubtitle>Today, are you ready to learn Thai?</UserSubtitle>
            </HeaderTextContainer>

            <RightIconsGroup>
              {isAdmin && (
                <TouchableOpacity
                  onPress={() => openFromHeader('admin')}
                  style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#f97316', borderRadius: 8 }}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Sarabun_700Bold' }}>Admin</Text>
                </TouchableOpacity>
              )}
              <ProfileIcon onPress={handleGoToProfile}>
                <ProfileImagePlaceholder source={ProfileImg} />
                <ProfileIconLabel>Profile</ProfileIconLabel>
              </ProfileIcon>
            </RightIconsGroup>
          </HeaderIcons>
        )}

        {renderCurrentView()}
      </MainCard>
    </AppContainer>
  );
}
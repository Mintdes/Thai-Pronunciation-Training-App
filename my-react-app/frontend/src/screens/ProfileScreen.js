import { useState } from 'react';
import { ScrollView } from 'react-native';
import styled from 'styled-components/native';
import LogoutConfirmModal from '../components/LogoutConfirmModal';
import { BackLinkButton } from '../shared/AuthStyles';

const Wrapper = styled.View`
  width: 100%;
  align-items: center;
`;

const AvatarImg = styled.Image`
  width: 84px;
  height: 84px;
  border-radius: 42px;
  border-width: 2px;
  border-color: #333;
  margin-bottom: 14px;
`;

const NameText = styled.Text`
  font-size: 18px;
  font-family: 'Sarabun_700Bold';
  color: #222;
  text-align: center;
`;

const EmailRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
`;

const EmailText = styled.Text`
  font-size: 13px;
  color: #555;
`;

const ChangeEmailButton = styled.TouchableOpacity`
  background-color: #fcebd2;
  padding: 4px 10px;
  border-radius: 999px;
`;
const ChangeEmailButtonText = styled.Text`
  color: #b5651d;
  font-size: 11px;
  font-family: 'Sarabun_600SemiBold';
`;

const ProgressCard = styled.View`
  width: 100%;
  margin-top: 28px;
  background-color: #fcebd2;
  border-radius: 18px;
  padding: 18px 20px;
`;

const ProgressLabelRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
`;

const ProgressLabel = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_600SemiBold';
  color: #6b5f52;
`;

const ProgressPercent = styled.Text`
  font-size: 15px;
  font-family: 'Sarabun_700Bold';
  color: #e8734a;
`;

const ProgressTrack = styled.View`
  height: 10px;
  border-radius: 999px;
  background-color: #f0dfc7;
  overflow: hidden;
`;

const ProgressFill = styled.View`
  width: ${(props) => props.$percent}%;
  height: 100%;
  border-radius: 999px;
  background-color: #e8734a;
`;

const SectionCard = styled.View`
  width: 100%;
  margin-top: 16px;
  background-color: #fff;
  border-width: 1px;
  border-color: #f0e6d6;
  border-radius: 18px;
  padding: 18px 20px;
`;

const SectionTitle = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_700Bold';
  color: #6b5f52;
  margin-bottom: 14px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const LevelsGrid = styled.View`
  gap: 10px;
`;

const LevelRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const LevelSkillName = styled.Text`
  font-size: 14px;
  font-family: 'Sarabun_600SemiBold';
  color: #333;
`;

const LevelBadge = styled.Text`
  font-size: 11px;
  font-family: 'Sarabun_700Bold';
  padding: 4px 12px;
  border-radius: 999px;
  overflow: hidden;
  color: ${(props) => (props.$id === 'medium' ? '#b5651d' : props.$id === 'none' ? '#6b7280' : '#3f6b34')};
  background-color: ${(props) => (props.$id === 'medium' ? '#feebc8' : props.$id === 'none' ? '#e5e7eb' : '#c6f6d5')};
`;

const StatsGrid = styled.View`
  flex-direction: row;
  gap: 10px;
`;

const StatItem = styled.View`
  flex: 1;
  align-items: center;
`;

const StatValue = styled.Text`
  text-align: center;
  font-size: 20px;
  font-family: 'Sarabun_700Bold';
  color: #e8734a;
`;

const StatLabel = styled.Text`
  text-align: center;
  font-size: 12px;
  color: #8a8074;
`;

const ActionsColumn = styled.View`
  width: 100%;
  gap: 12px;
  margin-top: 28px;
`;

const LogoutButton = styled.TouchableOpacity`
  border-width: 1px;
  border-color: #e7dfd3;
  border-radius: 14px;
  padding: 13px 0;
  align-items: center;
  background-color: #fb7e7e;
`;
const LogoutButtonText = styled.Text`
  font-size: 15px;
  font-family: 'Sarabun_600SemiBold';
  color: #ffffff;
`;

const DEFAULT_LEVEL = { id: 'easy', title: 'Beginner' };
const DEFAULT_STATS = { lessonsCompleted: 0, exercisesCompleted: 0, weeklyCompleted: 0 };

function ProfileScreen({
  userName,
  userEmail,
  avatarSrc,
  overallProgress = 0,
  currentLevel = DEFAULT_LEVEL,
  learningStats = DEFAULT_STATS,
  onResume,
  backLabel = 'Resume Learning',
  onLogout,
  onChangeEmail,
  // false = ผู้ใช้ยังไม่ได้เลือก/วัดระดับ -> แสดง "Not selected yet" แทนระดับเริ่มต้น
  levelChosen = true,
}) {
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  const handleConfirmLogout = () => {
    setIsLogoutModalOpen(false);
    onLogout();
  };

  return (
    <ScrollView style={{ width: '100%' }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 30 }}>
      <Wrapper>
        <BackLinkButton onPress={onResume} label={backLabel} />

        <AvatarImg source={avatarSrc} />
        <NameText>{userName}</NameText>
        <EmailRow>
          <EmailText>{userEmail}</EmailText>
          <ChangeEmailButton onPress={onChangeEmail}>
            <ChangeEmailButtonText>Change email</ChangeEmailButtonText>
          </ChangeEmailButton>
        </EmailRow>

        {/* ผู้ใช้ที่ยังไม่ได้เลือก/วัดระดับยังไม่มีความคืบหน้าให้แสดง จึงซ่อนการ์ดนี้ไว้ */}
        {levelChosen && (
          <ProgressCard>
            <ProgressLabelRow>
              <ProgressLabel>Overall Progress</ProgressLabel>
              <ProgressPercent>{overallProgress}%</ProgressPercent>
            </ProgressLabelRow>
            <ProgressTrack>
              <ProgressFill $percent={overallProgress} />
            </ProgressTrack>
          </ProgressCard>
        )}

        {/* ไม่มีการ์ด Progress ด้านบน จึงเว้นระยะจากแถวอีเมลให้เท่าเดิม */}
        <SectionCard style={{ marginTop: levelChosen ? 16 : 28 }}>
          <SectionTitle>Current Level</SectionTitle>
          <LevelsGrid>
            <LevelRow>
              <LevelSkillName>Thai Level</LevelSkillName>
              {levelChosen ? (
                <LevelBadge $id={currentLevel.id}>{currentLevel.title}</LevelBadge>
              ) : (
                <LevelBadge $id="none">Not selected yet</LevelBadge>
              )}
            </LevelRow>
          </LevelsGrid>
        </SectionCard>

        <SectionCard>
          <SectionTitle>Learning Statistics</SectionTitle>
          <StatsGrid>
            <StatItem>
              <StatValue>{learningStats.lessonsCompleted}</StatValue>
              <StatLabel>Lessons completed</StatLabel>
            </StatItem>
            <StatItem>
              <StatValue>{learningStats.exercisesCompleted}</StatValue>
              <StatLabel>Exercises completed</StatLabel>
            </StatItem>
            <StatItem>
              <StatValue>{learningStats.weeklyCompleted ?? 0}</StatValue>
              <StatLabel>Weekly completed</StatLabel>
            </StatItem>
          </StatsGrid>
        </SectionCard>

        <ActionsColumn>
          <LogoutButton onPress={() => setIsLogoutModalOpen(true)}>
            <LogoutButtonText>Log out</LogoutButtonText>
          </LogoutButton>
        </ActionsColumn>

        {isLogoutModalOpen && (
          <LogoutConfirmModal onCancel={() => setIsLogoutModalOpen(false)} onConfirm={handleConfirmLogout} />
        )}
      </Wrapper>
    </ScrollView>
  );
}

export default ProfileScreen;
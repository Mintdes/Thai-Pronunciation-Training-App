import { useState } from 'react';
import { Modal, Text, TouchableWithoutFeedback, View } from 'react-native';
import styled from 'styled-components/native';
import EasyIconImg from '../assets/chick.webp';
import MediumIconImg from '../assets/chick1.png';
import talkingImg from '../assets/talking.png';

const StartLearningContainer = styled.View`
  width: 100%;
  flex: 1;
  align-items: center;
  justify-content: space-around;
`;

const StartLearningTitle = styled.Text`
  font-size: 20px;
  font-family: 'Sarabun_700Bold';
  color: #222;
  margin: 5px;
`;

const IllustrationImage = styled.Image`
  width: 150px;
  height: 150px;
  resize-mode: contain;
  margin: 15px 0;
`;

const ActionButtonGroup = styled.View`
  width: 100%;
  gap: 20px;
  margin: 15px;
`;

const ActionTouchable = styled.TouchableOpacity`
  background-color: #f97316;
  border-radius: 25px;
  padding: 16px 25px;
  width: 100%;
  align-items: center;
`;
const ActionButtonText = styled.Text`
  color: white;
  font-size: 16px;
  font-family: 'Sarabun_700Bold';
`;

const HintText = styled.Text`
  text-align: center;
  font-size: 13px;
  font-family: 'Sarabun_500Medium';
  color: #444;
  margin-top: 6px;
`;

const ModalOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.4);
  justify-content: center;
  align-items: center;
  padding: 20px;
`;

const ModalCard = styled.View`
  width: 90%;
  max-width: 320px;
  background-color: white;
  border-radius: 40px;
  padding: 35px 25px;
  align-items: center;
  position: relative;
`;

const CloseButton = styled.TouchableOpacity`
  position: absolute;
  top: 15px;
  right: 15px;
  background-color: #ff5b5b;
  width: 30px;
  height: 30px;
  border-radius: 15px;
  align-items: center;
  justify-content: center;
`;

const LevelOptionsContainer = styled.View`
  width: 100%;
  gap: 15px;
  margin-top: 25px;
`;

const LevelCard = styled.TouchableOpacity`
  width: 100%;
  background-color: ${(props) => props.bgColor};
  border-radius: 20px;
  padding: 15px 18px;
  flex-direction: row;
  align-items: center;
  gap: 15px;
`;

const BigConfirmIconBox = styled.View`
  width: 140px;
  height: 140px;
  background-color: ${(props) => props.bgColor};
  border-radius: 30px;
  justify-content: center;
  align-items: center;
  margin-bottom: 20px;
`;

const LevelIconImage = styled.Image`
  width: 50px;
  height: 50px;
  resize-mode: contain;
`;

const BigIconImage = styled.Image`
  width: 80px;
  height: 80px;
  resize-mode: contain;
`;

const BigIconLabel = styled.Text`
  font-size: 18px;
  font-family: 'Sarabun_600SemiBold';
  color: #222;
`;

const ConfirmQuestionText = styled.Text`
  font-size: 16px;
  color: #222;
  margin: 10px 0 25px 0;
`;

const PopupButtonGroup = styled.View`
  width: 100%;
  flex-direction: row;
  justify-content: space-between;
  gap: 12px;
`;

const PopupTouchable = styled.TouchableOpacity`
  flex: 1;
  border-radius: 25px;
  padding: 12px 20px;
  align-items: center;
  background-color: ${(props) => (props.variant === 'confirm' ? '#f97316' : '#222222')};
`;
const PopupButtonText = styled.Text`
  color: white;
  font-size: 16px;
`;

// 🎯 เพิ่ม onNavigateToAssess เข้ามาใน props
function WelcomeScreen({ onConfirmSelection, onNavigateToAssess }) {
  const ActionButton = ({ onPress, children }) => (
    <ActionTouchable onPress={onPress}>
      <ActionButtonText>{children}</ActionButtonText>
    </ActionTouchable>
  );

  const PopupButton = ({ variant, onPress, children }) => (
    <PopupTouchable variant={variant} onPress={onPress}>
      <PopupButtonText>{children}</PopupButtonText>
    </PopupTouchable>
  );
  const [isLevelModalOpen, setIsLevelModalOpen] = useState(false);
  const [modalStage, setModalStage] = useState('select');
  const [chosenLevel, setChosenLevel] = useState({ id: 'easy', title: 'เริ่มต้น', icon: EasyIconImg, color: '#c6f6d5' });

  const handleSelectLevel = (levelConfig) => {
    setChosenLevel(levelConfig);
    setModalStage('confirm');
  };

  return (
    <StartLearningContainer>
      <StartLearningTitle>Start your lesson</StartLearningTitle>

      <IllustrationImage source={talkingImg} />

      <ActionButtonGroup>
        <View>
          <ActionButton onPress={() => { setModalStage('select'); setIsLevelModalOpen(true); }}>
            Choose Level
          </ActionButton>
          <HintText>Choose any level you want to learn</HintText>
        </View>
        <View>
          {/* 🎯 สลับหน้าผ่าน onNavigateToAssess ไปยัง App.js โดยตรง */}
          <ActionButton onPress={() => onNavigateToAssess && onNavigateToAssess()}>
            Assess pronunciation proficiency
          </ActionButton>
          <HintText>Assess your Thai pronunciation proficiency to select the lesson for you</HintText>
        </View>
      </ActionButtonGroup>

      <Modal
        transparent
        visible={isLevelModalOpen}
        animationType="fade"
        onRequestClose={() => setIsLevelModalOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setIsLevelModalOpen(false)}>
          <ModalOverlay>
            <TouchableWithoutFeedback onPress={() => { }}>
              <ModalCard>
                {modalStage === 'select' ? (
                  <>
                    <CloseButton onPress={() => setIsLevelModalOpen(false)}>
                      <Text style={{ color: 'white', fontSize: 16, fontFamily: 'Sarabun_700Bold' }}>✕</Text>
                    </CloseButton>
                    <LevelOptionsContainer>
                      <LevelCard
                        bgColor="#c6f6d5"
                        onPress={() => handleSelectLevel({ id: 'easy', title: 'Beginner', icon: EasyIconImg, color: '#c6f6d5' })}
                      >
                        <LevelIconImage source={EasyIconImg} />
                        <View style={{ alignItems: 'flex-start', marginLeft: 10 }}>
                          <Text style={{ fontSize: 16 }}>Beginner</Text>
                          <Text style={{ marginTop: 2, fontSize: 13, color: '#555' }}>Basic Sentence</Text>
                        </View>
                      </LevelCard>

                      <LevelCard
                        bgColor="#feebc8"
                        onPress={() => handleSelectLevel({ id: 'medium', title: 'Medium', icon: MediumIconImg, color: '#feebc8' })}
                      >
                        <LevelIconImage source={MediumIconImg} />
                        <View style={{ alignItems: 'flex-start', marginLeft: 10 }}>
                          <Text style={{ fontSize: 16 }}>Medium</Text>
                          <Text style={{ marginTop: 2, fontSize: 13, color: '#555' }}>Interactive Sentence</Text>
                        </View>
                      </LevelCard>
                    </LevelOptionsContainer>
                  </>
                ) : (
                  <>
                    <BigConfirmIconBox bgColor={chosenLevel.color}>
                      <BigIconImage source={chosenLevel.icon} />
                      <BigIconLabel>{chosenLevel.title}</BigIconLabel>
                    </BigConfirmIconBox>
                    <ConfirmQuestionText>Are you sure to select this level?</ConfirmQuestionText>
                    <PopupButtonGroup>
                      <PopupButton
                        variant="confirm"
                        onPress={() => { setIsLevelModalOpen(false); onConfirmSelection(chosenLevel); }}
                      >
                        Confirm
                      </PopupButton>
                      <PopupButton variant="cancel" onPress={() => setModalStage('select')}>
                        Cancel
                      </PopupButton>
                    </PopupButtonGroup>
                  </>
                )}
              </ModalCard>
            </TouchableWithoutFeedback>
          </ModalOverlay>
        </TouchableWithoutFeedback>
      </Modal>
    </StartLearningContainer>
  );
}

export default WelcomeScreen;
import { Modal, View, Text, TouchableWithoutFeedback } from 'react-native';
import styled from 'styled-components/native';
import { ButtonGroupHorizontal, DarkPillButton, OrangePillButton } from '../shared/AuthStyles';

const Overlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.4);
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const Card = styled.View`
  width: 100%;
  max-width: 300px;
  background-color: #ffffff;
  border-radius: 24px;
  padding: 28px 22px 22px;
  align-items: center;
  /* เงาแบบ RN (แทน box-shadow ของเว็บ) */
  shadow-color: #000;
  shadow-offset: 0px 10px;
  shadow-opacity: 0.15;
  shadow-radius: 30px;
  elevation: 10;
`;

const Title = styled.Text`
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 8px;
  text-align: center;
  line-height: 25px;
`;

const Subtitle = styled.Text`
  font-size: 12.5px;
  color: #6b7280;
  margin-bottom: 22px;
  text-align: center;
  line-height: 18px;
`;

function LogoutConfirmModal({ onCancel, onConfirm }) {
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <TouchableWithoutFeedback onPress={onCancel}>
        <Overlay>
          <TouchableWithoutFeedback onPress={() => {}}>
            <Card>
              <Title>Are you sure you want to log out?</Title>
              <Subtitle>When you log out, you'll need to sign in again next time.</Subtitle>

              <ButtonGroupHorizontal>
                <DarkPillButton onPress={onCancel}>Cancel</DarkPillButton>
                <OrangePillButton onPress={onConfirm}>Confirm</OrangePillButton>
              </ButtonGroupHorizontal>
            </Card>
          </TouchableWithoutFeedback>
        </Overlay>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

export default LogoutConfirmModal;

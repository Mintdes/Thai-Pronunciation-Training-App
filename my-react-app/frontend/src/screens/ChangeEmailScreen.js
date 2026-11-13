import { Eye, EyeOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import styled from 'styled-components/native';
import {
  BackLinkButton,
  ButtonGroupHorizontal,
  CenterNavContainer,
  ErrorText,
  IconButton,
  InputGroup,
  InputLabel,
  InputWrapper,
  makeOtpHandlers,
  OrangePillButton,
  OtpInputsContainer,
  OtpNotice,
  OtpSquareInput,
  StyledInput,
  SuccessText,
  TextLinkButton
} from '../shared/AuthStyles';
import { apiFetch } from '../utils/apiClient';
import { API_URL } from './LoginScreen';

// ชื่อหน้าอยู่กึ่งกลาง ฟอนต์เดียวกับหัวข้อของหน้า Audio / Assess
const HeaderTitle = styled.Text`
  font-size: 22px;
  font-family: 'Sarabun_700Bold';
  color: #222;
  text-align: center;
  margin-top: 4px;
  margin-bottom: 20px;
`;

const validateEmailFormat = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

// stage: 'request' -> กรอกอีเมลใหม่ | 'otp' -> กรอกรหัส OTP 6 หลัก
function ChangeEmailScreen({ currentEmail, authToken, onCancel, onSuccess }) {
  const [stage, setStage] = useState('request');
  const [newEmail, setNewEmail] = useState('');
  // 🎯 เพิ่มใหม่: backend ตอนนี้ต้องการรหัสผ่านปัจจุบันมายืนยันตัวตนก่อนเปลี่ยนอีเมล
  // (แก้ช่องโหว่ที่ใครก็ตามที่รู้อีเมลเหยื่อ เปลี่ยนอีเมลบัญชีคนอื่นได้โดยไม่ต้องรู้รหัสผ่าน)
  const [currentPassword, setCurrentPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [otpArray, setOtpArray] = useState(new Array(6).fill(''));
  const [error, setError] = useState('');
  // error ของขั้นกรอกอีเมลใหม่ แยกตามช่อง เพื่อให้ข้อความขึ้นใต้ช่องที่มีปัญหาจริง
  const [fieldErrors, setFieldErrors] = useState({ newEmail: '', currentPassword: '' });
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const otpRefs = useRef([]);

  // ติดตามว่าแอปถูกสลับไปเบื้องหลังระหว่างรอคำขอส่ง OTP หรือไม่
  // ถ้าใช่ แล้ว fetch ล้มด้วย "Network request failed" แปลว่า OS ตัดการเชื่อมต่อตอนแอปอยู่เบื้องหลัง
  // แต่ server มักบันทึก OTP และส่งเมลไปแล้ว จึงพาผู้ใช้ไปหน้ากรอก OTP ต่อ (กด Resend ได้ถ้าไม่ได้รับ)
  const sendFlight = useRef({ inFlight: false, backgrounded: false });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && sendFlight.current.inFlight) {
        sendFlight.current.backgrounded = true;
      }
    });
    return () => sub.remove();
  }, []);
  const { handleOtpChange, handleOtpKeyPress } = makeOtpHandlers(otpArray, setOtpArray, otpRefs);

  // ขั้นที่ 1: ตรวจอีเมลใหม่ (รูปแบบ/ไม่ซ้ำอีเมลเดิม/ยังไม่มีในระบบ) และรหัสผ่านปัจจุบัน (ต้องตรงกับในฐานข้อมูล)
  // การตรวจ "อีเมลมีอยู่ในระบบแล้ว" และ "รหัสผ่านตรงกับ database" ทำที่ backend (change-email-request)
  // แอปแค่ส่งไปแล้วแสดงผลลัพธ์ จึงต้องเรียก change-email-request ที่นี่ ไม่ใช่ change-email-confirm (ซึ่งตรวจ OTP)
  const handleSendOtp = async () => {
    setError('');
    setFieldErrors({ newEmail: '', currentPassword: '' });

    const email = newEmail.trim();
    if (!validateEmailFormat(email)) {
      setFieldErrors({ newEmail: 'กรุณากรอกอีเมลให้ถูกต้อง', currentPassword: '' });
      return;
    }
    if (email.toLowerCase() === currentEmail.trim().toLowerCase()) {
      setFieldErrors({ newEmail: 'อีเมลใหม่ต้องไม่ซ้ำกับอีเมลปัจจุบัน', currentPassword: '' });
      return;
    }
    if (!currentPassword) {
      setFieldErrors({ newEmail: '', currentPassword: 'กรุณากรอกรหัสผ่านปัจจุบันเพื่อยืนยันตัวตน' });
      return;
    }
    if (isSubmitting) return;

    setIsSubmitting(true);
    sendFlight.current = { inFlight: true, backgrounded: false };
    try {
      const response = await apiFetch(`${API_URL}/api/auth/change-email-request`, {
        method: 'POST',
        token: authToken,
        // 🎯 แก้ไข: currentEmail ไม่ต้องส่งอีกต่อไป backend ระบุตัวตนจาก token (Authorization
        // header) แทนแล้ว ไม่ใช่จากค่าที่ client อ้างเองใน body
        body: { newEmail: email, currentPassword },
      });
      const data = await response.json();
      sendFlight.current.inFlight = false;

      if (response.ok) {
        setNewEmail(email);
        setOtpArray(new Array(6).fill(''));
        setStage('otp');
      } else {
        const message = data.message || 'ไม่สามารถส่งรหัส OTP ได้';
        if (response.status === 401) {
          // รหัสผ่านปัจจุบันไม่ตรงกับในฐานข้อมูล
          setFieldErrors({ newEmail: '', currentPassword: message });
        } else if (response.status === 400) {
          // อีเมลใหม่ใช้ไม่ได้ (รูปแบบผิด/ซ้ำของเดิม/มีบัญชีอื่นใช้อยู่แล้ว)
          setFieldErrors({ newEmail: message, currentPassword: '' });
        } else {
          setError(message);
        }
      }
    } catch (err) {
      const wasBackgrounded = sendFlight.current.backgrounded;
      sendFlight.current.inFlight = false;

      if (wasBackgrounded) {
        // ไม่ทราบผลแน่ชัดว่า server ส่งเมลหรือยัง แต่ส่วนใหญ่ส่งแล้ว -> ไปหน้า OTP ต่อ
        console.warn('change-email-request interrupted while app was in background', err);
        setNewEmail(email);
        setOtpArray(new Array(6).fill(''));
        setStage('otp');
      } else {
        console.error(err);
        setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmOtp = async () => {
    setError('');
    const fullOtpString = otpArray.join('');

    if (fullOtpString.length !== 6) {
      setError('กรุณากรอกรหัส OTP ให้ครบ 6 หลัก');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiFetch(`${API_URL}/api/auth/change-email-confirm`, {
        method: 'POST',
        token: authToken,
        body: { newEmail, otpCode: fullOtpString },
      });
      const data = await response.json();

      if (response.ok) {
        setCurrentPassword('');
        if (typeof onSuccess === 'function') {
          // 🎯 แก้ไข: backend ออก token ใหม่ให้หลังเปลี่ยนอีเมลสำเร็จ (token เดิมผูกกับอีเมลเก่า)
          // ต้องส่งต่อขึ้นไปให้ App.js เก็บแทนของเดิม
          onSuccess(newEmail, data.token);
        }
      } else {
        setError(data.message || 'รหัส OTP ไม่ถูกต้องหรือหมดอายุ');
      }
    } catch (err) {
      console.error(err);
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setStatus('');
    setError('');
    // 🎯 แก้ไข: เดิมจุดนี้ไม่ได้ส่ง currentPassword ไปด้วย ทั้งที่ backend ตอนนี้บังคับต้องมี
    // ทำให้กด Resend OTP แล้วจะโดนตีกลับ "กรุณายืนยันรหัสผ่านปัจจุบัน" ทุกครั้ง
    if (!currentPassword) {
      setError('กรุณากรอกรหัสผ่านปัจจุบันเพื่อยืนยันตัวตนก่อนขอรหัสใหม่');
      return;
    }
    try {
      const response = await apiFetch(`${API_URL}/api/auth/change-email-request`, {
        method: 'POST',
        token: authToken,
        body: { newEmail, currentPassword },
      });
      const data = await response.json();
      if (response.ok) {
        setStatus('ส่งรหัส OTP อีกครั้งเรียบร้อยแล้ว!');
      } else {
        setError(data.message || 'ไม่สามารถส่งรหัส OTP ได้');
      }
    } catch (err) {
      console.error(err);
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    }
  };

  return (
    <View style={{ flex: 1, width: '100%' }}>
      <BackLinkButton
        onPress={() => {
          if (stage === 'otp') {
            setError('');
            setStatus('');
            setStage('request');
          } else {
            onCancel();
          }
        }}
      />

      <HeaderTitle>{stage === 'otp' ? 'Confirm OTP' : 'Change Email'}</HeaderTitle>

      {stage === 'request' && (
        <>
          <InputGroup>
            <InputLabel>New Email *</InputLabel>
            <InputWrapper>
              <StyledInput
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={currentEmail}
                hasError={!!fieldErrors.newEmail}
              />
            </InputWrapper>
            {fieldErrors.newEmail ? <ErrorText>{fieldErrors.newEmail}</ErrorText> : null}
          </InputGroup>

          <InputGroup>
            <InputLabel>Current Password *</InputLabel>
            <InputWrapper>
              <StyledInput
                type={showCurrentPw ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                hasIcon
                hasError={!!fieldErrors.currentPassword}
              />
              <IconButton onPress={() => setShowCurrentPw(!showCurrentPw)}>
                {showCurrentPw ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
              </IconButton>
            </InputWrapper>
            {fieldErrors.currentPassword ? <ErrorText>{fieldErrors.currentPassword}</ErrorText> : null}
          </InputGroup>

          {error ? <ErrorText style={{ textAlign: 'center', marginBottom: 8 }}>{error}</ErrorText> : null}

          <ButtonGroupHorizontal>
            <OrangePillButton onPress={handleSendOtp} disabled={isSubmitting}>
              {isSubmitting ? 'Checking…' : 'Confirm'}
            </OrangePillButton>
          </ButtonGroupHorizontal>
        </>
      )}

      {stage === 'otp' && (
        <>
          <OtpNotice>
            We sent a verification code to {newEmail}. You can check your OTP code in your email. If you haven't received a code, tap Resend OTP.
          </OtpNotice>
          {error ? <ErrorText style={{ textAlign: 'center', marginBottom: 10 }}>{error}</ErrorText> : null}

          <OtpInputsContainer>
            {otpArray.map((data, index) => (
              <OtpSquareInput
                key={index}
                ref={(el) => (otpRefs.current[index] = el)}
                value={data}
                onChangeText={(text) => handleOtpChange(text, index)}
                onKeyPress={(e) => handleOtpKeyPress(e, index)}
              />
            ))}
          </OtpInputsContainer>

          {/* OrangePillButton มี flex: 1 ถ้าวางตรง ๆ ใน View แนวตั้งจะยืดเต็มความสูงที่เหลือ จึงห่อด้วยแถวแนวนอนเหมือนขั้นกรอกอีเมล */}
          <ButtonGroupHorizontal>
            <OrangePillButton onPress={handleConfirmOtp} disabled={isSubmitting}>
              {isSubmitting ? 'Confirming…' : 'Confirm'}
            </OrangePillButton>
          </ButtonGroupHorizontal>

          <CenterNavContainer style={{ gap: 8 }}>
            <TextLinkButton onPress={handleResend}>Resend OTP</TextLinkButton>
            {status ? <SuccessText>{status}</SuccessText> : null}
          </CenterNavContainer>
        </>
      )}
    </View>
  );
}

export default ChangeEmailScreen;
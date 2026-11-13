import AsyncStorage from '@react-native-async-storage/async-storage';
import { Eye, EyeOff, Lock } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import styled from 'styled-components/native';
import AppLogoImg from '../assets/AppLogo.png';
import {
  BackLinkButton,
  ButtonGroupHorizontal,
  CenterNavContainer,
  CenterNavText,
  CheckboxRow,
  ErrorText,
  IconButton,
  InputGroup,
  InputLabel,
  InputWrapper,
  makeOtpHandlers,
  OtpInputsContainer,
  OtpNotice,
  OtpSquareInput,
  PrimaryButton,
  SecondaryButton,
  StyledInput,
  SuccessText,
  TextLinkButton,
  ValidationItem,
  ValidationList,
  ViewHeader
} from '../shared/AuthStyles';
import { apiFetch } from '../utils/apiClient';
import { saveAuthToken } from '../utils/authToken';

// รายการเงื่อนไขรหัสผ่าน: ตัดกล่อง (พื้นหลัง/กรอบ/padding) ของ ValidationList เดิมออก ให้เป็นรายการต่อกันเฉย ๆ
// ครอบด้วย styled() เพื่อไม่ต้องแก้ ../shared/AuthStyles ที่ไฟล์อื่นอาจใช้ร่วมกัน
const PlainValidationList = styled(ValidationList)`
  background-color: transparent;
  border-width: 0;
  border-radius: 0;
  padding: 0;
  margin-top: 8px;
  elevation: 0;
  shadow-opacity: 0;
`;

// ==========================================
// --- API CONFIG ---
// เวอร์ชันเว็บใช้ import.meta.env.VITE_API_URL (Vite only, ใช้ใน RN ไม่ได้)
// Expo ใช้ EXPO_PUBLIC_ prefix แทนสำหรับ env var ที่ฝั่ง client อ่านได้
// ตั้งค่าใน .env ของโปรเจกต์ Expo เช่น: EXPO_PUBLIC_API_URL=https://xxxx.ngrok-free.app
// เปลี่ยน ngrok URL ทีไหน แก้แค่ค่านี้ค่าเดียว ไฟล์อื่นที่ import API_URL จะอัปเดตตามอัตโนมัติ
// ==========================================
export const API_URL = (process.env.EXPO_PUBLIC_API_URL).replace(/\/$/, '');

// OTP หมดอายุใน 5 นาที (ต้องตรงกับค่าฝั่ง backend)
const OTP_VALID_SECONDS = 5 * 60;
// ต้องรอกี่วินาทีก่อนกด Resend OTP ได้อีกครั้ง (กันกดรัว ๆ จนโดน rate limit)
const RESEND_COOLDOWN_SECONDS = 30;

// ==========================================
// --- Pending Register: กู้หน้า OTP สมัครสมาชิกหลังกลับมาจากแอปอื่น ---
// state ของหน้านี้เป็น useState จึงหายเมื่อคอมโพเนนต์ถูกสร้างใหม่ (เช่น Android ปิดแอปตอนไปเปิดเมลอ่าน OTP)
// เก็บ username/email/password ชั่วคราวเพื่อให้ register-confirm ใช้ต่อได้ และหมดอายุพร้อม OTP (5 นาที)
// ข้อมูลถูกลบเมื่อ: สมัครสำเร็จ / กดย้อนกลับจากหน้า OTP / หมดอายุ
// หมายเหตุ: AsyncStorage ไม่เข้ารหัส ถ้าต้องการเข้ารหัสให้เปลี่ยนเป็น expo-secure-store
// (แก้แค่ 3 ฟังก์ชันด้านล่างนี้ที่เดียว: getItemAsync / setItemAsync / deleteItemAsync)
// ==========================================
const PENDING_REGISTER_KEY = 'thaiApp.pendingRegister';

const savePendingRegister = async ({ username, email, password }) => {
  try {
    await AsyncStorage.setItem(
      PENDING_REGISTER_KEY,
      JSON.stringify({
        username,
        email,
        password,
        expiresAt: Date.now() + OTP_VALID_SECONDS * 1000,
        resendAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
      })
    );
  } catch (err) {
    console.warn('savePendingRegister failed', err);
  }
};

const clearPendingRegister = async () => {
  try {
    await AsyncStorage.removeItem(PENDING_REGISTER_KEY);
  } catch (err) {
    console.warn('clearPendingRegister failed', err);
  }
};

const loadPendingRegister = async () => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_REGISTER_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (!pending.expiresAt || Date.now() > pending.expiresAt) {
      await clearPendingRegister();
      return null;
    }
    return pending;
  } catch (err) {
    console.warn('loadPendingRegister failed', err);
    return null;
  }
};

const LockBadge = styled.View`
  width: 64px;
  height: 64px;
  border-radius: 20px;
  background-color: #f97316;
  align-items: center;
  justify-content: center;
  align-self: center;
  margin-bottom: 16px;
`;

const LogoSection = styled.View`
  align-items: center;
  margin-top: 25px;
  margin-bottom: 15px;
`;
const LogoImage = styled.Image`
  width: 110px;
  height: 110px;
  border-radius: 28px;
  overflow: hidden;
  resize-mode: cover;
`;
const LogoSubtitle = styled.Text`
  font-family: 'Sarabun_500Medium';
  font-size: 14px;
  color: #4b5563;
  margin-top: 8px;
`;

function LoginScreen({ onLoginSuccess }) {
  const [mode, setMode] = useState('login');
  const [isOtpStage, setIsOtpStage] = useState(false);
  const [otpArray, setOtpArray] = useState(new Array(6).fill(''));
  const [resetOtpArray, setResetOtpArray] = useState(new Array(6).fill(''));

  const [showLoginPw, setShowLoginPw] = useState(false);
  const [showRegisterPw, setShowRegisterPw] = useState(false);
  const [showRegisterConfirmPw, setShowRegisterConfirmPw] = useState(false);
  const [showResetPw, setShowResetPw] = useState(false);
  const [showResetConfirmPw, setShowResetConfirmPw] = useState(false);

  const [loginData, setLoginData] = useState({ email: '', password: '' });
  // 🎯 แก้ไข: ค่าเริ่มต้นเป็น false ให้ผู้ใช้เป็นคนกดติ๊กเลือกเองจริง ๆ ไม่ pre-check ไว้ล่วงหน้า
  // ไม่ติ๊ก (ค่าเริ่มต้น) -> login ได้ตามปกติแต่ session จะหายไปทันทีที่ปิดแอป (ไม่ persist ข้าม restart)
  // ติ๊ก -> persist ผ่าน AsyncStorage (เปิดแอปใหม่แล้ว auto-login ต่อได้เลย)
  const [rememberMe, setRememberMe] = useState(false);
  const [registerData, setRegisterData] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [resetPasswordData, setResetPasswordData] = useState({ newPassword: '', confirmPassword: '' });
  const [otpExpiresAt, setOtpExpiresAt] = useState(null);
  const [resetTimeLeft, setResetTimeLeft] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  // กันกด Sign up ซ้ำระหว่างรอ server (ไม่งั้นส่งเมลซ้ำและชน rate limit ของ register-request)
  const [isRegistering, setIsRegistering] = useState(false);

  const [errors, setErrors] = useState({});
  const [globalStatus, setGlobalStatus] = useState('');

  // refs สำหรับ auto-focus ช่อง OTP ถัดไป/ก่อนหน้า (แทน nextSibling/previousSibling ของเว็บ)
  // ต้องใช้ useRef ไม่ใช่ object ธรรมดา ไม่งั้นจะถูกสร้างใหม่ (รีเซ็ตเป็น []) ทุกครั้งที่ re-render
  const otpRefs = useRef([]);
  const resetOtpRefs = useRef([]);

  // ติดตามว่าแอปถูกสลับไปเบื้องหลังระหว่างที่ request สมัครสมาชิกยังไม่เสร็จหรือไม่
  // ถ้าใช่ แล้ว fetch ล้มด้วย "Network request failed" แปลว่า OS ตัดการเชื่อมต่อตอนแอปอยู่เบื้องหลัง
  // แต่ server มักประมวลผลและส่งอีเมล OTP ไปแล้ว จึงควรพาผู้ใช้ไปหน้ากรอก OTP ต่อ ไม่ใช่โชว์ error
  const registerFlight = useRef({ inFlight: false, backgrounded: false });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && registerFlight.current.inFlight) {
        registerFlight.current.backgrounded = true;
      }
    });
    return () => sub.remove();
  }, []);

  // กู้หน้ากรอก OTP สมัครสมาชิก ถ้าแอปถูกรีโหลด/ปิดระหว่างผู้ใช้ไปเปิดแอปอื่นรอ OTP
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await loadPendingRegister();
      if (!pending || cancelled) return;
      setRegisterData({
        username: pending.username,
        email: pending.email,
        password: pending.password,
        confirmPassword: pending.password,
      });
      setResendCooldown(Math.max(0, Math.ceil((pending.resendAt - Date.now()) / 1000)));
      setMode('register');
      setIsOtpStage(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // นับถอยหลังเวลาหมดอายุของ OTP
  useEffect(() => {
    if (!otpExpiresAt || (mode !== 'otp' && mode !== 'newpassword')) return;

    const tick = () => {
      const secondsLeft = Math.max(0, Math.round((otpExpiresAt - Date.now()) / 1000));
      setResetTimeLeft(secondsLeft);
    };

    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [otpExpiresAt, mode]);

  // นับถอยหลัง cooldown ของปุ่ม Resend OTP
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timeoutId = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timeoutId);
  }, [resendCooldown]);

  const formatTimeLeft = (totalSeconds) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const validateEmailFormat = (email) => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  };

  const checkPasswordStrength = (pw) => ({
    length: pw.length >= 8,
    uppercase: /[A-Z]/.test(pw),
    lowercase: /[a-z]/.test(pw),
    number: /\d/.test(pw),
    special: /[!@#$%^&*()_+]/.test(pw),
    // backend รับเฉพาะ A-Z a-z 0-9 และ !@#$%^&*()_+ (ตัวอักษรอื่น เช่น - . ช่องว่าง ภาษาไทย จะถูกปฏิเสธ)
    // (ไม่แสดงเป็นข้อในรายการเงื่อนไขแล้ว แต่ยังตรวจตอนกดส่ง เพื่อให้ตรงกับที่ backend รับ)
    allowedChars: pw.length > 0 && /^[A-Za-z\d!@#$%^&*()_+]+$/.test(pw),
  });

  const registerPwRules = checkPasswordStrength(registerData.password);
  const resetPwRules = checkPasswordStrength(resetPasswordData.newPassword);

  // handleXInputChange รับ (e) เหมือนเดิมได้เลย เพราะ StyledInput (RN)
  // ห่อ event ให้อยู่ในรูป { target: { name, value } } เหมือนฝั่งเว็บ
  const handleLoginInputChange = (e) => {
    const { name, value } = e.target;
    setLoginData((prev) => ({ ...prev, [name]: value }));
  };

  const handleRegisterInputChange = (e) => {
    const { name, value } = e.target;
    setRegisterData((prev) => ({ ...prev, [name]: value }));

    if (name === 'username' && value.length >= 5) {
      setErrors((prev) => ({ ...prev, username: null }));
    }
    if (name === 'email' && validateEmailFormat(value)) {
      setErrors((prev) => ({ ...prev, email: null }));
    }
    if (name === 'confirmPassword' && value === registerData.password) {
      setErrors((prev) => ({ ...prev, confirmPassword: null }));
    }
  };

  const handleResetInputChange = (e) => {
    const { name, value } = e.target;
    setResetPasswordData((prev) => ({ ...prev, [name]: value }));
  };

  const { handleOtpChange, handleOtpKeyPress } = makeOtpHandlers(otpArray, setOtpArray, otpRefs);
  const { handleOtpChange: handleResetOtpChange, handleOtpKeyPress: handleResetOtpKeyPress } = makeOtpHandlers(
    resetOtpArray,
    setResetOtpArray,
    resetOtpRefs
  );

  // หมายเหตุ: ตัดเรื่อง e.preventDefault() ออกทั้งหมด เพราะ RN ไม่มี <form>/submit event แบบเว็บ
  const handleLoginSubmit = async () => {
    setGlobalStatus('');
    setErrors({});

    if (!loginData.email || !loginData.password) {
      setErrors({ login: 'Please fill in all fields.' });
      return;
    }

    try {
      const response = await apiFetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        body: { email: loginData.email, password: loginData.password },
      });

      const data = await response.json();

      if (response.ok) {
        // 🎯 แก้ไข: เดิม save token ทุกครั้งไม่มีเงื่อนไข ตอนนี้ผูกกับ checkbox "Remember me"
        // ติ๊กไว้ -> persist ผ่าน AsyncStorage (เปิดแอปใหม่แล้ว auto-login ต่อได้เลย)
        // ไม่ติ๊ก -> ใช้ได้แค่ session ปัจจุบัน (เก็บใน state ผ่าน onLoginSuccess เท่านั้น)
        // ปิดแอปแล้วเปิดใหม่ต้อง login ใหม่เสมอ
        if (data.token && rememberMe) {
          await saveAuthToken(data.token);
        }
        if (typeof onLoginSuccess === 'function') {
          onLoginSuccess(data.user?.email || loginData.email, data.user?.username || '', data.token);
        }
      } else {
        setErrors({ login: data.message || 'Invalid email or password.' });
      }
    } catch (err) {
      console.error(err);
      setErrors({ login: 'Cannot connect to server. Please try again later.' });
    }
  };

  const handleRegisterRequest = async () => {
    const newErrors = {};
    setGlobalStatus('');

    if (registerData.username.length < 5) {
      newErrors.username = 'username must be at least 5 characters long';
    }
    if (!validateEmailFormat(registerData.email)) {
      newErrors.email = 'invalid email address format.';
    }
    const isAllRulesPassed = Object.values(registerPwRules).every(Boolean);
    if (!isAllRulesPassed) {
      newErrors.password = 'Password does not meet the conditions';
    }
    if (registerData.password !== registerData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    if (isRegistering) return;
    setIsRegistering(true);

    // บันทึกก่อนยิง request: ถ้าแอปถูกปิด/ตัดการเชื่อมต่อระหว่างรอ response ก็ยังกู้หน้า OTP ได้
    registerFlight.current = { inFlight: true, backgrounded: false };
    await savePendingRegister(registerData);

    try {
      const response = await apiFetch(`${API_URL}/api/auth/register-request`, {
        method: 'POST',
        body: {
          username: registerData.username,
          email: registerData.email,
          password: registerData.password,
        },
      });

      const data = await response.json();
      registerFlight.current.inFlight = false;

      if (response.ok) {
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setGlobalStatus('');
        await savePendingRegister(registerData);
        setIsOtpStage(true);
      } else {
        await clearPendingRegister();
        setErrors({ registerForm: data.message || 'An error occurred during verification' });
      }
    } catch (err) {
      const wasBackgrounded = registerFlight.current.backgrounded;
      registerFlight.current.inFlight = false;

      if (wasBackgrounded) {
        // ไม่ทราบผลแน่ชัดว่า server ส่งเมลหรือยัง แต่ส่วนใหญ่ส่งแล้ว -> ไปหน้า OTP และให้กด Resend ได้ถ้าไม่ได้รับ
        console.warn('register-request interrupted while app was in background', err);
        setErrors({});
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setIsOtpStage(true);
      } else {
        console.error(err);
        await clearPendingRegister();
        setErrors({ registerForm: 'Cannot connect to server. Please try again later.' });
      }
    } finally {
      setIsRegistering(false);
    }
  };

  const handleRegisterConfirm = async () => {
    const fullOtpString = otpArray.join('');
    if (fullOtpString.length !== 6) {
      setErrors({ otp: 'Please enter a valid 6-digit OTP code' });
      return;
    }

    try {
      const response = await apiFetch(`${API_URL}/api/auth/register-confirm`, {
        method: 'POST',
        body: {
          username: registerData.username,
          email: registerData.email,
          password: registerData.password,
          otpCode: fullOtpString,
        },
      });

      const data = await response.json();

      if (response.ok) {
        await clearPendingRegister();
        setIsOtpStage(false);
        setMode('login');
        setRegisterData({ username: '', email: '', password: '', confirmPassword: '' });
        setOtpArray(new Array(6).fill(''));
        setErrors({});
        setGlobalStatus('Registration complete! You can sign in now.');
      } else {
        setErrors({ otp: data.message || 'Invalid or expired OTP' });
      }
    } catch (err) {
      console.error(err);
      setErrors({ otp: 'Connection failure during OTP verification' });
    }
  };

  // เรียก forgot-password เพื่อให้ backend สร้าง OTP ใหม่แล้วส่งเมล (ใช้ทั้งตอนกด Send OTP ครั้งแรกและ Resend)
  const requestResetOtp = async (email) => {
    const response = await apiFetch(`${API_URL}/api/auth/forgot-password`, {
      method: 'POST',
      body: { email },
    });
    const data = await response.json();
    return { ok: response.ok, message: data.message };
  };

  // 🎯 แก้ไข: เดิมสำเร็จแล้วไม่ได้ setMode('otp') ผู้ใช้เลยค้างอยู่หน้ากรอกอีเมลตลอด
  // และ error ถูกเก็บใน errors.resetOtp ซึ่งหน้านี้ไม่ได้แสดง จึงมองไม่เห็นข้อความผิดพลาดเลย
  const handleForgotSubmit = async () => {
    const email = forgotPasswordEmail.trim();
    if (!email) {
      setErrors({ forgotEmail: 'Please enter your email' });
      return;
    }
    if (!validateEmailFormat(email)) {
      setErrors({ forgotEmail: 'invalid email address format.' });
      return;
    }
    setErrors({});
    setGlobalStatus('');

    try {
      const { ok, message } = await requestResetOtp(email);

      if (ok) {
        setForgotPasswordEmail(email);
        setResetOtpArray(new Array(6).fill(''));
        setOtpExpiresAt(Date.now() + OTP_VALID_SECONDS * 1000);
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setMode('otp');
      } else {
        setErrors({ forgotEmail: message || 'Could not send OTP. Please try again.' });
      }
    } catch (err) {
      console.error(err);
      setErrors({ forgotEmail: 'Cannot connect to server. Please try again later.' });
    }
  };

  // 🎯 แก้ไข: ฟังก์ชันนี้ถูกเรียกจากปุ่ม Resend OTP ในหน้า OTP แต่เดิมไม่เคยถูกประกาศไว้
  // (ReferenceError ทำให้แอป crash ทันทีที่เข้าหน้า OTP) ตอนนี้เรียก forgot-password ซ้ำจริง
  const handleResendResetOtp = async () => {
    if (resendCooldown > 0) return;
    setErrors({});
    setGlobalStatus('');

    try {
      const { ok, message } = await requestResetOtp(forgotPasswordEmail.trim());

      if (ok) {
        setResetOtpArray(new Array(6).fill(''));
        setOtpExpiresAt(Date.now() + OTP_VALID_SECONDS * 1000);
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setGlobalStatus('OTP Resent successfully!');
        resetOtpRefs.current[0]?.focus?.();
      } else {
        setErrors({ resetOtp: message || 'Could not resend OTP. Please try again.' });
      }
    } catch (err) {
      console.error(err);
      setErrors({ resetOtp: 'Cannot connect to server. Please try again later.' });
    }
  };

  // 🎯 แก้ไข: เดิมปุ่ม "Resend OTP" ตอนสมัครสมาชิกไม่ได้เรียก API จริง แค่ setGlobalStatus
  // เป็นข้อความสำเร็จหลอก ๆ ทำให้ผู้ใช้เข้าใจผิดว่าได้รับรหัสใหม่ทั้งที่ backend ไม่ได้ส่งอะไรเลย
  // เพิ่มฟังก์ชันที่เรียก register-request ซ้ำจริง เหมือน handleResendResetOtp ด้านบน
  const handleResendRegisterOtp = async () => {
    if (resendCooldown > 0) return;
    setErrors({});
    setGlobalStatus('');
    try {
      const response = await apiFetch(`${API_URL}/api/auth/register-request`, {
        method: 'POST',
        body: {
          username: registerData.username,
          email: registerData.email,
          password: registerData.password,
        },
      });

      const data = await response.json();

      if (response.ok) {
        setOtpArray(new Array(6).fill(''));
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setGlobalStatus('OTP Resent successfully!');
        await savePendingRegister(registerData);
      } else {
        setErrors({ otp: data.message || 'Could not resend OTP. Please try again.' });
      }
    } catch (err) {
      console.error(err);
      setErrors({ otp: 'Cannot connect to server. Please try again later.' });
    }
  };

  // 🎯 แก้ไข: เดิมเช็คแค่ว่ากรอกครบ 6 ตัว แล้วปล่อยไปหน้าตั้งรหัสผ่านทันที (ผู้ใช้ใส่ OTP มั่ว ๆ ก็ผ่าน
  // ไปได้ เพิ่งรู้ว่าผิดตอนกด Confirm Reset) ตอนนี้ยืนยัน OTP กับ backend จริงก่อน ตรงตามที่ระบุว่า
  // ต้องยืนยันตัวตนด้วย OTP ก่อนถึงจะระบุรหัสผ่านใหม่ได้
  const handleOtpStageNext = async () => {
    setErrors({});
    setGlobalStatus('');
    if (resetTimeLeft <= 0) {
      setErrors({ resetOtp: 'รหัส OTP หมดอายุแล้ว กรุณากดขอรหัสใหม่' });
      return;
    }
    const fullOtpString = resetOtpArray.join('');
    if (fullOtpString.length !== 6) {
      setErrors({ resetOtp: 'Please enter a valid 6-digit OTP code' });
      return;
    }

    try {
      const response = await apiFetch(`${API_URL}/api/auth/verify-reset-otp`, {
        method: 'POST',
        body: { email: forgotPasswordEmail.trim(), otpCode: fullOtpString },
      });
      const data = await response.json();

      if (response.ok) {
        setMode('newpassword');
      } else {
        setErrors({ resetOtp: data.message || 'Invalid or expired OTP' });
      }
    } catch (err) {
      console.error(err);
      setErrors({ resetOtp: 'Cannot connect to server. Please try again later.' });
    }
  };

  const handleResetPasswordSubmit = async () => {
    setErrors({});

    if (resetTimeLeft <= 0) {
      setErrors({ resetOtp: 'รหัส OTP หมดอายุแล้ว กรุณากดขอรหัสใหม่' });
      setMode('otp');
      return;
    }
    const fullOtpString = resetOtpArray.join('');
    if (fullOtpString.length !== 6) {
      setErrors({ resetOtp: 'Please enter a valid 6-digit OTP code' });
      setMode('otp');
      return;
    }
    const isAllRulesPassed = Object.values(resetPwRules).every(Boolean);
    if (!isAllRulesPassed) {
      setErrors({ resetPassword: 'Password does not meet the conditions' });
      return;
    }
    if (resetPasswordData.newPassword !== resetPasswordData.confirmPassword) {
      setErrors({ resetConfirmPassword: 'Passwords do not match' });
      return;
    }

    try {
      const response = await apiFetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        body: {
          email: forgotPasswordEmail,
          otpCode: fullOtpString,
          newPassword: resetPasswordData.newPassword,
        },
      });

      const data = await response.json();

      if (response.ok) {
        setForgotPasswordEmail('');
        setResetPasswordData({ newPassword: '', confirmPassword: '' });
        setResetOtpArray(new Array(6).fill(''));
        setOtpExpiresAt(null);
        setResendCooldown(0);
        setErrors({});
        setMode('login');
        setGlobalStatus('Password reset successfully!');
      } else {
        const message = data.message || 'Invalid or expired OTP';
        setErrors({ resetOtp: message });
        if (message.includes('OTP')) {
          setMode('otp');
        }
      }
    } catch (err) {
      console.error(err);
      setErrors({ resetOtp: 'Cannot connect to server. Please try again later.' });
    }
  };

  // ยกเลิกขั้นตอนตั้งรหัสผ่านใหม่: ถามยืนยันก่อน แล้วล้าง state ของ flow นี้ทั้งหมดและกลับหน้า Login
  const handleCancelReset = () => {
    Alert.alert(
      'Cancel password reset?',
      'Your progress will be lost and you will go back to the Log in page.',
      [
        { text: 'Keep resetting', style: 'cancel' },
        {
          text: 'Yes, cancel',
          style: 'destructive',
          onPress: () => {
            setForgotPasswordEmail('');
            setResetPasswordData({ newPassword: '', confirmPassword: '' });
            setResetOtpArray(new Array(6).fill(''));
            setOtpExpiresAt(null);
            setResetTimeLeft(0);
            setResendCooldown(0);
            setShowResetPw(false);
            setShowResetConfirmPw(false);
            setErrors({});
            setGlobalStatus('');
            setMode('login');
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, width: '100%' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, width: '100%' }} keyboardShouldPersistTaps="handled">
        <View style={{ flex: 1, width: '100%' }}>
          {mode === 'forgot' && (
            <BackLinkButton onPress={() => { setMode('login'); setErrors({}); setGlobalStatus(''); }} />
          )}
          {mode === 'otp' && (
            <BackLinkButton onPress={() => { setMode('forgot'); setErrors({}); setGlobalStatus(''); }} />
          )}
          {mode === 'register' && isOtpStage && (
            <BackLinkButton onPress={() => { setIsOtpStage(false); setErrors({}); setGlobalStatus(''); clearPendingRegister(); }} />
          )}

          {!(mode === 'forgot' || mode === 'otp' || mode === 'newpassword') && !(mode === 'register' && isOtpStage) && (
            <LogoSection>
              <LogoImage source={AppLogoImg} />
              {mode === 'login' && <LogoSubtitle>Thai Pronunciation</LogoSubtitle>}
            </LogoSection>
          )}

          {/* ================= MODE: LOGIN ================= */}
          {mode === 'login' && (
            <>
              <ViewHeader>Log in</ViewHeader>
              {globalStatus ? <SuccessText>{globalStatus}</SuccessText> : null}
              {errors.login ? (
                <ErrorText style={{ textAlign: 'center', marginBottom: 10 }}>{errors.login}</ErrorText>
              ) : null}

              <InputGroup>
                <InputLabel>Email</InputLabel>
                <InputWrapper>
                  <StyledInput
                    name="email"
                    type="email"
                    value={loginData.email}
                    onChange={handleLoginInputChange}
                    placeholder="example@gmail.com"
                  />
                </InputWrapper>
              </InputGroup>

              <InputGroup>
                <InputLabel>Password</InputLabel>
                <InputWrapper>
                  <StyledInput
                    name="password"
                    type={showLoginPw ? 'text' : 'password'}
                    value={loginData.password}
                    onChange={handleLoginInputChange}
                    placeholder="••••••••"
                    hasIcon
                  />
                  <IconButton onPress={() => setShowLoginPw(!showLoginPw)}>
                    {showLoginPw ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
                  </IconButton>
                </InputWrapper>
                <View style={{ alignItems: 'flex-end', marginTop: 6 }}>
                  <TextLinkButton onPress={() => { setMode('forgot'); setErrors({}); setGlobalStatus(''); }}>
                    Forgot password?
                  </TextLinkButton>
                </View>
              </InputGroup>

              <CheckboxRow
                checked={rememberMe}
                onToggle={() => setRememberMe((prev) => !prev)}
                label="Remember me"
              />

              <PrimaryButton onPress={handleLoginSubmit}>Log in</PrimaryButton>

              <CenterNavContainer>
                <CenterNavText>
                  Don't have an account?{' '}
                  <TextLinkButton
                    style={{ marginLeft: 4 }}
                    onPress={() => { setMode('register'); setIsOtpStage(false); setErrors({}); setGlobalStatus(''); }}
                  >
                    Sign up
                  </TextLinkButton>
                </CenterNavText>
              </CenterNavContainer>
            </>
          )}

          {/* ================= MODE: REGISTER (SIGN UP / OTP) ================= */}
          {mode === 'register' && (
            <>
              {isOtpStage ? (
                <>
                  <ViewHeader>Confirm OTP</ViewHeader>
                  <OtpNotice>
                    You can check your OTP code in your email. If you haven't received a code, tap Resend OTP.
                  </OtpNotice>
                  {errors.otp ? (
                    <ErrorText style={{ textAlign: 'center', marginBottom: 10 }}>{errors.otp}</ErrorText>
                  ) : null}

                  <OtpInputsContainer>
                    {otpArray.map((data, index) => (
                      <OtpSquareInput
                        key={index}
                        ref={(el) => (otpRefs.current[index] = el)}
                        value={data}
                        onChangeText={(text) => handleOtpChange(text, index)}
                        onKeyPress={(e) => handleOtpKeyPress(e, index)}
                        onFocus={() => { }}
                      />
                    ))}
                  </OtpInputsContainer>

                  <PrimaryButton onPress={handleRegisterConfirm}>Confirm</PrimaryButton>

                  <CenterNavContainer style={{ gap: 8 }}>
                    <TextLinkButton
                      onPress={handleResendRegisterOtp}
                      disabled={resendCooldown > 0}
                      style={{ opacity: resendCooldown > 0 ? 0.5 : 1 }}
                    >
                      {resendCooldown > 0 ? `Resend OTP (${resendCooldown}s)` : 'Resend OTP'}
                    </TextLinkButton>
                    {globalStatus ? <SuccessText>{globalStatus}</SuccessText> : null}
                  </CenterNavContainer>
                </>
              ) : (
                <>
                  <ViewHeader>Sign up</ViewHeader>
                  {errors.registerForm ? (
                    <ErrorText style={{ textAlign: 'center', marginBottom: 10 }}>{errors.registerForm}</ErrorText>
                  ) : null}

                  <InputGroup>
                    <InputLabel>Username</InputLabel>
                    <InputWrapper>
                      <StyledInput
                        name="username"
                        type="text"
                        value={registerData.username}
                        onChange={handleRegisterInputChange}
                        placeholder="YourName"
                        hasError={!!errors.username}
                      />
                    </InputWrapper>
                    {errors.username ? <ErrorText>{errors.username}</ErrorText> : null}
                  </InputGroup>

                  <InputGroup>
                    <InputLabel>Email</InputLabel>
                    <InputWrapper>
                      <StyledInput
                        name="email"
                        type="text"
                        value={registerData.email}
                        onChange={handleRegisterInputChange}
                        placeholder="example@gmail.com"
                        hasError={!!errors.email}
                      />
                    </InputWrapper>
                    {errors.email ? <ErrorText>{errors.email}</ErrorText> : null}
                  </InputGroup>

                  <InputGroup>
                    <InputLabel>Password</InputLabel>
                    <InputWrapper>
                      <StyledInput
                        name="password"
                        type={showRegisterPw ? 'text' : 'password'}
                        value={registerData.password}
                        onChange={handleRegisterInputChange}
                        placeholder="••••••••"
                        hasIcon
                      />
                      <IconButton onPress={() => setShowRegisterPw(!showRegisterPw)}>
                        {showRegisterPw ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
                      </IconButton>
                    </InputWrapper>
                    {errors.password ? <ErrorText>{errors.password}</ErrorText> : null}

                    <PlainValidationList>
                      <ValidationItem isValid={registerPwRules.length}>At least 8 characters</ValidationItem>
                      <ValidationItem isValid={registerPwRules.uppercase}>Uppercase letter (A-Z)</ValidationItem>
                      <ValidationItem isValid={registerPwRules.lowercase}>Lowercase letter (a-z)</ValidationItem>
                      <ValidationItem isValid={registerPwRules.number}>At least 1 number (0-9)</ValidationItem>
                      <ValidationItem isValid={registerPwRules.special && registerPwRules.allowedChars}>At least 1 special character, only !@#$%^&*()_+ allowed</ValidationItem>
                    </PlainValidationList>
                  </InputGroup>

                  <InputGroup>
                    <InputLabel>Confirm Password</InputLabel>
                    <InputWrapper>
                      <StyledInput
                        name="confirmPassword"
                        type={showRegisterConfirmPw ? 'text' : 'password'}
                        value={registerData.confirmPassword}
                        onChange={handleRegisterInputChange}
                        placeholder="••••••••"
                        hasIcon
                        hasError={!!errors.confirmPassword}
                      />
                      <IconButton onPress={() => setShowRegisterConfirmPw(!showRegisterConfirmPw)}>
                        {showRegisterConfirmPw ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
                      </IconButton>
                    </InputWrapper>
                    {errors.confirmPassword ? <ErrorText>{errors.confirmPassword}</ErrorText> : null}
                  </InputGroup>

                  <PrimaryButton onPress={handleRegisterRequest} disabled={isRegistering}>
                    {isRegistering ? 'Sending…' : 'Sign up'}
                  </PrimaryButton>

                  <CenterNavContainer>
                    <CenterNavText>
                      Already have an account?{' '}
                      <TextLinkButton style={{ marginLeft: 4 }} onPress={() => { setMode('login'); setErrors({}); setGlobalStatus(''); }}>
                        Log in
                      </TextLinkButton>
                    </CenterNavText>
                  </CenterNavContainer>
                </>
              )}
            </>
          )}

          {/* ================= MODE: FORGOT PASSWORD ================= */}
          {mode === 'forgot' && (
            <>
              <ViewHeader>Reset Password</ViewHeader>

              <InputGroup>
                <InputLabel>Email *</InputLabel>
                <InputWrapper>
                  <StyledInput
                    type="email"
                    value={forgotPasswordEmail}
                    onChange={(e) => setForgotPasswordEmail(e.target.value)}
                    placeholder="example@gmail.com"
                  />
                </InputWrapper>
                {errors.forgotEmail ? <ErrorText>{errors.forgotEmail}</ErrorText> : null}
              </InputGroup>

              <ButtonGroupHorizontal>
                <View style={{ flex: 1 }}>
                  <SecondaryButton onPress={() => { setMode('login'); setErrors({}); }}>Cancel</SecondaryButton>
                </View>
                <View style={{ flex: 1 }}>
                  <PrimaryButton onPress={handleForgotSubmit}>Send OTP</PrimaryButton>
                </View>
              </ButtonGroupHorizontal>
            </>
          )}

          {/* ================= MODE: OTP VERIFICATION ================= */}
          {mode === 'otp' && (
            <>
              <ViewHeader>Enter Verification Code</ViewHeader>
              <OtpNotice>If {forgotPasswordEmail} is registered, we sent a verification code to it</OtpNotice>

              <OtpInputsContainer>
                {resetOtpArray.map((data, index) => (
                  <OtpSquareInput
                    key={index}
                    ref={(el) => (resetOtpRefs.current[index] = el)}
                    value={data}
                    onChangeText={(text) => handleResetOtpChange(text, index)}
                    onKeyPress={(e) => handleResetOtpKeyPress(e, index)}
                  />
                ))}
              </OtpInputsContainer>

              {resetTimeLeft > 0 ? (
                <SuccessText style={{ textAlign: 'center' }}>Code expires in {formatTimeLeft(resetTimeLeft)}</SuccessText>
              ) : (
                <ErrorText style={{ textAlign: 'center' }}>OTP has expired. Please request a new code.</ErrorText>
              )}
              {errors.resetOtp ? <ErrorText style={{ textAlign: 'center' }}>{errors.resetOtp}</ErrorText> : null}

              <PrimaryButton onPress={handleOtpStageNext}>Next</PrimaryButton>

              <CenterNavContainer style={{ gap: 8 }}>
                <TextLinkButton
                  onPress={handleResendResetOtp}
                  disabled={resendCooldown > 0}
                  style={{ opacity: resendCooldown > 0 ? 0.5 : 1 }}
                >
                  {resendCooldown > 0 ? `Resend OTP (${resendCooldown}s)` : 'Resend OTP'}
                </TextLinkButton>
                {globalStatus ? <SuccessText>{globalStatus}</SuccessText> : null}
              </CenterNavContainer>
            </>
          )}

          {/* ================= MODE: NEW PASSWORD ================= */}
          {mode === 'newpassword' && (
            <>
              <LockBadge>
                <Lock size={32} color="#ffffff" />
              </LockBadge>
              <ViewHeader>Reset Password</ViewHeader>
              {resetTimeLeft > 0 ? (
                <SuccessText style={{ textAlign: 'center', marginBottom: 8 }}>
                  Code expires in {formatTimeLeft(resetTimeLeft)}
                </SuccessText>
              ) : (
                <ErrorText style={{ textAlign: 'center', marginBottom: 8 }}>
                  OTP has expired. Please request a new code.
                </ErrorText>
              )}
              {errors.resetOtp ? (
                <ErrorText style={{ textAlign: 'center', marginBottom: 8 }}>{errors.resetOtp}</ErrorText>
              ) : null}

              <InputGroup>
                <InputLabel>New Password *</InputLabel>
                <InputWrapper>
                  <StyledInput
                    name="newPassword"
                    type={showResetPw ? 'text' : 'password'}
                    value={resetPasswordData.newPassword}
                    onChange={handleResetInputChange}
                    placeholder="••••••••"
                    hasIcon
                  />
                  <IconButton onPress={() => setShowResetPw(!showResetPw)}>
                    {showResetPw ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
                  </IconButton>
                </InputWrapper>
                {errors.resetPassword ? <ErrorText>{errors.resetPassword}</ErrorText> : null}

                <PlainValidationList>
                  <ValidationItem isValid={resetPwRules.length}>At least 8 characters</ValidationItem>
                  <ValidationItem isValid={resetPwRules.uppercase}>Uppercase letter (A-Z)</ValidationItem>
                  <ValidationItem isValid={resetPwRules.lowercase}>Lowercase letter (a-z)</ValidationItem>
                  <ValidationItem isValid={resetPwRules.number}>At least 1 number (0-9)</ValidationItem>
                  <ValidationItem isValid={resetPwRules.special && resetPwRules.allowedChars}>At least 1 special character, only !@#$%^&*()_+ allowed</ValidationItem>
                </PlainValidationList>
              </InputGroup>

              <InputGroup>
                <InputLabel>Confirm Password *</InputLabel>
                <InputWrapper>
                  <StyledInput
                    name="confirmPassword"
                    type={showResetConfirmPw ? 'text' : 'password'}
                    value={resetPasswordData.confirmPassword}
                    onChange={handleResetInputChange}
                    placeholder="••••••••"
                    hasIcon
                  />
                  <IconButton onPress={() => setShowResetConfirmPw(!showResetConfirmPw)}>
                    {showResetConfirmPw ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
                  </IconButton>
                </InputWrapper>
                {errors.resetConfirmPassword ? <ErrorText>{errors.resetConfirmPassword}</ErrorText> : null}
              </InputGroup>

              <PrimaryButton onPress={handleResetPasswordSubmit}>Confirm Reset</PrimaryButton>
              <SecondaryButton onPress={handleCancelReset}>Cancel</SecondaryButton>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default LoginScreen;
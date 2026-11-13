import { Check, ChevronLeft } from 'lucide-react-native';
import React from 'react';
import { Text, View } from 'react-native';
import styled from 'styled-components/native';

// ==========================================
// --- SHARED AUTH / OTP STYLED COMPONENTS (React Native) ---
// รวมจาก AuthStyles.js (มี CheckboxRow) + AuthStyles_m.js (ใช้ฟอนต์ Sarabun)
// ==========================================

const wrapTextChildren = (children, textStyle) =>
  React.Children.map(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      return <Text style={textStyle}>{child}</Text>;
    }
    return child;
  });

export const TopBackButton = ({ onPress, onClick, children, ...rest }) => (
  <TopBackTouchable onPress={onPress || onClick} {...rest}>
    {wrapTextChildren(children, topBackTextStyle)}
  </TopBackTouchable>
);
const TopBackTouchable = styled.TouchableOpacity`
  align-self: flex-start;
  margin-bottom: 20px;
`;
const topBackTextStyle = { color: '#4b5563', fontSize: 13.5, fontFamily: 'Sarabun_500Medium' };

// ปุ่มย้อนกลับแบบ ไอคอน + คำ ใช้ร่วมกันทุกหน้า (Login/OTP, Change Email, Profile)
// ขนาด/ระยะห่างเท่ากับปุ่ม "Resume Learning" เดิมของ ProfileScreen เพื่อให้อยู่ตำแหน่งเดียวกัน
export const BackLinkButton = ({ onPress, label = 'Back' }) => (
  <BackLinkTouchable onPress={onPress} activeOpacity={0.7}>
    <ChevronLeft size={18} color="#333" strokeWidth={2.5} />
    <Text style={backLinkTextStyle}>{label}</Text>
  </BackLinkTouchable>
);
const BackLinkTouchable = styled.TouchableOpacity`
  align-self: flex-start;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  padding: 30px 10px 30px 6px;
`;
const backLinkTextStyle = { fontSize: 14, fontFamily: 'Sarabun_600SemiBold', color: '#333' };

export const IconBadge = styled.View`
  background-color: #f97316;
  width: 46px;
  height: 46px;
  border-radius: 12px;
  justify-content: center;
  align-items: center;
  align-self: center;
  margin-bottom: 16px;
`;

export const ViewHeader = styled.Text`
  font-size: 20px;
  font-family: 'Sarabun_700Bold';
  color: #111827;
  margin-bottom: 24px;
  text-align: center;
`;

export const InputGroup = styled.View`
  margin-bottom: 16px;
  width: 100%;
`;

export const InputLabel = styled.Text`
  margin-bottom: 6px;
  font-family: 'Sarabun_500Medium';
  font-size: 13.5px;
  color: #374151;
`;

export const InputWrapper = styled.View`
  position: relative;
  flex-direction: row;
  align-items: center;
  width: 100%;
`;

export const StyledInput = ({
  name,
  type,
  value,
  onChange,
  onChangeText,
  hasError,
  hasIcon,
  placeholder,
  ...rest
}) => (
  <StyledTextInput
    value={value}
    placeholder={placeholder}
    placeholderTextColor="#9ca3af"
    secureTextEntry={type === 'password'}
    keyboardType={type === 'email' ? 'email-address' : 'default'}
    autoCapitalize="none"
    hasError={hasError}
    hasIcon={hasIcon}
    onChangeText={(text) => {
      if (onChangeText) onChangeText(text);
      if (onChange) onChange({ target: { name, value: text } });
    }}
    {...rest}
  />
);

const StyledTextInput = styled.TextInput`
  width: 100%;
  padding: 12px 16px;
  padding-right: ${(props) => (props.hasIcon ? '46px' : '16px')};
  border-width: 1px;
  border-color: ${(props) => (props.hasError ? '#ef4444' : '#e5e7eb')};
  border-radius: 12px;
  font-size: 14px;
  background-color: #fcfbfa;
  color: #111827;
`;

export const IconButton = ({ onPress, onClick, children, ...rest }) => (
  <IconTouchable onPress={onPress || onClick} {...rest}>
    {children}
  </IconTouchable>
);
const IconTouchable = styled.TouchableOpacity`
  position: absolute;
  right: 12px;
  padding: 4px;
`;

export const PrimaryButton = ({ onPress, onClick, disabled, children, ...rest }) => (
  <PrimaryTouchable onPress={onPress || onClick} disabled={disabled} {...rest}>
    {wrapTextChildren(children, primaryTextStyle)}
  </PrimaryTouchable>
);
const PrimaryTouchable = styled.TouchableOpacity`
  width: 100%;
  padding: 12px;
  background-color: ${(props) => (props.disabled ? '#fbc596' : '#f97316')};
  border-radius: 12px;
  margin-top: 12px;
  align-items: center;
  justify-content: center;
`;
const primaryTextStyle = { color: 'white', fontSize: 14.5, fontFamily: 'Sarabun_700Bold' };

export const SecondaryButton = ({ onPress, onClick, children, ...rest }) => (
  <SecondaryTouchable onPress={onPress || onClick} {...rest}>
    {wrapTextChildren(children, secondaryTextStyle)}
  </SecondaryTouchable>
);
const SecondaryTouchable = styled.TouchableOpacity`
  width: 100%;
  padding: 12px;
  background-color: #ffffff;
  border-width: 1px;
  border-color: #e5e7eb;
  border-radius: 12px;
  margin-top: 12px;
  align-items: center;
  justify-content: center;
`;
const secondaryTextStyle = { color: '#374151', fontSize: 14.5, fontFamily: 'Sarabun_500Medium' };

export const DarkPillButton = ({ onPress, onClick, children, ...rest }) => (
  <DarkPillTouchable onPress={onPress || onClick} {...rest}>
    {wrapTextChildren(children, darkPillTextStyle)}
  </DarkPillTouchable>
);
const DarkPillTouchable = styled.TouchableOpacity`
  flex: 1;
  padding: 13px 0;
  background-color: #111111;
  border-radius: 999px;
  align-items: center;
  justify-content: center;
`;
const darkPillTextStyle = { color: '#ffffff', fontSize: 14.5, fontFamily: 'Sarabun_500Medium' };

export const OrangePillButton = ({ onPress, onClick, disabled, children, ...rest }) => (
  <OrangePillTouchable onPress={onPress || onClick} disabled={disabled} {...rest}>
    {wrapTextChildren(children, orangePillTextStyle)}
  </OrangePillTouchable>
);
const OrangePillTouchable = styled.TouchableOpacity`
  flex: 1;
  padding: 13px 0;
  background-color: ${(props) => (props.disabled ? '#fbc596' : '#f97316')};
  border-radius: 999px;
  align-items: center;
  justify-content: center;
`;
const orangePillTextStyle = { color: '#ffffff', fontSize: 14.5, fontFamily: 'Sarabun_700Bold' };

export const TextLinkButton = ({ onPress, onClick, children, style, ...rest }) => (
  <TextLinkTouchable onPress={onPress || onClick} {...rest}>
    <Text style={[textLinkTextStyle, style]}>{children}</Text>
  </TextLinkTouchable>
);
const TextLinkTouchable = styled.TouchableOpacity``;
const textLinkTextStyle = { color: '#f97316', fontFamily: 'Sarabun_700Bold', fontSize: 13 };

export const ErrorText = styled.Text`
  color: #ef4444;
  font-size: 12px;
  margin-top: 5px;
  font-family: 'Sarabun_500Medium';
`;

export const SuccessText = styled.Text`
  color: #10b981;
  font-size: 13px;
  margin-top: 10px;
  text-align: center;
  font-family: 'Sarabun_500Medium';
`;

export const OtpNotice = styled.Text`
  font-size: 13.5px;
  color: #4b5563;
  margin-bottom: 16px;
  line-height: 19px;
  text-align: center;
`;

// เช็กลิสต์เงื่อนไขรหัสผ่าน: การ์ดเล็ก ๆ แต่ละข้อมีวงกลมนำหน้า
// ยังไม่ผ่าน = วงกลมเส้นเทา + ข้อความเทา / ผ่านแล้ว = วงกลมเขียวมีเครื่องหมายถูก + ข้อความเข้มขึ้น
export const ValidationList = styled.View`
  margin-top: 10px;
  padding: 10px 12px 6px;
  background-color: #fafaf9;
  border-width: 1px;
  border-color: #eceae6;
  border-radius: 12px;
`;

export const ValidationItem = ({ isValid, children }) => (
  // marginBottom ลดจาก 6 เหลือ 2 ชดเชย lineHeight ที่เพิ่มใน Text ด้านล่าง ให้ระยะห่างระหว่างแถวใกล้เคียงของเดิม
  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        marginRight: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isValid ? '#10b981' : 'transparent',
        borderWidth: isValid ? 0 : 1.5,
        borderColor: '#d1d5db',
      }}
    >
      {isValid ? <Check size={11} color="#ffffff" strokeWidth={3.5} /> : null}
    </View>
    <Text
      style={{
        flex: 1,
        fontSize: 12.5,
        // line-height + padding-top เหมือนสไตล์ label ประโยคใน ChooseSentenceScreen:
        // ฟอนต์ Sarabun วาด "_" ต่ำกว่าเส้นฐานมาก ถ้าไม่ตั้ง line-height กล่องข้อความจะตัดขอบล่างทิ้ง
        lineHeight: 22,
        paddingTop: 2,
        fontFamily: isValid ? 'Sarabun_600SemiBold' : 'Sarabun_400Regular',
        color: isValid ? '#047857' : '#6b7280',
      }}
    >
      {children}
    </Text>
  </View>
);

export const OtpInputsContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  gap: 8px;
  margin: 12px 0 20px 0;
`;

export const OtpSquareInput = React.forwardRef(({ value, onChangeText, onKeyPress, onFocus }, ref) => (
  <OtpSquareTextInput
    ref={ref}
    value={value}
    onChangeText={onChangeText}
    onKeyPress={onKeyPress}
    onFocus={onFocus}
    keyboardType="number-pad"
    maxLength={1}
    textAlign="center"
  />
));
const OtpSquareTextInput = styled.TextInput`
  width: 46px;
  height: 46px;
  border-width: 1px;
  border-color: #e5e7eb;
  border-radius: 8px;
  font-size: 18px;
  font-family: 'Sarabun_700Bold';
  color: #111827;
  background-color: #f9fafb;
`;

export const ButtonGroupHorizontal = styled.View`
  flex-direction: row;
  gap: 10px;
  width: 100%;
  margin-top: 8px;
`;

export const CenterNavContainer = styled.View`
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-top: 20px;
`;
export const CenterNavText = styled.Text`
  font-size: 13.5px;
  color: #4b5563;
  font-family: 'Sarabun_500Medium';
  text-align: center;
`;

// 🎯 คงไว้จาก AuthStyles.js เดิม: checkbox สำหรับ "Remember me"
// (เวอร์ชัน _m ไม่มี component นี้ ตัดหายไปตอนแปลงเป็นฟอนต์ Sarabun)
export const CheckboxRow = ({ checked, onToggle, label }) => (
  <CheckboxTouchable onPress={onToggle} activeOpacity={0.7}>
    <CheckboxBox checked={checked}>
      {checked && <CheckboxCheckmark>✓</CheckboxCheckmark>}
    </CheckboxBox>
    <Text style={checkboxLabelStyle}>{label}</Text>
  </CheckboxTouchable>
);
const CheckboxTouchable = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  margin-bottom: 4px;
`;
const CheckboxBox = styled.View`
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border-width: ${(props) => (props.checked ? '0px' : '1.5px')};
  border-color: #cbd5e1;
  background-color: ${(props) => (props.checked ? '#f97316' : 'transparent')};
  align-items: center;
  justify-content: center;
`;
const CheckboxCheckmark = ({ children }) => (
  <Text style={{ color: 'white', fontSize: 12, fontFamily: 'Sarabun_700Bold', lineHeight: 14 }}>{children}</Text>
);
const checkboxLabelStyle = { fontSize: 13.5, color: '#374151', fontFamily: 'Sarabun_500Medium' };

// ==========================================
// OTP handlers เวอร์ชัน RN
// ==========================================
export const makeOtpHandlers = (otpArray, setOtpArray, refs) => {
  const handleOtpChange = (text, index) => {
    if (text !== '' && isNaN(text)) return;

    const newOtp = [...otpArray];
    newOtp[index] = text;
    setOtpArray(newOtp);

    if (text !== '' && index < otpArray.length - 1) {
      refs?.current?.[index + 1]?.focus();
    }
  };

  const handleOtpKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !otpArray[index] && index > 0) {
      refs?.current?.[index - 1]?.focus();
    }
  };

  return { handleOtpChange, handleOtpKeyPress };
};
# Thai Pronunciation App — React Native (Expo) เวอร์ชัน

แปลงมาจากโปรเจกต์ React (Vite) เว็บเดิม ให้เป็นแอป React Native ที่รันบน Android/iOS จริงผ่าน Expo

## 1) วิธีติดตั้งและรัน

```bash
# 1. ติดตั้ง Expo CLI (ถ้ายังไม่มี) และสร้าง node_modules
npm install

# 2. คัดลอกโฟลเดอร์ assets (รูป + เสียง) จากโปรเจกต์เว็บเดิมมาไว้ที่ src/assets/
#    ให้ตรงชื่อไฟล์เป๊ะ ๆ ตามที่ไฟล์ .js เรียก import เช่น
#    src/assets/chick.webp, chick1.png, dog.png, talking.png, hi.png,
#    howgoing.png, meeting.png, morning.png, whaturname.png,
#    thai.png, etiquette.png, skyline.png,
#    src/assets/oriaudio/ai-sawasdee.wav, ai0.8-whaturname.wav,
#    ai0.9-nice2meetu.wav, howgoing.mp3, morning.mp3
#    (ไฟล์เหล่านี้ไม่ได้ถูกอัปโหลดมาด้วย ผมจึงไม่มีต้นฉบับให้คัดลอกให้)

# 3. ตั้งค่า API URL (ถ้าไม่ตั้ง จะ fallback ไปที่ https://finalcompro.onrender.com)
echo "EXPO_PUBLIC_API_URL=https://finalcompro.onrender.com" > .env

# 4. รัน
npx expo start
# กด "a" เพื่อเปิดบน Android emulator/เครื่องจริงผ่าน Expo Go
```

จากนั้นถ้าจะ build เป็น APK/AAB จริงเพื่อเอาเข้า Android Studio หรือส่งขึ้น Play Store:
```bash
npx expo prebuild        # สร้างโฟลเดอร์ android/ ขึ้นมา เปิดด้วย Android Studio ได้เลย
# หรือ
eas build -p android     # build ผ่าน Expo Application Services (แนะนำ ไม่ต้องมี Android Studio ในเครื่อง)
```

## 2) โครงสร้างไฟล์ (เทียบกับของเดิม)

| เดิม (เว็บ) | ใหม่ (RN) |
|---|---|
| `App.jsx` | `App.js` |
| `main.jsx`, `index.html`, `App.css`, `index.css` | ตัดออกทั้งหมด (ไม่มีแนวคิด DOM/HTML ใน RN) |
| `LoginView.jsx` | `src/screens/LoginScreen.js` |
| `WelcomeView.jsx` | `src/screens/WelcomeScreen.js` |
| `HomeView.jsx` | `src/screens/HomeScreen.js` |
| `ChooseSentenceView.jsx` | `src/screens/ChooseSentenceScreen.js` |
| `PracticeView.jsx` | `src/screens/PracticeScreen.js` |
| `ProfileView.jsx` | `src/screens/ProfileScreen.js` |
| `ChangeEmailView.jsx` | `src/screens/ChangeEmailScreen.js` |
| `LogoutConfirmModal.jsx` | `src/components/LogoutConfirmModal.js` |
| `shared/AuthStyles.js` | `src/shared/AuthStyles.js` |
| `utils/learningStats.js` (ไม่ได้อัปโหลดมา) | `src/utils/learningStats.js` (เขียนขึ้นใหม่ตาม logic ที่ใช้งานจริงใน App.jsx/ProfileView.jsx) |

## 3) จุดที่แก้ไปจากเว็บ (สรุป)

- **HTML tags → RN components**: `div/span/p/h1-3/label` → `View/Text`, `img` → `Image`, `button` → `TouchableOpacity`, `input` → `TextInput`, ไม่มี `<form onSubmit>` แล้ว เรียก handler ตรงจาก `onPress` แทน
- **CSS → styled-components/native**: ตัด `hover`, `transition`, `@keyframes`, `box-shadow`, media query ออกทั้งหมด (RN ไม่รองรับ) เปลี่ยนไปใช้ `Animated` (ดูใน `PracticeScreen.js`) หรือ shadow props (`shadowColor`, `elevation`) แทน
- **Modal**: `ModalOverlay` แบบ `position: fixed` ของเว็บ → ใช้ RN `<Modal>` จริง (ดูใน `HomeScreen.js`, `WelcomeScreen.js`, `LogoutConfirmModal.js`)
- **การอัดเสียง**: `MediaRecorder` + `navigator.mediaDevices.getUserMedia` → `expo-av` (`Audio.Recording`) — logic เขียนใหม่ทั้งหมดใน `PracticeScreen.js`
- **Waveform**: เดิมวาดด้วย `<canvas>` + `AnalyserNode` (ความถี่เสียงแบบละเอียด) — RN ไม่มี Web Audio API จึงเปลี่ยนไปอ่านค่า **metering (dB)** จาก `expo-av` ระหว่างอัดแทน แล้ว map เป็นแถบ `Animated.View` แทน (รายละเอียดคลื่นจะหยาบกว่าเว็บเดิมพอสมควร ถ้าต้องการความแม่นยำสูงขึ้นต้องพิจารณา `react-native-audio-analyser` หรือ native module เพิ่มเติม)
- **เล่นเสียงตัวอย่าง**: `new Audio(url).play()` → `Audio.Sound.createAsync()`
- **ส่งไฟล์เสียงไป backend**: เดิมส่งเป็น `Blob` ผ่าน `FormData` → ใน RN ต้องส่งเป็น `{ uri, name, type }` แทน (แก้ใน `sendAudioToModel` ของ `PracticeScreen.js`) — **backend ฝั่ง server (`finalcompro.onrender.com`) ไม่ต้องแก้ ถ้ารับ multipart/form-data อยู่แล้วจะใช้ได้ปกติ**
- **เก็บสถิติการเรียน**: `localStorage` → `@react-native-async-storage/async-storage` — และ `loadStats()` เปลี่ยนจาก sync เป็น **async** (ดูวิธีเรียกใหม่ใน `App.js`)
- **Environment variable**: `import.meta.env.VITE_API_URL` (Vite only) → `process.env.EXPO_PUBLIC_API_URL` (ต้องมี prefix `EXPO_PUBLIC_` ถึงจะอ่านได้ฝั่ง client)
- **OTP auto-focus ช่องถัดไป**: เดิมใช้ `element.nextSibling.focus()` (DOM API) → RN ไม่มี ต้องใช้ `refs` array เก็บ ref ของแต่ละช่องเอง (ดู `makeOtpHandlers` ใน `AuthStyles.js`)
- **CSS Grid** (`HeaderRow` ใน PracticeView เดิมใช้ `display: grid`) → เปลี่ยนเป็น Flexbox row 3 ช่อง (ซ้าย-กลาง-ขวา) แทน

## 4) สิ่งที่ยังต้องทำเพิ่มเอง

1. **คัดลอกไฟล์ assets** (รูป/เสียง) เข้ามาใน `src/assets/` ตามที่ระบุด้านบน — ไม่งั้น build จะ error หา asset ไม่เจอ
2. ทดสอบ endpoint `finalcompro.onrender.com` ว่ารับไฟล์เสียงแบบ RN (`{uri,name,type}`) ได้ถูกต้อง โดยเฉพาะ `Content-Type` ที่ device ส่งจริง (บางเคส RN จะ auto-set boundary เอง ไม่ต้องกำหนด header เองก็ได้ ถ้าเจอปัญหาลองลบ header `Content-Type` ออกจาก fetch แล้วปล่อยให้ RN จัดการเอง)
3. ปัจจุบันใช้ state เปลี่ยนหน้าแบบ `useState('currentView')` เหมือนเดิม (ยังไม่ได้เปลี่ยนไปใช้ React Navigation) — ใช้งานได้ปกติ แต่ถ้าต้องการปุ่ม back ของ Android ให้ทำงานตามลำดับหน้า/มี transition สวยงามขึ้น แนะนำให้ปรับไปใช้ `@react-navigation/native` ภายหลัง
4. หน้าที่เนื้อหายาวเกินจอ (เช่น HomeScreen) อาจต้องห่อด้วย `<ScrollView>` เพิ่มเติมถ้าเทสแล้วเนื้อหาล้นจอเครื่องเล็ก

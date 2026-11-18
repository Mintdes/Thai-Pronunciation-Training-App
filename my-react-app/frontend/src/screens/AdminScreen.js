import {
  AudioQuality,
  createAudioPlayer,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, TouchableOpacity, View } from 'react-native';
import styled from 'styled-components/native';
import {
  ErrorText,
  InputGroup,
  InputLabel,
  InputWrapper,
  StyledInput,
} from '../shared/AuthStyles';
import { apiFetch } from '../utils/apiClient';
import { saveRecording } from '../utils/recordingManager';
import { API_URL } from './LoginScreen';

const LEVEL_OPTIONS = [
  { id: 'easy', label: 'Beginner' },
  { id: 'medium', label: 'Medium' },
];

// ---------- ช่วยคำนวณ "สัปดาห์" (เริ่มวันจันทร์ เวลาไทย) เป็นสตริง YYYY-MM-DD ----------
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parseDay = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => new Date(parseDay(s).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const thaiWeekStart = () => {
  const t = new Date(Date.now() + 7 * 60 * 60 * 1000);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};
const fmtDay = (s) => {
  const d = parseDay(s);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
// จำนวนสัปดาห์ล่วงหน้าที่เลือกได้ (นับจากสัปดาห์ปัจจุบัน)
const MAX_WEEKS_AHEAD = 52;
const fmtWeekRange = (s) => (s ? `${fmtDay(s)} – ${fmtDay(addDays(s, 6))}` : 'ยังไม่กำหนดสัปดาห์');

// 🎯 ใช้ค่าเดียวกับ PracticeScreen.js เป๊ะ ๆ เพื่อให้ไฟล์เสียงที่แอดมินอัดในนี้ เข้ากันได้กับ
// ตัวเล่นเสียง/ตัวประเมินเดิมทั้งหมด ไม่ต้องมี logic แยกสองชุด
const RECORDING_OPTIONS = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 128000,
  isMeteringEnabled: false,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    extension: '.wav',
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

// ---------- styled components ----------

const Wrapper = styled.View`
  width: 100%;
  align-items: center;
  padding-bottom: 40px;
`;

const HeaderRow = styled.View`
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 20px 0 10px;
  margin-bottom: 10px;
`;

const BackButtonText = styled.Text`
  font-size: 14px;
  font-family: 'Sarabun_600SemiBold';
  color: #333;
`;

const PageTitle = styled.Text`
  font-size: 18px;
  font-family: 'Sarabun_700Bold';
  color: #222;
`;

const SectionCard = styled.View`
  width: 100%;
  background-color: #ffffff;
  border-radius: 20px;
  padding: 18px 20px;
  margin-bottom: 16px;
  border-width: 1px;
  border-color: #f0e6d6;
`;

const SectionTitle = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_700Bold';
  color: #6b5f52;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const PillRow = styled.View`
  flex-direction: row;
  gap: 10px;
`;

const Pill = styled.TouchableOpacity`
  padding: 9px 18px;
  border-radius: 999px;
  background-color: ${(props) => (props.$active ? '#f97316' : '#f3f4f6')};
`;

const PillText = styled.Text`
  font-size: 13.5px;
  font-family: 'Sarabun_600SemiBold';
  color: ${(props) => (props.$active ? '#ffffff' : '#555')};
`;

const ChipsScroll = styled.ScrollView.attrs({
  horizontal: true,
  showsHorizontalScrollIndicator: false,
})`
  width: 100%;
`;

const Chip = styled.TouchableOpacity`
  padding: 8px 16px;
  border-radius: 999px;
  background-color: ${(props) => (props.$active ? '#222222' : '#f3f4f6')};
  margin-right: 8px;
`;

const ChipText = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_500Medium';
  color: ${(props) => (props.$active ? '#ffffff' : '#444')};
`;

const ImagePickerBox = styled.TouchableOpacity`
  width: 90px;
  height: 90px;
  border-radius: 14px;
  background-color: #f9fafb;
  border-width: 1px;
  border-color: #e5e7eb;
  border-style: dashed;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

const PreviewImage = styled.Image`
  width: 100%;
  height: 100%;
  resize-mode: cover;
`;

const ImagePickerLabel = styled.Text`
  font-size: 11px;
  color: #9ca3af;
  text-align: center;
  padding: 0 6px;
  font-family: 'Sarabun_500Medium';
`;

const AudioRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
`;

const RecordCircle = styled.TouchableOpacity`
  width: 46px;
  height: 46px;
  border-radius: 23px;
  background-color: ${(props) => (props.$isRecording ? '#dc2626' : '#f97316')};
  align-items: center;
  justify-content: center;
`;

const RecordCircleText = styled.Text`
  color: white;
  font-size: 18px;
`;

const PlayCircle = styled.TouchableOpacity`
  width: 46px;
  height: 46px;
  border-radius: 23px;
  background-color: ${(props) => (props.disabled ? '#e5e7eb' : '#111111')};
  align-items: center;
  justify-content: center;
`;

const AudioStatusText = styled.Text`
  flex: 1;
  font-size: 12.5px;
  color: #6b5f52;
  font-family: 'Sarabun_500Medium';
`;

const SaveButton = styled.TouchableOpacity`
  width: 100%;
  background-color: ${(props) => (props.disabled ? '#fbc596' : '#f97316')};
  border-radius: 16px;
  padding: 14px;
  align-items: center;
  margin-top: 16px;
`;

const SaveButtonText = styled.Text`
  color: white;
  font-size: 15px;
  font-family: 'Sarabun_700Bold';
`;

const CancelEditButton = styled.TouchableOpacity`
  width: 100%;
  padding: 10px;
  align-items: center;
`;

const CancelEditText = styled.Text`
  color: #8a8074;
  font-size: 13px;
  font-family: 'Sarabun_500Medium';
`;

const SentenceRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom-width: 1px;
  border-bottom-color: #f5eee0;
`;

const SentenceRowText = styled.View`
  flex: 1;
  gap: 4px;
  padding-right: 12px;
`;

const SentenceThaiText = styled.Text`
  font-size: 14px;
  font-family: 'Sarabun_600SemiBold';
  color: #333;
`;

const SentenceSubText = styled.Text`
  font-size: 12px;
  color: #8a8074;
  margin-top: 2px;
`;

const RowActions = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 16px;
`;

const RowActionText = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_600SemiBold';
`;

const EmptyText = styled.Text`
  font-size: 13px;
  color: #8a8074;
  text-align: center;
  padding: 10px 0;
`;

const WeekStepper = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: #fff7ed;
  border-radius: 14px;
  padding: 6px;
  margin: 6px 0 4px;
`;

const WeekArrow = styled.TouchableOpacity`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  background-color: #f97316;
  align-items: center;
  justify-content: center;
`;

const WeekArrowText = styled.Text`
  color: white;
  font-size: 22px;
  line-height: 26px;
  font-family: 'Sarabun_700Bold';
`;

const WeekLabel = styled.Text`
  flex: 1;
  text-align: center;
  font-size: 13.5px;
  font-family: 'Sarabun_600SemiBold';
  color: #333;
`;

const GroupTitle = styled.Text`
  font-size: 12.5px;
  font-family: 'Sarabun_700Bold';
  color: ${(props) => props.$color || '#8a8074'};
  margin: 6px 0 -4px;
`;

const AddSentenceButton = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  background-color: #fff7ed;
  border-width: 1.5px;
  border-color: #f97316;
  border-style: dashed;
  border-radius: 12px;
  padding: 10px 16px;
  margin-top: 14px;
  gap: 6px;
`;

const AddSentenceButtonText = styled.Text`
  font-size: 13.5px;
  font-family: 'Sarabun_600SemiBold';
  color: #f97316;
`;

// ปุ่ม Edit lesson: แถบทึบสีส้ม (อยู่เหนือปุ่ม Add New Sentence)
const EditLessonButton = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  background-color: #f97316;
  border-radius: 12px;
  padding: 11px 16px;
  margin-top: 14px;
  gap: 6px;
`;

const EditLessonButtonText = styled.Text`
  font-size: 13.5px;
  font-family: 'Sarabun_700Bold';
  color: #ffffff;
`;

// การ์ด Danger zone (ใต้รายการประโยค) ที่ใส่ปุ่ม Delete lesson แยกจากปุ่มที่กดบ่อย
const DangerCard = styled.View`
  width: 100%;
  background-color: #ffffff;
  border-radius: 20px;
  padding: 18px 20px;
  margin-bottom: 16px;
  border-width: 1px;
  border-color: #fecaca;
`;

const DangerTitle = styled.Text`
  font-size: 13px;
  font-family: 'Sarabun_700Bold';
  color: #dc2626;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const DangerText = styled.Text`
  font-size: 12.5px;
  line-height: 19px;
  font-family: 'Sarabun_500Medium';
  color: #8a8074;
`;

// ปุ่ม Delete lesson: แถบขอบแดง
const DeleteLessonButton = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  background-color: #fef2f2;
  border-width: 1.5px;
  border-color: #dc2626;
  border-radius: 12px;
  padding: 10px 16px;
  margin-top: 14px;
  gap: 6px;
`;

const DeleteLessonButtonText = styled.Text`
  font-size: 13.5px;
  font-family: 'Sarabun_700Bold';
  color: #dc2626;
`;

// ---- popup ยืนยันการลบบทเรียน ----
const ModalOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.45);
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const ModalCard = styled.View`
  width: 100%;
  max-width: 400px;
  background-color: #ffffff;
  border-radius: 20px;
  padding: 22px 20px;
`;

const ModalTitle = styled.Text`
  font-size: 17px;
  font-family: 'Sarabun_700Bold';
  color: #dc2626;
  margin-bottom: 8px;
`;

const ModalBodyText = styled.Text`
  font-size: 13.5px;
  line-height: 21px;
  font-family: 'Sarabun_500Medium';
  color: #444;
  margin-bottom: 14px;
`;

const ModalButtonRow = styled.View`
  flex-direction: row;
  gap: 10px;
  margin-top: 16px;
`;

const ModalButton = styled.TouchableOpacity`
  flex: 1;
  border-radius: 14px;
  padding: 13px;
  align-items: center;
  background-color: ${(props) => props.$bg || '#f3f4f6'};
  opacity: ${(props) => (props.disabled ? 0.6 : 1)};
`;

const ModalButtonText = styled.Text`
  font-size: 14px;
  font-family: 'Sarabun_700Bold';
  color: ${(props) => props.$color || '#444'};
`;

function AdminScreen({ authToken, onBack }) {
  const [level, setLevel] = useState('easy');
  const [topics, setTopics] = useState([]);
  const [weeklySentences, setWeeklySentences] = useState([]); // ประโยค Weekly ของระดับที่เลือก (ใหม่สุดก่อน)
  const [isWeeklyMode, setIsWeeklyMode] = useState(false);     // true = กดปุ่ม Weekly อยู่ (ไม่ได้เลือกบทเรียนปกติ)
  const [activeWeeklyId, setActiveWeeklyId] = useState(null);  // id ประโยคที่กำลังแสดงที่หน้า Home (server คำนวณตามสัปดาห์ปัจจุบัน)
  const [serverWeekStart, setServerWeekStart] = useState(null); // วันจันทร์ของสัปดาห์ปัจจุบัน (เวลาไทย) จาก server
  const [weekStart, setWeekStart] = useState(null);             // สัปดาห์ที่เลือกในฟอร์ม (null = ใช้ค่าที่แนะนำ)
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);

  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [topicIconUri, setTopicIconUri] = useState(null); // รูป icon ของบทเรียนใหม่ (บังคับ)

  // แก้ไขบทเรียนที่เลือก (ชื่อ + icon) -> อัปเดตตาราง Topic
  const [isEditingTopic, setIsEditingTopic] = useState(false);
  const [editTopicTitle, setEditTopicTitle] = useState('');
  const [editTopicIconUri, setEditTopicIconUri] = useState(null); // uri ในเครื่อง = เลือกรูปใหม่ / http = icon เดิม
  const [isSavingTopic, setIsSavingTopic] = useState(false);
  const [topicError, setTopicError] = useState('');

  // ลบบทเรียน: popup ยืนยันด้วยรหัสผ่านของบัญชี
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isDeletingTopic, setIsDeletingTopic] = useState(false);

  const [isListCollapsed, setIsListCollapsed] = useState(false); // false = แสดงรายการประโยคทั้งหมด (ค่าเริ่มต้น) / true = ย่อรายการ
  const [isFormOpen, setIsFormOpen] = useState(false); // true = แสดงฟอร์มเพิ่ม/แก้ไขประโยค (แทนรายการประโยค)
  const [editingSentenceId, setEditingSentenceId] = useState(null); // null = กำลังเพิ่มใหม่
  const [thai, setThai] = useState('');
  const [karaoke, setKaraoke] = useState('');
  const [pronunciation, setPronunciation] = useState('');
  const [eng, setEng] = useState('');
  const [label, setLabel] = useState('');
  const [imageUri, setImageUri] = useState(null);
  const [audioUri, setAudioUri] = useState(null);
  const [audioFileName, setAudioFileName] = useState('');

  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const recorder = useAudioRecorder(RECORDING_OPTIONS);

  const selectedTopic = topics.find((t) => t.id === selectedTopicId) || null;

  // โหลดรายการบทเรียนใหม่ทุกครั้งที่เปลี่ยนระดับ
  useEffect(() => {
    fetchTopics();
    setSelectedTopicId(null);
    setIsCreatingTopic(false);
    setIsWeeklyMode(false);
    setIsEditingTopic(false);
    setIsFormOpen(false);
    setIsListCollapsed(false);
    resetSentenceForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  const fetchTopics = async () => {
    setIsLoadingTopics(true);
    try {
      const response = await apiFetch(`${API_URL}/api/admin/topics?level=${level}`, {
        token: authToken,
      });
      const data = await response.json();
      if (response.ok) {
        setTopics(data.topics || []);
        setWeeklySentences(data.weekly || []);
        setActiveWeeklyId(data.active_weekly_id ?? null);
        setServerWeekStart(data.current_week_start || null);
      } else {
        Alert.alert('โหลดบทเรียนไม่สำเร็จ', data.message || '');
      }
    } catch (err) {
      console.error('fetchTopics error:', err);
      Alert.alert('Error', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setIsLoadingTopics(false);
    }
  };

  const resetSentenceForm = () => {
    setEditingSentenceId(null);
    setThai('');
    setKaraoke('');
    setPronunciation('');
    setEng('');
    setLabel('');
    setImageUri(null);
    setAudioUri(null);
    setAudioFileName('');
    setWeekStart(null);
    setFormError('');
  };

  const handleSelectTopic = (topicId) => {
    setSelectedTopicId(topicId);
    setIsCreatingTopic(false);
    setIsWeeklyMode(false);
    setIsEditingTopic(false);
    setIsListCollapsed(false);   // เปลี่ยนบทเรียนแล้วกลับมาแสดงรายการทั้งหมดเสมอ
    setIsFormOpen(false);   // เลือกบทเรียน = เห็นรายการประโยคก่อน ฟอร์มจะขึ้นเมื่อกด Add
    resetSentenceForm();
  };

  // ---- แก้ไขบทเรียน (ชื่อ + icon) ----
  const handleOpenEditTopic = () => {
    if (!selectedTopic) return;
    setEditTopicTitle(selectedTopic.title || '');
    setEditTopicIconUri(selectedTopic.icon_url || null);
    setTopicError('');
    setIsEditingTopic(true);
  };

  const handleCancelEditTopic = () => {
    setIsEditingTopic(false);
    setTopicError('');
  };

  const handlePickEditTopicIcon = async () => {
    const uri = await pickImageFromLibrary();
    if (uri) setEditTopicIconUri(uri);
  };

  const handleSaveTopic = async () => {
    if (!selectedTopic) return;
    setTopicError('');

    const title = editTopicTitle.trim().replace(/\s+/g, ' ');
    if (!title) {
      setTopicError('กรุณากรอกชื่อบทเรียน');
      return;
    }
    if (!editTopicIconUri) {
      setTopicError('บทเรียนต้องมีรูป icon');
      return;
    }

    const titleChanged = title !== selectedTopic.title;
    const iconChanged = !!editTopicIconUri && !editTopicIconUri.startsWith('http');
    if (!titleChanged && !iconChanged) {
      setIsEditingTopic(false);   // ไม่มีอะไรเปลี่ยน
      return;
    }

    setIsSavingTopic(true);
    try {
      const form = new FormData();
      if (titleChanged) form.append('title', title);
      if (iconChanged) {
        const iconExt = (editTopicIconUri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
        form.append('icon', {
          uri: editTopicIconUri,
          name: `icon_${Date.now()}.${iconExt}`,
          type: `image/${iconExt === 'jpg' ? 'jpeg' : iconExt}`,
        });
      }

      const response = await fetch(`${API_URL}/api/admin/topics/${selectedTopic.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'ngrok-skip-browser-warning': 'true',
        },
        body: form,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        setTopicError(errData.message || `บันทึกไม่สำเร็จ (status ${response.status})`);
        return;
      }

      setIsEditingTopic(false);
      Alert.alert('สำเร็จ', 'แก้ไขบทเรียนเรียบร้อย');
      await fetchTopics();
    } catch (err) {
      console.error('save topic error:', err);
      setTopicError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setIsSavingTopic(false);
    }
  };

  // ---- ลบบทเรียน (ต้องกรอกรหัสผ่านใน popup) ----
  const handleOpenDeleteTopic = () => {
    if (!selectedTopic) return;
    setDeletePassword('');
    setDeleteError('');
    setIsDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    if (isDeletingTopic) return;
    setIsDeleteModalOpen(false);
    setDeletePassword('');
    setDeleteError('');
  };

  const handleConfirmDeleteTopic = async () => {
    if (!selectedTopic) return;
    if (!deletePassword) {
      setDeleteError('กรุณากรอกรหัสผ่านเพื่อยืนยัน');
      return;
    }

    setIsDeletingTopic(true);
    setDeleteError('');
    try {
      const response = await fetch(`${API_URL}/api/admin/topics/${selectedTopic.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({ password: deletePassword }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        // 401 จาก endpoint นี้ = รหัสผ่านผิดเสมอ (ไม่ต้องรอข้อความจาก server เผื่อรันเซิร์ฟเวอร์เวอร์ชันเก่าอยู่)
        setDeleteError(
          response.status === 401
            ? 'Password is incorrect'
            : errData.message || `ลบไม่สำเร็จ (status ${response.status})`
        );
        return;
      }

      setIsDeleteModalOpen(false);
      setDeletePassword('');
      setSelectedTopicId(null);
      setIsEditingTopic(false);
      setIsFormOpen(false);
      resetSentenceForm();
      Alert.alert('สำเร็จ', 'ลบบทเรียนเรียบร้อย');
      await fetchTopics();
    } catch (err) {
      console.error('delete topic error:', err);
      setDeleteError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setIsDeletingTopic(false);
    }
  };

  // ---- สร้างบทเรียนใหม่ โดยยังไม่ต้องเพิ่มประโยค ----
  const handleCreateTopicOnly = async () => {
    setTopicError('');
    const title = newTopicTitle.trim().replace(/\s+/g, ' ');
    if (!title) {
      setTopicError('กรุณากรอกชื่อบทเรียนใหม่');
      return;
    }
    if (!topicIconUri) {
      setTopicError('กรุณาเลือกรูป icon ของบทเรียนใหม่');
      return;
    }

    setIsSavingTopic(true);
    try {
      const topicForm = new FormData();
      topicForm.append('level', level);
      topicForm.append('title', title);
      const iconExt = (topicIconUri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
      topicForm.append('icon', {
        uri: topicIconUri,
        name: `icon_${Date.now()}.${iconExt}`,
        type: `image/${iconExt === 'jpg' ? 'jpeg' : iconExt}`,
      });

      const response = await fetch(`${API_URL}/api/admin/topics`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'ngrok-skip-browser-warning': 'true',
        },
        body: topicForm,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        setTopicError(errData.message || `สร้างบทเรียนไม่สำเร็จ (status ${response.status})`);
        return;
      }

      const data = await response.json();
      setIsCreatingTopic(false);
      setNewTopicTitle('');
      setTopicIconUri(null);
      setSelectedTopicId(data.id);   // เลือกบทที่เพิ่งสร้างให้เลย กด + Add New Sentence เพิ่มประโยคภายหลังได้
      Alert.alert(
        data.existed ? 'มีบทเรียนนี้อยู่แล้ว' : 'สำเร็จ',
        data.existed ? 'เลือกบทเรียนเดิมให้แล้ว' : 'สร้างบทเรียนเรียบร้อย เพิ่มประโยคได้ภายหลัง'
      );
      await fetchTopics();
    } catch (err) {
      console.error('create topic error:', err);
      setTopicError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setIsSavingTopic(false);
    }
  };

  // เปิดฟอร์มเพิ่มประโยคใหม่ (กดปุ่ม + Add New Sentence)
  const handleOpenAddForm = () => {
    resetSentenceForm();
    setIsFormOpen(true);
  };

  // ปุ่ม Cancel: ปิดฟอร์มแล้วกลับไปดูรายการประโยคของบทเรียนนั้น
  const handleCancelForm = () => {
    resetSentenceForm();
    if (isCreatingTopic) {
      setIsCreatingTopic(false);
      setNewTopicTitle('');
      setTopicIconUri(null);
    }
    setIsFormOpen(false);
  };

  // ปุ่ม Weekly: เพิ่ม/แก้ไขประโยค Weekly ของระดับนี้ (ส่ง is_weekly='true' ไปเก็บใน Sentence.is_weekly)
  const handleSelectWeekly = () => {
    setSelectedTopicId(null);
    setIsCreatingTopic(false);
    setIsEditingTopic(false);
    setIsWeeklyMode(true);
    setIsListCollapsed(false);
    setIsFormOpen(false);
    resetSentenceForm();
  };

  const handleStartNewTopic = () => {
    setSelectedTopicId(null);
    setIsWeeklyMode(false);
    setIsEditingTopic(false);
    setIsCreatingTopic(true);
    setNewTopicTitle('');
    setTopicIconUri(null);
    resetSentenceForm();
    setTopicError('');
    setIsFormOpen(false);  // สร้างบทเรียนได้เลยโดยไม่ต้องเพิ่มประโยค (เพิ่มประโยคทีหลังได้)
  };

  // ยกเลิกการสร้างบทเรียนใหม่
  const handleCancelNewTopic = () => {
    setIsCreatingTopic(false);
    setNewTopicTitle('');
    setTopicIconUri(null);
    setTopicError('');
  };

  // เลือกรูปจากคลังภาพ คืน uri (หรือ null ถ้ายกเลิก/ไม่ได้รับอนุญาต)
  const pickImageFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Denied', 'กรุณาอนุญาตให้เข้าถึงคลังภาพก่อน');
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    return result.canceled ? null : result.assets[0].uri;
  };

  const handlePickImage = async () => {
    const uri = await pickImageFromLibrary();
    if (uri) setImageUri(uri);
  };

  const handlePickTopicIcon = async () => {
    const uri = await pickImageFromLibrary();
    if (uri) setTopicIconUri(uri);
  };

  const startRecording = async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Denied', 'กรุณาอนุญาตให้เข้าถึงไมโครโฟน');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
    } catch (err) {
      console.error('startRecording error:', err);
      Alert.alert('Error', 'ไม่สามารถเริ่มอัดเสียงได้');
    }
  };

  const stopRecording = async () => {
    if (!recorder.isRecording) return;
    setIsRecording(false);
    try {
      await recorder.stop();
      const tempUri = recorder.uri;
      if (tempUri) {
        // เก็บไฟล์ไว้ถาวรในเครื่องก่อน ค่อยอัปโหลดตอนกด Save (แบบเดียวกับ PracticeScreen)
        const savedUri = await saveRecording(tempUri);
        setAudioUri(savedUri);

        const isIOS = Platform.OS === 'ios';
        const extension = isIOS ? 'wav' : 'm4a';
        const safeThai = (thai || 'sentence').replace(/\s+/g, '_').slice(0, 20);
        setAudioFileName(`${safeThai}_${Date.now()}.${extension}`);
      }
    } catch (err) {
      console.error('stopRecording error:', err);
      Alert.alert('Error', 'ไม่สามารถหยุดอัดเสียงได้');
    }
  };

  const handlePreviewAudio = async () => {
    if (!audioUri) return;
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const player = createAudioPlayer({ uri: audioUri });
      player.volume = 1.0;
      player.play();
    } catch (err) {
      console.error('preview audio error:', err);
      Alert.alert('Error', 'ไม่สามารถเล่นเสียงตัวอย่างได้');
    }
  };

  const handleEditSentence = (sentenceItem) => {
    setEditingSentenceId(sentenceItem.sentence_id);
    setThai(sentenceItem.thai || '');
    setKaraoke(sentenceItem.karaoke || '');
    setPronunciation(sentenceItem.pronunciation || '');
    setEng(sentenceItem.eng || '');
    setLabel(sentenceItem.label || '');
    setImageUri(sentenceItem.image_url || null);
    setAudioUri(null); // ไม่ดึงไฟล์เสียงเดิมกลับมาแก้ — อัดใหม่เฉพาะตอนอยากเปลี่ยน
    setAudioFileName(sentenceItem.audio_file_name || '');
    setWeekStart(sentenceItem.weekly_start || null);
    setFormError('');
    setIsFormOpen(true);
  };

  // ปุ่ม "ตั้งเป็นสัปดาห์นี้": แสดงประโยคนี้ที่หน้า Home ทันที
  const handleActivateWeekly = (sentenceItem) => {
    Alert.alert(
      'ตั้งเป็นประโยคประจำสัปดาห์นี้?',
      `${sentenceItem.thai}\n\nจะแสดงที่หน้า Home ทันที ถ้ามีประโยคอื่นกำหนดไว้สัปดาห์นี้ จะกลายเป็น "ยังไม่กำหนดสัปดาห์"`,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ตั้งเลย',
          onPress: async () => {
            try {
              const response = await apiFetch(
                `${API_URL}/api/admin/weekly/${sentenceItem.sentence_id}/activate`,
                { method: 'POST', token: authToken }
              );
              if (response.ok) {
                fetchTopics();
              } else {
                const data = await response.json().catch(() => ({}));
                Alert.alert('ตั้งไม่สำเร็จ', data.message || '');
              }
            } catch (err) {
              console.error('activate weekly error:', err);
              Alert.alert('Error', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
            }
          },
        },
      ]
    );
  };

  const handleDeleteSentence = (sentenceItem) => {
    Alert.alert(
      'ลบประโยคนี้?',
      sentenceItem.thai,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบ',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await apiFetch(
                `${API_URL}/api/admin/sentences/${sentenceItem.sentence_id}`,
                { method: 'DELETE', token: authToken }
              );
              if (response.ok) {
                if (editingSentenceId === sentenceItem.sentence_id) resetSentenceForm();
                fetchTopics();
              } else {
                const data = await response.json().catch(() => ({}));
                Alert.alert('ลบไม่สำเร็จ', data.message || '');
              }
            } catch (err) {
              console.error('delete sentence error:', err);
              Alert.alert('Error', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
            }
          },
        },
      ]
    );
  };

  const handleSaveSentence = async () => {
    setFormError('');

    if (!thai.trim() || !karaoke.trim() || !eng.trim()) {
      setFormError('กรุณากรอกประโยคภาษาไทย คาราโอเกะ และคำแปลภาษาอังกฤษให้ครบ');
      return;
    }
    if (isCreatingTopic && !newTopicTitle.trim()) {
      setFormError('กรุณากรอกชื่อบทเรียนใหม่');
      return;
    }
    if (isCreatingTopic && !topicIconUri) {
      setFormError('กรุณาเลือกรูป icon ของบทเรียนใหม่');
      return;
    }
    if (!isCreatingTopic && !selectedTopicId && !isWeeklyMode) {
      setFormError('กรุณาเลือกบทเรียนก่อน');
      return;
    }
    // ประโยค Weekly ต้องเลือกสัปดาห์เสมอ (เพิ่มใหม่ = ต้องกดเลือกเอง / แก้ไขประโยคที่ยังไม่กำหนดสัปดาห์ = ปล่อยค่าเดิมได้)
    if (isWeeklyMode && !editingSentenceId && !weekStart) {
      setFormError('กรุณาเลือกสัปดาห์ที่จะแสดงบนหน้า Home ก่อนบันทึกประโยค Weekly');
      return;
    }
    if (isWeeklyMode && weekStart && !availableWeeks.includes(weekStart)) {
      setFormError('สัปดาห์ที่เลือกไม่พร้อมใช้งาน (ผ่านไปแล้ว หรือมีประโยคอื่นใช้อยู่) กรุณาเลือกสัปดาห์ใหม่');
      return;
    }
    // ต้องมีเสียง อย่างน้อยตอนเพิ่มประโยคใหม่ (ตอนแก้ไข ถ้าไม่อัดใหม่คือใช้ไฟล์เดิมต่อ)
    if (!editingSentenceId && !audioUri) {
      setFormError('กรุณาอัดเสียงประโยคนี้ก่อนบันทึก');
      return;
    }

    setIsSaving(true);
    let topicJustCreated = false;
    let saved = false;
    try {
      const isEditing = !!editingSentenceId;

      // 🎯 บทเรียนใหม่: สร้าง topic พร้อมอัปโหลด icon ก่อน แล้วค่อยเพิ่มประโยคด้วย topic_id ที่ได้
      let topicIdForSave = selectedTopicId;
      if (isCreatingTopic && !isEditing) {
        const topicForm = new FormData();
        topicForm.append('level', level);
        topicForm.append('title', newTopicTitle.trim());
        const iconExt = (topicIconUri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
        topicForm.append('icon', {
          uri: topicIconUri,
          name: `icon_${Date.now()}.${iconExt}`,
          type: `image/${iconExt === 'jpg' ? 'jpeg' : iconExt}`,
        });

        const topicResponse = await fetch(`${API_URL}/api/admin/topics`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'ngrok-skip-browser-warning': 'true',
          },
          body: topicForm,
        });
        if (!topicResponse.ok) {
          const topicErr = await topicResponse.json().catch(() => ({}));
          Alert.alert('สร้างบทเรียนไม่สำเร็จ', topicErr.message || `status ${topicResponse.status}`);
          return;
        }
        const topicData = await topicResponse.json();
        topicIdForSave = topicData.id;
        topicJustCreated = true;

        // สลับไปโหมด "เลือกบทเรียนที่มีอยู่" ทันที ถ้าบันทึกประโยคพลาด กดบันทึกซ้ำจะไม่สร้างบทซ้ำ
        setSelectedTopicId(topicData.id);
        setIsCreatingTopic(false);
        setTopicIconUri(null);
      }
      const endpoint = isEditing
        ? `${API_URL}/api/admin/sentences/${editingSentenceId}`
        : `${API_URL}/api/admin/sentences`;

      // 🎯 ใช้ FormData + fetch แทน FileSystem.uploadAsync เพื่อรองรับ multipart หลายไฟล์
      // (audio + image พร้อมกันใน 1 request) ซึ่ง FileSystem.uploadAsync ทำไม่ได้
      const formData = new FormData();
      formData.append('level', level);
      if (isWeeklyMode) {
        formData.append('is_weekly', 'true');   // บันทึกลงคอลัมน์ is_weekly ของตาราง Sentence
        // สัปดาห์ที่แสดง (ตอนแก้ไขประโยคที่ยังไม่กำหนดสัปดาห์ และไม่ได้กดเลือก = ไม่เปลี่ยนค่าเดิม)
        if (weekStart) formData.append('weekly_start', weekStart);
      } else {
        formData.append('topic_id', String(topicIdForSave || ''));
      }
      formData.append('thai', thai.trim());
      formData.append('karaoke', karaoke.trim());
      formData.append('pronunciation', pronunciation.trim());
      formData.append('eng', eng.trim());
      formData.append('label', label.trim() || `${thai.trim()} (${eng.trim()})`);
      formData.append('audio_file_name', audioFileName);

      // แนบไฟล์เสียง (ถ้ามี local uri ใหม่)
      if (audioUri && !audioUri.startsWith('http')) {
        const audioExt = Platform.OS === 'ios' ? 'wav' : 'm4a';
        const audioMime = Platform.OS === 'ios' ? 'audio/wav' : 'audio/m4a';
        formData.append('audio', {
          uri: audioUri,
          name: audioFileName || `audio_${Date.now()}.${audioExt}`,
          type: audioMime,
        });
      }

      // แนบรูปภาพ (ถ้ามี local uri ใหม่) หรือส่ง URL เดิม
      if (imageUri && !imageUri.startsWith('http')) {
        const imgExt = imageUri.split('.').pop() || 'jpg';
        formData.append('image', {
          uri: imageUri,
          name: `image_${Date.now()}.${imgExt}`,
          type: `image/${imgExt === 'jpg' ? 'jpeg' : imgExt}`,
        });
      } else if (imageUri && imageUri.startsWith('http')) {
        // URL เดิมที่ดึงมาตอน edit — ส่งเป็น text field ไป backend เก็บต่อ
        formData.append('image_url', imageUri);
      }

      const response = await fetch(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'ngrok-skip-browser-warning': 'true',
          // ไม่ตั้ง Content-Type เอง ปล่อยให้ fetch/RN ตั้ง boundary ให้อัตโนมัติ
        },
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error('Server returned error:', errData);
        Alert.alert('บันทึกไม่สำเร็จ', errData.message || `status ${response.status}`);
        return;
      }

      saved = true;
      Alert.alert('สำเร็จ', isEditing ? 'แก้ไขประโยคเรียบร้อย' : 'เพิ่มประโยคใหม่เรียบร้อย');
      resetSentenceForm();
      setIsCreatingTopic(false);
      setIsFormOpen(false);   // บันทึกสำเร็จ -> กลับไปดูรายการประโยค
      await fetchTopics();
    } catch (err) {
      console.error('save sentence error:', err);
      Alert.alert('Error', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      // สร้างบทใหม่สำเร็จแต่บันทึกประโยคพลาด → รีโหลดรายการให้เห็นบทที่เพิ่งสร้าง
      if (topicJustCreated && !saved) fetchTopics();
      setIsSaving(false);
    }
  };

  const levelLabel = LEVEL_OPTIONS.find((o) => o.id === level)?.label || level;
  const listSentences = isWeeklyMode ? weeklySentences : selectedTopic?.sentences || [];
  const showSentenceList = !isCreatingTopic && (isWeeklyMode || !!selectedTopic);

  // ---- Weekly: สัปดาห์ปัจจุบัน / สัปดาห์ที่แนะนำสำหรับประโยคใหม่ (ถัดจากสัปดาห์ล่าสุดที่กำหนดไว้) ----
  const currentWeek = serverWeekStart || thaiWeekStart();
  const latestScheduled = weeklySentences.map((s) => s.weekly_start).filter(Boolean).sort().pop();
  // ถ้ามีประโยคที่แสดงอยู่แล้ว ประโยคใหม่ต้องไม่แย่งที่ -> แนะนำสัปดาห์ถัดจากสัปดาห์ล่าสุดที่กำหนดไว้ (อย่างน้อยสัปดาห์หน้า)
  // ถ้ายังไม่มีประโยคแสดงอยู่เลย ใช้สัปดาห์นี้ เพื่อให้หน้า Home ไม่ว่าง
  const lastTaken = latestScheduled && latestScheduled >= currentWeek ? latestScheduled : currentWeek;
  const suggestedWeek = activeWeeklyId == null ? currentWeek : addDays(lastTaken, 7);
  // สัปดาห์ที่เลือกได้ = ตั้งแต่สัปดาห์ปัจจุบันเป็นต้นไป และยังไม่มีประโยคอื่นใช้
  // (สัปดาห์ที่ผ่านไปแล้ว / ถูกเลือกไปแล้ว จะไม่ปรากฏ ยกเว้นตอนแก้ไขประโยค: สัปดาห์เดิมของประโยคนั้นยังเลือกกลับได้)
  const ownWeek = editingSentenceId
    ? weeklySentences.find((s) => s.sentence_id === editingSentenceId)?.weekly_start || null
    : null;
  const takenWeeks = new Set(
    weeklySentences
      .filter((s) => s.weekly_start && s.sentence_id !== editingSentenceId)
      .map((s) => s.weekly_start)
  );
  const availableWeeks = (() => {
    const list = [];
    for (let i = 0; i <= MAX_WEEKS_AHEAD; i += 1) {
      const w = addDays(currentWeek, i * 7);
      if (!takenWeeks.has(w)) list.push(w);
    }
    if (ownWeek && !list.includes(ownWeek)) list.push(ownWeek);
    return list.sort();
  })();
  const weekIndex = weekStart ? availableWeeks.indexOf(weekStart) : -1;
  const canGoPrev = weekIndex > 0;
  const canGoNext = weekIndex === -1 ? availableWeeks.length > 0 : weekIndex < availableWeeks.length - 1;
  const weekLabel = !weekStart
    ? (editingSentenceId ? 'Week not set (tap arrow to set)' : 'Select a week (tap arrow)')
    : fmtWeekRange(weekStart);
  // ยังไม่ได้เลือกสัปดาห์: กดลูกศรครั้งแรกจะเสนอสัปดาห์ที่แนะนำ แล้วกดต่อเพื่อเลื่อนทีละสัปดาห์
  // กดลูกศรจะข้ามไปเฉพาะสัปดาห์ที่เลือกได้เท่านั้น
  const stepWeek = (dir) => {
    if (availableWeeks.length === 0) return;
    if (weekIndex === -1) {
      setWeekStart(availableWeeks.includes(suggestedWeek) ? suggestedWeek : availableWeeks[0]);
      return;
    }
    const next = availableWeeks[weekIndex + dir];
    if (next) setWeekStart(next);
  };

  const byWeekAsc = (a, b) => a.weekly_start.localeCompare(b.weekly_start);
  const isActiveItem = (s) => s.sentence_id === activeWeeklyId;
  const weeklyGroups = isWeeklyMode
    ? [
      { key: 'active', title: '● Current on Home', color: '#16a34a', items: weeklySentences.filter(isActiveItem) },
      {
        key: 'scheduled',
        title: 'Scheduled',
        items: weeklySentences.filter((s) => !isActiveItem(s) && s.weekly_start && s.weekly_start > currentWeek).sort(byWeekAsc),
      },
      {
        key: 'unscheduled',
        title: 'Unscheduled',
        items: weeklySentences.filter((s) => !isActiveItem(s) && !s.weekly_start),
      },
      {
        key: 'past',
        title: 'Past',
        items: weeklySentences.filter((s) => !isActiveItem(s) && s.weekly_start && s.weekly_start <= currentWeek).sort(byWeekAsc).reverse(),
      },
    ].filter((g) => g.items.length > 0)
    : [];

  const renderSentenceRow = (item) => (
    <SentenceRow key={item.sentence_id}>
      <SentenceRowText>
        <SentenceThaiText>{item.thai}</SentenceThaiText>
        <SentenceSubText style={{ marginTop: 0 }}>{item.eng}</SentenceSubText>
        {isWeeklyMode && (
          <SentenceSubText style={{ marginTop: 0 }}>Week: {fmtWeekRange(item.weekly_start)}</SentenceSubText>
        )}
      </SentenceRowText>
      <RowActions>
        <TouchableOpacity onPress={() => handleEditSentence(item)}>
          <RowActionText style={{ color: '#e8734a' }}>Edit</RowActionText>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDeleteSentence(item)}>
          <RowActionText style={{ color: '#dc2626' }}>Delete</RowActionText>
        </TouchableOpacity>
      </RowActions>
    </SentenceRow>
  );

  return (
    <ScrollView style={{ width: '100%' }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 30 }}>
      <Wrapper>
        <HeaderRow>
          <TouchableOpacity onPress={onBack}>
            <BackButtonText>ᐊ  Back</BackButtonText>
          </TouchableOpacity>
          <PageTitle>Manage Sentences</PageTitle>
          <View style={{ width: 40 }} />
        </HeaderRow>

        {/* ---------- ระดับ ---------- */}
        <SectionCard>
          <SectionTitle>Level</SectionTitle>
          <PillRow>
            {LEVEL_OPTIONS.map((opt) => (
              <Pill key={opt.id} $active={level === opt.id} onPress={() => setLevel(opt.id)}>
                <PillText $active={level === opt.id}>{opt.label}</PillText>
              </Pill>
            ))}
          </PillRow>
        </SectionCard>

        {/* ---------- บทเรียน (Topic) ---------- */}
        <SectionCard>
          <SectionTitle>Lesson</SectionTitle>
          {isLoadingTopics ? (
            <EmptyText>Loading…</EmptyText>
          ) : (
            <ChipsScroll>
              <Chip $active={isWeeklyMode} onPress={handleSelectWeekly}>
                <ChipText $active={isWeeklyMode}>Weekly</ChipText>
              </Chip>
              {topics.map((topic) => (
                <Chip
                  key={topic.id}
                  $active={selectedTopicId === topic.id}
                  onPress={() => handleSelectTopic(topic.id)}
                >
                  <ChipText $active={selectedTopicId === topic.id}>{topic.title}</ChipText>
                </Chip>
              ))}
              <Chip $active={isCreatingTopic} onPress={handleStartNewTopic}>
                <ChipText $active={isCreatingTopic}>+ New lesson</ChipText>
              </Chip>
            </ChipsScroll>
          )}

          {isCreatingTopic && (
            <View>
              <InputGroup style={{ marginTop: 14, marginBottom: 0 }}>
                <InputLabel>Lesson title *</InputLabel>
                <InputWrapper>
                  <StyledInput
                    value={newTopicTitle}
                    onChangeText={setNewTopicTitle}
                    placeholder="e.g. Shopping"
                  />
                </InputWrapper>
              </InputGroup>

              <InputLabel style={{ marginTop: 14 }}>Lesson icon *</InputLabel>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
                <ImagePickerBox onPress={handlePickTopicIcon}>
                  {topicIconUri ? (
                    <PreviewImage source={{ uri: topicIconUri }} />
                  ) : (
                    <ImagePickerLabel>Tap to select image</ImagePickerLabel>
                  )}
                </ImagePickerBox>
                {topicIconUri && (
                  <TouchableOpacity onPress={() => setTopicIconUri(null)}>
                    <RowActionText style={{ color: '#dc2626' }}>Delete image</RowActionText>
                  </TouchableOpacity>
                )}
              </View>

              {!!topicError && <ErrorText style={{ marginTop: 12 }}>{topicError}</ErrorText>}

              <SaveButton disabled={isSavingTopic} onPress={handleCreateTopicOnly}>
                <SaveButtonText>{isSavingTopic ? 'Creating…' : 'Create lesson'}</SaveButtonText>
              </SaveButton>
              <CancelEditButton disabled={isSavingTopic} onPress={handleCancelNewTopic}>
                <CancelEditText>Cancel</CancelEditText>
              </CancelEditButton>
            </View>
          )}

          {isWeeklyMode && (
            <View>
              <SentenceSubText style={{ marginTop: 10 }}>
                Weekly of {levelLabel}: {weeklySentences.length} Sentence (starting on Monday)
              </SentenceSubText>
              {!isFormOpen && (
                <AddSentenceButton onPress={handleOpenAddForm}>
                  <AddSentenceButtonText>+ Add New Weekly Sentence</AddSentenceButtonText>
                </AddSentenceButton>
              )}
            </View>
          )}

          {!isCreatingTopic && selectedTopic && (
            <View>
              <SentenceSubText style={{ marginTop: 10 }}>
                {selectedTopic.sentences?.length || 0} Sentences in this topic
              </SentenceSubText>
              {!isFormOpen && !isEditingTopic && (
                <>
                  <EditLessonButton onPress={handleOpenEditTopic}>
                    <EditLessonButtonText>Edit lesson (title / icon)</EditLessonButtonText>
                  </EditLessonButton>
                  <AddSentenceButton onPress={handleOpenAddForm}>
                    <AddSentenceButtonText>+ Add New Sentence</AddSentenceButtonText>
                  </AddSentenceButton>
                </>
              )}

              {isEditingTopic && (
                <View>
                  <InputGroup style={{ marginTop: 14, marginBottom: 0 }}>
                    <InputLabel>Lesson title *</InputLabel>
                    <InputWrapper>
                      <StyledInput
                        value={editTopicTitle}
                        onChangeText={setEditTopicTitle}
                        placeholder="e.g. Shopping"
                      />
                    </InputWrapper>
                  </InputGroup>

                  <InputLabel style={{ marginTop: 14 }}>Lesson icon *</InputLabel>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
                    <ImagePickerBox onPress={handlePickEditTopicIcon}>
                      {editTopicIconUri ? (
                        <PreviewImage source={{ uri: editTopicIconUri }} />
                      ) : (
                        <ImagePickerLabel>Tap to select image</ImagePickerLabel>
                      )}
                    </ImagePickerBox>
                    <SentenceSubText style={{ flex: 1 }}>Tap the image to change the icon</SentenceSubText>
                  </View>

                  {!!topicError && <ErrorText style={{ marginTop: 12 }}>{topicError}</ErrorText>}

                  <SaveButton disabled={isSavingTopic} onPress={handleSaveTopic}>
                    <SaveButtonText>{isSavingTopic ? 'Saving…' : 'Update lesson'}</SaveButtonText>
                  </SaveButton>
                  <CancelEditButton disabled={isSavingTopic} onPress={handleCancelEditTopic}>
                    <CancelEditText>Cancel</CancelEditText>
                  </CancelEditButton>
                </View>
              )}
            </View>
          )}
        </SectionCard>

        {/* ---------- ฟอร์มประโยค ---------- */}
        {isFormOpen && (selectedTopicId || isCreatingTopic || isWeeklyMode) && (
          <SectionCard>
            <SectionTitle>
              {editingSentenceId
                ? 'Edit sentence'
                : isWeeklyMode
                  ? `Add Weekly sentence → ${levelLabel}`
                  : selectedTopic
                    ? `Add sentence → "${selectedTopic.title}"`
                    : 'Add sentence'}
            </SectionTitle>

            {isWeeklyMode && (
              <View style={{ marginBottom: 14 }}>
                <InputLabel>Week to display on Home screen *</InputLabel>
                <WeekStepper>
                  <WeekArrow disabled={!canGoPrev} style={{ opacity: canGoPrev ? 1 : 0.35 }} onPress={() => stepWeek(-1)}>
                    <WeekArrowText>‹</WeekArrowText>
                  </WeekArrow>
                  <WeekLabel>{weekLabel}</WeekLabel>
                  <WeekArrow disabled={!canGoNext} style={{ opacity: canGoNext ? 1 : 0.35 }} onPress={() => stepWeek(1)}>
                    <WeekArrowText>›</WeekArrowText>
                  </WeekArrow>
                </WeekStepper>
                <SentenceSubText>This week starts on {fmtDay(currentWeek)} (Thai time)</SentenceSubText>
              </View>
            )}

            <InputGroup>
              <InputLabel>Thai sentence *</InputLabel>
              <InputWrapper>
                <StyledInput value={thai} onChangeText={setThai} placeholder="สวัสดีครับ" />
              </InputWrapper>
            </InputGroup>

            <InputGroup>
              <InputLabel>Karaoke (romanization) *</InputLabel>
              <InputWrapper>
                <StyledInput value={karaoke} onChangeText={setKaraoke} placeholder="Sa-wat-di-Khrap" />
              </InputWrapper>
            </InputGroup>

            <InputGroup>
              <InputLabel>English translation *</InputLabel>
              <InputWrapper>
                <StyledInput value={eng} onChangeText={setEng} placeholder="Hello" />
              </InputWrapper>
            </InputGroup>

            <InputGroup>
              <InputLabel>Label (show in list)</InputLabel>
              <InputWrapper>
                <StyledInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder={thai && eng ? `${thai} (${eng})` : 'สวัสดีครับ (Hello.)'}
                />
              </InputWrapper>
            </InputGroup>

            <InputGroup>
              <InputLabel>Pronunciation *</InputLabel>
              <InputWrapper>
                <StyledInput
                  value={pronunciation}
                  onChangeText={setPronunciation}
                  placeholder="สวัสดี ครับ"
                />
              </InputWrapper>
            </InputGroup>

            <InputLabel>Illustration image</InputLabel>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, marginBottom: 16 }}>
              <ImagePickerBox onPress={handlePickImage}>
                {imageUri ? (
                  <PreviewImage source={{ uri: imageUri }} />
                ) : (
                  <ImagePickerLabel>Tap to select image</ImagePickerLabel>
                )}
              </ImagePickerBox>
              {imageUri && (
                <TouchableOpacity onPress={() => setImageUri(null)}>
                  <RowActionText style={{ color: '#dc2626' }}>Delete Image</RowActionText>
                </TouchableOpacity>
              )}
            </View>

            <InputLabel>
              Audio {editingSentenceId ? '(Record again if you want to change the existing file)' : '*'}
            </InputLabel>
            <AudioRow>
              <RecordCircle $isRecording={isRecording} onPress={isRecording ? stopRecording : startRecording}>
                <RecordCircleText>{isRecording ? '■' : '●'}</RecordCircleText>
              </RecordCircle>
              <PlayCircle disabled={!audioUri} onPress={handlePreviewAudio}>
                <RecordCircleText>▶</RecordCircleText>
              </PlayCircle>
              <AudioStatusText numberOfLines={2}>
                {isRecording
                  ? 'Recording audio… Tap the square button to stop'
                  : audioFileName
                    ? `File: ${audioFileName}`
                    : 'No audio file'}
              </AudioStatusText>
            </AudioRow>

            {!!formError && <ErrorText style={{ marginTop: 12 }}>{formError}</ErrorText>}

            <SaveButton disabled={isSaving} onPress={handleSaveSentence}>
              <SaveButtonText>
                {isSaving ? 'Saving…' : editingSentenceId ? 'Update sentence' : 'Add sentence'}
              </SaveButtonText>
            </SaveButton>

            <CancelEditButton disabled={isSaving} onPress={handleCancelForm}>
              <CancelEditText>Cancel</CancelEditText>
            </CancelEditButton>
          </SectionCard>
        )}

        {/* ---------- รายการประโยคในบทที่เลือก ---------- */}
        {showSentenceList && !isFormOpen && (
          <SectionCard>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setIsListCollapsed((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: isListCollapsed ? 0 : 12 }}
            >
              <SectionTitle style={{ flex: 1, marginBottom: 0 }}>
                {isWeeklyMode
                  ? `Weekly sentences (${levelLabel}) · ${listSentences.length}`
                  : `Sentences in "${selectedTopic.title}" · ${listSentences.length}`}
              </SectionTitle>
              <RowActionText style={{ color: '#e8734a' }}>{isListCollapsed ? 'Show ▾' : 'Hide ▴'}</RowActionText>
            </TouchableOpacity>
            {!isListCollapsed && (
              isWeeklyMode ? (
                weeklyGroups.length === 0 ? (
                  <EmptyText>No Weekly sentences in this level</EmptyText>
                ) : (
                  weeklyGroups.map((group) => (
                    <View key={group.key} style={{ marginBottom: 6 }}>
                      <GroupTitle $color={group.color}>{group.title}</GroupTitle>
                      {group.items.map(renderSentenceRow)}
                    </View>
                  ))
                )
              ) : listSentences.length === 0 ? (
                <EmptyText>No sentences in this topic</EmptyText>
              ) : (
                listSentences.map(renderSentenceRow)
              )
            )}
          </SectionCard>
        )}

        {/* ---------- Danger zone: ลบบทเรียน (เฉพาะบทเรียนปกติ ตอนฟอร์มประโยค/แก้ไขบทปิดอยู่) ---------- */}
        {showSentenceList && !isWeeklyMode && !isFormOpen && !isEditingTopic && selectedTopic && (
          <DangerCard>
            <DangerTitle>Danger zone</DangerTitle>
            <DangerText>
              Deleting this lesson permanently removes it and all of its sentences. You will be asked for your password to confirm.
            </DangerText>
            <DeleteLessonButton onPress={handleOpenDeleteTopic}>
              <DeleteLessonButtonText>Delete lesson</DeleteLessonButtonText>
            </DeleteLessonButton>
          </DangerCard>
        )}

        {/* ---------- popup ยืนยันลบบทเรียนด้วยรหัสผ่าน ---------- */}
        <Modal
          visible={isDeleteModalOpen}
          transparent
          animationType="fade"
          onRequestClose={handleCloseDeleteModal}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ModalOverlay>
              <ModalCard>
                <ModalTitle>Delete this lesson?</ModalTitle>
                <ModalBodyText>
                  {`"${selectedTopic?.title || ''}" และประโยคทั้งหมดในบทนี้ (${selectedTopic?.sentences?.length || 0} ประโยค) จะถูกลบถาวร ไม่สามารถกู้คืนได้\n\nกรอกรหัสผ่านของบัญชีเพื่อยืนยัน`}
                </ModalBodyText>

                <InputGroup style={{ marginBottom: 0 }}>
                  <InputLabel>Password *</InputLabel>
                  <InputWrapper>
                    <StyledInput
                      value={deletePassword}
                      onChangeText={setDeletePassword}
                      placeholder="Enter your password"
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </InputWrapper>
                </InputGroup>

                {!!deleteError && <ErrorText style={{ marginTop: 12 }}>{deleteError}</ErrorText>}

                <ModalButtonRow>
                  <ModalButton disabled={isDeletingTopic} onPress={handleCloseDeleteModal}>
                    <ModalButtonText>Cancel</ModalButtonText>
                  </ModalButton>
                  <ModalButton
                    $bg="#dc2626"
                    disabled={isDeletingTopic}
                    onPress={handleConfirmDeleteTopic}
                  >
                    <ModalButtonText $color="#ffffff">
                      {isDeletingTopic ? 'Deleting…' : 'Delete'}
                    </ModalButtonText>
                  </ModalButton>
                </ModalButtonRow>
              </ModalCard>
            </ModalOverlay>
          </KeyboardAvoidingView>
        </Modal>
      </Wrapper>
    </ScrollView>
  );
}

export default AdminScreen;
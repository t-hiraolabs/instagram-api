import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  PanResponder,
  Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { uploadPostImage, uploadBlob } from '../services/storage';
import {
  composeStoryImage,
  StoryTransform,
  DEFAULT_TRANSFORM,
} from '../utils/composeStory';
import FeedCropEditor from '../components/FeedCropEditor';
import StoryEditor from '../components/StoryEditor';
import ReelScreen from './ReelScreen';
import RosterScreen from './RosterScreen';
import { addTextToVideo, composeImageWithHeadline } from '../utils/createReel';
import { generateStory, generatePost, generateFromImage, generateFromImages, refineCaption } from '../services/aiService';
import { getTopPostsForGeneration } from '../services/insightsService';
import {
  getTemplates,
  saveTemplate,
  deleteTemplate,
  PostTemplate,
} from '../services/templateService';

// 動画の1フレームを取り出してbase64画像にする（AI見出し生成用・web）
function extractVideoFrame(blob: Blob): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    (video as any).playsInline = true;
    video.src = URL.createObjectURL(blob);
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(1, (video.duration || 2) / 2);
      } catch (_e) {
        // noop
      }
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 1280;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvasを利用できません'));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      URL.revokeObjectURL(video.src);
      resolve({ base64: dataUrl.split(',')[1] ?? '', mime: 'image/jpeg' });
    };
    video.onerror = () => reject(new Error('動画の読み込みに失敗しました'));
  });
}

// 画像URI（web/ネイティブ）をbase64に変換（ImagePickerのbase64がwebで取れない対策）
async function uriToBase64(uri: string): Promise<{ base64: string; mime: string }> {
  const res = await fetch(uri);
  const blob = await res.blob();
  const mime = blob.type || 'image/jpeg';
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  return { base64, mime };
}
import {
  getScheduledPosts,
  createScheduledPost,
  deleteScheduledPost,
  updateScheduledPost,
  getMyPlan,
  ScheduledPost,
  RepeatOption,
} from '../services/scheduleService';
import { ensureLoggedIn } from '../utils/requireLogin';
import { useAppStore } from '../store/appStore';
import { publishNow } from '../services/publishNow';
import ImageGenChat from '../components/ImageGenChat';
import { Plan, canRecurring } from '../utils/plans';

type Filter = 'all' | 'draft' | 'pending' | 'published' | 'failed';

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseDate(str: string): Date | null {
  const normalized = str.replace(/\//g, '-').replace(' ', 'T');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

// ISO日時を編集欄用のローカル文字列(YYYY-MM-DDTHH:mm)に変換
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getQuickDates(): { label: string; value: string; isOptimal: boolean }[] {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date, h: number) => {
    d.setHours(h, 0, 0, 0);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:00`;
  };

  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(now);
  dayAfter.setDate(dayAfter.getDate() + 2);

  const currentHour = now.getHours();
  const todayBestHour = currentHour < 12 ? 12 : currentHour < 18 ? 18 : 20;
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  return [
    { label: `今日 ${todayBestHour}:00`, value: fmt(new Date(today), todayBestHour), isOptimal: true },
    { label: '明日 18:00', value: fmt(new Date(tomorrow), 18), isOptimal: true },
    { label: '明日 12:00', value: fmt(new Date(tomorrow), 12), isOptimal: false },
    { label: isWeekend ? '月曜 18:00' : '土曜 11:00', value: (() => {
      const d = new Date(now);
      const daysUntil = isWeekend ? (1 + 7 - now.getDay()) % 7 || 7 : (6 - now.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntil);
      return fmt(d, isWeekend ? 18 : 11);
    })(), isOptimal: false },
  ];
}

const REPEAT_OPTIONS: { key: RepeatOption; label: string }[] = [
  { key: 'none', label: 'なし' },
  { key: 'daily', label: '毎日' },
  { key: 'weekly', label: '毎週' },
  { key: 'monthly', label: '毎月' },
  { key: 'weekdays', label: '平日のみ' },
];

const REPEAT_SHORT: Record<RepeatOption, string> = {
  none: '',
  daily: '毎日',
  weekly: '毎週',
  monthly: '毎月',
  weekdays: '平日',
};

// カレンダーで状態を色分けするための定義（予約中=青/投稿済み=緑/下書き=グレー/失敗=赤）
type PostStatus = 'pending' | 'published' | 'draft' | 'failed';
const STATUS_ORDER: PostStatus[] = ['pending', 'published', 'draft', 'failed'];
const STATUS_COLORS: Record<PostStatus, string> = {
  pending: '#4FC3F7',
  published: '#4CAF50',
  draft: '#888888',
  failed: '#FF5252',
};
const STATUS_LABELS: Record<PostStatus, string> = {
  pending: '予約中',
  published: '投稿済み',
  draft: '下書き',
  failed: '失敗',
};

// web の日付/時間ピッカー（<input type="date|time">）の見た目。RNのStyleSheetは使えないのでCSSで指定
const webDateInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  backgroundColor: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.md,
  padding: '10px 12px',
  color: COLORS.text,
  fontSize: 15,
  colorScheme: 'dark',
};

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const draft = useAppStore((s) => s.draft);
  const clearDraft = useAppStore((s) => s.clearDraft);
  const instagramCredentials1 = useAppStore((s) => s.instagramCredentials);
  const instagramCredentials2 = useAppStore((s) => s.secondInstagramCredentials);
  const instagramCredentials3 = useAppStore((s) => s.thirdInstagramCredentials);
  const activeAccountSlot = useAppStore((s) => s.activeAccountSlot);
  const instagramCredentials = activeAccountSlot === 3 ? instagramCredentials3 : activeAccountSlot === 2 ? instagramCredentials2 : instagramCredentials1;
  const brandSettings = useAppStore((s) => s.brandSettings);

  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [calView, setCalView] = useState<'list' | 'calendar'>('list');
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [calSelected, setCalSelected] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [caption, setCaption] = useState('');
  const [hashtagsText, setHashtagsText] = useState('');
  const [newFeedTag, setNewFeedTag] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]); // フィードのカルーセル用（複数）
  const [feedPreviews, setFeedPreviews] = useState<string[]>([]); // 選択した写真のサムネ表示用
  const [imagePreview, setImagePreview] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [dateText, setDateText] = useState('');
  const [type, setType] = useState<'feed' | 'story'>('feed');
  const [repeat, setRepeat] = useState<RepeatOption>('none');
  const [scheduleModalVisible, setScheduleModalVisible] = useState(false); // 「予約する」で日時入力を別画面表示
  const scheduleFromResult = useRef(false); // 結果画面から予約モーダルを開いたか
  const editingDraftId = useRef<string | null>(null); // 結果画面で既存の下書きを編集中ならそのID
  const draftOriginalRef = useRef<string | null>(null); // 編集開始時の内容スナップショット（変更検知用）
  const [plan, setPlan] = useState<Plan>('free');
  const [nowSub, setNowSub] = useState<'menu' | 'reel' | 'roster'>('menu'); // 投稿タブ内の表示

  // テンプレート（ひな形）: この端末だけに保存して再利用する
  const [templates, setTemplates] = useState<PostTemplate[]>([]);
  const [templatePickerVisible, setTemplatePickerVisible] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  // 詳細モーダル用
  const [detailPost, setDetailPost] = useState<ScheduledPost | null>(null);
  const [carouselW, setCarouselW] = useState(0);
  const [carouselIdx, setCarouselIdx] = useState(0);
  useEffect(() => { setCarouselIdx(0); }, [detailPost]);
  const [rCarW, setRCarW] = useState(0);
  const [rCarIdx, setRCarIdx] = useState(0);
  // 写真トリミング編集（選択→調整→AI生成の流れ）
  const [cropVisible, setCropVisible] = useState(false);
  const [cropRawImages, setCropRawImages] = useState<string[]>([]);
  const [cropInitialIndex, setCropInitialIndex] = useState(0);
  const cropAppendRef = useRef(false); // 追加（追記）モードか、置き換えモードか
  const cropReturnRef = useRef<'create' | 'result' | null>(null); // 編集後に戻るモーダル

  // AI生成結果画面用
  const [resultVisible, setResultVisible] = useState(false);
  const [closeConfirmVisible, setCloseConfirmVisible] = useState(false);
  useEffect(() => { setRCarIdx(0); }, [resultVisible]);

  // 編集モーダル用
  const [editVisible, setEditVisible] = useState(false);
  const [editingPost, setEditingPost] = useState<ScheduledPost | null>(null);
  const [editDuplicateSource, setEditDuplicateSource] = useState<ScheduledPost | null>(null);
  const [editPublishDraft, setEditPublishDraft] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [editCaption, setEditCaption] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editRepeat, setEditRepeat] = useState<RepeatOption>('none');
  const [editSaving, setEditSaving] = useState(false);

  // ストーリー用：合成前の元写真と、画像に載せる文字
  const [storyRawUri, setStoryRawUri] = useState('');
  const [storyMode, setStoryMode] = useState<'image' | 'video'>('image'); // ストーリー: 写真+文字 / 動画
  const [storyVideoUri, setStoryVideoUri] = useState('');
  const [storyVideoBlob, setStoryVideoBlob] = useState<Blob | null>(null);
  const [storyMediaType, setStoryMediaType] = useState<'' | 'image' | 'video'>('');
  const [storyImageUri, setStoryImageUri] = useState('');
  const [storyVideoText, setStoryVideoText] = useState('');
  const [storyVideoTheme, setStoryVideoTheme] = useState('');
  const [storyVideoTextXY, setStoryVideoTextXY] = useState({ x: 0.5, y: 0.85 });
  const [storyVideoTextScale, setStoryVideoTextScale] = useState(1);
  const [storyTextSize, setStoryTextSize] = useState({ w: 0, h: 0 });
  const [storyDragging, setStoryDragging] = useState(false);
  const storyVideoHostRef = useRef<any>(null);
  const xyRef = useRef({ x: 0.5, y: 0.85 });
  xyRef.current = storyVideoTextXY;
  const scaleRef = useRef(1);
  scaleRef.current = storyVideoTextScale;
  const dragStart = useRef({ x: 0.5, y: 0.85 });
  const pinchRef = useRef({ active: false, startDist: 0, startScale: 1 });
  const wasPinchRef = useRef(false);
  const PREVIEW_W = 200;
  const PREVIEW_H = 356;
  const clamp01 = (v: number, lo = 0.06, hi = 0.94) => Math.max(lo, Math.min(hi, v));
  const storyTextPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStart.current = { ...xyRef.current };
        pinchRef.current = { active: false, startDist: 0, startScale: scaleRef.current };
        wasPinchRef.current = false;
        setStoryDragging(true);
      },
      onPanResponderMove: (e, g) => {
        // 二本指：ピンチで拡大縮小
        if (g.numberActiveTouches >= 2) {
          const t: any[] = (e.nativeEvent as any).touches || [];
          if (t.length >= 2) {
            wasPinchRef.current = true;
            const dist = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
            if (!pinchRef.current.active) {
              pinchRef.current = { active: true, startDist: dist, startScale: scaleRef.current };
            } else if (pinchRef.current.startDist > 0) {
              const next = Math.max(
                0.5,
                Math.min(2.5, pinchRef.current.startScale * (dist / pinchRef.current.startDist))
              );
              setStoryVideoTextScale(+next.toFixed(2));
            }
          }
          return;
        }
        // 一本指：ドラッグで移動（ピンチ後は誤動作防止でスキップ）
        pinchRef.current.active = false;
        if (wasPinchRef.current) return;
        setStoryVideoTextXY({
          x: clamp01(dragStart.current.x + g.dx / PREVIEW_W),
          y: clamp01(dragStart.current.y + g.dy / PREVIEW_H),
        });
      },
      onPanResponderRelease: () => setStoryDragging(false),
      onPanResponderTerminate: () => setStoryDragging(false),
    })
  ).current;
  const [storyTheme, setStoryTheme] = useState('');
  const [storyDetails, setStoryDetails] = useState('');
  const [storyTitle, setStoryTitle] = useState('');
  const [storyBody, setStoryBody] = useState('');
  const [storyCta, setStoryCta] = useState('');
  const [storyTextColor, setStoryTextColor] = useState('#FFFFFF');
  const [storyTransform, setStoryTransform] = useState<StoryTransform>({
    ...DEFAULT_TRANSFORM,
  });
  const [feedTheme, setFeedTheme] = useState('');
  // タグ・場所
  const [userTags, setUserTags] = useState<string[]>([]);
  const [newUserTag, setNewUserTag] = useState('');
  const [productTags, setProductTags] = useState<string[]>([]);
  const [newProductTag, setNewProductTag] = useState('');
  const [locationId, setLocationId] = useState('');
  // AI画像生成（チャット）
  const [imgChatVisible, setImgChatVisible] = useState(false);
  const openImageChatFlag = useAppStore((s) => s.openImageChat);
  const setOpenImageChatFlag = useAppStore((s) => s.setOpenImageChat);
  const imgChatFromHome = useRef(false);
  useEffect(() => {
    if (openImageChatFlag) {
      imgChatFromHome.current = true;
      setImgChatVisible(true);
      setOpenImageChatFlag(false);
    }
  }, [openImageChatFlag, setOpenImageChatFlag]);

  // ホームのインラインチャットで「この画像で投稿を作る」を押したときの受け取り
  const pendingUseImage = useAppStore((s) => s.pendingUseImage);
  const setPendingUseImage = useAppStore((s) => s.setPendingUseImage);
  useEffect(() => {
    if (pendingUseImage) {
      handleUseGeneratedImage(pendingUseImage);
      setPendingUseImage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUseImage]);
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [composing, setComposing] = useState(false);

  const quickDates = getQuickDates();

  const fetchPosts = useCallback(async () => {
    try {
      const data = await getScheduledPosts(instagramCredentials?.userId);
      setPosts(data);
    } catch {
      Alert.alert('エラー', 'Supabaseの設定を確認してください。');
    } finally {
      setLoading(false);
    }
  }, [instagramCredentials?.userId]);

  useEffect(() => {
    fetchPosts();
    getMyPlan().then(setPlan).catch(() => {});
    getTemplates().then(setTemplates).catch(() => {});
  }, [fetchPosts]);

  // 動画ストーリーのプレビュー：選んだ動画を<video>で表示
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const host = storyVideoHostRef.current as HTMLElement | null;
    if (!host) return;
    host.innerHTML = '';
    if (!storyVideoUri) return;
    const v = document.createElement('video');
    v.src = storyVideoUri;
    v.controls = false; // コントロール非表示（ピンチで全画面化するのを防ぐ）
    v.autoplay = true;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    (v as any).disablePictureInPicture = true;
    Object.assign(v.style, {
      width: '200px',
      height: '356px',
      borderRadius: '12px',
      backgroundColor: '#000',
      display: 'block',
      objectFit: 'cover',
      pointerEvents: 'none', // 動画はタッチを受け取らない（操作は上の枠で受ける）
      touchAction: 'none',
    } as Partial<CSSStyleDeclaration>);
    v.play?.().catch(() => {});
    host.appendChild(v);
  }, [storyVideoUri, storyMediaType, modalVisible]);

  const openModal = () => {
    setCaption(draft.caption || '');
    setHashtagsText(draft.hashtags.join(' ') || '');
    setType(draft.type || 'feed');
    setImageUrl('');
    setImageUrls([]);
    setFeedPreviews([]);
    setImagePreview('');
    setDateText('');
    setStoryRawUri('');
    setStoryMode('image');
    setStoryMediaType('');
    setStoryImageUri('');
    setStoryVideoUri('');
    setStoryVideoBlob(null);
    setStoryVideoText('');
    setStoryVideoTheme('');
    setStoryVideoTextXY({ x: 0.5, y: 0.85 });
    setStoryVideoTextScale(1);
    setStoryTheme('');
    setFeedTheme('');
    setAiInstruction('');
    setStoryDetails('');
    setStoryTitle('');
    setStoryBody('');
    setStoryCta('');
    setStoryTextColor('#FFFFFF');
    setStoryTransform({ ...DEFAULT_TRANSFORM });
    setRepeat('none');
    setUserTags([]);
    setNewUserTag('');
    setProductTags([]);
    setNewProductTag('');
    setLocationId('');
    setScheduleModalVisible(false);
    setModalVisible(true);
  };

  // 「投稿を作成」：作成モーダルを開きつつ、すぐ写真選択→調整画面へ進む
  const startNewPost = () => {
    openModal();
    setTimeout(() => { pickFeedImages(); }, 0);
  };

  const alertMsg = (msg: string, title = 'エラー') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  // くりかえしの選択（Pro限定。無料が選んだら案内を出す）
  const selectRepeat = (r: RepeatOption) => {
    if (r !== 'none' && !canRecurring(plan)) {
      alertMsg(
        'くりかえし投稿はProプラン限定です。Proにアップグレードすると、毎日・毎週・毎月・平日の自動くりかえし投稿が使えます。',
        'Pro限定の機能です'
      );
      return;
    }
    setRepeat(r);
  };

  // 写真を選ぶ。フィードはそのままアップロード、ストーリーは合成用に元写真として保持
  const pickAndUploadImage = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('権限エラー', '写真へのアクセスを許可してください');
        return;
      }
    }
    if (type === 'story') {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [9, 16],
        quality: 0.9,
      });
      if (res.canceled) return;
      // ストーリーは文字を合成してから投稿するので、ここではアップロードしない
      setStoryRawUri(res.assets[0].uri);
      setImagePreview(res.assets[0].uri);
      setImageUrl('');
      return;
    }

    // フィードは複数選択OK（カルーセル投稿）→ まずトリミング編集へ
    await pickFeedImages();
  };

  // 画像生成チャットを開く（作成モーダルは隠してz-index競合を防ぐ）
  const openImgChat = async () => {
    if (!(await ensureLoggedIn('画像生成を使うにはログインが必要です'))) return;
    imgChatFromHome.current = false;
    setModalVisible(false);
    setImgChatVisible(true);
  };

  // チャットで生成した画像を使って調整画面へ
  const handleUseGeneratedImage = (dataUrl: string) => {
    setImgChatVisible(false);
    cropAppendRef.current = false;
    cropReturnRef.current = 'create';
    setCropInitialIndex(0);
    setCropRawImages([dataUrl]);
    setCropVisible(true);
  };

  // フィード写真を選んで、そのまま「写真を調整する画面」へ
  const pickFeedImages = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('権限エラー', '写真へのアクセスを許可してください');
        return;
      }
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.9,
    });
    if (res.canceled) return;

    cropAppendRef.current = false;
    cropReturnRef.current = 'create';
    setCropInitialIndex(0);
    setModalVisible(false); // 下のモーダルと重なってz-indexで隠れるのを防ぐ
    setCropRawImages(res.assets.map((a) => a.uri));
    setCropVisible(true);
  };

  // ストーリー用のメディア（写真 または 動画）を選ぶ
  const pickStoryMedia = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
    });
    if (res.canceled) return;
    const a = res.assets[0];
    if (a.type === 'video') {
      try {
        const r = await fetch(a.uri);
        const b = await r.blob();
        setStoryMediaType('video');
        setStoryVideoBlob(b);
        setStoryVideoUri(URL.createObjectURL(b));
        setStoryImageUri('');
      } catch (e) {
        alertMsg(e instanceof Error ? e.message : '動画の読み込みに失敗しました');
      }
    } else {
      setStoryMediaType('image');
      setStoryImageUri(a.uri);
      setStoryVideoBlob(null);
      setStoryVideoUri('');
    }
  };

  // 統合ストーリーのメディアを合成・アップロードしてURLと種別を返す
  const uploadStoryMedia = async (): Promise<{ url: string; isVideo: boolean }> => {
    if (storyMediaType === 'video') {
      let blob = storyVideoBlob!;
      if (storyVideoText.trim()) {
        const c = await addTextToVideo(
          storyVideoBlob!,
          storyVideoText.trim(),
          storyVideoTextXY.x,
          storyVideoTextXY.y,
          storyVideoTextScale
        );
        blob = c.blob;
      }
      return { url: await uploadBlob(blob), isVideo: true };
    }
    // 写真：見出しを合成
    const c = await composeImageWithHeadline(
      storyImageUri,
      storyVideoText.trim(),
      storyVideoTextXY.x,
      storyVideoTextXY.y,
      storyVideoTextScale
    );
    return { url: await uploadBlob(c.blob), isVideo: false };
  };

  // 見出しを指示で書き直す
  const handleRefineHeadline = async () => {
    if (!storyVideoText.trim()) {
      alertMsg('先に見出しを作成（または入力）してください');
      return;
    }
    if (!aiInstruction.trim()) {
      alertMsg('指示を入力してください（例: もっと短く / 絵文字を入れて）');
      return;
    }
    if (!(await ensureLoggedIn('AI生成を使うにはログインが必要です'))) return;
    setAiLoading(true);
    try {
      const r = await refineCaption(storyVideoText.trim(), aiInstruction.trim());
      setStoryVideoText((r || '').replace(/[\n#]/g, ' ').trim().slice(0, 24));
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '書き直しに失敗しました');
    } finally {
      setAiLoading(false);
    }
  };

  // 写真/動画から見出しをAIで作る
  const handleGenerateHeadlineFromMedia = async () => {
    if (!storyMediaType) {
      alertMsg('先に写真または動画を選んでください');
      return;
    }
    if (!(await ensureLoggedIn('AI生成を使うにはログインが必要です'))) return;
    setAiLoading(true);
    try {
      let base64 = '';
      let mime = 'image/jpeg';
      if (storyMediaType === 'video') {
        const f = await extractVideoFrame(storyVideoBlob!);
        base64 = f.base64;
        mime = f.mime;
      } else {
        const f = await uriToBase64(storyImageUri);
        base64 = f.base64;
        mime = f.mime;
      }
      if (!base64) {
        alertMsg('読み込みに失敗しました');
        return;
      }
      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const topPosts = await getTopPostsForGeneration();
      const g = await generateFromImage({
        imageBase64: base64,
        mimeType: (allowed.includes(mime) ? mime : 'image/jpeg') as 'image/jpeg',
        contentType: 'story',
        tone: brandSettings.tone || '明るい・ポジティブ',
        industry: brandSettings.industry,
        instruction:
          'ストーリーにのせる短い見出しを1つだけ。8〜14文字、記号や改行・ハッシュタグなし。' +
          (aiInstruction.trim() ? ` ${aiInstruction.trim()}` : ''),
        topPosts,
      });
      setStoryVideoText((g.caption || '').replace(/[\n#]/g, ' ').trim().slice(0, 24));
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : 'AI生成に失敗しました');
    } finally {
      setAiLoading(false);
    }
  };

  // テーマから見出しをAIで作る
  const handleGenerateVideoHeadlineFromTheme = async () => {
    if (!storyVideoTheme.trim()) {
      alertMsg('テーマを入力してください（例: 本日OPEN）');
      return;
    }
    if (!(await ensureLoggedIn('AI生成を使うにはログインが必要です'))) return;
    setAiLoading(true);
    try {
      const topPosts = await getTopPostsForGeneration();
      const g = await generateStory({
        theme: storyVideoTheme.trim(),
        type: 'announcement',
        details:
          storyVideoTheme.trim() + (aiInstruction.trim() ? ` 指示:${aiInstruction.trim()}` : ''),
        topPosts,
      });
      setStoryVideoText((g.title || g.bodyText || '').replace(/[\n#]/g, ' ').trim().slice(0, 24));
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : 'AI生成に失敗しました');
    } finally {
      setAiLoading(false);
    }
  };

  // 動画から見出しをAIで作る（1フレームを抽出してAIに渡す）
  const handleGenerateVideoHeadline = async () => {
    if (!storyVideoBlob) {
      alertMsg('先に動画を選んでください');
      return;
    }
    if (!(await ensureLoggedIn('AI生成を使うにはログインが必要です'))) return;
    setAiLoading(true);
    try {
      const { base64, mime } = await extractVideoFrame(storyVideoBlob);
      if (!base64) {
        alertMsg('動画の読み込みに失敗しました');
        return;
      }
      const topPosts = await getTopPostsForGeneration();
      const g = await generateFromImage({
        imageBase64: base64,
        mimeType: mime as 'image/jpeg',
        contentType: 'story',
        tone: brandSettings.tone || '明るい・ポジティブ',
        industry: brandSettings.industry,
        instruction:
          '動画にのせる短い見出しを1つだけ。8〜14文字、記号や改行・ハッシュタグなし。' +
          (aiInstruction.trim() ? ` ${aiInstruction.trim()}` : ''),
        topPosts,
      });
      setStoryVideoText((g.caption || '').replace(/[\n#]/g, ' ').trim().slice(0, 24));
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : 'AI生成に失敗しました');
    } finally {
      setAiLoading(false);
    }
  };

  // フィードのキャプション・ハッシュタグをAI生成
  const handleGenerateFeedText = async () => {
    if (!feedTheme.trim()) {
      alertMsg('テーマを入力してください（例: 夏の新メニュー紹介）');
      return;
    }
    if (!(await ensureLoggedIn('AI生成を使うにはログインが必要です'))) return;
    setAiLoading(true);
    try {
      const topPosts = await getTopPostsForGeneration();
      const g = await generatePost({
        theme: feedTheme.trim(),
        tone: brandSettings.tone || '明るい・ポジティブ',
        keywords: [],
        includeHashtags: true,
        language: 'ja',
        industry: brandSettings.industry,
        instruction: aiInstruction.trim() || undefined,
        topPosts,
      });
      setCaption(g.caption);
      setHashtagsText(g.hashtags.join(' '));
      setModalVisible(false);
      setResultVisible(true);
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : 'AI生成に失敗しました');
    } finally {
      setAiLoading(false);
    }
  };

  // 投稿用に選んだ写真（最大5枚）すべてからキャプション・ハッシュタグをAI生成
  const handleGenerateFeedFromPhoto = async () => {
    if (feedPreviews.length === 0) {
      alertMsg('先に投稿する写真を選んでください');
      return;
    }
    if (!(await ensureLoggedIn('AI生成を使うにはログインが必要です'))) return;
    setAiLoading(true);
    try {
      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const images = [];
      for (const uri of feedPreviews.slice(0, 5)) {
        const { base64, mime } = await uriToBase64(uri);
        if (base64) {
          images.push({
            base64,
            mimeType: (allowed.includes(mime) ? mime : 'image/jpeg') as 'image/jpeg',
          });
        }
      }
      if (images.length === 0) {
        alertMsg('写真の読み込みに失敗しました');
        return;
      }
      const topPosts = await getTopPostsForGeneration();
      const g = await generateFromImages({
        images,
        tone: brandSettings.tone || '明るい・ポジティブ',
        industry: brandSettings.industry,
        instruction: aiInstruction.trim() || undefined,
        topPosts,
      });
      setCaption(g.caption);
      setHashtagsText(g.hashtags.join(' '));
      setModalVisible(false);
      setResultVisible(true);
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : 'AI生成に失敗しました');
    } finally {
      setAiLoading(false);
    }
  };

  // 生成済みキャプションを指示に従って書き直す
  const handleRefineCaption = async () => {
    if (!caption.trim()) {
      alertMsg('先にキャプションを作成（または入力）してください');
      return;
    }
    if (!aiInstruction.trim()) {
      alertMsg('指示を入力してください（例: もっとカジュアルに、絵文字多めで）');
      return;
    }
    if (!(await ensureLoggedIn('AI生成を使うにはログインが必要です'))) return;
    setAiLoading(true);
    try {
      const newCaption = await refineCaption(caption.trim(), aiInstruction.trim());
      setCaption(newCaption);
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '書き直しに失敗しました');
    } finally {
      setAiLoading(false);
    }
  };

  const handleGenerateStoryText = async () => {
    if (!storyTheme.trim() && !storyDetails.trim()) {
      alertMsg('テーマか内容を入力してください');
      return;
    }
    if (!(await ensureLoggedIn('AI生成を使うにはログインが必要です'))) return;
    setAiLoading(true);
    try {
      const topPosts = await getTopPostsForGeneration();
      const g = await generateStory({
        theme: storyTheme.trim() || storyDetails.trim().slice(0, 20),
        type: 'announcement',
        details: storyDetails.trim() || storyTheme.trim(),
        topPosts,
      });
      setStoryTitle(g.title);
      setStoryBody(g.bodyText);
      setStoryCta(g.cta);
      if (g.textColor) setStoryTextColor(g.textColor);
      // 文字が変わったので合成済み画像は作り直しが必要
      setImageUrl('');
    } catch {
      alertMsg('AI生成に失敗しました。プロフィール画面でAPIキーを設定してください。');
    } finally {
      setAiLoading(false);
    }
  };

  // 元写真＋文字を合成してプレビューを作り、アップロードまで行う
  const handleComposeStory = async () => {
    if (!storyRawUri) {
      alertMsg('先に写真を選んでください');
      return;
    }
    if (!storyTitle.trim() && !storyBody.trim() && !storyCta.trim()) {
      alertMsg('画像に載せる文字（タイトル・本文・CTAのいずれか）を入力してください');
      return;
    }
    setComposing(true);
    try {
      const { blob, previewUrl } = await composeStoryImage(
        storyRawUri,
        {
          title: storyTitle.trim(),
          bodyText: storyBody.trim(),
          cta: storyCta.trim(),
          textColor: storyTextColor,
        },
        storyTransform
      );
      setImagePreview(previewUrl);
      const publicUrl = await uploadBlob(blob);
      setImageUrl(publicUrl);
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '合成に失敗しました');
    } finally {
      setComposing(false);
    }
  };

  const buildHashtags = () =>
    hashtagsText
      .split(/[\s,　]+/)
      .map((h) => h.trim())
      .filter(Boolean);

  // ハッシュタグを1枠ずつ（チップ式）で管理する。canonicalは hashtagsText（スペース区切り）
  const MAX_TAGS = 30;
  const feedTags = hashtagsText
    .split(/[\s,、　]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const setFeedTags = (tags: string[]) => setHashtagsText(tags.join(' '));

  const addFeedTag = () => {
    const parsed = newFeedTag
      .split(/[\s,、　]+/)
      .map((t) => t.replace(/#/g, '').trim())
      .filter(Boolean)
      .map((t) => `#${t}`);
    if (parsed.length === 0) {
      setNewFeedTag('');
      return;
    }
    const seen = new Set(feedTags.map((h) => h.toLowerCase()));
    const merged = [...feedTags];
    let skipped = false;
    for (const t of parsed) {
      if (merged.length >= MAX_TAGS) {
        skipped = true;
        break;
      }
      if (!seen.has(t.toLowerCase())) {
        merged.push(t);
        seen.add(t.toLowerCase());
      }
    }
    setFeedTags(merged);
    setNewFeedTag('');
    if (skipped) alertMsg(`ハッシュタグは${MAX_TAGS}個までです`);
  };

  const removeFeedTag = (index: number) => {
    setFeedTags(feedTags.filter((_, i) => i !== index));
  };

  // いまの投稿内容をテンプレート（ひな形）として保存する
  const handleSaveTemplate = async () => {
    if (type !== 'feed') {
      alertMsg('テンプレートはフィード投稿の文章を保存します（ストーリーは未対応）', 'お知らせ');
      return;
    }
    if (!caption.trim() && feedTags.length === 0) {
      alertMsg('保存するキャプションかハッシュタグを入力してください');
      return;
    }
    const fallbackName =
      caption.trim().slice(0, 20) || feedTags.join(' ').slice(0, 20) || 'テンプレート';
    let name = fallbackName;
    if (Platform.OS === 'web') {
      const input = window.prompt('テンプレートの名前を入力してください', fallbackName);
      if (input === null) return; // キャンセル
      name = input.trim() || fallbackName;
    }
    setSavingTemplate(true);
    try {
      // カルーセル（複数枚）はテンプレートに含めない。1枚のときだけアップロード済みURLを保存
      const next = await saveTemplate({
        name,
        caption: caption.trim(),
        hashtags: feedTags,
        type: 'feed',
        image_url: imageUrls.length > 1 ? undefined : imageUrl.trim() || undefined,
      });
      setTemplates(next);
      alertMsg('テンプレートに保存しました。次回「テンプレートから選ぶ」で使えます', '保存しました');
    } catch {
      alertMsg('テンプレートの保存に失敗しました');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleResultClose = () => {
    // 写真もキャプションもハッシュタグも無ければ、何も聞かずに閉じる
    if (!caption.trim() && feedTags.length === 0 && feedPreviews.length === 0) {
      editingDraftId.current = null;
      draftOriginalRef.current = null;
      setResultVisible(false);
      return;
    }
    // 既存下書きを編集中で、内容が変わっていなければ何も聞かずに閉じる
    if (draftOriginalRef.current != null) {
      const now = JSON.stringify({
        caption,
        tags: feedTags.join(' '),
        images: feedPreviews.join('\n'),
      });
      if (now === draftOriginalRef.current) {
        editingDraftId.current = null;
        draftOriginalRef.current = null;
        setResultVisible(false);
        return;
      }
    }
    // キャンセル/いいえ/はい の3択ダイアログ（アプリ内モーダル）
    setCloseConfirmVisible(true);
  };

  const discardResult = () => {
    editingDraftId.current = null;
    draftOriginalRef.current = null;
    setCloseConfirmVisible(false);
    setResultVisible(false);
  };
  const saveResultAsDraft = async () => {
    setCloseConfirmVisible(false);
    await handleSaveDraft();
    draftOriginalRef.current = null;
    setResultVisible(false);
  };

  // テンプレートを作成画面に読み込む（編集して再利用できる）
  const applyTemplate = (t: PostTemplate) => {
    setType(t.type);
    setCaption(t.caption);
    setHashtagsText(t.hashtags.join(' '));
    if (t.type === 'feed' && t.image_url) {
      setImageUrl(t.image_url);
      setImageUrls([t.image_url]);
      setImagePreview(t.image_url);
      setFeedPreviews([t.image_url]);
    }
    setTemplatePickerVisible(false);
  };

  const handleDeleteTemplate = (id: string) => {
    const run = async () => {
      try {
        setTemplates(await deleteTemplate(id));
      } catch {
        alertMsg('削除に失敗しました');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('このテンプレートを削除しますか？')) run();
    } else {
      Alert.alert('削除', 'テンプレートを削除しますか？', [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: run },
      ]);
    }
  };

  // 今すぐInstagramに投稿（テスト/手動投稿）
  const handlePublishNow = async () => {
    const isStory = type === 'story';
    if (type === 'feed' && !caption.trim()) {
      alertMsg('キャプションを入力してください', '入力に不備があります');
      return;
    }
    if (isStory) {
      if (!storyMediaType) {
        alertMsg('写真または動画を選んでください', 'メディアが必要です');
        return;
      }
    } else if (!imageUrl.trim()) {
      alertMsg('写真を選んでください', '画像が必要です');
      return;
    }
    if (!instagramCredentials?.userId || !instagramCredentials?.accessToken) {
      alertMsg('右上のアイコンからInstagramを連携してください', '未連携です');
      return;
    }
    if (!(await ensureLoggedIn('投稿するにはログインが必要です'))) return;

    const confirmMsg = `@${instagramCredentials.username ?? ''} に今すぐ投稿します。よろしいですか？`;
    if (Platform.OS === 'web' && !window.confirm(confirmMsg)) return;

    setPublishing(true);
    try {
      const storyMedia = isStory ? await uploadStoryMedia() : null;
      const result = await publishNow({
        caption: caption.trim(),
        hashtags: buildHashtags(),
        image_url: isStory ? (storyMedia!.isVideo ? undefined : storyMedia!.url) : imageUrl.trim(),
        image_urls: type === 'feed' && imageUrls.length > 1 ? imageUrls : undefined,
        video_url: isStory && storyMedia!.isVideo ? storyMedia!.url : undefined,
        type,
        instagram_user_id: instagramCredentials.userId,
        access_token: instagramCredentials.accessToken,
        user_tags: type === 'feed' && userTags.length > 0 ? userTags : undefined,
        product_tags: type === 'feed' && productTags.length > 0 ? productTags : undefined,
        location_id: type === 'feed' && locationId.trim() ? locationId.trim() : undefined,
      });
      // 投稿履歴として記録（status:'published'。pendingではないので無料の予約2件制限には当たらない）
      try {
        await createScheduledPost({
          caption: caption.trim(),
          hashtags: buildHashtags(),
          image_url: isStory
            ? storyMedia!.url
            : type === 'feed' && imageUrls.length > 1
              ? imageUrls.join('\n')
              : imageUrl.trim() || undefined,
          scheduled_at: new Date(),
          type,
          status: 'published',
          instagram_user_id: instagramCredentials.userId,
          access_token: instagramCredentials.accessToken,
        });
        await finishDraftEdit();
        await fetchPosts();
      } catch {
        // 履歴の記録に失敗しても投稿自体は成功しているので、続行する
      }
      clearDraft();
      setResultVisible(false);
      setModalVisible(false);
      const kind = result.posted_type === 'story' ? 'ストーリー' : 'フィード';
      const ok = `投稿しました（${kind}として投稿）\nInstagramアプリで確認してください`;
      if (Platform.OS === 'web') window.alert(ok);
      else Alert.alert('投稿完了', `${kind}として投稿しました。Instagramで確認してください`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '投稿に失敗しました';
      if (Platform.OS === 'web') window.alert('投稿失敗\n' + msg);
      else Alert.alert('投稿失敗', msg);
    } finally {
      setPublishing(false);
    }
  };

  const handleSave = async () => {
    const isStory = type === 'story';
    if (type === 'feed' && !caption.trim()) {
      alertMsg('キャプションを入力してください', '入力に不備があります');
      return;
    }
    if (isStory) {
      if (!storyMediaType) {
        alertMsg('写真または動画を選んでください', 'メディアが必要です');
        return;
      }
    } else if (!imageUrl.trim()) {
      alertMsg('写真を選んでください', '画像が必要です');
      return;
    }
    if (!dateText.trim()) {
      alertMsg('予約日時を選んでください（おすすめ時間帯から選べます）', '日時が未入力です');
      return;
    }
    const scheduledDate = parseDate(dateText);
    if (!scheduledDate) {
      alertMsg('日時の形式が正しくありません\n例: 2026-06-15T18:00', '入力に不備があります');
      return;
    }
    if (scheduledDate <= new Date()) {
      alertMsg('予約日時は未来の日時を指定してください', '入力に不備があります');
      return;
    }
    if (!(await ensureLoggedIn('予約投稿を保存するにはログインが必要です'))) return;

    setSaving(true);
    try {
      // ストーリーは合成して image_url に保存（動画URLでも可、Edge側で判定）
      const storyMedia = isStory ? await uploadStoryMedia() : null;
      await createScheduledPost({
        caption: caption.trim(),
        hashtags: buildHashtags(),
        // フィードで複数枚なら改行区切りで保存（カルーセル）
        image_url: isStory
          ? storyMedia!.url
          : type === 'feed' && imageUrls.length > 1
            ? imageUrls.join('\n')
            : imageUrl.trim() || undefined,
        scheduled_at: scheduledDate,
        type,
        repeat,
        instagram_user_id: instagramCredentials?.userId || undefined,
        access_token: instagramCredentials?.accessToken || undefined,
        user_tags: type === 'feed' && userTags.length > 0 ? userTags : undefined,
        product_tags: type === 'feed' && productTags.length > 0 ? productTags : undefined,
        location_id: type === 'feed' && locationId.trim() ? locationId.trim() : undefined,
      });
      await finishDraftEdit();
      clearDraft();
      scheduleFromResult.current = false;
      setScheduleModalVisible(false);
      setResultVisible(false);
      setModalVisible(false);
      await fetchPosts();
    } catch (e) {
      // DB側の制限（無料は2件まで等）のメッセージをそのまま表示
      // ※ Supabaseのエラーは Error 型ではなく { message } 形式なので message を直接取り出す
      const msg =
        (e as { message?: string })?.message ||
        (typeof e === 'string' ? e : '保存に失敗しました');
      alertMsg(msg, '保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  // 下書き保存：日時を決めずに内容だけ保存しておく（自動投稿の対象外）
  // 下書きはキャプション未入力でも保存OK（写真だけ先に保存しておける）
  const handleSaveDraft = async () => {
    const isStory = type === 'story';
    if (isStory) {
      if (!storyMediaType) {
        alertMsg('写真または動画を選んでください', 'メディアが必要です');
        return;
      }
    } else if (!imageUrl.trim()) {
      alertMsg('写真を選んでください', '画像が必要です');
      return;
    }
    if (!(await ensureLoggedIn('下書きを保存するにはログインが必要です'))) return;

    setSavingDraft(true);
    try {
      const storyMedia = isStory ? await uploadStoryMedia() : null;
      await createScheduledPost({
        caption: caption.trim(),
        hashtags: buildHashtags(),
        image_url: isStory
          ? storyMedia!.url
          : type === 'feed' && imageUrls.length > 1
            ? imageUrls.join('\n')
            : imageUrl.trim() || undefined,
        scheduled_at: new Date(), // 仮の日時（下書きなので投稿はされない）
        type,
        repeat,
        status: 'draft',
        instagram_user_id: instagramCredentials?.userId || undefined,
        access_token: instagramCredentials?.accessToken || undefined,
        user_tags: type === 'feed' && userTags.length > 0 ? userTags : undefined,
        product_tags: type === 'feed' && productTags.length > 0 ? productTags : undefined,
        location_id: type === 'feed' && locationId.trim() ? locationId.trim() : undefined,
      });
      await finishDraftEdit();
      clearDraft();
      setModalVisible(false);
      setFilter('draft');
      await fetchPosts();
      alertMsg('下書きに保存しました。「下書き」タブから予約できます', '保存しました');
    } catch (e) {
      const msg =
        (e as { message?: string })?.message ||
        (typeof e === 'string' ? e : '保存に失敗しました');
      alertMsg(msg, '保存できませんでした');
    } finally {
      setSavingDraft(false);
    }
  };

  // 下書き → 予約に変換（編集画面で日時を決めて保存）
  const openScheduleDraft = (post: ScheduledPost) => {
    setEditDuplicateSource(null);
    setEditingPost(post);
    setEditCaption(post.caption ?? '');
    setEditHashtags((post.hashtags ?? []).join(' '));
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    setEditDate(toLocalInput(d.toISOString()));
    setEditRepeat(post.repeat ?? 'none');
    setEditPublishDraft(true);
    setEditVisible(true);
  };

  const doDelete = async (id: string) => {
    try {
      await deleteScheduledPost(id);
      setPosts((prev) => prev.filter((p) => p.id !== id));
    } catch {
      alertMsg('削除に失敗しました');
    }
  };

  const handleDelete = (id: string) => {
    if (Platform.OS === 'web') {
      if (window.confirm('この予約を削除しますか？')) doDelete(id);
    } else {
      Alert.alert('削除', '予約を削除しますか？', [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: () => doDelete(id) },
      ]);
    }
  };

  // 結果画面で下書きを編集中だった場合、元の下書きを削除する（保存・投稿の成功後に呼ぶ）
  const finishDraftEdit = async () => {
    if (editingDraftId.current) {
      await deleteScheduledPost(editingDraftId.current).catch(() => {});
      editingDraftId.current = null;
    }
  };

  // 下書きを「生成結果画面」で開いて編集する
  const openEditDraftInResult = (post: ScheduledPost) => {
    const urls = post.image_url?.includes('\n')
      ? post.image_url.split('\n').filter(Boolean)
      : post.image_url ? [post.image_url] : [];
    setCaption(post.caption ?? '');
    setHashtagsText((post.hashtags ?? []).join(' '));
    setType('feed');
    setImageUrl(urls[0] ?? '');
    setImageUrls(urls);
    setFeedPreviews(urls);
    setImagePreview(urls[0] ?? '');
    setAiInstruction('');
    setUserTags((post as { user_tags?: string[] }).user_tags ?? []);
    setProductTags((post as { product_tags?: string[] }).product_tags ?? []);
    setLocationId((post as { location_id?: string }).location_id ?? '');
    editingDraftId.current = post.id;
    // 変更検知用に開始時の内容を記録
    draftOriginalRef.current = JSON.stringify({
      caption: post.caption ?? '',
      tags: (post.hashtags ?? []).join(' '),
      images: urls.join('\n'),
    });
    setDetailPost(null);
    setResultVisible(true);
  };

  // 生成結果画面で写真を追加する（トリミング編集を経て追記）
  const addFeedImages = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.9,
    });
    if (res.canceled) return;
    // 既存の写真と新しく選んだ写真をまとめて調整画面へ（置き換え）。追加分を選択状態で開く
    cropAppendRef.current = false;
    cropReturnRef.current = 'result';
    setResultVisible(false);
    setCropInitialIndex(feedPreviews.length); // 最初の追加写真を選択
    setCropRawImages([...feedPreviews, ...res.assets.map((a) => a.uri)]);
    setCropVisible(true);
  };

  // 選択済みの写真を再調整する（元画像があればそれ、無ければ現在の画像から）
  const reAdjustImages = () => {
    const src = cropRawImages.length > 0 ? cropRawImages : feedPreviews;
    if (src.length === 0) return;
    cropAppendRef.current = false;
    cropReturnRef.current = 'create';
    setCropInitialIndex(0);
    setCropRawImages(src);
    setModalVisible(false);
    setCropVisible(true);
  };

  // 生成結果画面で、現在の画像を調整し直す（下書き編集時など）
  const reAdjustResultImages = () => {
    if (feedPreviews.length === 0) return;
    cropAppendRef.current = false;
    cropReturnRef.current = 'result';
    setCropInitialIndex(0);
    setResultVisible(false);
    setCropRawImages(feedPreviews);
    setCropVisible(true);
  };

  // トリミング編集を閉じて、元のモーダルに戻す
  const restoreFromCrop = () => {
    if (cropReturnRef.current === 'create') setModalVisible(true);
    else if (cropReturnRef.current === 'result') setResultVisible(true);
    cropReturnRef.current = null;
  };

  const handleCropCancel = () => {
    setCropVisible(false);
    cropAppendRef.current = false;
    restoreFromCrop();
  };

  // トリミング編集の完了：合成画像をアップロードして反映し、生成画面（ステップ2）へ
  const handleCropDone = async (results: { blob: Blob; previewUrl: string }[]) => {
    setCropVisible(false);
    // 追記でなく新規の写真選択なら、下書き編集の変更検知をリセット
    if (!cropAppendRef.current) draftOriginalRef.current = null;
    cropReturnRef.current = null;
    setModalVisible(false);
    setResultVisible(true); // 写真調整 → キャプション/生成画面へ直行
    setImageUploading(true);
    try {
      const urls: string[] = [];
      for (const r of results) urls.push(await uploadBlob(r.blob));
      const previews = results.map((r) => r.previewUrl);
      if (cropAppendRef.current) {
        setFeedPreviews((p) => [...p, ...previews]);
        setImageUrls((p) => {
          const merged = [...p, ...urls];
          setImageUrl(merged[0]);
          return merged;
        });
      } else {
        setFeedPreviews(previews);
        setImagePreview(previews[0] ?? '');
        setImageUrls(urls);
        setImageUrl(urls[0] ?? '');
      }
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '画像アップロードに失敗しました');
    } finally {
      setImageUploading(false);
      cropAppendRef.current = false;
    }
  };

  // 生成結果画面で写真を1枚削除する
  const removeFeedImage = (index: number) => {
    setFeedPreviews((p) => p.filter((_, i) => i !== index));
    setImageUrls((p) => {
      const next = p.filter((_, i) => i !== index);
      setImageUrl(next[0] ?? '');
      return next;
    });
  };

  // 複製：投稿作成モーダルに内容を引き継いで開く
  const openDuplicate = (post: ScheduledPost) => {
    const urls = post.image_url?.includes('\n')
      ? post.image_url.split('\n').filter(Boolean)
      : post.image_url ? [post.image_url] : [];
    setCaption(post.caption ?? '');
    setHashtagsText((post.hashtags ?? []).join(' '));
    setType((post.type === 'reel' ? 'feed' : post.type) as 'feed' | 'story');
    setImageUrl(urls[0] ?? '');
    setImageUrls(urls);
    setFeedPreviews(urls);
    setImagePreview(urls[0] ?? '');
    setDateText('');
    setStoryRawUri('');
    setStoryMode('image');
    setStoryMediaType('');
    setStoryImageUri('');
    setStoryVideoUri('');
    setStoryVideoBlob(null);
    setStoryVideoText('');
    setStoryVideoTheme('');
    setStoryVideoTextXY({ x: 0.5, y: 0.85 });
    setStoryVideoTextScale(1);
    setStoryTheme('');
    setFeedTheme('');
    setAiInstruction('');
    setStoryDetails('');
    setStoryTitle('');
    setStoryBody('');
    setStoryCta('');
    setStoryTextColor('#FFFFFF');
    setStoryTransform({ ...DEFAULT_TRANSFORM });
    setRepeat('none');
    setScheduleModalVisible(false);
    if (scheduleFromResult.current) {
      scheduleFromResult.current = false;
      setResultVisible(true);
    } else {
      setModalVisible(true);
    }
  };

  const openEdit = (post: ScheduledPost) => {
    setEditDuplicateSource(null);
    setEditPublishDraft(false);
    setEditingPost(post);
    setEditCaption(post.caption ?? '');
    setEditHashtags((post.hashtags ?? []).join(' '));
    // 下書きは日時が仮なので、明日を初期値にしておく
    if (post.status === 'draft') {
      setEditDate(toLocalInput(new Date(Date.now() + 24 * 3600 * 1000).toISOString()));
    } else {
      setEditDate(toLocalInput(post.scheduled_at));
    }
    setEditRepeat(post.repeat ?? 'none');
    setEditVisible(true);
  };

  const saveEdit = async () => {
    if (!editingPost && !editDuplicateSource) return;
    const date = parseDate(editDate);
    if (!date) {
      alertMsg('日時の形式が正しくありません\n例: 2026-06-15T18:00', '入力に不備があります');
      return;
    }
    if (date <= new Date()) {
      alertMsg('予約日時は未来の日時を指定してください', '入力に不備があります');
      return;
    }
    const hashtags = editHashtags.split(/[\s,　]+/).map((h) => h.trim()).filter(Boolean);
    setEditSaving(true);
    try {
      if (editDuplicateSource) {
        // 複製：同じ内容で新しい予約を作成（メディアはアップロード済みURLを再利用）
        const src = editDuplicateSource;
        await createScheduledPost({
          caption: editCaption.trim(),
          hashtags,
          image_url: src.image_url ?? undefined,
          scheduled_at: date,
          type: src.type,
          repeat: editRepeat,
          instagram_user_id: src.instagram_user_id ?? undefined,
          access_token: src.access_token ?? undefined,
        });
      } else if (editingPost) {
        await updateScheduledPost(editingPost.id, {
          caption: editCaption.trim(),
          hashtags,
          scheduled_at: date,
          repeat: editRepeat,
          // 下書きを予約に変換するときは status を pending に
          ...(editPublishDraft ? { status: 'pending' as const } : {}),
        });
      }
      setEditVisible(false);
      setEditingPost(null);
      setEditDuplicateSource(null);
      setEditPublishDraft(false);
      await fetchPosts();
    } catch (e) {
      alertMsg((e as { message?: string })?.message || '更新に失敗しました', '保存できませんでした');
    } finally {
      setEditSaving(false);
    }
  };

  const editSelectRepeat = (r: RepeatOption) => {
    if (r !== 'none' && !canRecurring(plan)) {
      alertMsg('くりかえし投稿はProプラン限定です', 'Pro限定の機能です');
      return;
    }
    setEditRepeat(r);
  };

  const filtered = posts.filter((p) => filter === 'all' || p.status === filter);

  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 日付ごとに予約をまとめる（カレンダー用）
  const postsByDay: Record<string, ScheduledPost[]> = {};
  for (const p of posts) {
    const k = dayKey(new Date(p.scheduled_at));
    (postsByDay[k] ||= []).push(p);
  }
  const calY = calMonth.getFullYear();
  const calMo = calMonth.getMonth();
  const calFirstWd = new Date(calY, calMo, 1).getDay();
  const calDays = new Date(calY, calMo + 1, 0).getDate();
  const calCells: (number | null)[] = [
    ...Array(calFirstWd).fill(null),
    ...Array.from({ length: calDays }, (_, i) => i + 1),
  ];
  const todayKey = dayKey(new Date());

  const renderPostCard = (post: ScheduledPost) => (
    <TouchableOpacity key={post.id} style={styles.postCard} onPress={() => setDetailPost(post)} activeOpacity={0.85}>
      <View style={styles.postHeader}>
        <View style={styles.postMeta}>
          <View style={[styles.typeBadge, post.type !== 'feed' && styles.typeBadgeStory]}>
            <Text style={styles.typeBadgeText}>
              {post.type === 'feed' ? 'フィード' : post.type === 'reel' ? 'リール' : 'ストーリー'}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              post.status === 'published' && styles.statusPublished,
              post.status === 'failed' && styles.statusFailed,
            ]}
          >
            <Text style={styles.statusText}>
              {post.status === 'draft'
                ? '下書き'
                : post.status === 'pending'
                ? '予約中'
                : post.status === 'published'
                ? '投稿済'
                : '失敗'}
            </Text>
          </View>
          {post.repeat && post.repeat !== 'none' && (
            <View style={styles.repeatBadge}>
              <Text style={styles.repeatBadgeText}>{REPEAT_SHORT[post.repeat]}</Text>
            </View>
          )}
        </View>
        <View style={styles.cardActions}>
          {post.status === 'draft' ? (
            // 下書きカードはゴミ箱のみ（その他の操作はタップして詳細から）
            <TouchableOpacity onPress={() => handleDelete(post.id)} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity onPress={() => openDuplicate(post)} hitSlop={8}>
                <Ionicons name="copy-outline" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
              {post.status === 'pending' && (
                <TouchableOpacity onPress={() => openEdit(post)} hitSlop={8}>
                  <Ionicons name="pencil-outline" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => handleDelete(post.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <Text style={styles.postCaption} numberOfLines={2}>
        {post.caption}
      </Text>
      {post.hashtags?.length > 0 && (
        <Text style={styles.postHashtags} numberOfLines={1}>
          {post.hashtags.join(' ')}
        </Text>
      )}

      <View style={styles.postFooter}>
        <Text style={styles.scheduleTime}>
          {post.status === 'draft' ? '日時未定（予約から設定）' : formatDate(post.scheduled_at)}
        </Text>
      </View>
    </TouchableOpacity>
  );

  // 投稿タブのサブ画面（リール／本日の出勤）
  if (nowSub === 'reel') {
    return <ReelScreen onBack={() => setNowSub('menu')} />;
  }
  if (nowSub === 'roster') {
    return <RosterScreen onBack={() => setNowSub('menu')} />;
  }

  return (
    <View style={styles.wrapper}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 100 }}
      >
        <View style={styles.header}>
          <Text style={styles.title}>投稿</Text>
          <TouchableOpacity style={styles.addBtn} onPress={startNewPost}>
            <Text style={styles.addBtnText}>＋ 投稿を作成</Text>
          </TouchableOpacity>
        </View>

        {/* 何を作るか選ぶ */}
        <View style={styles.createMenu}>
          <Text style={styles.createMenuTitle}>何を投稿しますか？</Text>
          <View style={styles.createMenuRow}>
            <TouchableOpacity style={styles.createMenuBtn} onPress={openModal} activeOpacity={0.85}>
              <Ionicons name="image-outline" size={22} color={COLORS.text} style={styles.createMenuEmoji} />
              <Text style={styles.createMenuLabel}>フィード・ストーリー</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.createMenuBtn}
              onPress={() => setNowSub('reel')}
              activeOpacity={0.85}
            >
              <Ionicons name="film-outline" size={22} color={COLORS.text} style={styles.createMenuEmoji} />
              <Text style={styles.createMenuLabel}>リール</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Japan best time hint */}
        <View style={styles.hintCard}>
          <Text style={styles.hintText}>
            最適な投稿時間: 平日18〜21時・12〜13時 ／ 休日11〜13時・19〜21時
          </Text>
        </View>

        {/* 表示切替：リスト / カレンダー */}
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterTab, calView === 'list' && styles.filterTabActive]}
            onPress={() => setCalView('list')}
          >
            <Text style={[styles.filterText, calView === 'list' && styles.filterTextActive]}>リスト</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, calView === 'calendar' && styles.filterTabActive]}
            onPress={() => setCalView('calendar')}
          >
            <Text style={[styles.filterText, calView === 'calendar' && styles.filterTextActive]}>
              カレンダー
            </Text>
          </TouchableOpacity>
        </View>

        {calView === 'list' ? (
          <>
            <View style={styles.filterRow}>
              {(['all', 'draft', 'pending', 'published', 'failed'] as Filter[]).map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterTab, filter === f && styles.filterTabActive]}
                  onPress={() => setFilter(f)}
                >
                  <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                    {f === 'all' ? 'すべて' : f === 'draft' ? '下書き' : f === 'pending' ? '予約中' : f === 'published' ? '投稿済' : '失敗'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {loading ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginTop: 60 }} />
            ) : filtered.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>まだ投稿がありません</Text>
                <Text style={styles.emptyDesc}>今すぐ投稿も、予約投稿もここに履歴として残ります</Text>
                <TouchableOpacity style={styles.emptyAddBtn} onPress={startNewPost}>
                  <Text style={styles.emptyAddBtnText}>＋ 最初の投稿を作成する</Text>
                </TouchableOpacity>
              </View>
            ) : (
              filtered.map(renderPostCard)
            )}
          </>
        ) : (
          <>
            <View style={styles.calHeader}>
              <TouchableOpacity onPress={() => setCalMonth(new Date(calY, calMo - 1, 1))} hitSlop={10}>
                <Text style={styles.calNav}>◀</Text>
              </TouchableOpacity>
              <Text style={styles.calTitle}>
                {calY}年{calMo + 1}月
              </Text>
              <TouchableOpacity onPress={() => setCalMonth(new Date(calY, calMo + 1, 1))} hitSlop={10}>
                <Text style={styles.calNav}>▶</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.calWeekRow}>
              {['日', '月', '火', '水', '木', '金', '土'].map((w) => (
                <Text key={w} style={styles.calWeekday}>
                  {w}
                </Text>
              ))}
            </View>
            <View style={styles.calGrid}>
              {calCells.map((cell, i) => {
                if (cell === null) return <View key={`b${i}`} style={styles.calCell} />;
                const key = dayKey(new Date(calY, calMo, cell));
                const cnt = (postsByDay[key] || []).length;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.calCell,
                      key === todayKey && styles.calCellToday,
                      calSelected === key && styles.calCellSelected,
                    ]}
                    onPress={() => setCalSelected(key)}
                  >
                    <Text style={styles.calDayNum}>{cell}</Text>
                    {cnt > 0 && (
                      <View style={styles.calDotRow}>
                        {STATUS_ORDER.map((st) => {
                          const c = (postsByDay[key] || []).filter((p) => p.status === st).length;
                          if (c === 0) return null;
                          return (
                            <View
                              key={st}
                              style={[styles.calStatusDot, { backgroundColor: STATUS_COLORS[st] }]}
                            >
                              <Text style={styles.calStatusDotText}>{c}</Text>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 色の凡例 */}
            <View style={styles.calLegend}>
              {STATUS_ORDER.map((st) => (
                <View key={st} style={styles.calLegendItem}>
                  <View style={[styles.calLegendDot, { backgroundColor: STATUS_COLORS[st] }]} />
                  <Text style={styles.calLegendText}>{STATUS_LABELS[st]}</Text>
                </View>
              ))}
            </View>

            {calSelected ? (
              <>
                <Text style={styles.calSelTitle}>{calSelected.replace(/-/g, '/')} の投稿</Text>
                {(postsByDay[calSelected] || []).length === 0 ? (
                  <Text style={styles.calHint}>この日の投稿はありません</Text>
                ) : (
                  (postsByDay[calSelected] || []).map(renderPostCard)
                )}
              </>
            ) : (
              <Text style={styles.calHint}>日付をタップするとその日の予約が見られます</Text>
            )}
          </>
        )}
      </ScrollView>

      {/* 写真トリミング編集（選択→調整→AI生成） */}
      <FeedCropEditor
        visible={cropVisible}
        images={cropRawImages}
        initialIndex={cropInitialIndex}
        onCancel={handleCropCancel}
        onDone={handleCropDone}
      />

      {/* AI画像生成チャット */}
      <ImageGenChat
        visible={imgChatVisible}
        onClose={() => { setImgChatVisible(false); if (!imgChatFromHome.current) setModalVisible(true); imgChatFromHome.current = false; }}
        onUseImage={handleUseGeneratedImage}
      />

      {/* AI生成結果モーダル */}
      <Modal visible={resultVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => handleResultClose()}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={handleResultClose}>
              <Text style={styles.modalCancel}>キャンセル</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>投稿を作成</Text>
            <View style={{ width: 70 }} />
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
            {/* 画像プレビュー（Instagram風スライド） */}
            {feedPreviews.length > 0 && (
              <View
                style={{ marginBottom: SPACING.sm }}
                onLayout={(e) => {
                  const w = e.nativeEvent.layout.width;
                  if (w > 0 && w !== rCarW) setRCarW(w);
                }}
              >
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  scrollEventThrottle={16}
                  onScroll={(e) => {
                    const w = rCarW || e.nativeEvent.layoutMeasurement.width;
                    if (w > 0) {
                      const idx = Math.round(e.nativeEvent.contentOffset.x / w);
                      if (idx !== rCarIdx) setRCarIdx(idx);
                    }
                  }}
                >
                  {feedPreviews.map((uri, i) => (
                    <View key={i} style={{ width: rCarW || Dimensions.get('window').width - SPACING.md * 2 }}>
                      <Image
                        source={{ uri }}
                        style={{ width: '100%', aspectRatio: 1, borderRadius: RADIUS.md }}
                        resizeMode="cover"
                      />
                      <TouchableOpacity style={styles.carouselRemove} onPress={() => removeFeedImage(i)} hitSlop={8}>
                        <Text style={styles.carouselRemoveText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
                {feedPreviews.length > 1 && (
                  <>
                    <View style={styles.carouselCounter}>
                      <Text style={styles.carouselCounterText}>{rCarIdx + 1}/{feedPreviews.length}</Text>
                    </View>
                    <View style={styles.carouselDots}>
                      {feedPreviews.map((_, i) => (
                        <View key={i} style={[styles.carouselDot, i === rCarIdx && styles.carouselDotActive]} />
                      ))}
                    </View>
                  </>
                )}
              </View>
            )}
            {/* 写真の追加 */}
            <TouchableOpacity
              style={[styles.aiBtnGhost, { marginBottom: SPACING.md }, imageUploading && styles.publishNowBtnDisabled]}
              onPress={addFeedImages}
              disabled={imageUploading}
              activeOpacity={0.85}
            >
              {imageUploading ? (
                <ActivityIndicator color={COLORS.secondary} />
              ) : (
                <Text style={styles.aiBtnGhostText}>{feedPreviews.length > 0 ? '＋ 写真を追加' : '写真を選ぶ'}</Text>
              )}
            </TouchableOpacity>
            {feedPreviews.length > 0 && (
              <TouchableOpacity
                style={[styles.aiBtnGhost, { marginBottom: SPACING.md }, imageUploading && styles.publishNowBtnDisabled]}
                onPress={reAdjustResultImages}
                disabled={imageUploading}
                activeOpacity={0.85}
              >
                <Text style={styles.aiBtnGhostText}>写真を調整する</Text>
              </TouchableOpacity>
            )}

            {/* AIでキャプションを生成 */}
            <Text style={styles.sectionDivider}>AIでキャプションを作る</Text>
            <Text style={styles.fieldLabel}>テーマ（任意）</Text>
            <TextInput
              style={styles.input}
              value={feedTheme}
              onChangeText={setFeedTheme}
              placeholder="例: 夏の新メニュー紹介、週末セールのお知らせ"
              placeholderTextColor={COLORS.textMuted}
            />
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
              {feedPreviews.length > 0 && (
                <TouchableOpacity
                  style={[styles.aiBtn, { flex: 1 }, aiLoading && styles.publishNowBtnDisabled]}
                  onPress={handleGenerateFeedFromPhoto}
                  disabled={aiLoading}
                  activeOpacity={0.85}
                >
                  {aiLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.aiBtnText}>写真から生成</Text>}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.aiBtn, { flex: 1, backgroundColor: COLORS.secondary }, aiLoading && styles.publishNowBtnDisabled]}
                onPress={handleGenerateFeedText}
                disabled={aiLoading}
                activeOpacity={0.85}
              >
                {aiLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.aiBtnText}>テーマから生成</Text>}
              </TouchableOpacity>
            </View>

            {/* AIへの指示で書き直す */}
            <Text style={[styles.fieldLabel, { marginTop: SPACING.md }]}>AIへの指示で書き直す（任意）</Text>
            <TextInput
              style={[styles.input, styles.aiInstructionInput]}
              value={aiInstruction}
              onChangeText={setAiInstruction}
              placeholder={'例: もっとカジュアルに\n絵文字多めで\n短く3行で'}
              placeholderTextColor={COLORS.textMuted}
              multiline
            />
            <TouchableOpacity
              style={[styles.aiBtnGhost, { marginBottom: SPACING.md }, aiLoading && styles.publishNowBtnDisabled]}
              onPress={handleRefineCaption}
              disabled={aiLoading}
              activeOpacity={0.85}
            >
              {aiLoading ? (
                <ActivityIndicator color={COLORS.secondary} />
              ) : (
                <Text style={styles.aiBtnGhostText}>指示で書き直す</Text>
              )}
            </TouchableOpacity>

            {/* キャプション（広めの入力欄） */}
            <Text style={styles.fieldLabel}>キャプション</Text>
            <TextInput
              style={[styles.input, { height: 440, textAlignVertical: 'top', fontSize: 15, lineHeight: 22 }]}
              value={caption}
              onChangeText={setCaption}
              placeholder="キャプションを入力"
              placeholderTextColor={COLORS.textMuted}
              multiline
            />

            {/* ハッシュタグ */}
            <Text style={[styles.fieldLabel, { marginTop: SPACING.md }]}>ハッシュタグ（{feedTags.length}/{MAX_TAGS}）</Text>
            <View style={styles.tagWrap}>
              {feedTags.map((tag, i) => (
                <View key={`${tag}-${i}`} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>{tag}</Text>
                  <TouchableOpacity onPress={() => removeFeedTag(i)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                    <Text style={styles.tagChipRemove}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {feedTags.length === 0 && <Text style={styles.tagEmpty}>ハッシュタグなし</Text>}
            </View>
            <View style={styles.tagAddRow}>
              <TextInput
                style={styles.tagInput}
                value={newFeedTag}
                onChangeText={setNewFeedTag}
                onSubmitEditing={addFeedTag}
                placeholder="#タグを追加"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                returnKeyType="done"
              />
              <TouchableOpacity style={styles.tagAddBtn} onPress={addFeedTag}>
                <Text style={styles.tagAddBtnText}>追加</Text>
              </TouchableOpacity>
            </View>

            {/* タグ・場所（フィードのみ） */}
            <Text style={[styles.sectionDivider, { marginTop: SPACING.lg }]}>タグ・場所（任意）</Text>

            <Text style={styles.fieldLabel}>アカウントをタグ付け</Text>
            <View style={styles.tagWrap}>
              {userTags.map((u, i) => (
                <View key={`${u}-${i}`} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>@{u}</Text>
                  <TouchableOpacity onPress={() => setUserTags(userTags.filter((_, j) => j !== i))} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                    <Text style={styles.tagChipRemove}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {userTags.length === 0 && <Text style={styles.tagEmpty}>なし</Text>}
            </View>
            <View style={styles.tagAddRow}>
              <TextInput
                style={styles.tagInput}
                value={newUserTag}
                onChangeText={setNewUserTag}
                onSubmitEditing={() => { const v = newUserTag.replace(/^@/, '').trim(); if (v) { setUserTags([...userTags, v]); setNewUserTag(''); } }}
                placeholder="ユーザー名（@なし）"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                returnKeyType="done"
              />
              <TouchableOpacity style={styles.tagAddBtn} onPress={() => { const v = newUserTag.replace(/^@/, '').trim(); if (v) { setUserTags([...userTags, v]); setNewUserTag(''); } }}>
                <Text style={styles.tagAddBtnText}>追加</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { marginTop: SPACING.md }]}>場所ID（Facebook Place ID）</Text>
            <TextInput
              style={styles.input}
              value={locationId}
              onChangeText={setLocationId}
              placeholder="例: 123456789012345"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="number-pad"
            />

            <Text style={[styles.fieldLabel, { marginTop: SPACING.md }]}>商品タグ（商品ID・要ショッピング設定）</Text>
            <View style={styles.tagWrap}>
              {productTags.map((p, i) => (
                <View key={`${p}-${i}`} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>{p}</Text>
                  <TouchableOpacity onPress={() => setProductTags(productTags.filter((_, j) => j !== i))} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                    <Text style={styles.tagChipRemove}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {productTags.length === 0 && <Text style={styles.tagEmpty}>なし</Text>}
            </View>
            <View style={styles.tagAddRow}>
              <TextInput
                style={styles.tagInput}
                value={newProductTag}
                onChangeText={setNewProductTag}
                onSubmitEditing={() => { const v = newProductTag.trim(); if (v) { setProductTags([...productTags, v]); setNewProductTag(''); } }}
                placeholder="商品ID"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                returnKeyType="done"
              />
              <TouchableOpacity style={styles.tagAddBtn} onPress={() => { const v = newProductTag.trim(); if (v) { setProductTags([...productTags, v]); setNewProductTag(''); } }}>
                <Text style={styles.tagAddBtnText}>追加</Text>
              </TouchableOpacity>
            </View>

            {/* 投稿方法 */}
            <Text style={[styles.sectionDivider, { marginTop: SPACING.lg }]}>投稿方法を選ぶ</Text>

            <TouchableOpacity
              style={[styles.publishNowBtn, { marginTop: SPACING.sm }, (publishing || !imageUrl) && styles.publishNowBtnDisabled]}
              onPress={async () => { await handlePublishNow(); setResultVisible(false); }}
              disabled={publishing || !imageUrl}
              activeOpacity={0.85}
            >
              {publishing ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishNowText}>今すぐ投稿する</Text>}
            </TouchableOpacity>
            {!imageUrl && <Text style={styles.aiHintText}>※ 写真を選ぶと今すぐ投稿できます</Text>}

            <TouchableOpacity
              style={[styles.aiBtn, { marginTop: SPACING.sm, backgroundColor: '#F77737' }]}
              onPress={() => { scheduleFromResult.current = true; setScheduleModalVisible(true); }}
              activeOpacity={0.85}
            >
              <Text style={styles.aiBtnText}>予約する</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.draftSaveBtn, { marginTop: SPACING.sm }]}
              onPress={async () => { await handleSaveDraft(); }}
              disabled={savingDraft}
              activeOpacity={0.85}
            >
              {savingDraft ? <ActivityIndicator color={COLORS.textSecondary} /> : <Text style={styles.draftSaveBtnText}>下書き保存</Text>}
            </TouchableOpacity>

            <Text style={[styles.sectionDivider, { marginTop: SPACING.lg }]}>テンプレート</Text>
            <TouchableOpacity
              style={[styles.templateSaveBtn, savingTemplate && styles.publishNowBtnDisabled]}
              onPress={handleSaveTemplate}
              disabled={savingTemplate}
              activeOpacity={0.85}
            >
              {savingTemplate ? <ActivityIndicator color={COLORS.secondary} /> : <Text style={styles.templateSaveText}>テンプレートとして保存</Text>}
            </TouchableOpacity>
            <Text style={styles.publishNowHint}>
              ※ 文章・ハッシュタグ・画像をこの端末に保存して、次回そのまま使い回せます
            </Text>

          </ScrollView>

          {/* キャンセル時の下書き保存確認（生成画面の内側オーバーレイ） */}
          {closeConfirmVisible && (
            <View style={styles.confirmOverlay}>
              <View style={styles.confirmCard}>
                <Text style={styles.confirmTitle}>内容は破棄されます</Text>
                <Text style={styles.confirmDesc}>下書きとして保存しますか？</Text>
                <TouchableOpacity style={styles.confirmYes} onPress={saveResultAsDraft} activeOpacity={0.85}>
                  <Text style={styles.confirmYesText}>はい（下書き保存）</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmNo} onPress={discardResult} activeOpacity={0.85}>
                  <Text style={styles.confirmNoText}>いいえ（保存せず閉じる）</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmCancel} onPress={() => setCloseConfirmVisible(false)} activeOpacity={0.7}>
                  <Text style={styles.confirmCancelText}>キャンセル</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* 詳細モーダル */}
      <Modal visible={!!detailPost} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailPost(null)}>
        {detailPost && (
          <View style={{ flex: 1, backgroundColor: COLORS.background }}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setDetailPost(null)}>
                <Text style={styles.modalCancel}>閉じる</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>投稿詳細</Text>
              {detailPost.status === 'draft' ? (
                <TouchableOpacity onPress={() => openEditDraftInResult(detailPost)}>
                  <Text style={[styles.modalCancel, { color: COLORS.primary }]}>編集</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => { setDetailPost(null); openDuplicate(detailPost); }}>
                  <Text style={[styles.modalCancel, { color: COLORS.primary }]}>複製</Text>
                </TouchableOpacity>
              )}
            </View>
            <ScrollView style={styles.modalBody} contentContainerStyle={{ paddingBottom: 40 }}>
              {/* 画像（複数枚はInstagram風にスライド） */}
              {detailPost.image_url && (() => {
                const imgs = detailPost.image_url.split('\n').map((s) => s.trim()).filter(Boolean);
                return (
                  <View
                    style={{ marginBottom: SPACING.md }}
                    onLayout={(e) => {
                      const w = e.nativeEvent.layout.width;
                      if (w > 0 && w !== carouselW) setCarouselW(w);
                    }}
                  >
                    <ScrollView
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      scrollEventThrottle={16}
                      onScroll={(e) => {
                        const w = carouselW || e.nativeEvent.layoutMeasurement.width;
                        if (w > 0) {
                          const idx = Math.round(e.nativeEvent.contentOffset.x / w);
                          if (idx !== carouselIdx) setCarouselIdx(idx);
                        }
                      }}
                    >
                      {imgs.map((uri, i) => (
                        <Image
                          key={i}
                          source={{ uri }}
                          style={{ width: carouselW || Dimensions.get('window').width - SPACING.md * 2, aspectRatio: 1, borderRadius: RADIUS.md }}
                          resizeMode="cover"
                        />
                      ))}
                    </ScrollView>
                    {imgs.length > 1 && (
                      <>
                        <View style={styles.carouselCounter}>
                          <Text style={styles.carouselCounterText}>{carouselIdx + 1}/{imgs.length}</Text>
                        </View>
                        <View style={styles.carouselDots}>
                          {imgs.map((_, i) => (
                            <View key={i} style={[styles.carouselDot, i === carouselIdx && styles.carouselDotActive]} />
                          ))}
                        </View>
                      </>
                    )}
                  </View>
                );
              })()}
              {/* ステータス・タイプ */}
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md, flexWrap: 'wrap' }}>
                <View style={[styles.typeBadge, detailPost.type !== 'feed' && styles.typeBadgeStory]}>
                  <Text style={styles.typeBadgeText}>
                    {detailPost.type === 'feed' ? 'フィード' : detailPost.type === 'reel' ? 'リール' : 'ストーリー'}
                  </Text>
                </View>
                <View style={[styles.statusBadge, detailPost.status === 'published' && styles.statusPublished, detailPost.status === 'failed' && styles.statusFailed]}>
                  <Text style={styles.statusText}>
                    {detailPost.status === 'draft' ? '下書き' : detailPost.status === 'pending' ? '予約中' : detailPost.status === 'published' ? '投稿済' : '失敗'}
                  </Text>
                </View>
              </View>
              {/* 日時 */}
              <Text style={[styles.fieldLabel, { marginBottom: 4 }]}>日時</Text>
              <Text style={{ color: COLORS.text, fontSize: 15, marginBottom: SPACING.md }}>
                {detailPost.status === 'draft' ? '未定' : formatDate(detailPost.scheduled_at)}
              </Text>
              {/* キャプション */}
              <Text style={[styles.fieldLabel, { marginBottom: 4 }]}>キャプション</Text>
              <Text style={{ color: COLORS.text, fontSize: 15, lineHeight: 22, marginBottom: SPACING.md }}>
                {detailPost.caption || '（なし）'}
              </Text>
              {/* ハッシュタグ */}
              {detailPost.hashtags?.length > 0 && (
                <>
                  <Text style={[styles.fieldLabel, { marginBottom: 4 }]}>ハッシュタグ</Text>
                  <Text style={{ color: COLORS.primary, fontSize: 13, lineHeight: 20, marginBottom: SPACING.md }}>
                    {detailPost.hashtags.join(' ')}
                  </Text>
                </>
              )}
              {/* 削除に関する注意 */}
              {detailPost.status === 'published' && (
                <View style={{ backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, marginTop: SPACING.lg, borderWidth: 1, borderColor: COLORS.border }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 }}>
                    Instagram APIの仕様上、アプリから Instagram 上の投稿を削除することはできません。{'\n'}
                    Instagram 本体から手動で削除してください。{'\n'}
                    下の「削除」はアプリ内の履歴のみを削除します。
                  </Text>
                </View>
              )}
              {/* 下書き: 予約・編集 */}
              {detailPost.status === 'draft' && (
                <>
                  <TouchableOpacity
                    style={[styles.modalSaveBtn, { backgroundColor: COLORS.primary, marginTop: SPACING.md }]}
                    onPress={() => { const p = detailPost; setDetailPost(null); openScheduleDraft(p); }}
                  >
                    <Text style={styles.modalSaveBtnText}>予約する</Text>
                  </TouchableOpacity>
                </>
              )}
              {/* 削除ボタン */}
              <TouchableOpacity
                style={[styles.modalSaveBtn, { backgroundColor: COLORS.error ?? '#FF3B30', marginTop: SPACING.md }]}
                onPress={() => {
                  const run = () => { setDetailPost(null); handleDelete(detailPost.id); };
                  if (Platform.OS === 'web') { if (window.confirm('この投稿を削除しますか？')) run(); }
                  else Alert.alert('削除', 'この投稿を削除しますか？', [{ text: 'キャンセル', style: 'cancel' }, { text: '削除', style: 'destructive', onPress: run }]);
                }}
              >
                <Text style={styles.modalSaveBtnText}>
                  {detailPost.status === 'published' ? '履歴から削除する' : '削除する'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}
      </Modal>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView
          style={styles.modal}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCancel}>キャンセル</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>投稿を作成</Text>
            <View style={{ width: 48 }} />
          </View>

          <ScrollView
            style={styles.modalBody}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={!storyDragging}
          >
            {templates.length > 0 && (
              <TouchableOpacity
                style={styles.templateOpenBtn}
                onPress={() => setTemplatePickerVisible(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.templateOpenBtnText}>
                  テンプレートから選ぶ（{templates.length}）
                </Text>
              </TouchableOpacity>
            )}

            <Text style={styles.fieldLabel}>投稿タイプ</Text>
            <View style={styles.typeRow}>
              {(['feed', 'story'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeBtn, type === t && styles.typeBtnActive]}
                  onPress={() => setType(t)}
                >
                  <Text style={[styles.typeBtnText, type === t && styles.typeBtnTextActive]}>
                    {t === 'feed' ? 'フィード' : 'ストーリー'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {type === 'feed' ? (
              <>
                <Text style={styles.fieldLabel}>投稿画像（複数選択OK・カルーセル）</Text>
                <TouchableOpacity
                  style={styles.imagePickerBox}
                  onPress={pickAndUploadImage}
                  activeOpacity={0.85}
                  disabled={imageUploading}
                >
                  {feedPreviews.length > 0 ? (
                    <View style={styles.thumbRow}>
                      {feedPreviews.map((uri, i) => (
                        <View key={i} style={styles.thumbWrap}>
                          <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
                          <Text style={styles.thumbNum}>{i + 1}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <Ionicons name="image-outline" size={28} color={COLORS.textSecondary} />
                      <Text style={styles.imagePlaceholderText}>タップして写真を選ぶ（複数OK）</Text>
                    </View>
                  )}
                  {imageUploading && (
                    <View style={styles.imageUploadingOverlay}>
                      <ActivityIndicator color="#fff" />
                      <Text style={styles.imageUploadingText}>アップロード中...</Text>
                    </View>
                  )}
                </TouchableOpacity>
                {feedPreviews.length > 0 && (
                  <TouchableOpacity
                    style={[styles.aiBtnGhost, { marginTop: SPACING.sm }]}
                    onPress={reAdjustImages}
                    disabled={imageUploading}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.aiBtnGhostText}>写真を調整する</Text>
                  </TouchableOpacity>
                )}

                {/* AIで画像を生成（チャット） */}
                <Text style={[styles.sectionDivider, { marginTop: SPACING.lg }]}>または AIで画像を作る</Text>
                <TouchableOpacity
                  style={[styles.aiBtn, { backgroundColor: COLORS.secondary }]}
                  onPress={openImgChat}
                  activeOpacity={0.85}
                >
                  <Text style={styles.aiBtnText}>AIで画像を作る（チャット）</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* 統合ストーリー：写真でも動画でも同じ流れ */}
                <Text style={styles.fieldLabel}>メディア（写真 または 動画）</Text>
                <TouchableOpacity style={styles.imagePickerBox} onPress={pickStoryMedia} activeOpacity={0.85}>
                  {storyMediaType ? (
                    <Text style={styles.imageReadyText}>
                      {storyMediaType === 'video' ? '動画' : '写真'}を選びました（タップで変更）
                    </Text>
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <Ionicons name="image-outline" size={28} color={COLORS.textSecondary} />
                      <Text style={styles.imagePlaceholderText}>タップして写真/動画を選ぶ</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {/* AI生成カード（フィードと同じ構成） */}
                <View style={styles.aiCard}>
                  <Text style={styles.aiCardTitle}>AIで見出しを作る</Text>

                  <Text style={styles.fieldLabel}>AIへの指示（任意・どちらにも反映）</Text>
                  <TextInput
                    style={[styles.input, styles.aiInstructionInput]}
                    value={aiInstruction}
                    onChangeText={setAiInstruction}
                    placeholder="例: もっと短く / 絵文字を入れて"
                    placeholderTextColor={COLORS.textMuted}
                    multiline
                  />
                  {storyVideoText.trim() ? (
                    <TouchableOpacity
                      style={[styles.aiBtnGhost, aiLoading && styles.publishNowBtnDisabled]}
                      onPress={handleRefineHeadline}
                      disabled={aiLoading}
                      activeOpacity={0.85}
                    >
                      {aiLoading ? (
                        <ActivityIndicator color={COLORS.secondary} />
                      ) : (
                        <Text style={styles.aiBtnGhostText}>今の見出しを指示で書き直す</Text>
                      )}
                    </TouchableOpacity>
                  ) : null}

                  <View style={styles.aiMethod}>
                    <Text style={styles.aiMethodTitle}>テーマから作る</Text>
                    <TextInput
                      style={styles.input}
                      value={storyVideoTheme}
                      onChangeText={setStoryVideoTheme}
                      placeholder="例: 本日OPEN / 週末セール"
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <TouchableOpacity
                      style={[styles.aiBtn, { marginTop: SPACING.sm }, aiLoading && styles.publishNowBtnDisabled]}
                      onPress={handleGenerateVideoHeadlineFromTheme}
                      disabled={aiLoading}
                      activeOpacity={0.85}
                    >
                      {aiLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.aiBtnText}>テーマから作る</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  <View style={styles.aiMethod}>
                    <Text style={styles.aiMethodTitle}>写真/動画から作る</Text>
                    <Text style={styles.aiHintText}>選んだメディアを見て見出しを作ります</Text>
                    <TouchableOpacity
                      style={[styles.aiBtn, aiLoading && styles.publishNowBtnDisabled]}
                      onPress={handleGenerateHeadlineFromMedia}
                      disabled={aiLoading}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.aiBtnText}>選んだメディアから作る</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.sectionDivider}>のせる見出し</Text>
                <TextInput
                  style={styles.input}
                  value={storyVideoText}
                  onChangeText={setStoryVideoText}
                  placeholder="例: 本日OPEN / 新作入荷（任意）"
                  placeholderTextColor={COLORS.textMuted}
                />

                {storyMediaType ? (
                  <>
                    <View
                      {...(storyVideoText.trim() ? storyTextPan.panHandlers : {})}
                      style={[styles.videoPreviewWrap, { touchAction: 'none' } as any]}
                    >
                      {storyMediaType === 'video' ? (
                        <View ref={storyVideoHostRef} style={styles.videoPreviewHost} pointerEvents="none" />
                      ) : (
                        <Image
                          source={{ uri: storyImageUri }}
                          style={[styles.videoPreviewHost, { pointerEvents: 'none' }] as any}
                          resizeMode="cover"
                        />
                      )}
                      {storyVideoText.trim() ? (
                        <View
                          pointerEvents="none"
                          onLayout={(e) =>
                            setStoryTextSize({
                              w: e.nativeEvent.layout.width,
                              h: e.nativeEvent.layout.height,
                            })
                          }
                          style={[
                            styles.videoOverlayBox,
                            {
                              left: storyVideoTextXY.x * 200 - storyTextSize.w / 2,
                              top: storyVideoTextXY.y * 356 - storyTextSize.h / 2,
                            },
                          ]}
                        >
                          <Text style={[styles.videoOverlayText, { fontSize: 20 * storyVideoTextScale }]}>
                            {storyVideoText.trim()}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {storyVideoText.trim() ? (
                      <>
                        <Text style={styles.aiHintText}>
                          文字をドラッグで移動 ／ 二本指(または＋−)で拡大縮小
                        </Text>
                        <View style={styles.typeRow}>
                          <TouchableOpacity
                            style={styles.typeBtn}
                            onPress={() => setStoryVideoTextScale((s) => Math.max(0.5, +(s - 0.1).toFixed(2)))}
                          >
                            <Text style={styles.typeBtnText}>－ 小さく</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.typeBtn}
                            onPress={() => setStoryVideoTextScale((s) => Math.min(2.5, +(s + 0.1).toFixed(2)))}
                          >
                            <Text style={styles.typeBtnText}>＋ 大きく</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    ) : null}
                  </>
                ) : null}

                <Text style={styles.publishNowHint}>
                  ※ 縦長(9:16)推奨。動画は見出しを焼き込みます（少し時間がかかります）。音楽はInstagramで付けられます
                </Text>
              </>
            )}

            {type === 'feed' ? (
              <>
                {/* 次のステップ（キャプション作成）へ */}
                <TouchableOpacity
                  style={[styles.aiBtn, { marginTop: SPACING.lg }]}
                  onPress={() => { draftOriginalRef.current = null; setModalVisible(false); setResultVisible(true); }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.aiBtnText}>次へ（キャプション作成）›</Text>
                </TouchableOpacity>
              </>
            ) : null}

            {type !== 'feed' && (
              <>
                <Text style={styles.sectionDivider}>Instagram</Text>
                {instagramCredentials ? (
                  <View style={styles.igConnectedBox}>
                    <Text style={styles.igConnectedText}>
                      {instagramCredentials.username ? `@${instagramCredentials.username}` : '連携済み'} に投稿します
                    </Text>
                  </View>
                ) : (
                  <View style={styles.igWarnBox}>
                    <Text style={styles.igWarnText}>
                      未連携です。右上のアイコンからInstagramを連携してください
                    </Text>
                  </View>
                )}

                <Text style={styles.sectionDivider}>出し方を選ぶ</Text>

                {/* ① 今すぐ投稿 */}
                <TouchableOpacity
                  style={[styles.publishNowBtn, (publishing || !instagramCredentials) && styles.publishNowBtnDisabled]}
                  onPress={handlePublishNow}
                  disabled={publishing || !instagramCredentials}
                  activeOpacity={0.85}
                >
                  {publishing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.publishNowText}>今すぐ投稿する</Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.publishNowHint}>※ すぐにInstagramへ投稿します（履歴に残ります）</Text>

                {/* ② 予約する */}
                <Text style={styles.orDivider}>または、日時を決めて予約する</Text>
                <TouchableOpacity
                  style={styles.scheduleSaveBtn}
                  onPress={() => setScheduleModalVisible(true)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.publishNowText}>予約する</Text>
                </TouchableOpacity>
                <Text style={styles.publishNowHint}>※ 次の画面で日時を選びます</Text>

                {/* ③ 下書き保存 */}
                <Text style={styles.orDivider}>または、あとで決める</Text>
                <TouchableOpacity
                  style={[styles.draftSaveBtn, savingDraft && styles.publishNowBtnDisabled]}
                  onPress={handleSaveDraft}
                  disabled={savingDraft}
                  activeOpacity={0.85}
                >
                  {savingDraft ? (
                    <ActivityIndicator color={COLORS.primary} />
                  ) : (
                    <Text style={styles.draftSaveText}>下書きに保存</Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.publishNowHint}>
                  ※ 日時を決めずに保存。「下書き」から後で予約できます
                </Text>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* 編集モーダル（キャプション・ハッシュタグ・日時・くりかえし） */}
      <Modal visible={editVisible} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView
          style={styles.modal}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                setEditVisible(false);
                setEditingPost(null);
                setEditDuplicateSource(null);
                setEditPublishDraft(false);
              }}
            >
              <Text style={styles.modalCancel}>キャンセル</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editDuplicateSource ? '複製して保存' : editPublishDraft ? '下書きを予約する' : '予約を編集'}
            </Text>
            <TouchableOpacity onPress={saveEdit} disabled={editSaving}>
              {editSaving ? (
                <ActivityIndicator color={COLORS.primary} />
              ) : (
                <Text style={styles.modalSave}>保存</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {(editingPost ?? editDuplicateSource) && (
              <Text style={styles.editKind}>
                {(editingPost ?? editDuplicateSource)!.type === 'feed'
                  ? 'フィード投稿'
                  : (editingPost ?? editDuplicateSource)!.type === 'reel'
                  ? 'リール'
                  : 'ストーリー'}
                ／ 画像・動画は変更できません
              </Text>
            )}

            {(editingPost ?? editDuplicateSource)?.type !== 'story' && (
              <>
                <Text style={styles.fieldLabel}>キャプション</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={editCaption}
                  onChangeText={setEditCaption}
                  placeholder="投稿のキャプション"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  numberOfLines={4}
                />
                <Text style={styles.fieldLabel}>ハッシュタグ（スペース区切り）</Text>
                <TextInput
                  style={styles.input}
                  value={editHashtags}
                  onChangeText={setEditHashtags}
                  placeholder="#春コーデ #新作"
                  placeholderTextColor={COLORS.textMuted}
                />
              </>
            )}

            <Text style={styles.fieldLabel}>予約日時</Text>
            <TextInput
              style={styles.input}
              value={editDate}
              onChangeText={setEditDate}
              placeholder="例: 2026-06-15T18:00"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>くりかえし {!canRecurring(plan) && '(Pro限定)'}</Text>
            <View style={styles.repeatRow}>
              {REPEAT_OPTIONS.map((opt) => {
                const active = editRepeat === opt.key;
                const locked = opt.key !== 'none' && !canRecurring(plan);
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.repeatBtn, active && styles.repeatBtnActive]}
                    onPress={() => editSelectRepeat(opt.key)}
                  >
                    <Text style={[styles.repeatBtnText, active && styles.repeatBtnTextActive]}>
                      {opt.label}
                      {locked ? ' (Pro)' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.publishNowBtn, editSaving && styles.publishNowBtnDisabled]}
              onPress={saveEdit}
              disabled={editSaving}
              activeOpacity={0.85}
            >
              {editSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.publishNowText}>変更を保存する</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* 予約日時の入力（別画面） */}
      <Modal visible={scheduleModalVisible} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView
          style={styles.modal}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setScheduleModalVisible(false)}>
              <Text style={styles.modalCancel}>戻る</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>予約日時を設定</Text>
            <View style={{ width: 48 }} />
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.quickLabel}>おすすめの時間帯から選ぶ</Text>
            <View style={styles.quickDatesGrid}>
              {quickDates.map((q) => {
                const active = dateText === q.value;
                return (
                  <TouchableOpacity
                    key={q.value}
                    style={[
                      styles.quickDateBtn,
                      q.isOptimal && styles.quickDateBtnOptimal,
                      active && styles.quickDateBtnActive,
                    ]}
                    onPress={() => setDateText(q.value)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.quickDateText, active && styles.quickDateTextActive]}>
                      {q.isOptimal && <Text style={styles.quickDateOptimalDot}>● </Text>}
                      {q.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.dateTimeRow}>
              <View style={styles.dateTimeCol}>
                <Text style={styles.fieldLabel}>日付</Text>
                {Platform.OS === 'web' ? (
                  <input
                    type="date"
                    value={dateText.split('T')[0] || ''}
                    min={todayKey}
                    onChange={(e: any) => {
                      const d = e.target.value;
                      const t = dateText.split('T')[1] || '18:00';
                      setDateText(d ? `${d}T${t}` : '');
                    }}
                    style={webDateInputStyle}
                  />
                ) : (
                  <TextInput
                    style={styles.input}
                    value={dateText.split('T')[0] || ''}
                    onChangeText={(d) => {
                      const t = dateText.split('T')[1] || '18:00';
                      setDateText(d ? `${d}T${t}` : '');
                    }}
                    placeholder="2026-06-15"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="none"
                  />
                )}
              </View>
              <View style={styles.dateTimeCol}>
                <Text style={styles.fieldLabel}>時間</Text>
                {Platform.OS === 'web' ? (
                  <input
                    type="time"
                    value={dateText.split('T')[1] || ''}
                    onChange={(e: any) => {
                      const t = e.target.value;
                      const d = dateText.split('T')[0] || todayKey;
                      setDateText(t ? `${d}T${t}` : '');
                    }}
                    style={webDateInputStyle}
                  />
                ) : (
                  <TextInput
                    style={styles.input}
                    value={dateText.split('T')[1] || ''}
                    onChangeText={(t) => {
                      const d = dateText.split('T')[0] || todayKey;
                      setDateText(t ? `${d}T${t}` : '');
                    }}
                    placeholder="18:00"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="none"
                  />
                )}
              </View>
            </View>

            <Text style={styles.fieldLabel}>くりかえし {!canRecurring(plan) && '(Pro限定)'}</Text>
            <View style={styles.repeatRow}>
              {REPEAT_OPTIONS.map((opt) => {
                const active = repeat === opt.key;
                const locked = opt.key !== 'none' && !canRecurring(plan);
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.repeatBtn, active && styles.repeatBtnActive]}
                    onPress={() => selectRepeat(opt.key)}
                  >
                    <Text style={[styles.repeatBtnText, active && styles.repeatBtnTextActive]}>
                      {opt.label}
                      {locked ? ' (Pro)' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.repeatHint}>
              ※ くりかえしを設定すると、指定した間隔で自動的に投稿されます
            </Text>

            <TouchableOpacity
              style={[styles.publishNowBtn, saving && styles.publishNowBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.publishNowText}>この日時で予約する</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* テンプレート選択モーダル */}
      <Modal visible={templatePickerVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setTemplatePickerVisible(false)}>
              <Text style={styles.modalCancel}>閉じる</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>テンプレート</Text>
            <View style={{ width: 48 }} />
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {templates.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>テンプレートはありません</Text>
                <Text style={styles.emptyDesc}>
                  投稿作成画面で「テンプレートとして保存」すると、ここに表示されます
                </Text>
              </View>
            ) : (
              templates.map((t) => (
                <View key={t.id} style={styles.templateCard}>
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    onPress={() => applyTemplate(t)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.templateName}>
                      {t.name}
                    </Text>
                    {t.caption ? (
                      <Text style={styles.templateCaption} numberOfLines={2}>
                        {t.caption}
                      </Text>
                    ) : null}
                    {t.hashtags.length > 0 ? (
                      <Text style={styles.templateTags} numberOfLines={1}>
                        {t.hashtags.join(' ')}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                  <View style={styles.templateActions}>
                    <TouchableOpacity onPress={() => applyTemplate(t)} hitSlop={8}>
                      <Text style={styles.templateUseText}>使う →</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteTemplate(t.id)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={16} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, paddingHorizontal: SPACING.md },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
    paddingRight: 52, // 右上のアカウントアイコンと重ならないように
  },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800' },
  addBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  hintCard: {
    backgroundColor: COLORS.secondary + '18',
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.secondary + '33',
  },
  hintText: { color: COLORS.secondary, fontSize: 12, lineHeight: 18 },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  calNav: { color: COLORS.primary, fontSize: 22, fontWeight: '800', paddingHorizontal: SPACING.md },
  calTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  calWeekRow: { flexDirection: 'row' },
  calWeekday: {
    flex: 1,
    textAlign: 'center',
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
  },
  calCellToday: { backgroundColor: COLORS.surfaceElevated },
  calCellSelected: { backgroundColor: COLORS.primary + '33', borderWidth: 1, borderColor: COLORS.primary },
  calDayNum: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  calDot: {
    marginTop: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  calDotText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  calSelTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800', marginTop: SPACING.lg, marginBottom: SPACING.sm },
  calHint: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginTop: SPACING.lg },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: 4,
    marginBottom: SPACING.lg,
  },
  filterTab: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    borderRadius: RADIUS.sm,
  },
  filterTabActive: { backgroundColor: COLORS.primary },
  filterText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  postCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  postMeta: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap' },
  typeBadge: {
    backgroundColor: COLORS.primary + '33',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  typeBadgeStory: { backgroundColor: COLORS.secondary + '33' },
  typeBadgeText: { color: COLORS.text, fontSize: 11, fontWeight: '600' },
  statusBadge: {
    backgroundColor: COLORS.warning + '33',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  statusPublished: { backgroundColor: COLORS.success + '33' },
  statusFailed: { backgroundColor: COLORS.error + '33' },
  statusText: { color: COLORS.text, fontSize: 11, fontWeight: '600' },
  deleteBtn: { fontSize: 18 },
  cardActions: { flexDirection: 'row', gap: SPACING.md, alignItems: 'center' },
  carouselCounter: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  carouselCounterText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  carouselDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: SPACING.sm,
  },
  carouselDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.border,
  },
  carouselDotActive: { backgroundColor: COLORS.primary },
  confirmOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  confirmTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800', textAlign: 'center', marginBottom: SPACING.sm },
  confirmDesc: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: SPACING.lg },
  confirmYes: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: SPACING.md, alignItems: 'center' },
  confirmYesText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  confirmNo: { marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.error, borderRadius: RADIUS.full, paddingVertical: SPACING.md, alignItems: 'center' },
  confirmNoText: { color: COLORS.error, fontSize: 15, fontWeight: '700' },
  confirmCancel: { marginTop: SPACING.sm, paddingVertical: SPACING.md, alignItems: 'center' },
  confirmCancelText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  carouselRemove: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carouselRemoveText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  editBtn: { fontSize: 17 },
  editKind: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginBottom: SPACING.sm,
  },
  postCaption: { color: COLORS.text, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  postHashtags: { color: '#4FC3F7', fontSize: 12, marginBottom: SPACING.sm },
  postFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.sm,
    marginTop: SPACING.sm,
  },
  scheduleTime: { color: COLORS.textMuted, fontSize: 12 },
  empty: { alignItems: 'center', paddingTop: 60, gap: SPACING.sm },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  emptyDesc: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
  emptyAddBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    marginTop: SPACING.md,
  },
  emptyAddBtnText: { color: '#fff', fontWeight: '700' },
  reelChoiceBtn: { backgroundColor: COLORS.secondary, marginTop: SPACING.sm },
  rosterChoiceBtn: { backgroundColor: COLORS.primaryLight ?? '#F77737', marginTop: SPACING.sm },
  modal: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  modalCancel: { color: COLORS.textMuted, fontSize: 16 },
  modalSave: { color: COLORS.primary, fontSize: 16, fontWeight: '700' },
  modalBody: { flex: 1, paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
  fieldLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: SPACING.xs,
    marginTop: SPACING.md,
  },
  quickLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  quickDatesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  quickDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 7,
    gap: 4,
  },
  quickDateBtnActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '22',
  },
  quickDateBtnOptimal: {
    borderColor: COLORS.success + '66',
  },
  quickDateOptimalDot: { color: COLORS.success, fontSize: 8 },
  quickDateText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  quickDateTextActive: { color: COLORS.primary },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.text,
    fontSize: 15,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top', paddingTop: SPACING.sm },
  dateTimeRow: { flexDirection: 'row', gap: SPACING.sm },
  dateTimeCol: { flex: 1 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.sm },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.sm,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  tagChipText: { color: '#4FC3F7', fontSize: 13 },
  tagChipRemove: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  tagEmpty: { color: COLORS.textMuted, fontSize: 12 },
  tagAddRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm },
  tagInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.text,
    fontSize: 14,
  },
  tagAddBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tagAddBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  tagWarn: { color: COLORS.warning, fontSize: 12, marginBottom: SPACING.sm },
  templateOpenBtn: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.secondary + '55',
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  templateOpenBtnText: { color: COLORS.secondary, fontSize: 14, fontWeight: '700' },
  templateSaveBtn: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.xs,
    borderWidth: 1.5,
    borderColor: COLORS.secondary,
  },
  templateSaveText: { color: COLORS.secondary, fontSize: 15, fontWeight: '800' },
  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  templateName: { color: COLORS.text, fontSize: 15, fontWeight: '800', marginBottom: 2 },
  templateCaption: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  templateTags: { color: '#4FC3F7', fontSize: 12, marginTop: 2 },
  templateActions: { alignItems: 'flex-end', gap: SPACING.sm },
  templateUseText: { color: COLORS.primary, fontSize: 14, fontWeight: '800' },
  createMenu: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  createMenuTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: SPACING.sm,
  },
  createMenuRow: { flexDirection: 'row', gap: SPACING.sm },
  createMenuBtn: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  createMenuEmoji: { fontSize: 26 },
  createMenuLabel: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  orDivider: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  scheduleSaveBtn: {
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  calDotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 2,
    marginTop: 2,
  },
  calStatusDot: {
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  calStatusDotText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  calLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.md,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  calLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  calLegendDot: { width: 10, height: 10, borderRadius: 5 },
  calLegendText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  typeRow: { flexDirection: 'row', gap: SPACING.sm },
  typeBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
  },
  typeBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '22' },
  typeBtnText: { color: COLORS.textMuted, fontWeight: '600' },
  typeBtnTextActive: { color: COLORS.primary },
  sectionDivider: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: SPACING.xl,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  imagePickerBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    minHeight: 120,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.sm,
  },
  imagePreview: { width: '100%', maxHeight: 360, alignSelf: 'center' },
  storyPreview: { width: 150, aspectRatio: 9 / 16, alignSelf: 'center', borderRadius: RADIUS.sm },
  thumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    justifyContent: 'center',
  },
  thumbWrap: { position: 'relative' },
  thumb: { width: 80, height: 80, borderRadius: RADIUS.sm, backgroundColor: '#000' },
  thumbNum: {
    position: 'absolute',
    top: 3,
    left: 3,
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    fontSize: 11,
    fontWeight: '800',
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    lineHeight: 20,
    overflow: 'hidden',
  },
  imagePlaceholder: { alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xl },
  imagePlaceholderIcon: { fontSize: 36 },
  imagePlaceholderText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  imageUploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  imageUploadingText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  imageReadyText: { color: COLORS.success, fontSize: 12, fontWeight: '600', marginTop: SPACING.xs },
  igConnectedBox: {
    backgroundColor: COLORS.success + '18',
    borderWidth: 1,
    borderColor: COLORS.success + '44',
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginTop: SPACING.xs,
  },
  igConnectedText: { color: COLORS.success, fontSize: 13, fontWeight: '700' },
  igWarnBox: {
    backgroundColor: COLORS.warning + '18',
    borderWidth: 1,
    borderColor: COLORS.warning + '44',
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginTop: SPACING.xs,
  },
  igWarnText: { color: COLORS.warning, fontSize: 13, fontWeight: '600' },
  modalSaveBtn: {
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center' as const,
  },
  modalSaveBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' as const },
  publishNowBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  publishNowBtnDisabled: { opacity: 0.5 },
  publishNowText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  draftSaveBtn: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  draftSaveText: { color: COLORS.primary, fontSize: 15, fontWeight: '800' },
  aiBtn: {
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  aiBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  aiHintText: { color: COLORS.textMuted, fontSize: 11, marginTop: 4, marginBottom: SPACING.sm },
  aiCard: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.secondary + '55',
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  aiCardTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: SPACING.xs,
  },
  aiBtnGhost: {
    borderWidth: 1,
    borderColor: COLORS.secondary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  aiBtnGhostText: { color: COLORS.secondary, fontSize: 14, fontWeight: '700' },
  aiMethod: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
    marginTop: SPACING.md,
  },
  aiMethodTitle: { color: COLORS.text, fontSize: 13, fontWeight: '800', marginBottom: SPACING.xs },
  aiInstructionInput: { height: 90, textAlignVertical: 'top' },
  videoPreviewWrap: {
    width: 200,
    height: 356,
    alignSelf: 'center',
    marginTop: SPACING.md,
    position: 'relative',
  },
  videoPreviewHost: { width: 200, height: 356 },
  videoOverlayBox: {
    position: 'absolute',
    maxWidth: 184,
    paddingHorizontal: 6,
  },
  videoOverlayText: {
    textAlign: 'center',
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  composeBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  composeBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  repeatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  repeatBtn: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  repeatBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  repeatBtnText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  repeatBtnTextActive: { color: '#fff' },
  repeatHint: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: SPACING.sm,
  },
  repeatBadge: {
    backgroundColor: COLORS.secondary + '33',
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  repeatBadgeText: { color: COLORS.secondary, fontSize: 12, fontWeight: '700' },
  publishNowHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
  },
});

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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { uploadPostImage, uploadBlob } from '../services/storage';
import {
  composeStoryImage,
  StoryTransform,
  DEFAULT_TRANSFORM,
} from '../utils/composeStory';
import StoryEditor from '../components/StoryEditor';
import ReelScreen from './ReelScreen';
import RosterScreen from './RosterScreen';
import { addTextToVideo } from '../utils/createReel';
import { generateStory, generatePost, generateFromImage, generateFromImages, refineCaption } from '../services/aiService';

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

type Filter = 'all' | 'pending' | 'published' | 'failed';

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

export default function ScheduleScreen({ route }: any) {
  // mode='now' は「投稿」タブ（今すぐ投稿のみ）／ 'schedule' は「予約投稿」タブ（予約のみ）
  const mode: 'now' | 'schedule' = route?.params?.mode === 'now' ? 'now' : 'schedule';
  const insets = useSafeAreaInsets();
  const draft = useAppStore((s) => s.draft);
  const clearDraft = useAppStore((s) => s.clearDraft);
  const instagramCredentials = useAppStore((s) => s.instagramCredentials);
  const brandSettings = useAppStore((s) => s.brandSettings);

  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [caption, setCaption] = useState('');
  const [hashtagsText, setHashtagsText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]); // フィードのカルーセル用（複数）
  const [feedPreviews, setFeedPreviews] = useState<string[]>([]); // 選択した写真のサムネ表示用
  const [imagePreview, setImagePreview] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [dateText, setDateText] = useState('');
  const [type, setType] = useState<'feed' | 'story'>('feed');
  const [repeat, setRepeat] = useState<RepeatOption>('none');
  const [plan, setPlan] = useState<'free' | 'pro'>('free');
  const [nowSub, setNowSub] = useState<'menu' | 'reel' | 'roster'>('menu'); // 投稿タブ内の表示

  // 編集モーダル用
  const [editVisible, setEditVisible] = useState(false);
  const [editingPost, setEditingPost] = useState<ScheduledPost | null>(null);
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
  const [storyVideoText, setStoryVideoText] = useState('');
  const [storyVideoTextPos, setStoryVideoTextPos] = useState<'top' | 'center' | 'bottom'>('bottom');
  const storyVideoHostRef = useRef<any>(null);
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
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [composing, setComposing] = useState(false);

  const quickDates = getQuickDates();

  const fetchPosts = useCallback(async () => {
    try {
      const data = await getScheduledPosts();
      setPosts(data);
    } catch {
      Alert.alert('エラー', 'Supabaseの設定を確認してください。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
    getMyPlan().then(setPlan).catch(() => {});
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
    v.controls = true;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    Object.assign(v.style, {
      width: '200px',
      height: '356px',
      borderRadius: '12px',
      backgroundColor: '#000',
      display: 'block',
      objectFit: 'cover',
    } as Partial<CSSStyleDeclaration>);
    host.appendChild(v);
  }, [storyVideoUri, storyMode, modalVisible]);

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
    setStoryVideoUri('');
    setStoryVideoBlob(null);
    setStoryVideoText('');
    setStoryVideoTextPos('bottom');
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
    setModalVisible(true);
  };

  const alertMsg = (msg: string, title = 'エラー') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  // くりかえしの選択（Pro限定。無料が選んだら案内を出す）
  const selectRepeat = (r: RepeatOption) => {
    if (r !== 'none' && plan !== 'pro') {
      alertMsg(
        'くりかえし投稿はProプラン限定です。Proにアップグレードすると、毎日・毎週・毎月・平日の自動くりかえし投稿が使えます。',
        '⭐ Pro限定の機能です'
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

    // フィードは複数選択OK（カルーセル投稿）
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.9,
    });
    if (res.canceled) return;

    setFeedPreviews(res.assets.map((a) => a.uri));
    setImagePreview(res.assets[0].uri);
    setImageUploading(true);
    try {
      const urls: string[] = [];
      for (const a of res.assets) {
        urls.push(await uploadPostImage(a.uri));
      }
      setImageUrls(urls);
      setImageUrl(urls[0]);
    } catch (e) {
      setImagePreview('');
      alertMsg(e instanceof Error ? e.message : '画像アップロードに失敗しました');
    } finally {
      setImageUploading(false);
    }
  };

  // ストーリー用の動画を選ぶ
  const pickStoryVideo = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
    });
    if (res.canceled) return;
    try {
      const r = await fetch(res.assets[0].uri);
      const b = await r.blob();
      setStoryVideoBlob(b);
      setStoryVideoUri(URL.createObjectURL(b));
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '動画の読み込みに失敗しました');
    }
  };

  // 動画ストーリーの最終Blob（文字があれば焼き込む）をアップロードしてURLを返す
  const uploadStoryVideo = async (): Promise<string> => {
    let blob = storyVideoBlob!;
    if (storyVideoText.trim()) {
      const composed = await addTextToVideo(storyVideoBlob!, storyVideoText.trim(), storyVideoTextPos);
      blob = composed.blob;
    }
    return uploadBlob(blob);
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
      const g = await generateFromImage({
        imageBase64: base64,
        mimeType: mime as 'image/jpeg',
        contentType: 'story',
        tone: brandSettings.tone || '明るい・ポジティブ',
        industry: brandSettings.industry,
        instruction:
          '動画にのせる短い見出しを1つだけ。8〜14文字、記号や改行・ハッシュタグなし。' +
          (aiInstruction.trim() ? ` ${aiInstruction.trim()}` : ''),
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
      const g = await generatePost({
        theme: feedTheme.trim(),
        tone: brandSettings.tone || '明るい・ポジティブ',
        keywords: [],
        includeHashtags: true,
        language: 'ja',
        industry: brandSettings.industry,
        instruction: aiInstruction.trim() || undefined,
      });
      setCaption(g.caption);
      setHashtagsText(g.hashtags.join(' '));
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
      const g = await generateFromImages({
        images,
        tone: brandSettings.tone || '明るい・ポジティブ',
        industry: brandSettings.industry,
        instruction: aiInstruction.trim() || undefined,
      });
      setCaption(g.caption);
      setHashtagsText(g.hashtags.join(' '));
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
      const g = await generateStory({
        theme: storyTheme.trim() || storyDetails.trim().slice(0, 20),
        type: 'announcement',
        details: storyDetails.trim() || storyTheme.trim(),
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

  // 今すぐInstagramに投稿（テスト/手動投稿）
  const handlePublishNow = async () => {
    const isStoryVideo = type === 'story' && storyMode === 'video';
    if (type === 'feed' && !caption.trim()) {
      alertMsg('キャプションを入力してください', '入力に不備があります');
      return;
    }
    if (isStoryVideo) {
      if (!storyVideoBlob) {
        alertMsg('ストーリーにする動画を選んでください', '動画が必要です');
        return;
      }
    } else if (!imageUrl.trim()) {
      alertMsg(
        type === 'story'
          ? '写真を選び「✅ この画像で確定する」を押してください'
          : '写真を選んでください',
        '画像が必要です'
      );
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
      const storyVideoUrl = isStoryVideo ? await uploadStoryVideo() : undefined;
      const result = await publishNow({
        caption: caption.trim(),
        hashtags: buildHashtags(),
        image_url: isStoryVideo ? undefined : imageUrl.trim(),
        image_urls: type === 'feed' && imageUrls.length > 1 ? imageUrls : undefined,
        video_url: storyVideoUrl,
        type,
        instagram_user_id: instagramCredentials.userId,
        access_token: instagramCredentials.accessToken,
      });
      clearDraft();
      setModalVisible(false);
      const kind = result.posted_type === 'story' ? 'ストーリー' : 'フィード';
      const ok = `投稿しました ✅（${kind}として投稿）\nInstagramアプリで確認してください`;
      if (Platform.OS === 'web') window.alert(ok);
      else Alert.alert('投稿完了 ✅', `${kind}として投稿しました。Instagramで確認してください`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '投稿に失敗しました';
      if (Platform.OS === 'web') window.alert('投稿失敗\n' + msg);
      else Alert.alert('投稿失敗', msg);
    } finally {
      setPublishing(false);
    }
  };

  const handleSave = async () => {
    const isStoryVideo = type === 'story' && storyMode === 'video';
    if (type === 'feed' && !caption.trim()) {
      alertMsg('キャプションを入力してください', '入力に不備があります');
      return;
    }
    if (isStoryVideo) {
      if (!storyVideoBlob) {
        alertMsg('ストーリーにする動画を選んでください', '動画が必要です');
        return;
      }
    } else if (!imageUrl.trim()) {
      alertMsg(
        type === 'story'
          ? '写真を選び「✅ この画像で確定する」を押してください'
          : '写真を選んでください',
        '画像が必要です'
      );
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
      // ストーリー動画は動画をアップロードして image_url に動画URLを保存
      const storyVideoUrl = isStoryVideo ? await uploadStoryVideo() : undefined;
      await createScheduledPost({
        caption: caption.trim(),
        hashtags: buildHashtags(),
        // フィードで複数枚なら改行区切りで保存（カルーセル）／ストーリー動画は動画URL
        image_url: isStoryVideo
          ? storyVideoUrl
          : type === 'feed' && imageUrls.length > 1
            ? imageUrls.join('\n')
            : imageUrl.trim() || undefined,
        scheduled_at: scheduledDate,
        type,
        repeat,
        instagram_user_id: instagramCredentials?.userId || undefined,
        access_token: instagramCredentials?.accessToken || undefined,
      });
      clearDraft();
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

  // 編集
  const openEdit = (post: ScheduledPost) => {
    setEditingPost(post);
    setEditCaption(post.caption ?? '');
    setEditHashtags((post.hashtags ?? []).join(' '));
    setEditDate(toLocalInput(post.scheduled_at));
    setEditRepeat(post.repeat ?? 'none');
    setEditVisible(true);
  };

  const saveEdit = async () => {
    if (!editingPost) return;
    const date = parseDate(editDate);
    if (!date) {
      alertMsg('日時の形式が正しくありません\n例: 2026-06-15T18:00', '入力に不備があります');
      return;
    }
    if (date <= new Date()) {
      alertMsg('予約日時は未来の日時を指定してください', '入力に不備があります');
      return;
    }
    setEditSaving(true);
    try {
      await updateScheduledPost(editingPost.id, {
        caption: editCaption.trim(),
        hashtags: editHashtags.split(/[\s,　]+/).map((h) => h.trim()).filter(Boolean),
        scheduled_at: date,
        repeat: editRepeat,
      });
      setEditVisible(false);
      setEditingPost(null);
      await fetchPosts();
    } catch (e) {
      alertMsg((e as { message?: string })?.message || '更新に失敗しました', '保存できませんでした');
    } finally {
      setEditSaving(false);
    }
  };

  const editSelectRepeat = (r: RepeatOption) => {
    if (r !== 'none' && plan !== 'pro') {
      alertMsg('くりかえし投稿はProプラン限定です', '⭐ Pro限定の機能です');
      return;
    }
    setEditRepeat(r);
  };

  const filtered = posts.filter((p) => filter === 'all' || p.status === filter);

  // 投稿タブのサブ画面（リール／本日の出勤）
  if (mode === 'now' && nowSub === 'reel') {
    return <ReelScreen onBack={() => setNowSub('menu')} />;
  }
  if (mode === 'now' && nowSub === 'roster') {
    return <RosterScreen onBack={() => setNowSub('menu')} />;
  }

  return (
    <View style={styles.wrapper}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 100 }}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{mode === 'now' ? '投稿' : '予約投稿'}</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openModal}>
            <Text style={styles.addBtnText}>
              {mode === 'now' ? '＋ 投稿を作成' : '＋ 追加'}
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'now' ? (
          /* 「投稿」タブ: 何を作るか選ぶ */
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📸</Text>
            <Text style={styles.emptyTitle}>何を投稿しますか？</Text>
            <Text style={styles.emptyDesc}>
              作成して、すぐにInstagramへ投稿できます
            </Text>
            <TouchableOpacity style={styles.emptyAddBtn} onPress={openModal}>
              <Text style={styles.emptyAddBtnText}>📷 フィード・ストーリーを作成</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.emptyAddBtn, styles.reelChoiceBtn]}
              onPress={() => setNowSub('reel')}
            >
              <Text style={styles.emptyAddBtnText}>🎬 リールを作成</Text>
            </TouchableOpacity>
            {/* 「本日の出勤」は機能を練ってから公開予定。準備ができたら下を有効化する
            <TouchableOpacity
              style={[styles.emptyAddBtn, styles.rosterChoiceBtn]}
              onPress={() => setNowSub('roster')}
            >
              <Text style={styles.emptyAddBtnText}>🗓 本日の出勤を作成</Text>
            </TouchableOpacity>
            */}
          </View>
        ) : (
          <>
        {/* Japan best time hint */}
        <View style={styles.hintCard}>
          <Text style={styles.hintText}>
            💡 最適な投稿時間: 平日18〜21時・12〜13時 ／ 休日11〜13時・19〜21時
          </Text>
        </View>

        <View style={styles.filterRow}>
          {(['all', 'pending', 'published', 'failed'] as Filter[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterTab, filter === f && styles.filterTabActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f === 'all' ? 'すべて' : f === 'pending' ? '予約中' : f === 'published' ? '投稿済' : '失敗'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>予約投稿はありません</Text>
            <Text style={styles.emptyDesc}>AI生成した投稿を最適な時間に自動投稿できます</Text>
            <TouchableOpacity style={styles.emptyAddBtn} onPress={openModal}>
              <Text style={styles.emptyAddBtnText}>＋ 最初の予約を追加する</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((post) => (
            <View key={post.id} style={styles.postCard}>
              <View style={styles.postHeader}>
                <View style={styles.postMeta}>
                  <View style={[styles.typeBadge, post.type !== 'feed' && styles.typeBadgeStory]}>
                    <Text style={styles.typeBadgeText}>
                      {post.type === 'feed' ? '📷 フィード' : post.type === 'reel' ? '🎬 リール' : '📖 ストーリー'}
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
                      {post.status === 'pending' ? '⏳ 予約中' : post.status === 'published' ? '✅ 投稿済' : '❌ 失敗'}
                    </Text>
                  </View>
                  {post.repeat && post.repeat !== 'none' && (
                    <View style={styles.repeatBadge}>
                      <Text style={styles.repeatBadgeText}>🔁 {REPEAT_SHORT[post.repeat]}</Text>
                    </View>
                  )}
                </View>
                {post.status === 'pending' && (
                  <View style={styles.cardActions}>
                    <TouchableOpacity onPress={() => openEdit(post)} hitSlop={8}>
                      <Text style={styles.editBtn}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(post.id)} hitSlop={8}>
                      <Text style={styles.deleteBtn}>🗑</Text>
                    </TouchableOpacity>
                  </View>
                )}
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
                <Text style={styles.scheduleTime}>🕐 {formatDate(post.scheduled_at)}</Text>
              </View>
            </View>
          ))
        )}
          </>
        )}
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView
          style={styles.modal}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCancel}>キャンセル</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {mode === 'now' ? '投稿を作成' : '予約投稿を追加'}
            </Text>
            {mode === 'schedule' ? (
              <TouchableOpacity onPress={handleSave} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color={COLORS.primary} />
                ) : (
                  <Text style={styles.modalSave}>保存</Text>
                )}
              </TouchableOpacity>
            ) : (
              <View style={{ width: 48 }} />
            )}
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>投稿タイプ</Text>
            <View style={styles.typeRow}>
              {(['feed', 'story'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeBtn, type === t && styles.typeBtnActive]}
                  onPress={() => setType(t)}
                >
                  <Text style={[styles.typeBtnText, type === t && styles.typeBtnTextActive]}>
                    {t === 'feed' ? '📷 フィード' : '📖 ストーリー'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ストーリー：写真+文字 か 動画 を選ぶ */}
            {type === 'story' && (
              <>
                <Text style={styles.fieldLabel}>ストーリーの種類</Text>
                <View style={styles.typeRow}>
                  <TouchableOpacity
                    style={[styles.typeBtn, storyMode === 'image' && styles.typeBtnActive]}
                    onPress={() => setStoryMode('image')}
                  >
                    <Text style={[styles.typeBtnText, storyMode === 'image' && styles.typeBtnTextActive]}>
                      🖼 写真＋文字
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.typeBtn, storyMode === 'video' && styles.typeBtnActive]}
                    onPress={() => setStoryMode('video')}
                  >
                    <Text style={[styles.typeBtnText, storyMode === 'video' && styles.typeBtnTextActive]}>
                      📹 動画
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* ストーリー動画モード */}
            {type === 'story' && storyMode === 'video' ? (
              <>
                <Text style={styles.fieldLabel}>ストーリーにする動画</Text>
                <TouchableOpacity style={styles.imagePickerBox} onPress={pickStoryVideo} activeOpacity={0.85}>
                  {storyVideoUri ? (
                    <Text style={styles.imageReadyText}>✅ 動画を選びました（タップで変更）</Text>
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <Text style={styles.imagePlaceholderIcon}>📹</Text>
                      <Text style={styles.imagePlaceholderText}>タップして動画を選ぶ</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <Text style={styles.fieldLabel}>動画にのせる見出し（任意）</Text>
                <TextInput
                  style={styles.input}
                  value={storyVideoText}
                  onChangeText={setStoryVideoText}
                  placeholder="例: 本日OPEN / 新作入荷"
                  placeholderTextColor={COLORS.textMuted}
                />
                <TouchableOpacity
                  style={[styles.aiBtn, { marginTop: SPACING.sm }, aiLoading && styles.publishNowBtnDisabled]}
                  onPress={handleGenerateVideoHeadline}
                  disabled={aiLoading}
                  activeOpacity={0.85}
                >
                  {aiLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.aiBtnText}>✨ 動画から見出しを作る</Text>
                  )}
                </TouchableOpacity>

                {storyVideoText.trim() ? (
                  <>
                    <Text style={styles.fieldLabel}>文字の位置</Text>
                    <View style={styles.typeRow}>
                      {([['top', '上'], ['center', '中央'], ['bottom', '下']] as const).map(
                        ([pos, label]) => (
                          <TouchableOpacity
                            key={pos}
                            style={[styles.typeBtn, storyVideoTextPos === pos && styles.typeBtnActive]}
                            onPress={() => setStoryVideoTextPos(pos)}
                          >
                            <Text
                              style={[
                                styles.typeBtnText,
                                storyVideoTextPos === pos && styles.typeBtnTextActive,
                              ]}
                            >
                              {label}
                            </Text>
                          </TouchableOpacity>
                        )
                      )}
                    </View>
                  </>
                ) : null}

                {storyVideoUri ? (
                  <View style={styles.videoPreviewWrap}>
                    <View ref={storyVideoHostRef} style={styles.videoPreviewHost} />
                    {storyVideoText.trim() ? (
                      <Text
                        style={[
                          styles.videoOverlayText,
                          storyVideoTextPos === 'top' && { top: 16 },
                          storyVideoTextPos === 'center' && { top: '44%' },
                          storyVideoTextPos === 'bottom' && { bottom: 24 },
                        ]}
                      >
                        {storyVideoText.trim()}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                <Text style={styles.publishNowHint}>
                  ※ 縦長(9:16)推奨。見出しを入れると動画に焼き込みます（少し時間がかかります）。音楽はInstagramで付けられます
                </Text>
              </>
            ) : (
              <>
            {/* 写真（フィード=正方形 / ストーリー=縦長） */}
            <Text style={styles.fieldLabel}>
              {type === 'story' ? '背景写真（縦長 9:16）' : '投稿画像（複数選択OK・カルーセル）'}
            </Text>
            <TouchableOpacity
              style={styles.imagePickerBox}
              onPress={pickAndUploadImage}
              activeOpacity={0.85}
              disabled={imageUploading || composing}
            >
              {type === 'feed' && feedPreviews.length > 0 ? (
                <View style={styles.thumbRow}>
                  {feedPreviews.map((uri, i) => (
                    <View key={i} style={styles.thumbWrap}>
                      <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
                      <Text style={styles.thumbNum}>{i + 1}</Text>
                    </View>
                  ))}
                </View>
              ) : imagePreview ? (
                <Image
                  source={{ uri: imagePreview }}
                  style={[styles.storyPreview]}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Text style={styles.imagePlaceholderIcon}>🖼</Text>
                  <Text style={styles.imagePlaceholderText}>
                    タップして写真を選ぶ{type === 'feed' ? '（複数OK）' : ''}
                  </Text>
                </View>
              )}
              {(imageUploading || composing) && (
                <View style={styles.imageUploadingOverlay}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.imageUploadingText}>
                    {composing ? '合成中...' : 'アップロード中...'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
              </>
            )}

            {type === 'story' && storyMode === 'video' ? null : type === 'feed' ? (
              <>
                {/* AI生成カード */}
                <View style={styles.aiCard}>
                  <Text style={styles.aiCardTitle}>✨ AIで文章を作る</Text>

                  <Text style={styles.fieldLabel}>AIへの指示（任意・どちらにも反映）</Text>
                  <TextInput
                    style={[styles.input, styles.aiInstructionInput]}
                    value={aiInstruction}
                    onChangeText={setAiInstruction}
                    placeholder={'例: もっとカジュアルに\n絵文字多めで\n短く3行で'}
                    placeholderTextColor={COLORS.textMuted}
                    multiline
                  />

                  {/* 書き直し（生成後のみ表示・指示欄の下） */}
                  {caption.trim() ? (
                    <TouchableOpacity
                      style={[styles.aiBtnGhost, aiLoading && styles.publishNowBtnDisabled]}
                      onPress={handleRefineCaption}
                      disabled={aiLoading}
                      activeOpacity={0.85}
                    >
                      {aiLoading ? (
                        <ActivityIndicator color={COLORS.secondary} />
                      ) : (
                        <Text style={styles.aiBtnGhostText}>✏️ 今の文章を指示で書き直す</Text>
                      )}
                    </TouchableOpacity>
                  ) : null}

                  {/* 方法A: テーマから */}
                  <View style={styles.aiMethod}>
                    <Text style={styles.aiMethodTitle}>📝 テーマから作る</Text>
                    <TextInput
                      style={styles.input}
                      value={feedTheme}
                      onChangeText={setFeedTheme}
                      placeholder="例: 夏の新メニュー紹介"
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <TouchableOpacity
                      style={[styles.aiBtn, { marginTop: SPACING.sm }, aiLoading && styles.publishNowBtnDisabled]}
                      onPress={handleGenerateFeedText}
                      disabled={aiLoading}
                      activeOpacity={0.85}
                    >
                      {aiLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.aiBtnText}>✨ テーマから作る</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* 方法B: 写真から */}
                  <View style={styles.aiMethod}>
                    <Text style={styles.aiMethodTitle}>📷 写真から作る</Text>
                    <Text style={styles.aiHintText}>
                      投稿用に選んだ写真（最大5枚）を見て作ります
                    </Text>
                    <TouchableOpacity
                      style={[styles.aiBtn, aiLoading && styles.publishNowBtnDisabled]}
                      onPress={handleGenerateFeedFromPhoto}
                      disabled={aiLoading}
                      activeOpacity={0.85}
                    >
                      {aiLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.aiBtnText}>📷 選んだ写真から作る</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.sectionDivider}>投稿内容</Text>
                <Text style={styles.fieldLabel}>キャプション</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={caption}
                  onChangeText={setCaption}
                  placeholder="投稿のキャプションを入力"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  numberOfLines={4}
                />
                <Text style={styles.fieldLabel}>ハッシュタグ（スペース区切り）</Text>
                <TextInput
                  style={styles.input}
                  value={hashtagsText}
                  onChangeText={setHashtagsText}
                  placeholder="#春コーデ #新作 #ファッション"
                  placeholderTextColor={COLORS.textMuted}
                />
                {imageUrl && !imageUploading ? (
                  <Text style={styles.imageReadyText}>
                    ✅ {imageUrls.length > 1 ? `画像${imageUrls.length}枚（カルーセル）の準備ができました` : '画像の準備ができました'}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                {/* AI生成カード（フィードと統一） */}
                <View style={styles.aiCard}>
                  <Text style={styles.aiCardTitle}>✨ AIで文字を作る</Text>
                  <Text style={styles.fieldLabel}>テーマ</Text>
                  <TextInput
                    style={styles.input}
                    value={storyTheme}
                    onChangeText={setStoryTheme}
                    placeholder="例: 夏セールのお知らせ"
                    placeholderTextColor={COLORS.textMuted}
                  />
                  <Text style={styles.fieldLabel}>内容・詳細</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={storyDetails}
                    onChangeText={setStoryDetails}
                    placeholder="例: 7/20〜31限定で全品20%OFF"
                    placeholderTextColor={COLORS.textMuted}
                    multiline
                    numberOfLines={2}
                  />
                  <TouchableOpacity
                    style={[styles.aiBtn, { marginTop: SPACING.sm }, aiLoading && styles.publishNowBtnDisabled]}
                    onPress={handleGenerateStoryText}
                    disabled={aiLoading}
                    activeOpacity={0.85}
                  >
                    {aiLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.aiBtnText}>✨ AIで文章を作る</Text>
                    )}
                  </TouchableOpacity>
                </View>

                <Text style={styles.sectionDivider}>画像にのせる文字</Text>
                <Text style={styles.fieldLabel}>タイトル（大きく表示）</Text>
                <TextInput
                  style={styles.input}
                  value={storyTitle}
                  onChangeText={(t) => {
                    setStoryTitle(t);
                    setImageUrl('');
                  }}
                  placeholder="見出し"
                  placeholderTextColor={COLORS.textMuted}
                />
                <Text style={styles.fieldLabel}>本文</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={storyBody}
                  onChangeText={(t) => {
                    setStoryBody(t);
                    setImageUrl('');
                  }}
                  placeholder="補足の文章"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  numberOfLines={2}
                />
                <Text style={styles.fieldLabel}>ボタン文言（CTA）</Text>
                <TextInput
                  style={styles.input}
                  value={storyCta}
                  onChangeText={(t) => {
                    setStoryCta(t);
                    setImageUrl('');
                  }}
                  placeholder="例: 今すぐチェック"
                  placeholderTextColor={COLORS.textMuted}
                />

                {storyRawUri &&
                (storyTitle.trim() || storyBody.trim() || storyCta.trim()) ? (
                  <>
                    <Text style={styles.sectionDivider}>レイアウト調整</Text>
                    <StoryEditor
                      imageUri={storyRawUri}
                      overlay={{
                        title: storyTitle.trim(),
                        bodyText: storyBody.trim(),
                        cta: storyCta.trim(),
                        textColor: storyTextColor,
                      }}
                      onChange={(t) => {
                        setStoryTransform(t);
                        setImageUrl('');
                      }}
                    />

                    <TouchableOpacity
                      style={[styles.composeBtn, composing && styles.publishNowBtnDisabled]}
                      onPress={handleComposeStory}
                      disabled={composing}
                      activeOpacity={0.85}
                    >
                      {composing ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.composeBtnText}>✅ この画像で確定する</Text>
                      )}
                    </TouchableOpacity>
                    {imageUrl && !composing ? (
                      <Text style={styles.imageReadyText}>
                        ✅ ストーリー画像の準備ができました
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.publishNowHint}>
                    写真を選び、文字を入力すると編集プレビューが表示されます
                  </Text>
                )}
              </>
            )}

            {mode === 'schedule' && (
              <>
                <Text style={styles.fieldLabel}>予約日時</Text>

                {/* Quick date buttons */}
                <Text style={styles.quickLabel}>おすすめ時間帯</Text>
                <View style={styles.quickDatesGrid}>
                  {quickDates.map((qd) => (
                    <TouchableOpacity
                      key={qd.value}
                      style={[styles.quickDateBtn, dateText === qd.value && styles.quickDateBtnActive, qd.isOptimal && styles.quickDateBtnOptimal]}
                      onPress={() => setDateText(qd.value)}
                    >
                      {qd.isOptimal && <Text style={styles.quickDateOptimalDot}>●</Text>}
                      <Text style={[styles.quickDateText, dateText === qd.value && styles.quickDateTextActive]}>
                        {qd.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TextInput
                  style={[styles.input, { marginTop: SPACING.sm }]}
                  value={dateText}
                  onChangeText={setDateText}
                  placeholder="例: 2026-06-15T18:00"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                />

                <Text style={styles.fieldLabel}>
                  くりかえし {plan !== 'pro' && '⭐Pro'}
                </Text>
                <View style={styles.repeatRow}>
                  {REPEAT_OPTIONS.map((opt) => {
                    const active = repeat === opt.key;
                    const locked = opt.key !== 'none' && plan !== 'pro';
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        style={[styles.repeatBtn, active && styles.repeatBtnActive]}
                        onPress={() => selectRepeat(opt.key)}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[styles.repeatBtnText, active && styles.repeatBtnTextActive]}
                        >
                          {opt.label}
                          {locked ? ' 🔒' : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {repeat !== 'none' && (
                  <Text style={styles.repeatHint}>
                    🔁 上の日時を1回目として、{REPEAT_SHORT[repeat]}くりかえし自動投稿します
                  </Text>
                )}
              </>
            )}

            <Text style={styles.sectionDivider}>Instagram</Text>
            {instagramCredentials ? (
              <View style={styles.igConnectedBox}>
                <Text style={styles.igConnectedText}>
                  ✅ {instagramCredentials.username ? `@${instagramCredentials.username}` : '連携済み'} に投稿します
                </Text>
              </View>
            ) : (
              <View style={styles.igWarnBox}>
                <Text style={styles.igWarnText}>
                  ⚠️ 未連携です。右上のアイコンからInstagramを連携してください
                </Text>
              </View>
            )}

            {mode === 'now' ? (
              <>
                {/* 今すぐ投稿 */}
                <TouchableOpacity
                  style={[styles.publishNowBtn, (publishing || !instagramCredentials) && styles.publishNowBtnDisabled]}
                  onPress={handlePublishNow}
                  disabled={publishing || !instagramCredentials}
                  activeOpacity={0.85}
                >
                  {publishing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.publishNowText}>🚀 今すぐ投稿する</Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.publishNowHint}>
                  ※ すぐにInstagramへ投稿します
                </Text>
              </>
            ) : (
              <>
                {/* 予約を保存 */}
                <TouchableOpacity
                  style={[styles.publishNowBtn, saving && styles.publishNowBtnDisabled]}
                  onPress={handleSave}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.publishNowText}>📅 この内容で予約する</Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.publishNowHint}>
                  ※ 指定した日時に自動で投稿されます
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
            <TouchableOpacity onPress={() => setEditVisible(false)}>
              <Text style={styles.modalCancel}>キャンセル</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>予約を編集</Text>
            <TouchableOpacity onPress={saveEdit} disabled={editSaving}>
              {editSaving ? (
                <ActivityIndicator color={COLORS.primary} />
              ) : (
                <Text style={styles.modalSave}>保存</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {editingPost && (
              <Text style={styles.editKind}>
                {editingPost.type === 'feed'
                  ? '📷 フィード投稿'
                  : editingPost.type === 'reel'
                  ? '🎬 リール'
                  : '📖 ストーリー'}
                ／ 画像・動画は変更できません
              </Text>
            )}

            {editingPost?.type !== 'story' && (
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

            <Text style={styles.fieldLabel}>くりかえし {plan !== 'pro' && '⭐Pro'}</Text>
            <View style={styles.repeatRow}>
              {REPEAT_OPTIONS.map((opt) => {
                const active = editRepeat === opt.key;
                const locked = opt.key !== 'none' && plan !== 'pro';
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.repeatBtn, active && styles.repeatBtnActive]}
                    onPress={() => editSelectRepeat(opt.key)}
                  >
                    <Text style={[styles.repeatBtnText, active && styles.repeatBtnTextActive]}>
                      {opt.label}
                      {locked ? ' 🔒' : ''}
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
                <Text style={styles.publishNowText}>💾 変更を保存する</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
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
  publishNowBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  publishNowBtnDisabled: { opacity: 0.5 },
  publishNowText: { color: '#fff', fontSize: 15, fontWeight: '800' },
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
  videoOverlayText: {
    position: 'absolute',
    left: 8,
    right: 8,
    textAlign: 'center',
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.9)',
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

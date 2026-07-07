// リール（スライド動画）作成テスト画面：写真を選ぶ→文字をのせる→MP4を作ってプレビュー
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { createReel } from '../utils/createReel';
import { generateReelCaptions } from '../services/aiService';
import { getTopPostsForGeneration } from '../services/insightsService';
import { ensureLoggedIn } from '../utils/requireLogin';
import { useAppStore } from '../store/appStore';
import { getAccountTheme } from '../utils/accountThemes';
import { uploadBlob } from '../services/storage';
import { publishNow } from '../services/publishNow';
import { createScheduledPost } from '../services/scheduleService';

function parseDate(str: string): Date | null {
  const d = new Date(str.replace(/\//g, '-').replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

interface Slide {
  uri: string;
  text: string;
  seconds: number;
}

const SECONDS_PER = 3;
const SECONDS_OPTIONS = [2, 3, 4];

export default function ReelScreen({ onBack }: { onBack?: () => void } = {}) {
  const insets = useSafeAreaInsets();
  const [slides, setSlides] = useState<Slide[]>([]);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [theme, setTheme] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const brandSettings = useAppStore((s) => s.brandSettings);
  const instagramCredentials = useAppStore((s) => s.instagramCredentials);
  const [reelBlob, setReelBlob] = useState<Blob | null>(null);
  const [caption, setCaption] = useState('');
  const [hashtagsText, setHashtagsText] = useState('');
  const [dateText, setDateText] = useState('');
  const [posting, setPosting] = useState(false);

  const videoHostRef = useRef<any>(null);

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  // 自分の動画をそのままリールに使う
  const pickOwnVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
    });
    if (result.canceled) return;
    try {
      const r = await fetch(result.assets[0].uri);
      const b = await r.blob();
      setReelBlob(b);
      setPreviewUrl(URL.createObjectURL(b));
      setElapsed(null);
      setStatus('');
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '動画の読み込みに失敗しました', 'エラー');
    }
  };

  const pickPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.9,
    });
    if (result.canceled) return;
    const added = result.assets.map((a) => ({ uri: a.uri, text: '', seconds: SECONDS_PER }));
    setSlides((prev) => [...prev, ...added]);
    setPreviewUrl('');
  };

  const setText = (i: number, t: string) =>
    setSlides((prev) => prev.map((s, idx) => (idx === i ? { ...s, text: t } : s)));

  const setSeconds = (i: number, sec: number) => {
    setSlides((prev) => prev.map((s, idx) => (idx === i ? { ...s, seconds: sec } : s)));
    setPreviewUrl('');
  };

  const removeSlide = (i: number) => {
    setSlides((prev) => prev.filter((_, idx) => idx !== i));
    setPreviewUrl('');
  };

  const handleGenerateTexts = async () => {
    if (slides.length === 0) {
      alertMsg('先に写真を選んでください');
      return;
    }
    if (!theme.trim()) {
      alertMsg('テーマを入力してください（例：夏の新メニュー紹介）');
      return;
    }
    if (!(await ensureLoggedIn('AIで文字を作るにはログインが必要です'))) return;
    setAiLoading(true);
    try {
      const topPosts = await getTopPostsForGeneration();
      const captions = await generateReelCaptions({
        theme: theme.trim(),
        count: slides.length,
        industry: brandSettings.industry,
        toneHint: getAccountTheme(brandSettings.accountType).toneHint,
        topPosts,
      });
      setSlides((prev) => prev.map((s, i) => ({ ...s, text: captions[i] ?? s.text })));
      setPreviewUrl('');
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : 'AI生成に失敗しました', 'エラー');
    } finally {
      setAiLoading(false);
    }
  };

  const handleCreate = async () => {
    if (slides.length === 0) {
      alertMsg('写真を1枚以上選んでください');
      return;
    }
    setWorking(true);
    setPreviewUrl('');
    setStatus('動画エンジンを準備中...（初回は少し時間がかかります）');
    const start = Date.now();
    try {
      const at = getAccountTheme(brandSettings.accountType);
      const { blob, url } = await createReel(
        slides.map((s) => ({ imageUri: s.uri, text: s.text, seconds: s.seconds })),
        SECONDS_PER,
        (msg) => setStatus(msg),
        { accent: at.accent, captionStyle: at.captionStyle }
      );
      setPreviewUrl(url);
      setReelBlob(blob);
      setElapsed(Math.round((Date.now() - start) / 1000));
      setStatus('完成しました');
    } catch (e) {
      const detail =
        (e as { message?: string })?.message || String(e) || 'リールの作成に失敗しました';
      alertMsg(detail, 'エラー');
      setStatus(detail);
    } finally {
      setWorking(false);
    }
  };

  const buildHashtags = () =>
    hashtagsText
      .split(/[\s,　]+/)
      .map((h) => h.trim())
      .filter(Boolean);

  const ensureReady = async () => {
    if (!reelBlob) {
      alertMsg('先に「リールを作成する」を押してください');
      return false;
    }
    if (!instagramCredentials?.userId || !instagramCredentials?.accessToken) {
      alertMsg('右上のアイコンからInstagramを連携してください', '未連携です');
      return false;
    }
    return ensureLoggedIn('投稿にはログインが必要です');
  };

  const downloadReel = () => {
    if (!previewUrl || typeof document === 'undefined') return;
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = `reel-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handlePublishReel = async () => {
    if (!(await ensureReady())) return;
    if (Platform.OS === 'web' && !window.confirm('このリールを今すぐ投稿します。よろしいですか？')) {
      return;
    }
    setPosting(true);
    try {
      setStatus('動画をアップロード中...');
      const videoUrl = await uploadBlob(reelBlob!);
      setStatus('Instagramに投稿中...（動画の処理に1分ほどかかります）');
      await publishNow({
        caption: caption.trim(),
        hashtags: buildHashtags(),
        video_url: videoUrl,
        type: 'reel',
        instagram_user_id: instagramCredentials!.userId,
        access_token: instagramCredentials!.accessToken,
      });
      alertMsg('リールを投稿しました\nInstagramアプリで確認してください', '投稿完了');
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '投稿に失敗しました', 'エラー');
    } finally {
      setPosting(false);
      setStatus('');
    }
  };

  const handleScheduleReel = async () => {
    if (!(await ensureReady())) return;
    const date = parseDate(dateText);
    if (!date) {
      alertMsg('日時の形式が正しくありません\n例: 2026-06-15T18:00', '日時を確認してください');
      return;
    }
    if (date <= new Date()) {
      alertMsg('予約日時は未来の日時を指定してください');
      return;
    }
    setPosting(true);
    try {
      setStatus('動画をアップロード中...');
      const videoUrl = await uploadBlob(reelBlob!);
      await createScheduledPost({
        caption: caption.trim(),
        hashtags: buildHashtags(),
        image_url: videoUrl, // リールは image_url 列に動画URLを保存
        scheduled_at: date,
        type: 'reel',
        instagram_user_id: instagramCredentials!.userId,
        access_token: instagramCredentials!.accessToken,
      });
      alertMsg('リールを予約しました\n指定の日時に自動投稿されます', '予約完了');
      setDateText('');
    } catch (e) {
      alertMsg((e as { message?: string })?.message || '予約に失敗しました', 'エラー');
    } finally {
      setPosting(false);
      setStatus('');
    }
  };

  // プレビュー動画（web）：ホストに<video>を差し込む
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const host = videoHostRef.current as HTMLElement | null;
    if (!host) return;
    host.innerHTML = '';
    if (!previewUrl) return;
    const video = document.createElement('video');
    video.src = previewUrl;
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    (video as any).disablePictureInPicture = true;
    Object.assign(video.style, {
      width: '240px',
      height: '427px',
      borderRadius: '14px',
      backgroundColor: '#000',
      display: 'block',
      touchAction: 'none', // ピンチで全画面/拡大表示にならないように
    } as Partial<CSSStyleDeclaration>);
    host.appendChild(video);
  }, [previewUrl]);

  const totalSec = slides.reduce((sum, s) => sum + s.seconds, 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 100 }}
    >
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} hitSlop={8} style={{ marginBottom: SPACING.xs }}>
            <Text style={styles.backText}>← 投稿の選択に戻る</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>リール作成</Text>
      </View>
      <Text style={styles.desc}>
        自分の動画をそのまま投稿するか、写真からスライド動画を作れます。
      </Text>

      <TouchableOpacity style={styles.ownVideoBtn} onPress={pickOwnVideo} activeOpacity={0.85}>
        <Text style={styles.ownVideoBtnText}>自分の動画を選んで投稿</Text>
      </TouchableOpacity>

      <Text style={styles.orText}>― または 写真からスライド動画を作る ―</Text>

      <TouchableOpacity style={styles.pickBtn} onPress={pickPhotos} activeOpacity={0.85}>
        <Text style={styles.pickBtnText}>＋ 写真を選ぶ（複数OK）</Text>
      </TouchableOpacity>

      {slides.length > 0 && (
        <Text style={styles.countText}>
          {slides.length}枚 ／ 約{totalSec}秒の動画になります
        </Text>
      )}

      {slides.length > 0 && (
        <View style={styles.aiBox}>
          <Text style={styles.aiBoxLabel}>AIで文字を作る</Text>
          <TextInput
            style={styles.input}
            value={theme}
            onChangeText={setTheme}
            placeholder="テーマ（例：夏の新メニュー紹介）"
            placeholderTextColor={COLORS.textMuted}
          />
          <TouchableOpacity
            style={[styles.aiBtn, aiLoading && styles.createBtnDisabled]}
            onPress={handleGenerateTexts}
            disabled={aiLoading}
            activeOpacity={0.85}
          >
            {aiLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.aiBtnText}>{slides.length}枚分の文字をAIで作る</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.aiHint}>各写真の文字に自動で入ります（あとで手直しもできます）</Text>
        </View>
      )}

      {slides.map((s, i) => (
        <View key={i} style={styles.slideRow}>
          <Image source={{ uri: s.uri }} style={styles.thumb} resizeMode="cover" />
          <View style={{ flex: 1 }}>
            <Text style={styles.slideLabel}>{i + 1}枚目の文字</Text>
            <TextInput
              style={styles.input}
              value={s.text}
              onChangeText={(t) => setText(i, t)}
              placeholder="この写真にのせる文字（任意）"
              placeholderTextColor={COLORS.textMuted}
            />
            <View style={styles.secRow}>
              <Text style={styles.secLabel}>表示時間</Text>
              {SECONDS_OPTIONS.map((sec) => (
                <TouchableOpacity
                  key={sec}
                  style={[styles.secBtn, s.seconds === sec && styles.secBtnActive]}
                  onPress={() => setSeconds(i, sec)}
                >
                  <Text style={[styles.secBtnText, s.seconds === sec && styles.secBtnTextActive]}>
                    {sec}秒
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => removeSlide(i)} style={{ marginLeft: 'auto' }}>
                <Text style={styles.removeText}>削除</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ))}

      {slides.length > 0 && (
        <TouchableOpacity
          style={[styles.createBtn, working && styles.createBtnDisabled]}
          onPress={handleCreate}
          disabled={working}
          activeOpacity={0.85}
        >
          {working ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.createBtnText}>リールを作成する</Text>
          )}
        </TouchableOpacity>
      )}

      {working && <Text style={styles.status}>{status}</Text>}

      {previewUrl ? (
        <View style={styles.previewWrap}>
          <Text style={styles.previewTitle}>
            プレビュー{elapsed != null ? `（作成 ${elapsed}秒）` : ''}
          </Text>
          <View ref={videoHostRef} style={styles.videoHost} />
        </View>
      ) : null}

      {previewUrl ? (
        <View style={styles.postWrap}>
          {/* おすすめ：保存してInstagramで音楽をつけて投稿 */}
          <TouchableOpacity style={styles.saveBtn} onPress={downloadReel} activeOpacity={0.85}>
            <Text style={styles.saveBtnText}>動画を保存する</Text>
          </TouchableOpacity>
          <Text style={styles.saveHint}>
            おすすめ：保存した動画をInstagramアプリで投稿すると、トレンド音楽を付けられます
          </Text>

          <Text style={styles.orDivider}>― または アプリから直接投稿（音楽なし） ―</Text>

          <Text style={styles.sectionTitle}>キャプション</Text>
          <TextInput
            style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
            value={caption}
            onChangeText={setCaption}
            placeholder="リールの説明文（任意）"
            placeholderTextColor={COLORS.textMuted}
            multiline
          />
          <TextInput
            style={[styles.input, { marginTop: SPACING.sm }]}
            value={hashtagsText}
            onChangeText={setHashtagsText}
            placeholder="#ハッシュタグ #カフェ #新メニュー"
            placeholderTextColor={COLORS.textMuted}
          />

          {instagramCredentials ? (
            <Text style={styles.igOk}>
              {instagramCredentials.username ? `@${instagramCredentials.username}` : '連携済み'} に投稿します
            </Text>
          ) : (
            <Text style={styles.igWarn}>右上のアイコンからInstagramを連携してください</Text>
          )}

          <TouchableOpacity
            style={[styles.postBtn, posting && styles.createBtnDisabled]}
            onPress={handlePublishReel}
            disabled={posting}
            activeOpacity={0.85}
          >
            {posting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.createBtnText}>今すぐ投稿する</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>または予約</Text>
          <TextInput
            style={styles.input}
            value={dateText}
            onChangeText={setDateText}
            placeholder="例: 2026-06-15T18:00"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.scheduleBtn, posting && styles.createBtnDisabled]}
            onPress={handleScheduleReel}
            disabled={posting}
            activeOpacity={0.85}
          >
            <Text style={styles.createBtnText}>この日時に予約する</Text>
          </TouchableOpacity>

          {posting && status ? <Text style={styles.status}>{status}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.lg },
  header: { marginBottom: SPACING.sm },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  backText: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
  desc: { color: COLORS.textSecondary, fontSize: 13, marginBottom: SPACING.md },
  pickBtn: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.primary + '55',
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  pickBtnText: { color: COLORS.primary, fontSize: 15, fontWeight: '700' },
  ownVideoBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  ownVideoBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  orText: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginVertical: SPACING.md,
  },
  countText: { color: COLORS.textSecondary, fontSize: 13, marginTop: SPACING.sm },
  aiBox: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.secondary + '44',
  },
  aiBoxLabel: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginBottom: SPACING.sm },
  aiBtn: {
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  aiBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  aiHint: { color: COLORS.textMuted, fontSize: 11, marginTop: SPACING.sm },
  slideRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
  },
  thumb: { width: 72, height: 128, borderRadius: RADIUS.sm, backgroundColor: '#000' },
  slideLabel: { color: COLORS.textMuted, fontSize: 12, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
    color: COLORS.text,
    fontSize: 14,
  },
  removeText: { color: COLORS.error ?? '#E5484D', fontSize: 13 },
  secRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.sm },
  secLabel: { color: COLORS.textMuted, fontSize: 12, marginRight: 4 },
  secBtn: {
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  secBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  secBtnText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  secBtnTextActive: { color: '#fff' },
  createBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  status: { color: COLORS.textMuted, fontSize: 12, marginTop: SPACING.sm, textAlign: 'center' },
  postWrap: { marginTop: SPACING.xl },
  saveBtn: {
    backgroundColor: COLORS.success ?? '#4CAF50',
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  saveHint: { color: COLORS.textMuted, fontSize: 12, marginTop: SPACING.sm, textAlign: 'center' },
  orDivider: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: SPACING.lg,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  igOk: { color: COLORS.success ?? '#4CAF50', fontSize: 13, fontWeight: '600', marginTop: SPACING.md },
  igWarn: { color: COLORS.warning ?? '#FF9800', fontSize: 13, fontWeight: '600', marginTop: SPACING.md },
  postBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  scheduleBtn: {
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  previewWrap: { alignItems: 'center', marginTop: SPACING.xl },
  previewTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: SPACING.sm },
  videoHost: { width: 240, height: 427 },
  previewHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
});

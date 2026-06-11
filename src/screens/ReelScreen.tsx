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
import { ensureLoggedIn } from '../utils/requireLogin';
import { useAppStore } from '../store/appStore';

interface Slide {
  uri: string;
  text: string;
}

const SECONDS_PER = 3;

export default function ReelScreen() {
  const insets = useSafeAreaInsets();
  const [slides, setSlides] = useState<Slide[]>([]);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [theme, setTheme] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const brandSettings = useAppStore((s) => s.brandSettings);

  const videoHostRef = useRef<any>(null);

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  const pickPhotos = async () => {
    const { status: perm } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm !== 'granted') {
      alertMsg('写真へのアクセスを許可してください', '権限エラー');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.9,
    });
    if (result.canceled) return;
    const added = result.assets.map((a) => ({ uri: a.uri, text: '' }));
    setSlides((prev) => [...prev, ...added]);
    setPreviewUrl('');
  };

  const setText = (i: number, t: string) =>
    setSlides((prev) => prev.map((s, idx) => (idx === i ? { ...s, text: t } : s)));

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
      const captions = await generateReelCaptions({
        theme: theme.trim(),
        count: slides.length,
        industry: brandSettings.industry,
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
      const { url } = await createReel(
        slides.map((s) => ({ imageUri: s.uri, text: s.text })),
        SECONDS_PER,
        (msg) => setStatus(msg)
      );
      setPreviewUrl(url);
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
    Object.assign(video.style, {
      width: '240px',
      height: '427px',
      borderRadius: '14px',
      backgroundColor: '#000',
      display: 'block',
    } as Partial<CSSStyleDeclaration>);
    host.appendChild(video);
  }, [previewUrl]);

  const totalSec = slides.length * SECONDS_PER;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 100 }}
    >
      <View style={styles.header}>
        <Text style={styles.title}>リール作成（テスト）</Text>
      </View>
      <Text style={styles.desc}>
        写真を数枚選び、文字をのせると、1枚{SECONDS_PER}秒のスライド動画(MP4)を作ります。
      </Text>

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
          <Text style={styles.aiBoxLabel}>✨ AIで文字を作る</Text>
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
              <Text style={styles.aiBtnText}>✨ {slides.length}枚分の文字をAIで作る</Text>
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
            <TouchableOpacity onPress={() => removeSlide(i)}>
              <Text style={styles.removeText}>🗑 削除</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.createBtn, working && styles.createBtnDisabled]}
        onPress={handleCreate}
        disabled={working}
        activeOpacity={0.85}
      >
        {working ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.createBtnText}>🎬 リールを作成する</Text>
        )}
      </TouchableOpacity>

      {working && <Text style={styles.status}>{status}</Text>}

      {previewUrl ? (
        <View style={styles.previewWrap}>
          <Text style={styles.previewTitle}>
            プレビュー{elapsed != null ? `（作成 ${elapsed}秒）` : ''}
          </Text>
          <View ref={videoHostRef} style={styles.videoHost} />
          <Text style={styles.previewHint}>
            ※ これはテストです。ここまで動けば、次に「Instagramへ投稿・予約」を足します。
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.lg },
  header: { marginBottom: SPACING.sm },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
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
  removeText: { color: COLORS.error ?? '#E5484D', fontSize: 13, marginTop: SPACING.sm },
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

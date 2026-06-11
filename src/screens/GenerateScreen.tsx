import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Clipboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { generatePost, generateFromImage, getSeasonalThemes, INDUSTRIES } from '../services/aiService';
import { getAiUsage, AiUsage } from '../services/scheduleService';
import { ensureLoggedIn } from '../utils/requireLogin';
import { useAppStore } from '../store/appStore';
import { COLORS, SPACING, RADIUS } from '../utils/theme';

type Mode = 'photo' | 'text';
type ContentType = 'feed' | 'story' | 'reel';

const CONTENT_TYPES: { key: ContentType; label: string; emoji: string; desc: string }[] = [
  { key: 'feed', label: 'フィード', emoji: '📷', desc: '通常投稿' },
  { key: 'story', label: 'ストーリー', emoji: '📖', desc: '24時間' },
  { key: 'reel', label: 'リール', emoji: '🎬', desc: '短尺動画' },
];

const TONES = ['明るい・ポジティブ', 'プロフェッショナル', 'カジュアル', '感情的・共感', 'ユーモラス'];

type GenerationResult = { caption: string; hashtags: string[]; suggestions: string[] };

export default function GenerateScreen() {
  const insets = useSafeAreaInsets();
  const { setDraft, brandSettings, setBrandSettings } = useAppStore();

  const [mode, setMode] = useState<Mode>('photo');
  const [contentType, setContentType] = useState<ContentType>('feed');
  const [tone, setTone] = useState(brandSettings.tone || '明るい・ポジティブ');
  const [selectedIndustry, setSelectedIndustry] = useState(brandSettings.industry || '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const refreshUsage = () => getAiUsage().then(setUsage).catch(() => {});
  useEffect(() => {
    refreshUsage();
  }, []);

  // Web では Alert.alert が表示されないため window.alert を使う
  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  // Photo mode
  const [selectedImage, setSelectedImage] = useState<{
    uri: string;
    base64: string;
    mimeType: string;
  } | null>(null);

  // Text mode
  const [theme, setTheme] = useState('');
  const [customTheme, setCustomTheme] = useState('');
  const [keywords, setKeywords] = useState('');

  const month = new Date().getMonth() + 1;
  const seasonalEvents = useMemo(() => getSeasonalThemes(month), [month]);

  const pickImage = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        alertMsg('写真へのアクセスを許可してください', '権限エラー');
        return;
      }
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (res.canceled) return;

    const asset = res.assets[0];
    let base64 = asset.base64 ?? '';

    if (!base64 && Platform.OS !== 'web' && asset.uri) {
      base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    setSelectedImage({ uri: asset.uri, base64, mimeType: asset.mimeType ?? 'image/jpeg' });
    setResult(null);
  };

  const handleGenerate = async () => {
    if (!(await ensureLoggedIn('AI生成を使うにはログインが必要です'))) return;
    setLoading(true);
    setResult(null);
    try {
      let generated: GenerationResult;

      if (mode === 'photo') {
        if (!selectedImage?.base64) {
          alertMsg('写真を選択してください', 'エラー');
          setLoading(false);
          return;
        }
        generated = await generateFromImage({
          imageBase64: selectedImage.base64,
          mimeType: selectedImage.mimeType as any,
          contentType,
          tone,
          industry: selectedIndustry,
        });
      } else {
        const selectedTheme = customTheme || theme;
        if (!selectedTheme) {
          alertMsg('テーマを選択または入力してください', 'エラー');
          setLoading(false);
          return;
        }
        generated = await generatePost({
          theme: selectedTheme,
          tone,
          keywords: keywords.split('、').filter(Boolean),
          includeHashtags: true,
          language: 'ja',
          industry: selectedIndustry,
        });
      }

      setResult(generated);
      setDraft({
        caption: generated.caption,
        hashtags: generated.hashtags,
        type: contentType === 'reel' ? 'feed' : contentType,
      });
    } catch (e) {
      // サーバーからのメッセージ（回数上限など）をそのまま表示
      const msg =
        (e as { message?: string })?.message || 'AI生成に失敗しました。もう一度お試しください。';
      alertMsg(msg, 'エラー');
    } finally {
      setLoading(false);
      refreshUsage(); // 使用回数を更新
    }
  };

  const copyResult = () => {
    if (!result) return;
    Clipboard.setString(result.caption + '\n\n' + result.hashtags.join(' '));
    alertMsg('コピーしました ✅');
  };

  const handleIndustrySelect = (key: string) => {
    setSelectedIndustry(key);
    if (key && key !== brandSettings.industry) {
      setBrandSettings({ industry: key });
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>AI コンテンツ生成</Text>

      {/* Industry Selector */}
      <Text style={styles.label}>業種・ジャンル</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.industryRow}>
        {INDUSTRIES.map((ind) => (
          <TouchableOpacity
            key={ind.key}
            style={[styles.industryChip, selectedIndustry === ind.key && ind.key !== '' && styles.industryChipActive]}
            onPress={() => handleIndustrySelect(ind.key)}
          >
            <Text style={styles.industryEmoji}>{ind.emoji}</Text>
            <Text style={[styles.industryLabel, selectedIndustry === ind.key && ind.key !== '' && styles.industryLabelActive]}>
              {ind.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Mode toggle */}
      <View style={styles.modeRow}>
        {(['photo', 'text'] as Mode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
            onPress={() => { setMode(m); setResult(null); }}
          >
            <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextActive]}>
              {m === 'photo' ? '📷 写真から生成' : '✏️ テキストで生成'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content type */}
      <Text style={styles.label}>コンテンツタイプ</Text>
      <View style={styles.contentTypeRow}>
        {CONTENT_TYPES.map((ct) => (
          <TouchableOpacity
            key={ct.key}
            style={[styles.contentTypeCard, contentType === ct.key && styles.contentTypeCardActive]}
            onPress={() => setContentType(ct.key)}
          >
            <Text style={styles.contentTypeEmoji}>{ct.emoji}</Text>
            <Text style={[styles.contentTypeLabel, contentType === ct.key && styles.contentTypeLabelActive]}>
              {ct.label}
            </Text>
            <Text style={styles.contentTypeDesc}>{ct.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'photo' ? (
        <>
          <Text style={styles.label}>写真を選択</Text>
          <TouchableOpacity style={styles.imagePicker} onPress={pickImage} activeOpacity={0.8}>
            {selectedImage ? (
              <Image source={{ uri: selectedImage.uri }} style={styles.imagePreview} resizeMode="cover" />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Text style={styles.imagePlaceholderEmoji}>📸</Text>
                <Text style={styles.imagePlaceholderText}>タップして写真を選択</Text>
                <Text style={styles.imagePlaceholderSub}>AIが写真を分析してキャプションを生成します</Text>
              </View>
            )}
          </TouchableOpacity>
          {selectedImage && (
            <TouchableOpacity onPress={pickImage} style={styles.changePhotoBtn}>
              <Text style={styles.changePhotoBtnText}>写真を変更</Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <>
          {/* Seasonal quick themes */}
          {seasonalEvents.length > 0 && (
            <>
              <Text style={styles.label}>今月のおすすめテーマ</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonalRow}>
                {seasonalEvents.flatMap((ev) =>
                  ev.themes.map((t) => (
                    <TouchableOpacity
                      key={`${ev.event}-${t}`}
                      style={[styles.seasonChip, theme === t && styles.seasonChipActive]}
                      onPress={() => { setTheme(t); setCustomTheme(''); }}
                    >
                      <Text style={styles.seasonChipEmoji}>{ev.emoji}</Text>
                      <Text style={[styles.seasonChipText, theme === t && styles.seasonChipTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </>
          )}

          <Text style={styles.label}>投稿テーマ</Text>
          <TextInput
            style={styles.input}
            placeholder="例: 新しいカフェのオープン、秋の新作メニュー"
            placeholderTextColor={COLORS.textMuted}
            value={customTheme}
            onChangeText={(t) => { setCustomTheme(t); setTheme(''); }}
          />
          <Text style={styles.label}>キーワード（任意）</Text>
          <TextInput
            style={styles.input}
            placeholder="例: 秋、限定、新作（「、」で区切る）"
            placeholderTextColor={COLORS.textMuted}
            value={keywords}
            onChangeText={setKeywords}
          />
        </>
      )}

      {/* Tone */}
      <Text style={styles.label}>トーン・雰囲気</Text>
      <View style={styles.toneGrid}>
        {TONES.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.chip, tone === t && styles.chipActive]}
            onPress={() => setTone(t)}
          >
            <Text style={[styles.chipText, tone === t && styles.chipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* AI残り回数 */}
      {usage && (
        <View style={styles.usageBox}>
          <Text style={styles.usageText}>
            今月のAI生成：あと <Text style={styles.usageStrong}>{usage.remaining}</Text> 回
            （{usage.used}/{usage.limit}）
          </Text>
          {usage.plan === 'free' && usage.remaining <= 3 && (
            <Text style={styles.usageWarn}>
              残りわずかです。Proなら月{300}回まで使えます。
            </Text>
          )}
        </View>
      )}

      {/* Generate button */}
      <TouchableOpacity
        style={[styles.generateBtn, loading && styles.generateBtnDisabled]}
        onPress={handleGenerate}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.generateBtnText}>  AI生成中...</Text>
          </View>
        ) : (
          <Text style={styles.generateBtnText}>✨ AIで生成する</Text>
        )}
      </TouchableOpacity>

      {/* Result */}
      {result && (
        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <Text style={styles.resultTitle}>生成結果</Text>
            <TouchableOpacity onPress={copyResult} style={styles.copyBtn}>
              <Text style={styles.copyBtnText}>📋 コピー</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.resultLabel}>キャプション</Text>
          <Text style={styles.caption}>{result.caption}</Text>

          <Text style={styles.resultLabel}>ハッシュタグ（{result.hashtags.length}個）</Text>
          <Text style={styles.hashtags}>{result.hashtags.join(' ')}</Text>

          {result.suggestions.length > 0 && (
            <>
              <Text style={styles.resultLabel}>💡 アドバイス</Text>
              {result.suggestions.map((s, i) => (
                <Text key={i} style={styles.suggestion}>・{s}</Text>
              ))}
            </>
          )}

          <TouchableOpacity
            style={styles.scheduleBtn}
            onPress={() => alertMsg('スケジュール画面で予約投稿に追加できます', '下書き保存 ✅')}
            activeOpacity={0.8}
          >
            <Text style={styles.scheduleBtnText}>📅 予約投稿に追加 →</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.md,
  },
  title: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '800',
    marginBottom: SPACING.lg,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  industryRow: { marginBottom: SPACING.lg },
  industryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    marginRight: SPACING.sm,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    gap: 4,
  },
  industryChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '18' },
  industryEmoji: { fontSize: 16 },
  industryLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  industryLabelActive: { color: COLORS.primary },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: 4,
    marginBottom: SPACING.lg,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    borderRadius: RADIUS.sm,
  },
  modeBtnActive: { backgroundColor: COLORS.primary },
  modeBtnText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  modeBtnTextActive: { color: '#fff' },
  contentTypeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  contentTypeCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    gap: 4,
  },
  contentTypeCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '18',
  },
  contentTypeEmoji: { fontSize: 22 },
  contentTypeLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  contentTypeLabelActive: { color: COLORS.primary },
  contentTypeDesc: { color: COLORS.textMuted, fontSize: 10 },
  imagePicker: {
    height: 220,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    marginBottom: SPACING.sm,
  },
  imagePreview: { width: '100%', height: '100%' },
  imagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.lg,
  },
  imagePlaceholderEmoji: { fontSize: 44 },
  imagePlaceholderText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  imagePlaceholderSub: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center' },
  changePhotoBtn: { alignSelf: 'center', marginBottom: SPACING.lg },
  changePhotoBtnText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  seasonalRow: { marginBottom: SPACING.sm },
  seasonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    marginRight: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  seasonChipActive: { backgroundColor: COLORS.secondary + '22', borderColor: COLORS.secondary },
  seasonChipEmoji: { fontSize: 14 },
  seasonChipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '500' },
  seasonChipTextActive: { color: COLORS.secondary },
  chips: { marginBottom: SPACING.sm },
  chip: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    marginRight: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  toneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  input: {
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: 15,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  usageBox: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    alignItems: 'center',
  },
  usageText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  usageStrong: { color: COLORS.primary, fontSize: 15, fontWeight: '800' },
  usageWarn: { color: COLORS.warning, fontSize: 12, fontWeight: '600', marginTop: 4 },
  generateBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  generateBtnDisabled: { opacity: 0.6 },
  generateBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },
  resultCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  resultTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  copyBtn: {
    backgroundColor: COLORS.surfaceElevated,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  copyBtnText: { color: COLORS.textSecondary, fontSize: 13 },
  resultLabel: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: SPACING.md,
    marginBottom: 6,
  },
  caption: { color: COLORS.text, fontSize: 14, lineHeight: 22 },
  hashtags: { color: '#4FC3F7', fontSize: 12, lineHeight: 20 },
  suggestion: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 22 },
  scheduleBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  scheduleBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

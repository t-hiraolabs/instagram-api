import React, { useState } from 'react';
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
import { generatePost, generateFromImage } from '../services/aiService';
import { useAppStore } from '../store/appStore';
import { COLORS, SPACING, RADIUS } from '../utils/theme';

type Mode = 'photo' | 'text';
type ContentType = 'feed' | 'story' | 'reel';

const CONTENT_TYPES: { key: ContentType; label: string; emoji: string; desc: string }[] = [
  { key: 'feed', label: 'フィード', emoji: '📷', desc: '通常の投稿' },
  { key: 'story', label: 'ストーリー', emoji: '📖', desc: '24時間限定' },
  { key: 'reel', label: 'リール', emoji: '🎬', desc: '短尺動画' },
];

const TONES = ['明るい・ポジティブ', 'プロフェッショナル', 'カジュアル', '感情的・共感', 'ユーモラス'];
const THEMES = ['新商品・サービス', '日常・ライフスタイル', '旅行・観光', 'フード・グルメ', 'ファッション', 'ビジネス・キャリア', 'イベント告知'];

type GenerationResult = { caption: string; hashtags: string[]; suggestions: string[] };

export default function GenerateScreen() {
  const insets = useSafeAreaInsets();
  const setDraft = useAppStore((s) => s.setDraft);

  const [mode, setMode] = useState<Mode>('photo');
  const [contentType, setContentType] = useState<ContentType>('feed');
  const [tone, setTone] = useState('明るい・ポジティブ');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);

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

  const pickImage = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('権限エラー', '写真へのアクセスを許可してください');
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

    setSelectedImage({
      uri: asset.uri,
      base64,
      mimeType: asset.mimeType ?? 'image/jpeg',
    });
    setResult(null);
  };

  const handleGenerate = async () => {
    setLoading(true);
    setResult(null);
    try {
      let generated: GenerationResult;

      if (mode === 'photo') {
        if (!selectedImage?.base64) {
          Alert.alert('エラー', '写真を選択してください');
          setLoading(false);
          return;
        }
        generated = await generateFromImage({
          imageBase64: selectedImage.base64,
          mimeType: selectedImage.mimeType as any,
          contentType,
          tone,
        });
      } else {
        const selectedTheme = customTheme || theme;
        if (!selectedTheme) {
          Alert.alert('エラー', 'テーマを選択または入力してください');
          setLoading(false);
          return;
        }
        generated = await generatePost({
          theme: selectedTheme,
          tone,
          keywords: keywords.split('、').filter(Boolean),
          includeHashtags: true,
          language: 'ja',
        });
      }

      setResult(generated);
      setDraft({
        caption: generated.caption,
        hashtags: generated.hashtags,
        type: contentType === 'reel' ? 'feed' : contentType,
      });
    } catch {
      Alert.alert('エラー', 'AI生成に失敗しました。APIキーを確認してください。');
    } finally {
      setLoading(false);
    }
  };

  const copyResult = () => {
    if (!result) return;
    Clipboard.setString(result.caption + '\n\n' + result.hashtags.join(' '));
    Alert.alert('コピーしました ✅');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>AI コンテンツ生成</Text>

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
          {/* Photo picker */}
          <Text style={styles.label}>写真を選択</Text>
          <TouchableOpacity style={styles.imagePicker} onPress={pickImage} activeOpacity={0.8}>
            {selectedImage ? (
              <Image source={{ uri: selectedImage.uri }} style={styles.imagePreview} resizeMode="cover" />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Text style={styles.imagePlaceholderEmoji}>📸</Text>
                <Text style={styles.imagePlaceholderText}>タップして写真を選択</Text>
                <Text style={styles.imagePlaceholderSub}>ギャラリーから選択できます</Text>
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
          {/* Text mode: theme selection */}
          <Text style={styles.label}>投稿テーマ</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            {THEMES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, theme === t && styles.chipActive]}
                onPress={() => { setTheme(t); setCustomTheme(''); }}
              >
                <Text style={[styles.chipText, theme === t && styles.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TextInput
            style={styles.input}
            placeholder="または自由入力（例：新しいカフェのオープン）"
            placeholderTextColor={COLORS.textMuted}
            value={customTheme}
            onChangeText={(t) => { setCustomTheme(t); setTheme(''); }}
          />
          <Text style={styles.label}>キーワード（任意）</Text>
          <TextInput
            style={styles.input}
            placeholder="例: 春、限定、新作（「、」で区切る）"
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

          <Text style={styles.resultLabel}>ハッシュタグ</Text>
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
            onPress={() => Alert.alert('下書き保存', 'スケジュール画面から予約投稿できます')}
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
  label: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
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
  contentTypeEmoji: { fontSize: 24 },
  contentTypeLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700' },
  contentTypeLabelActive: { color: COLORS.primary },
  contentTypeDesc: { color: COLORS.textMuted, fontSize: 10 },
  imagePicker: {
    height: 240,
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
  },
  imagePlaceholderEmoji: { fontSize: 48 },
  imagePlaceholderText: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  imagePlaceholderSub: { color: COLORS.textMuted, fontSize: 13 },
  changePhotoBtn: { alignSelf: 'center', marginBottom: SPACING.lg },
  changePhotoBtnText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
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
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: SPACING.md,
    marginBottom: 6,
  },
  caption: { color: COLORS.text, fontSize: 15, lineHeight: 24 },
  hashtags: { color: '#4FC3F7', fontSize: 13, lineHeight: 22 },
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

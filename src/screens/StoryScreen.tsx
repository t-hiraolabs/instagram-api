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
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { generateStory } from '../services/aiService';
import { COLORS, SPACING, RADIUS } from '../utils/theme';

const { width } = Dimensions.get('window');
const STORY_W = (width - SPACING.md * 2) * 0.5;
const STORY_H = STORY_W * (16 / 9);

const STORY_TYPES = [
  { key: 'announcement', label: 'お知らせ', emoji: '📢' },
  { key: 'promotion', label: 'プロモーション', emoji: '🎁' },
  { key: 'poll', label: 'アンケート', emoji: '📊' },
  { key: 'quiz', label: 'クイズ', emoji: '❓' },
  { key: 'countdown', label: 'カウントダウン', emoji: '⏳' },
];

export default function StoryScreen() {
  const insets = useSafeAreaInsets();
  const [storyType, setStoryType] = useState<string>('announcement');
  const [theme, setTheme] = useState('');
  const [brandName, setBrandName] = useState('');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    title: string;
    bodyText: string;
    cta: string;
    backgroundColor: string;
    textColor: string;
    suggestions: string[];
  } | null>(null);

  const handleGenerate = async () => {
    if (!theme || !details) {
      Alert.alert('入力エラー', 'テーマと詳細を入力してください');
      return;
    }
    setLoading(true);
    try {
      const generated = await generateStory({
        theme,
        type: storyType as any,
        brandName,
        details,
      });
      setResult(generated);
    } catch (e) {
      Alert.alert('エラー', 'AI生成に失敗しました。APIキーを確認してください。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 100 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>📖 ストーリー生成</Text>
      <Text style={styles.subtitle}>AIが魅力的なストーリーコンテンツを自動生成します</Text>

      {/* ストーリータイプ */}
      <Text style={styles.label}>ストーリーのタイプ</Text>
      <View style={styles.typeGrid}>
        {STORY_TYPES.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.typeCard, storyType === t.key && styles.typeCardActive]}
            onPress={() => setStoryType(t.key)}
          >
            <Text style={styles.typeEmoji}>{t.emoji}</Text>
            <Text style={[styles.typeLabel, storyType === t.key && styles.typeLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 入力 */}
      <Text style={styles.label}>テーマ</Text>
      <TextInput
        style={styles.input}
        placeholder="例: 夏セールのお知らせ"
        placeholderTextColor={COLORS.textMuted}
        value={theme}
        onChangeText={setTheme}
      />

      <Text style={styles.label}>ブランド名（任意）</Text>
      <TextInput
        style={styles.input}
        placeholder="例: My Shop"
        placeholderTextColor={COLORS.textMuted}
        value={brandName}
        onChangeText={setBrandName}
      />

      <Text style={styles.label}>詳細・訴求内容</Text>
      <TextInput
        style={[styles.input, styles.inputMulti]}
        placeholder="例: 7月20〜31日限定で全品20%OFF。夏物アイテムが勢揃い！"
        placeholderTextColor={COLORS.textMuted}
        value={details}
        onChangeText={setDetails}
        multiline
        numberOfLines={3}
      />

      <TouchableOpacity
        style={[styles.generateBtn, loading && styles.generateBtnDisabled]}
        onPress={handleGenerate}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.generateBtnText}>✨ ストーリーを生成する</Text>
        )}
      </TouchableOpacity>

      {/* プレビュー */}
      {result && (
        <View>
          <Text style={styles.label}>プレビュー</Text>
          <View style={styles.previewWrapper}>
            <View
              style={[
                styles.storyPreview,
                { backgroundColor: result.backgroundColor || '#833AB4' },
              ]}
            >
              <Text style={[styles.storyTitle, { color: result.textColor || '#fff' }]}>
                {result.title}
              </Text>
              <Text style={[styles.storyBody, { color: result.textColor || '#fff' }]}>
                {result.bodyText}
              </Text>
              <View style={styles.ctaBadge}>
                <Text style={styles.ctaText}>{result.cta}</Text>
              </View>
            </View>
          </View>

          {result.suggestions.length > 0 && (
            <View style={styles.suggestCard}>
              <Text style={styles.suggestTitle}>💡 追加提案</Text>
              {result.suggestions.map((s, i) => (
                <Text key={i} style={styles.suggestion}>・{s}</Text>
              ))}
            </View>
          )}

          <TouchableOpacity style={styles.publishBtn} activeOpacity={0.8}>
            <Text style={styles.publishBtnText}>ストーリーを投稿する →</Text>
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
    marginBottom: 4,
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginBottom: SPACING.xl,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  typeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    minWidth: 80,
    gap: 4,
  },
  typeCardActive: {
    borderColor: COLORS.secondary,
    backgroundColor: COLORS.secondary + '22',
  },
  typeEmoji: { fontSize: 24 },
  typeLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  typeLabelActive: {
    color: COLORS.secondary,
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
  inputMulti: {
    height: 90,
    textAlignVertical: 'top',
  },
  generateBtn: {
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  generateBtnDisabled: { opacity: 0.6 },
  generateBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  previewWrapper: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  storyPreview: {
    width: STORY_W,
    height: STORY_H,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
  },
  storyTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  storyBody: {
    fontSize: 13,
    textAlign: 'center',
    opacity: 0.9,
  },
  ctaBadge: {
    backgroundColor: '#fff',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    marginTop: SPACING.sm,
  },
  ctaText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 13,
  },
  suggestCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  suggestTitle: {
    color: COLORS.text,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  suggestion: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 22,
  },
  publishBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  publishBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});

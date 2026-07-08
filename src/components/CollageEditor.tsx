// コラージュ型ストーリーテンプレート（web専用）: レイアウト・写真・テーマ・文字を選んで1枚の画像に合成する
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, TextInput, ActivityIndicator, Platform, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import { composeCollage, CollageLayout, COLLAGE_THEMES } from '../utils/createReel';

interface Props {
  onDone: (dataUrl: string) => void;
}

const LAYOUTS: { key: CollageLayout; label: string }[] = [
  { key: 1, label: '1枚' },
  { key: 2, label: '2枚' },
  { key: 4, label: '4枚' },
];

export default function CollageEditor({ onDone }: Props) {
  const [layout, setLayout] = useState<CollageLayout>(4);
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null, null]);
  const [themeIdx, setThemeIdx] = useState(0);
  const [accentText, setAccentText] = useState('2026');
  const [caption, setCaption] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  // レイアウトを変えたら、使わなくなる枠の写真は捨てる
  useEffect(() => {
    setPhotos((p) => {
      const next = [...p];
      for (let i = layout; i < next.length; i++) next[i] = null;
      return next;
    });
  }, [layout]);

  const pickPhoto = async (slot: number) => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        alertMsg('写真へのアクセスを許可してください', '権限エラー');
        return;
      }
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (res.canceled) return;
    setPhotos((p) => {
      const next = [...p];
      next[slot] = res.assets[0].uri;
      return next;
    });
  };

  const filledCount = photos.slice(0, layout).filter(Boolean).length;
  const ready = filledCount === layout;

  const generatePreview = async () => {
    if (!ready) return;
    setComposing(true);
    try {
      const { previewUrl } = await composeCollage(
        photos.slice(0, layout) as string[],
        layout,
        COLLAGE_THEMES[themeIdx],
        accentText,
        caption
      );
      setPreview(previewUrl);
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : 'コラージュの作成に失敗しました');
    } finally {
      setComposing(false);
    }
  };

  const useThis = () => {
    if (preview) onDone(preview);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>写真の枚数</Text>
      <View style={styles.row}>
        {LAYOUTS.map((l) => (
          <TouchableOpacity
            key={l.key}
            style={[styles.chip, layout === l.key && styles.chipActive]}
            onPress={() => setLayout(l.key)}
            activeOpacity={0.85}
          >
            <Text style={[styles.chipText, layout === l.key && styles.chipTextActive]}>{l.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>写真を選ぶ</Text>
      <View style={styles.photoGrid}>
        {Array.from({ length: layout }).map((_, i) => (
          <TouchableOpacity key={i} style={styles.photoSlot} onPress={() => pickPhoto(i)} activeOpacity={0.85}>
            {photos[i] ? (
              <Image source={{ uri: photos[i]! }} style={styles.photoThumb} resizeMode="cover" />
            ) : (
              <Ionicons name="image-outline" size={24} color={COLORS.textSecondary} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>テーマカラー</Text>
      <View style={styles.row}>
        {COLLAGE_THEMES.map((t, i) => (
          <TouchableOpacity
            key={t.name}
            style={[styles.themeSwatch, { backgroundColor: t.background, borderColor: t.accent }, themeIdx === i && styles.themeSwatchActive]}
            onPress={() => setThemeIdx(i)}
            activeOpacity={0.85}
          />
        ))}
      </View>

      <Text style={styles.label}>あしらい文字（年号など・空欄でも可）</Text>
      <TextInput
        style={styles.input}
        value={accentText}
        onChangeText={setAccentText}
        placeholder="例: 2026"
        placeholderTextColor={COLORS.textMuted}
      />

      <Text style={styles.label}>キャプション（画像内の下部・空欄でも可）</Text>
      <TextInput
        style={styles.input}
        value={caption}
        onChangeText={setCaption}
        placeholder="例: 今年もありがとうございました"
        placeholderTextColor={COLORS.textMuted}
      />

      <TouchableOpacity
        style={[styles.genBtn, !ready && styles.genBtnDisabled]}
        onPress={generatePreview}
        disabled={!ready || composing}
        activeOpacity={0.85}
      >
        {composing ? <ActivityIndicator color="#fff" /> : (
          <Text style={styles.genBtnText}>{ready ? 'プレビューを作る' : `あと${layout - filledCount}枚選んでください`}</Text>
        )}
      </TouchableOpacity>

      {preview && (
        <View style={styles.previewWrap}>
          <Image source={{ uri: preview }} style={styles.previewImg} resizeMode="contain" />
          <TouchableOpacity style={styles.useBtn} onPress={useThis} activeOpacity={0.85}>
            <Text style={styles.useBtnText}>この内容で進める ›</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: SPACING.xl },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700', marginTop: SPACING.md, marginBottom: SPACING.xs },
  row: { flexDirection: 'row', gap: SPACING.sm },
  chip: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  photoSlot: {
    width: 90,
    height: 90,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoThumb: { width: '100%', height: '100%' },
  themeSwatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2 },
  themeSwatchActive: { borderWidth: 3 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  genBtn: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  genBtnDisabled: { opacity: 0.5 },
  genBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  previewWrap: { marginTop: SPACING.lg, alignItems: 'center' },
  previewImg: { width: 260, height: (260 * 1920) / 1080, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  useBtn: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  useBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

// コラージュ型ストーリーテンプレート（web専用）: 見た目をプレビューで選び、写真を入れて加工する
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, TextInput, ActivityIndicator, Platform, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import { composeCollage, composeTemplatePreview, COLLAGE_TEMPLATES, COLLAGE_THEMES } from '../utils/createReel';

interface Props {
  onDone: (dataUrl: string) => void;
}

type Step = 'select' | 'edit';

export default function CollageEditor({ onDone }: Props) {
  const [step, setStep] = useState<Step>('select');
  const [templateIdx, setTemplateIdx] = useState<number | null>(null);
  const [themeIdx, setThemeIdx] = useState(0);
  const [previews, setPreviews] = useState<(string | null)[]>(() => COLLAGE_TEMPLATES.map(() => null));
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null, null]);
  const [accentText, setAccentText] = useState('2026');
  const [caption, setCaption] = useState('');
  const [finalPreview, setFinalPreview] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const template = templateIdx != null ? COLLAGE_TEMPLATES[templateIdx] : null;

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  // 選んでいるテーマ色で、各テンプレートの「実際の見た目」プレビューを作る
  useEffect(() => {
    let alive = true;
    setPreviews(COLLAGE_TEMPLATES.map(() => null));
    COLLAGE_TEMPLATES.forEach((t, i) => {
      composeTemplatePreview(t, COLLAGE_THEMES[themeIdx])
        .then((url) => {
          if (!alive) return;
          setPreviews((p) => {
            const next = [...p];
            next[i] = url;
            return next;
          });
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [themeIdx]);

  // テンプレートを選び直したら、使わなくなる枠の写真は捨てる
  useEffect(() => {
    if (!template) return;
    setPhotos((p) => {
      const next = [...p];
      for (let i = template.photoCount; i < next.length; i++) next[i] = null;
      return next;
    });
  }, [template]);

  const selectTemplate = (i: number) => {
    setTemplateIdx(i);
    setFinalPreview(null);
    setStep('edit');
  };

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

  const filledCount = template ? photos.slice(0, template.photoCount).filter(Boolean).length : 0;
  const ready = !!template && filledCount === template.photoCount;

  const generatePreview = async () => {
    if (!ready || !template) return;
    setComposing(true);
    try {
      const { previewUrl } = await composeCollage(
        photos.slice(0, template.photoCount) as string[],
        template,
        COLLAGE_THEMES[themeIdx],
        accentText,
        caption
      );
      setFinalPreview(previewUrl);
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : 'コラージュの作成に失敗しました');
    } finally {
      setComposing(false);
    }
  };

  const useThis = () => {
    if (finalPreview) onDone(finalPreview);
  };

  if (step === 'select' || !template) {
    return (
      <View style={styles.wrap}>
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

        <Text style={styles.label}>テンプレートを選ぶ（実際の見た目のプレビューです）</Text>
        <View style={styles.templateGrid}>
          {COLLAGE_TEMPLATES.map((t, i) => (
            <TouchableOpacity key={t.id} style={styles.templateCard} onPress={() => selectTemplate(i)} activeOpacity={0.85}>
              <View style={styles.templateThumbWrap}>
                {previews[i] ? (
                  <Image source={{ uri: previews[i]! }} style={styles.templateThumb} resizeMode="cover" />
                ) : (
                  <ActivityIndicator color={COLORS.textMuted} />
                )}
              </View>
              <Text style={styles.templateName}>{t.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.backRow} onPress={() => setStep('select')} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={16} color={COLORS.textMuted} />
        <Text style={styles.backText}>テンプレートを選び直す</Text>
      </TouchableOpacity>
      <Text style={styles.templateTitle}>{template.name}</Text>

      <Text style={styles.label}>写真を選ぶ（{template.photoCount}枚）</Text>
      <View style={styles.photoGrid}>
        {Array.from({ length: template.photoCount }).map((_, i) => (
          <TouchableOpacity key={i} style={styles.photoSlot} onPress={() => pickPhoto(i)} activeOpacity={0.85}>
            {photos[i] ? (
              <Image source={{ uri: photos[i]! }} style={styles.photoThumb} resizeMode="cover" />
            ) : (
              <Ionicons name="image-outline" size={24} color={COLORS.textSecondary} />
            )}
          </TouchableOpacity>
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
          <Text style={styles.genBtnText}>{ready ? 'プレビューを作る' : `あと${template.photoCount - filledCount}枚選んでください`}</Text>
        )}
      </TouchableOpacity>

      {finalPreview && (
        <View style={styles.previewWrap}>
          <Image source={{ uri: finalPreview }} style={styles.previewImg} resizeMode="contain" />
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
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: SPACING.sm },
  backText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  templateTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800', marginBottom: SPACING.sm },
  templateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  templateCard: { width: 140, alignItems: 'center' },
  templateThumbWrap: {
    width: 140,
    height: (140 * 1920) / 1080,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  templateThumb: { width: '100%', height: '100%' },
  templateName: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 6, textAlign: 'center' },
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

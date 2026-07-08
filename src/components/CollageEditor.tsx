// コラージュ型ストーリーテンプレート（web専用）: 枚数→テンプレート→色→写真の順に選んで加工する
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, TextInput, ActivityIndicator, Platform, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import { composeCollage, composeTemplatePreview, COLLAGE_TEMPLATES, COLLAGE_THEMES } from '../utils/createReel';

interface Props {
  onDone: (dataUrl: string) => void;
}

type Step = 'count' | 'template' | 'color' | 'edit';

const PHOTO_COUNTS = Array.from(new Set(COLLAGE_TEMPLATES.map((t) => t.photoCount))).sort((a, b) => a - b);

export default function CollageEditor({ onDone }: Props) {
  const [step, setStep] = useState<Step>('count');
  const [count, setCount] = useState<number | null>(null);
  const [templateIdx, setTemplateIdx] = useState<number | null>(null);
  const [themeIdx, setThemeIdx] = useState<number | null>(null);
  const [countPreviews, setCountPreviews] = useState<Record<number, string | null>>({});
  const [themePreviews, setThemePreviews] = useState<(string | null)[]>(() => COLLAGE_THEMES.map(() => null));
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null, null]);
  const [accentText, setAccentText] = useState('2026');
  const [caption, setCaption] = useState('');
  const [finalPreview, setFinalPreview] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const template = templateIdx != null ? COLLAGE_TEMPLATES[templateIdx] : null;
  const templatesInCount = count != null ? COLLAGE_TEMPLATES.filter((t) => t.photoCount === count) : [];

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  // 枚数選択画面：各テンプレートの代表色（1色目）でプレビューを作る
  useEffect(() => {
    let alive = true;
    COLLAGE_TEMPLATES.forEach((t, i) => {
      composeTemplatePreview(t, COLLAGE_THEMES[0])
        .then((url) => {
          if (!alive) return;
          setCountPreviews((p) => ({ ...p, [i]: url }));
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, []);

  // テンプレートを選んだら、色ごとのプレビューを作る
  useEffect(() => {
    if (!template) return;
    let alive = true;
    setThemePreviews(COLLAGE_THEMES.map(() => null));
    COLLAGE_THEMES.forEach((theme, i) => {
      composeTemplatePreview(template, theme)
        .then((url) => {
          if (!alive) return;
          setThemePreviews((p) => {
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
  }, [template]);

  // テンプレートを選び直したら、使わなくなる枠の写真は捨てる
  useEffect(() => {
    if (!template) return;
    setPhotos((p) => {
      const next = [...p];
      for (let i = template.photoCount; i < next.length; i++) next[i] = null;
      return next;
    });
  }, [template]);

  const selectCount = (c: number) => {
    setCount(c);
    setStep('template');
  };

  const selectTemplate = (idxInAll: number) => {
    setTemplateIdx(idxInAll);
    setThemeIdx(null);
    setStep('color');
  };

  const selectTheme = (i: number) => {
    setThemeIdx(i);
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
    if (!ready || !template || themeIdx == null) return;
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

  const BackRow = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.backRow} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name="chevron-back" size={16} color={COLORS.textMuted} />
      <Text style={styles.backText}>{label}</Text>
    </TouchableOpacity>
  );

  if (step === 'count') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>写真の枚数を選ぶ</Text>
        <View style={styles.countRow}>
          {PHOTO_COUNTS.map((c) => (
            <TouchableOpacity key={c} style={styles.countChip} onPress={() => selectCount(c)} activeOpacity={0.85}>
              <Text style={styles.countChipText}>{c}枚</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  if (step === 'template') {
    return (
      <View style={styles.wrap}>
        <BackRow label="枚数を選び直す" onPress={() => setStep('count')} />
        <Text style={styles.label}>{count}枚のテンプレートを選ぶ</Text>
        <View style={styles.templateGrid}>
          {COLLAGE_TEMPLATES.map((t, i) => {
            if (t.photoCount !== count) return null;
            return (
              <TouchableOpacity key={t.id} style={styles.templateCard} onPress={() => selectTemplate(i)} activeOpacity={0.85}>
                <View style={styles.templateThumbWrap}>
                  {countPreviews[i] ? (
                    <Image source={{ uri: countPreviews[i]! }} style={styles.templateThumb} resizeMode="cover" />
                  ) : (
                    <ActivityIndicator color={COLORS.textMuted} />
                  )}
                </View>
                <Text style={styles.templateName}>{t.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  if (step === 'color' && template) {
    return (
      <View style={styles.wrap}>
        <BackRow label="テンプレートを選び直す" onPress={() => setStep('template')} />
        <Text style={styles.templateTitle}>{template.name}</Text>
        <Text style={styles.label}>色を選ぶ（実際の見た目のプレビューです）</Text>
        <View style={styles.templateGrid}>
          {COLLAGE_THEMES.map((t, i) => (
            <TouchableOpacity key={t.name} style={styles.templateCard} onPress={() => selectTheme(i)} activeOpacity={0.85}>
              <View style={styles.templateThumbWrap}>
                {themePreviews[i] ? (
                  <Image source={{ uri: themePreviews[i]! }} style={styles.templateThumb} resizeMode="cover" />
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

  if (!template || themeIdx == null) return null;

  return (
    <View style={styles.wrap}>
      <BackRow label="色を選び直す" onPress={() => setStep('color')} />
      <Text style={styles.templateTitle}>{template.name}（{COLLAGE_THEMES[themeIdx].name}）</Text>

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
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: SPACING.sm },
  backText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  templateTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800', marginBottom: SPACING.sm },
  countRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  countChip: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  countChipText: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
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

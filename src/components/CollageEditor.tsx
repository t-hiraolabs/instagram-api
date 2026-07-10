// コラージュ型ストーリー（web専用）: 枚数→レイアウト→スタイル→写真の順に選んで加工する
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, TextInput, ActivityIndicator, Platform, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import { Plan } from '../utils/plans';
import { getMyPlan } from '../services/scheduleService';
import { listCollageStyles } from '../services/collageStyleService';
import {
  composeCollage, composeLayoutPreview, COLLAGE_LAYOUTS, COLLAGE_THEMES, CollageTheme, CollageStyleAssets,
} from '../utils/collageCompositor';

interface Props {
  onDone: (dataUrl: string) => void;
}

type Step = 'count' | 'layout' | 'color' | 'edit';

/** 「色を選ぶ」ステップの選択肢。組み込みの4色テーマと、DB登録の画像スタイルを同じ形にまとめたもの */
interface StyleOption {
  key: string;
  name: string;
  theme: CollageTheme;
  styleAssets?: CollageStyleAssets;
}

const PHOTO_COUNTS = Array.from(new Set(COLLAGE_LAYOUTS.map((t) => t.photoCount))).sort((a, b) => a - b);

export default function CollageEditor({ onDone }: Props) {
  const [step, setStep] = useState<Step>('count');
  const [count, setCount] = useState<number | null>(null);
  const [layoutIdx, setLayoutIdx] = useState<number | null>(null);
  const [styleIdx, setStyleIdx] = useState<number | null>(null);
  const [countPreviews, setCountPreviews] = useState<Record<number, string | null>>({});
  const [stylePreviews, setStylePreviews] = useState<(string | null)[]>([]);
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null, null]);
  const [accentText, setAccentText] = useState('2026');
  const [caption, setCaption] = useState('');
  const [finalPreview, setFinalPreview] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [plan, setPlan] = useState<Plan>('free');
  const [dbStyles, setDbStyles] = useState<StyleOption[]>([]);

  const layout = layoutIdx != null ? COLLAGE_LAYOUTS[layoutIdx] : null;
  const layoutsInCount = count != null ? COLLAGE_LAYOUTS.filter((t) => t.photoCount === count) : [];

  const styleOptions: StyleOption[] = useMemo(
    () => [
      ...COLLAGE_THEMES.map((theme): StyleOption => ({ key: theme.name, name: theme.name, theme })),
      ...dbStyles,
    ],
    [dbStyles]
  );

  useEffect(() => {
    getMyPlan().then(setPlan).catch(() => {});
  }, []);

  // 画像ベースのスタイル（シネマ風・レトロ風など）をDBから取得し、組み込みの4色テーマと並べる
  useEffect(() => {
    listCollageStyles(plan)
      .then((styles) => {
        setDbStyles(
          styles.map((s): StyleOption => ({
            key: s.id,
            name: s.name,
            theme: { name: s.name, background: '#000000', background2: '#000000', accent: s.accentColor ?? '#FFFFFF' },
            styleAssets: { backgroundUrl: s.backgroundUrl, frameUrl: s.frameUrl, accentColor: s.accentColor },
          }))
        );
      })
      .catch(() => {});
  }, [plan]);

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  // 枚数選択画面：各レイアウトの代表色（1色目）でプレビューを作る
  useEffect(() => {
    let alive = true;
    COLLAGE_LAYOUTS.forEach((t, i) => {
      composeLayoutPreview(t, COLLAGE_THEMES[0])
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

  // レイアウトを選んだら、スタイルごとのプレビューを作る
  useEffect(() => {
    if (!layout) return;
    let alive = true;
    setStylePreviews(styleOptions.map(() => null));
    styleOptions.forEach((option, i) => {
      composeLayoutPreview(layout, option.theme, option.styleAssets)
        .then((url) => {
          if (!alive) return;
          setStylePreviews((p) => {
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
  }, [layout, styleOptions]);

  // レイアウトを選び直したら、使わなくなる枠の写真は捨てる
  useEffect(() => {
    if (!layout) return;
    setPhotos((p) => {
      const next = [...p];
      for (let i = layout.photoCount; i < next.length; i++) next[i] = null;
      return next;
    });
  }, [layout]);

  const selectCount = (c: number) => {
    setCount(c);
    setStep('layout');
  };

  const selectLayout = (idxInAll: number) => {
    setLayoutIdx(idxInAll);
    setStyleIdx(null);
    setStep('color');
  };

  const selectStyle = (i: number) => {
    setStyleIdx(i);
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

  const filledCount = layout ? photos.slice(0, layout.photoCount).filter(Boolean).length : 0;
  const ready = !!layout && filledCount === layout.photoCount;

  const generatePreview = async () => {
    if (!ready || !layout || styleIdx == null) return;
    setComposing(true);
    try {
      const selected = styleOptions[styleIdx];
      const { previewUrl } = await composeCollage(
        photos.slice(0, layout.photoCount) as string[],
        layout,
        selected.theme,
        accentText,
        caption,
        selected.styleAssets
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

  if (step === 'layout') {
    return (
      <View style={styles.wrap}>
        <BackRow label="枚数を選び直す" onPress={() => setStep('count')} />
        <Text style={styles.label}>{count}枚のテンプレートを選ぶ</Text>
        <View style={styles.templateGrid}>
          {COLLAGE_LAYOUTS.map((t, i) => {
            if (t.photoCount !== count) return null;
            return (
              <TouchableOpacity key={t.id} style={styles.templateCard} onPress={() => selectLayout(i)} activeOpacity={0.85}>
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

  if (step === 'color' && layout) {
    return (
      <View style={styles.wrap}>
        <BackRow label="テンプレートを選び直す" onPress={() => setStep('layout')} />
        <Text style={styles.templateTitle}>{layout.name}</Text>
        <Text style={styles.label}>スタイルを選ぶ（実際の見た目のプレビューです）</Text>
        <View style={styles.templateGrid}>
          {styleOptions.map((option, i) => (
            <TouchableOpacity key={option.key} style={styles.templateCard} onPress={() => selectStyle(i)} activeOpacity={0.85}>
              <View style={styles.templateThumbWrap}>
                {stylePreviews[i] ? (
                  <Image source={{ uri: stylePreviews[i]! }} style={styles.templateThumb} resizeMode="cover" />
                ) : (
                  <ActivityIndicator color={COLORS.textMuted} />
                )}
              </View>
              <Text style={styles.templateName}>{option.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  if (!layout || styleIdx == null) return null;

  return (
    <View style={styles.wrap}>
      <BackRow label="スタイルを選び直す" onPress={() => setStep('color')} />
      <Text style={styles.templateTitle}>{layout.name}（{styleOptions[styleIdx].name}）</Text>

      <Text style={styles.label}>写真を選ぶ（{layout.photoCount}枚）</Text>
      <View style={styles.photoGrid}>
        {Array.from({ length: layout.photoCount }).map((_, i) => (
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
          <Text style={styles.genBtnText}>{ready ? 'プレビューを作る' : `あと${layout.photoCount - filledCount}枚選んでください`}</Text>
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

// コラージュ型ストーリー（web専用）: テンプレートギャラリーから1つ選び、写真とテキストを入れて仕上げる
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, TextInput, ActivityIndicator, Platform, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import { Plan } from '../utils/plans';
import { getMyPlan } from '../services/scheduleService';
import { listCollageStyles, CollageStyle } from '../services/collageStyleService';
import {
  composeCollage, composeLayoutPreview, COLLAGE_LAYOUTS, COLLAGE_THEMES, CollageLayout, CollageTheme, CollageStyleAssets, CollageTextLayer,
} from '../utils/collageCompositor';

interface Props {
  onDone: (dataUrl: string) => void;
}

type Step = 'gallery' | 'edit';

/** ギャラリーに並ぶ1タイル。組み込みレイアウト×テーマ／DBスタイル×レイアウト／DB完成テンプレートのいずれか */
interface GalleryTile {
  key: string;
  name: string;
  tags: string[];
  layout: CollageLayout;
  theme: CollageTheme;
  styleAssets?: CollageStyleAssets;
  textLayers?: CollageTextLayer[];
}

export default function CollageEditor({ onDone }: Props) {
  const [step, setStep] = useState<Step>('gallery');
  const [plan, setPlan] = useState<Plan>('free');
  const [dbStyles, setDbStyles] = useState<CollageStyle[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showAllBuiltIn, setShowAllBuiltIn] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});

  const [selectedTile, setSelectedTile] = useState<GalleryTile | null>(null);
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null, null]);
  const [accentText, setAccentText] = useState('2026');
  const [caption, setCaption] = useState('');
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [finalPreview, setFinalPreview] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    getMyPlan().then(setPlan).catch(() => {});
  }, []);

  useEffect(() => {
    listCollageStyles(plan).then(setDbStyles).catch(() => {});
  }, [plan]);

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  // 組み込みレイアウトの「おすすめ」: 13レイアウト×代表テーマ1色分（52件を最初から全部出さない）
  const curatedBuiltInTiles: GalleryTile[] = useMemo(
    () => COLLAGE_LAYOUTS.map((layout): GalleryTile => ({
      key: `built::${layout.id}::${COLLAGE_THEMES[0].name}`,
      name: `${layout.name}（${COLLAGE_THEMES[0].name}）`,
      tags: [layout.name, COLLAGE_THEMES[0].name, `${layout.photoCount}枚`],
      layout,
      theme: COLLAGE_THEMES[0],
    })),
    []
  );
  // 組み込み13レイアウト×4色テーマの全52件（「すべて見る」または検索時のみ使う）
  const allBuiltInTiles: GalleryTile[] = useMemo(() => {
    const list: GalleryTile[] = [];
    COLLAGE_LAYOUTS.forEach((layout) => {
      COLLAGE_THEMES.forEach((theme) => {
        list.push({
          key: `built::${layout.id}::${theme.name}`,
          name: `${layout.name}（${theme.name}）`,
          tags: [layout.name, theme.name, `${layout.photoCount}枚`],
          layout,
          theme,
        });
      });
    });
    return list;
  }, []);

  // DBスタイルは、layoutIdを持つ「完成テンプレート」のみをギャラリーに単体タイルとして出す
  // （layoutIdなしの旧スタイル形式は廃止。管理画面でも新規作成できない）
  const fullTemplateTiles: GalleryTile[] = useMemo(() => {
    const full: GalleryTile[] = [];
    dbStyles.forEach((s) => {
      if (!s.layoutId) return;
      const layout = COLLAGE_LAYOUTS.find((l) => l.id === s.layoutId);
      if (!layout) return;
      const styleAssets: CollageStyleAssets = {
        backgroundUrl: s.backgroundUrl,
        frameUrl: s.frameUrl,
        accentColor: s.accentColor,
        accentFont: s.accentFont,
        accentYOffset: s.accentYOffset,
        captionColor: s.captionColor,
        captionFont: s.captionFont,
        captionYOffset: s.captionYOffset,
        version: s.version,
        decorations: s.decorations,
        textLayers: s.textLayers,
      };
      const dummyTheme: CollageTheme = { name: s.name, background: '#000000', background2: '#000000', accent: s.accentColor ?? '#FFFFFF' };
      full.push({
        key: `tmpl::${s.id}`,
        name: s.name,
        tags: s.tags,
        layout,
        theme: dummyTheme,
        styleAssets,
        textLayers: s.textLayers,
      });
    });
    return full;
  }, [dbStyles]);

  // タグ候補は「完成テンプレート」と「組み込みレイアウト」から作る
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    [...fullTemplateTiles, ...allBuiltInTiles].forEach((t) => t.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return counts;
  }, [fullTemplateTiles, allBuiltInTiles]);
  const topTags = useMemo(
    () => Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([tag]) => tag),
    [tagCounts]
  );

  const searching = searchQuery.trim().length > 0 || !!activeTag;
  const q = searchQuery.trim().toLowerCase();

  // タイルの新しい配列参照を毎レンダー作ると、下のプレビュー生成useEffectが
  // レンダーのたびに再実行され続けてしまう（previewsの古いスナップショットに対して
  // 同じタイルを何度もcomposeLayoutPreviewし直す無限再レンダーの原因になる）ため、
  // 依存する値が実際に変わった時だけ再計算するようuseMemoで確定させる。
  const visibleFullTemplates = useMemo(
    () => fullTemplateTiles.filter((t) => (!activeTag || t.tags.includes(activeTag)) && (!q || t.name.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q)))),
    [fullTemplateTiles, activeTag, q]
  );
  const visibleBuiltIn = useMemo(() => {
    const base = searching ? allBuiltInTiles : (showAllBuiltIn ? allBuiltInTiles : curatedBuiltInTiles);
    return base.filter((t) => (!activeTag || t.tags.includes(activeTag)) && (!q || t.name.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q))));
  }, [searching, showAllBuiltIn, allBuiltInTiles, curatedBuiltInTiles, activeTag, q]);

  // 表示中のタイルのプレビューを順次生成する（生成済み・生成中のものは再実行しない）
  useEffect(() => {
    let alive = true;
    [...visibleFullTemplates, ...visibleBuiltIn].forEach((t) => {
      if (previews[t.key] !== undefined) return;
      setPreviews((p) => ({ ...p, [t.key]: null }));
      composeLayoutPreview(t.layout, t.theme, t.styleAssets)
        .then((url) => {
          if (!alive) return;
          setPreviews((p) => ({ ...p, [t.key]: url }));
        })
        .catch(() => {
          if (!alive) return;
          setPreviews((p) => ({ ...p, [t.key]: null }));
        });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleFullTemplates, visibleBuiltIn]);

  const selectTile = (tile: GalleryTile) => {
    setSelectedTile(tile);
    setPhotos(Array.from({ length: 4 }, () => null));
    setAccentText('2026');
    setCaption('');
    const initial: Record<string, string> = {};
    (tile.textLayers ?? []).forEach((l) => { initial[l.id] = l.sampleText; });
    setTextValues(initial);
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

  const filledCount = selectedTile ? photos.slice(0, selectedTile.layout.photoCount).filter(Boolean).length : 0;
  const ready = !!selectedTile && filledCount === selectedTile.layout.photoCount;

  const generatePreview = async () => {
    if (!ready || !selectedTile) return;
    setComposing(true);
    try {
      const { previewUrl } = await composeCollage(
        photos.slice(0, selectedTile.layout.photoCount) as string[],
        selectedTile.layout,
        selectedTile.theme,
        accentText,
        caption,
        selectedTile.styleAssets,
        textValues
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

  const renderTileGrid = (tileList: GalleryTile[]) => (
    <View style={styles.templateGrid}>
      {tileList.map((t) => (
        <TouchableOpacity key={t.key} style={styles.templateCard} onPress={() => selectTile(t)} activeOpacity={0.85}>
          <View style={styles.templateThumbWrap}>
            {previews[t.key] ? (
              <Image source={{ uri: previews[t.key]! }} style={styles.templateThumb} resizeMode="cover" />
            ) : (
              <ActivityIndicator color={COLORS.textMuted} />
            )}
          </View>
          <Text style={styles.templateName} numberOfLines={1}>{t.name}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (step === 'gallery' || !selectedTile) {
    const totalVisible = visibleFullTemplates.length + visibleBuiltIn.length;
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>テンプレートを選ぶ</Text>
        <TextInput
          style={styles.input}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="キーワードで検索（例: シンプル、3分割）"
          placeholderTextColor={COLORS.textMuted}
        />
        <ScrollTagRow tags={topTags} activeTag={activeTag} onSelect={setActiveTag} />

        {visibleFullTemplates.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>テンプレート</Text>
            {renderTileGrid(visibleFullTemplates)}
          </>
        )}

        {visibleBuiltIn.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>おすすめ</Text>
            {renderTileGrid(visibleBuiltIn)}
          </>
        )}
        {!searching && (
          <TouchableOpacity style={styles.linkBtn} onPress={() => setShowAllBuiltIn((v) => !v)}>
            <Text style={styles.linkBtnText}>{showAllBuiltIn ? '組み込みレイアウトを閉じる' : 'すべてのレイアウトを見る'}</Text>
          </TouchableOpacity>
        )}

        {totalVisible === 0 && <Text style={styles.emptyText}>該当するテンプレートがありません</Text>}
      </View>
    );
  }

  const layout = selectedTile.layout;
  const textLayers = selectedTile.textLayers ?? [];

  return (
    <View style={styles.wrap}>
      <BackRow label="テンプレートを選び直す" onPress={() => setStep('gallery')} />
      <Text style={styles.templateTitle}>{selectedTile.name}</Text>

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

      {textLayers.length > 0 ? (
        textLayers.map((l) => (
          <View key={l.id}>
            <Text style={styles.label}>{l.label ?? l.id}</Text>
            <TextInput
              style={styles.input}
              value={textValues[l.id] ?? ''}
              onChangeText={(v) => setTextValues((p) => ({ ...p, [l.id]: v }))}
              placeholder={l.sampleText}
              placeholderTextColor={COLORS.textMuted}
            />
          </View>
        ))
      ) : (
        <>
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
        </>
      )}

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

/** ギャラリー上部のタグ絞り込みチップ行（「すべて」＋頻出タグ上位16件） */
function ScrollTagRow({ tags, activeTag, onSelect }: { tags: string[]; activeTag: string | null; onSelect: (t: string | null) => void }) {
  return (
    <View style={styles.tagRow}>
      <TouchableOpacity style={[styles.tagChip, !activeTag && styles.tagChipActive]} onPress={() => onSelect(null)}>
        <Text style={[styles.tagChipText, !activeTag && styles.tagChipTextActive]}>すべて</Text>
      </TouchableOpacity>
      {tags.map((tag) => (
        <TouchableOpacity
          key={tag}
          style={[styles.tagChip, activeTag === tag && styles.tagChipActive]}
          onPress={() => onSelect(activeTag === tag ? null : tag)}
        >
          <Text style={[styles.tagChipText, activeTag === tag && styles.tagChipTextActive]}>{tag}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: SPACING.xl },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700', marginTop: SPACING.md, marginBottom: SPACING.xs },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: SPACING.sm },
  backText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  templateTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800', marginBottom: SPACING.sm },
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800', marginTop: SPACING.lg, marginBottom: SPACING.sm },
  linkBtn: { alignSelf: 'flex-start', paddingVertical: SPACING.xs, marginTop: SPACING.xs },
  linkBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm, marginBottom: SPACING.sm },
  tagChip: {
    paddingVertical: 6, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  tagChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tagChipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  tagChipTextActive: { color: '#fff' },
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
  templateName: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 6, textAlign: 'center', maxWidth: 140 },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: SPACING.lg },
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

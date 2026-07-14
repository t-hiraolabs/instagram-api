// 「ストーリー作成」統合ギャラリー。写真1枚のストーリーとコラージュ型を区別せず、
// 完成テンプレートを1つのグリッドから選ぶ（ユーザー指定の統合フロー ①②③に相当）。
// 写真枚数は各テンプレートのphotoSlots.lengthから導出し、フィルタチップも同じ実データで判定する。
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { Plan } from '../../utils/plans';
import { CreativeTemplate, CANVAS_W, CANVAS_H } from '../../types/creativeTemplate';
import { listCreativeTemplates } from '../../services/creativeTemplateService';
import { INDUSTRIES } from '../../services/aiService';
import { PURPOSES } from '../storyStudio/StoryStudioScreen';
import CreativeCanvas from './CreativeCanvas';

const STYLE_TAGS = ['ビフォーアフター', 'シンプル', 'ナチュラル', '高級感'];
const SEASON_TAGS = ['春', '夏', '秋', '冬'];
const INDUSTRY_TAGS = INDUSTRIES.filter((i) => i.key).map((i) => i.label);

const PHOTO_COUNT_CHIPS: { key: 1 | 2 | 3 | '4+'; label: string }[] = [
  { key: 1, label: '写真1枚' }, { key: 2, label: '写真2枚' }, { key: 3, label: '写真3枚' }, { key: '4+', label: '写真4枚以上' },
];

type ExpandGroup = 'season' | 'industry' | 'purpose' | null;

const GALLERY_THUMB_W = 150;
const GALLERY_THUMB_H = GALLERY_THUMB_W * (CANVAS_H / CANVAS_W);

function photoCountLabel(n: number): string {
  return n >= 4 ? '写真4枚以上' : `写真${n}枚`;
}

interface Props {
  plan: Plan;
  onSelectTemplate: (template: CreativeTemplate) => void;
}

export default function StoryGalleryScreen({ plan, onSelectTemplate }: Props) {
  const [templates, setTemplates] = useState<CreativeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [photoCountFilter, setPhotoCountFilter] = useState<1 | 2 | 3 | '4+' | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [expandedGroup, setExpandedGroup] = useState<ExpandGroup>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    listCreativeTemplates(plan, {
      photoCountFilter: photoCountFilter ?? undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      search: search.trim() || undefined,
    })
      .then((data) => { if (!cancelled) setTemplates(data); })
      .catch((e) => { if (!cancelled) setErrorMsg(e instanceof Error ? e.message : 'テンプレートの取得に失敗しました'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [plan, photoCountFilter, selectedTags, search]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const resetAll = () => {
    setPhotoCountFilter(null);
    setSelectedTags([]);
    setExpandedGroup(null);
  };

  const isAllActive = photoCountFilter === null && selectedTags.length === 0;
  const subChips = expandedGroup === 'season' ? SEASON_TAGS : expandedGroup === 'industry' ? INDUSTRY_TAGS : expandedGroup === 'purpose' ? PURPOSES : [];

  return (
    <View style={{ flex: 1 }}>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="テンプレートを検索"
        placeholderTextColor={COLORS.textMuted}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
        <TouchableOpacity style={[styles.chip, isAllActive && styles.chipActive]} onPress={resetAll} activeOpacity={0.85}>
          <Text style={[styles.chipText, isAllActive && styles.chipTextActive]}>すべて</Text>
        </TouchableOpacity>
        {PHOTO_COUNT_CHIPS.map((c) => {
          const active = photoCountFilter === c.key;
          return (
            <TouchableOpacity
              key={c.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setPhotoCountFilter(active ? null : c.key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
        {STYLE_TAGS.map((tag) => {
          const active = selectedTags.includes(tag);
          return (
            <TouchableOpacity key={tag} style={[styles.chip, active && styles.chipActive]} onPress={() => toggleTag(tag)} activeOpacity={0.85}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{tag}</Text>
            </TouchableOpacity>
          );
        })}
        {([['season', '季節'], ['industry', '業種'], ['purpose', '投稿目的']] as [ExpandGroup, string][]).map(([key, label]) => {
          const active = expandedGroup === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setExpandedGroup(active ? null : key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {expandedGroup && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subChipRow} contentContainerStyle={styles.chipRowContent}>
          {subChips.map((tag) => {
            const active = selectedTags.includes(tag);
            return (
              <TouchableOpacity key={tag} style={[styles.subChip, active && styles.chipActive]} onPress={() => toggleTag(tag)} activeOpacity={0.85}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{tag}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.xl }} />
      ) : errorMsg ? (
        <Text style={styles.errorText}>{errorMsg}</Text>
      ) : templates.length === 0 ? (
        <Text style={styles.emptyText}>条件に合うテンプレートが見つかりませんでした</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {templates.map((t) => (
            <TouchableOpacity key={t.id} style={styles.card} onPress={() => onSelectTemplate(t)} activeOpacity={0.85}>
              <View style={[styles.thumbWrap, { width: GALLERY_THUMB_W, height: GALLERY_THUMB_H }]}>
                <CreativeCanvas
                  photoSlots={t.photoSlots} layers={t.layers} textLayers={t.textLayers}
                  photoAssignments={[]} displayWidth={GALLERY_THUMB_W} locked
                />
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{photoCountLabel(t.photoSlots.length)}</Text>
                </View>
              </View>
              <Text style={styles.cardName} numberOfLines={1}>{t.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    marginHorizontal: SPACING.md, marginTop: SPACING.sm, marginBottom: SPACING.xs,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.full,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, color: COLORS.text, backgroundColor: COLORS.surface,
  },
  chipRow: { flexGrow: 0, paddingVertical: SPACING.sm },
  chipRowContent: { gap: SPACING.sm, paddingHorizontal: SPACING.md },
  subChipRow: { flexGrow: 0, paddingBottom: SPACING.sm },
  chip: {
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  subChip: {
    paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  errorText: { color: COLORS.error, fontSize: 14, textAlign: 'center', marginTop: SPACING.xl },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginTop: SPACING.xl },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md, padding: SPACING.md, justifyContent: 'center',
  },
  card: { width: GALLERY_THUMB_W, alignItems: 'center' },
  thumbWrap: { position: 'relative' },
  countBadge: {
    position: 'absolute', left: SPACING.xs, top: SPACING.xs,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: RADIUS.full,
    paddingVertical: 2, paddingHorizontal: SPACING.xs,
  },
  countBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  cardName: { color: COLORS.text, fontSize: 12, fontWeight: '700', marginTop: SPACING.xs, textAlign: 'center' },
});

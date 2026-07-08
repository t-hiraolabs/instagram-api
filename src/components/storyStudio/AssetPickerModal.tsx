// 素材検索：名前・タグ・カテゴリで検索し、プランに応じて絞り込む
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { Plan } from '../../utils/plans';
import { searchAssets, getCategories, StoryAsset, Category } from '../../services/storyStudioService';

interface Props {
  visible: boolean;
  plan: Plan;
  onClose: () => void;
  onSelect: (asset: StoryAsset) => void;
}

export default function AssetPickerModal({ visible, plan, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [assets, setAssets] = useState<StoryAsset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    getCategories().then(setCategories).catch(() => {});
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    searchAssets({ plan, query: query || undefined, categoryId: categoryId ?? undefined })
      .then(setAssets)
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  }, [visible, query, categoryId, plan]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}><Text style={styles.cancel}>閉じる</Text></TouchableOpacity>
          <Text style={styles.title}>素材を選ぶ</Text>
          <View style={{ width: 48 }} />
        </View>

        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="名前・タグで検索（例: 花、韓国風、ベージュ）"
          placeholderTextColor={COLORS.textMuted}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow} contentContainerStyle={{ gap: SPACING.sm, paddingHorizontal: SPACING.md }}>
          <TouchableOpacity style={[styles.catChip, !categoryId && styles.catChipActive]} onPress={() => setCategoryId(null)}>
            <Text style={[styles.catChipText, !categoryId && styles.catChipTextActive]}>すべて</Text>
          </TouchableOpacity>
          {categories.map((c) => (
            <TouchableOpacity key={c.id} style={[styles.catChip, categoryId === c.id && styles.catChipActive]} onPress={() => setCategoryId(c.id)}>
              <Text style={[styles.catChipText, categoryId === c.id && styles.catChipTextActive]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.primary} />
        ) : (
          <ScrollView contentContainerStyle={styles.grid}>
            {assets.map((a) => (
              <TouchableOpacity key={a.id} style={styles.item} onPress={() => { onSelect(a); onClose(); }} activeOpacity={0.85}>
                <Image source={{ uri: a.fileUrl }} style={styles.itemImg} resizeMode="contain" />
                <Text style={styles.itemName} numberOfLines={1}>{a.name}</Text>
              </TouchableOpacity>
            ))}
            {assets.length === 0 && <Text style={styles.empty}>該当する素材が見つかりませんでした</Text>}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SPACING.md },
  cancel: { color: COLORS.textMuted, fontSize: 15 },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  input: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, color: COLORS.text, backgroundColor: COLORS.surface,
  },
  catRow: { flexGrow: 0, marginBottom: SPACING.sm },
  catChip: {
    paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  catChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  catChipText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  catChipTextActive: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, padding: SPACING.md },
  item: { width: 100, alignItems: 'center' },
  itemImg: { width: 90, height: 90, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  itemName: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4, textAlign: 'center' },
  empty: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginTop: 40, width: '100%' },
});

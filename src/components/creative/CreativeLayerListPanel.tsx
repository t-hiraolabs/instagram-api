// レイヤー一覧＋写真スロット切替。storyStudio/LayerListPanel.tsxの一般化版。
// 旧版は`layers`単一配列＋7種類のtype固定だったが、新しい共通型では
// photoSlots / layers（背景・フレーム・装飾） / textLayers の3つに分かれているため、
// それぞれを扱えるようにしている。
// 写真スロットの切替チップ列は、photoSlots.length >= 2（複数写真テンプレート）の
// ときだけ表示する（要件通り、写真1枚のテンプレートでは出さない）。
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { PhotoSlot, TemplateLayer, TemplateLayerKind, TextLayer } from '../../types/creativeTemplate';
import { PhotoAssignment } from '../../store/creativeEditorStore';

const LAYER_KIND_LABELS: Record<TemplateLayerKind, string> = {
  background: '背景', frame: 'フレーム', decoration: '装飾',
};

interface Props {
  photoSlots: PhotoSlot[];
  photoAssignments: PhotoAssignment[];
  layers: TemplateLayer[];
  textLayers: TextLayer[];
  selectedId: string | null;
  activeSlotId: string | null;
  onSelectSlot: (slotId: string) => void;
  onSwapSlots?: (slotIdA: string, slotIdB: string) => void;
  onSelectItem: (id: string) => void;
  onToggleTextVisible: (id: string) => void;
  onBringToFront: (id: string) => void;
  onSendToBack: (id: string) => void;
  onRemoveText: (id: string) => void;
}

export default function CreativeLayerListPanel({
  photoSlots, photoAssignments, layers, textLayers, selectedId, activeSlotId,
  onSelectSlot, onSwapSlots, onSelectItem, onToggleTextVisible, onBringToFront, onSendToBack, onRemoveText,
}: Props) {
  const showSlotSwitcher = photoSlots.length >= 2;

  return (
    <View>
      {showSlotSwitcher && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.slotRow} contentContainerStyle={{ gap: SPACING.sm, paddingHorizontal: SPACING.md }}>
          {photoSlots.map((slot, i) => {
            const assignment = photoAssignments.find((a) => a.slotId === slot.id);
            const active = activeSlotId === slot.id;
            return (
              <TouchableOpacity
                key={slot.id}
                style={[styles.slotChip, active && styles.slotChipActive]}
                onPress={() => onSelectSlot(slot.id)}
                activeOpacity={0.85}
              >
                {assignment ? (
                  <Image source={{ uri: assignment.uri }} style={styles.slotThumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.slotThumb, styles.slotThumbEmpty]}>
                    <Ionicons name="image-outline" size={14} color={COLORS.textMuted} />
                  </View>
                )}
                <Text style={[styles.slotChipText, active && styles.slotChipTextActive]}>写真{i + 1}</Text>
                {active && onSwapSlots && photoSlots.length > 1 && (
                  <TouchableOpacity
                    onPress={() => {
                      const next = photoSlots[(i + 1) % photoSlots.length];
                      onSwapSlots(slot.id, next.id);
                    }}
                    hitSlop={8}
                  >
                    <Ionicons name="swap-horizontal" size={16} color="#fff" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.wrap} contentContainerStyle={{ gap: SPACING.sm, paddingHorizontal: SPACING.md }}>
        {[...layers].reverse().map((layer) => {
          const active = selectedId === layer.id;
          return (
            <TouchableOpacity
              key={layer.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onSelectItem(layer.id)}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{LAYER_KIND_LABELS[layer.kind]}</Text>
              {active && (
                <View style={styles.actionRow}>
                  <TouchableOpacity onPress={() => onBringToFront(layer.id)} hitSlop={8}>
                    <Ionicons name="arrow-up" size={16} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onSendToBack(layer.id)} hitSlop={8}>
                    <Ionicons name="arrow-down" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
        {[...textLayers].reverse().map((layer) => {
          const active = selectedId === layer.id;
          return (
            <TouchableOpacity
              key={layer.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onSelectItem(layer.id)}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{layer.isCta ? 'CTA' : '文字'}</Text>
              {active && (
                <View style={styles.actionRow}>
                  <TouchableOpacity onPress={() => onToggleTextVisible(layer.id)} hitSlop={8}>
                    <Ionicons name={layer.visible === false ? 'eye-off-outline' : 'eye-outline'} size={16} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onBringToFront(layer.id)} hitSlop={8}>
                    <Ionicons name="arrow-up" size={16} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onSendToBack(layer.id)} hitSlop={8}>
                    <Ionicons name="arrow-down" size={16} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onRemoveText(layer.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  slotRow: { flexGrow: 0, paddingTop: SPACING.sm },
  slotChip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    paddingVertical: 4, paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  slotChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  slotChipText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  slotChipTextActive: { color: '#fff' },
  slotThumb: { width: 22, height: 22, borderRadius: 11 },
  slotThumbEmpty: { backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexGrow: 0, paddingVertical: SPACING.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  actionRow: { flexDirection: 'row', gap: SPACING.sm, marginLeft: SPACING.xs },
});

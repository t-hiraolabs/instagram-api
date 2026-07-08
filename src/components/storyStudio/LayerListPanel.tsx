// レイヤー一覧：表示切替・前面/背面・削除・並び替え（上下ボタンでシンプルに）
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { useStoryEditorStore } from '../../store/storyEditorStore';

const LAYER_LABELS: Record<string, string> = {
  background: '背景', photo: '写真', frame: 'フレーム', flower: '花',
  decoration: '装飾', text: '文字', cta: 'CTA',
};

export default function LayerListPanel() {
  const layers = useStoryEditorStore((s) => s.layers);
  const selectedLayerId = useStoryEditorStore((s) => s.selectedLayerId);
  const selectLayer = useStoryEditorStore((s) => s.selectLayer);
  const removeLayer = useStoryEditorStore((s) => s.removeLayer);
  const toggleVisible = useStoryEditorStore((s) => s.toggleVisible);
  const bringToFront = useStoryEditorStore((s) => s.bringToFront);
  const sendToBack = useStoryEditorStore((s) => s.sendToBack);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.wrap} contentContainerStyle={{ gap: SPACING.sm, paddingHorizontal: SPACING.md }}>
      {[...layers].reverse().map((layer) => {
        const active = selectedLayerId === layer.id;
        return (
          <TouchableOpacity
            key={layer.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => selectLayer(layer.id)}
            activeOpacity={0.85}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{LAYER_LABELS[layer.type] ?? layer.type}</Text>
            {active && (
              <View style={styles.actionRow}>
                <TouchableOpacity onPress={() => toggleVisible(layer.id)} hitSlop={8}>
                  <Ionicons name={layer.visible === false ? 'eye-off-outline' : 'eye-outline'} size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => bringToFront(layer.id)} hitSlop={8}>
                  <Ionicons name="arrow-up" size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => sendToBack(layer.id)} hitSlop={8}>
                  <Ionicons name="arrow-down" size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeLayer(layer.id)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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

// 文字レイヤーの編集：文章・色・フォント・サイズ
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { TextLayer } from '../../store/storyEditorStore';

const COLOR_OPTIONS = ['#FFFFFF', '#000000', '#B5651D', '#D6597A', '#3E8E6E', '#333333'];
const FONT_OPTIONS = [
  { key: 'default', label: '標準' },
  { key: 'luxury', label: '高級感' },
  { key: 'rounded', label: '丸ゴシック' },
  { key: 'handwritten', label: '手書き風' },
];

interface Props {
  visible: boolean;
  layer: TextLayer | null;
  onClose: () => void;
  onChange: (patch: Partial<TextLayer>) => void;
}

export default function TextStyleModal({ visible, layer, onClose, onChange }: Props) {
  if (!layer) return null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}><Text style={styles.done}>完了</Text></TouchableOpacity>
          <Text style={styles.title}>文字を編集</Text>
          <View style={{ width: 48 }} />
        </View>

        <TextInput
          style={styles.textInput}
          value={layer.text}
          onChangeText={(text) => onChange({ text })}
          placeholder="文字を入力"
          placeholderTextColor={COLORS.textMuted}
          multiline
        />

        <Text style={styles.label}>色</Text>
        <View style={styles.row}>
          {COLOR_OPTIONS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.swatch, { backgroundColor: c }, layer.color === c && styles.swatchActive]}
              onPress={() => onChange({ color: c })}
            />
          ))}
        </View>

        <Text style={styles.label}>フォント</Text>
        <View style={styles.row}>
          {FONT_OPTIONS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.fontChip, layer.font === f.key && styles.fontChipActive]}
              onPress={() => onChange({ font: f.key })}
            >
              <Text style={[styles.fontChipText, layer.font === f.key && styles.fontChipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>サイズ</Text>
        <View style={styles.row}>
          {[36, 48, 64, 80, 96].map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.sizeChip, layer.size === s && styles.fontChipActive]}
              onPress={() => onChange({ size: s })}
            >
              <Text style={[styles.fontChipText, layer.size === s && styles.fontChipTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: COLORS.background, padding: SPACING.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.md },
  done: { color: COLORS.primary, fontSize: 15, fontWeight: '700' },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  textInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    padding: SPACING.md, color: COLORS.text, backgroundColor: COLORS.surface,
    minHeight: 80, textAlignVertical: 'top', marginBottom: SPACING.md,
  },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: SPACING.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: COLORS.border },
  swatchActive: { borderColor: COLORS.primary, borderWidth: 3 },
  fontChip: {
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  fontChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  fontChipText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  fontChipTextActive: { color: '#fff' },
  sizeChip: {
    width: 48, alignItems: 'center', paddingVertical: SPACING.xs, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
});

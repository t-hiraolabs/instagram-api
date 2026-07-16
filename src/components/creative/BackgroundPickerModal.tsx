// 写真を使わず、色・グラデーション・パターンだけでストーリーの背景を選ぶピッカー。
import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { BACKGROUND_PRESETS, BackgroundPreset } from '../../utils/backgroundPresets';
import BackgroundPresetSvg from './BackgroundPresetSvg';

const SWATCH_W = 84;
const SWATCH_H = SWATCH_W * (16 / 9);

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (preset: BackgroundPreset) => void;
}

export default function BackgroundPickerModal({ visible, onClose, onSelect }: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>背景を選ぶ</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>閉じる</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.grid}>
            {BACKGROUND_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset.id}
                style={styles.item}
                onPress={() => { onSelect(preset); onClose(); }}
                activeOpacity={0.85}
              >
                <View style={styles.swatch}>
                  <BackgroundPresetSvg preset={preset} width={SWATCH_W} height={SWATCH_H} />
                </View>
                <Text style={styles.itemLabel}>{preset.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { maxHeight: '70%', backgroundColor: COLORS.background, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  close: { color: COLORS.textMuted, fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md, padding: SPACING.md },
  item: { alignItems: 'center', width: SWATCH_W, gap: 6 },
  swatch: { width: SWATCH_W, height: SWATCH_H, borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  itemLabel: { color: COLORS.textSecondary, fontSize: 11, textAlign: 'center' },
});

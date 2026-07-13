// 端寄せ・複製ボタンの共通行。細かい移動はPositionCanvasのドラッグで行うため、
// ここでは「端に寄せる」一発ボタンと複製のみを提供する
// （管理画面・エンドユーザー画面共通）。
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../utils/theme';

export default function PositionToolRow({ onAlign, onDuplicate }: {
  onAlign: (where: 'centerX' | 'left' | 'right' | 'top' | 'bottom') => void;
  onDuplicate?: () => void;
}) {
  return (
    <View style={styles.posToolRow}>
      <TouchableOpacity style={styles.posTextBtn} onPress={() => onAlign('centerX')}><Text style={styles.posTextBtnText}>中央</Text></TouchableOpacity>
      <TouchableOpacity style={styles.posTextBtn} onPress={() => onAlign('left')}><Text style={styles.posTextBtnText}>左端</Text></TouchableOpacity>
      <TouchableOpacity style={styles.posTextBtn} onPress={() => onAlign('right')}><Text style={styles.posTextBtnText}>右端</Text></TouchableOpacity>
      <TouchableOpacity style={styles.posTextBtn} onPress={() => onAlign('top')}><Text style={styles.posTextBtnText}>上端</Text></TouchableOpacity>
      <TouchableOpacity style={styles.posTextBtn} onPress={() => onAlign('bottom')}><Text style={styles.posTextBtnText}>下端</Text></TouchableOpacity>
      {onDuplicate && (
        <TouchableOpacity style={styles.posTextBtn} onPress={onDuplicate}><Text style={styles.posTextBtnText}>複製</Text></TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  posToolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  posTextBtn: {
    paddingHorizontal: SPACING.xs, paddingVertical: 4, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background,
  },
  posTextBtnText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
});

// 10px単位の移動・端寄せ・複製ボタンの共通行。コラージュテンプレートの
// 写真エリア・テキストレイヤー・装飾の位置調整で使う（管理画面・エンドユーザー画面共通）。
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS } from '../utils/theme';

export default function PositionToolRow({ onNudge, onAlign, onDuplicate }: {
  onNudge: (dx: number, dy: number) => void;
  onAlign: (where: 'centerX' | 'left' | 'right' | 'top' | 'bottom') => void;
  onDuplicate?: () => void;
}) {
  return (
    <View style={styles.posToolRow}>
      <TouchableOpacity style={styles.posBtn} onPress={() => onNudge(0, -10)}><Ionicons name="chevron-up" size={16} color={COLORS.text} /></TouchableOpacity>
      <TouchableOpacity style={styles.posBtn} onPress={() => onNudge(0, 10)}><Ionicons name="chevron-down" size={16} color={COLORS.text} /></TouchableOpacity>
      <TouchableOpacity style={styles.posBtn} onPress={() => onNudge(-10, 0)}><Ionicons name="chevron-back" size={16} color={COLORS.text} /></TouchableOpacity>
      <TouchableOpacity style={styles.posBtn} onPress={() => onNudge(10, 0)}><Ionicons name="chevron-forward" size={16} color={COLORS.text} /></TouchableOpacity>
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
  posBtn: {
    width: 28, height: 28, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center',
  },
  posTextBtn: {
    paddingHorizontal: SPACING.xs, paddingVertical: 4, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background,
  },
  posTextBtnText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
});

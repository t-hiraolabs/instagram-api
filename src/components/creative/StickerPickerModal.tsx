// 絵文字ステッカーのピッカー。画像素材を用意せず、絵文字を大きなTextLayerとして
// 配置するだけで、位置・拡大率・回転を既存のテキスト編集機能でそのまま操作できる。
import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { STICKER_CATEGORIES } from '../../utils/stickerPresets';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}

export default function StickerPickerModal({ visible, onClose, onSelect }: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>ステッカーを選ぶ</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>閉じる</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            {STICKER_CATEGORIES.map((cat) => (
              <View key={cat.label} style={styles.category}>
                <Text style={styles.categoryLabel}>{cat.label}</Text>
                <View style={styles.grid}>
                  {cat.emojis.map((emoji) => (
                    <TouchableOpacity
                      key={emoji}
                      style={styles.item}
                      onPress={() => { onSelect(emoji); onClose(); }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.emoji}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
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
  body: { padding: SPACING.md },
  category: { marginBottom: SPACING.md },
  categoryLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', marginBottom: SPACING.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  item: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  emoji: { fontSize: 26 },
});

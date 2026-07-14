// Playwright回帰テスト専用の恒久ハーネス画面（フェーズ5）。
// CreativeLayerListPanelを1枚/3枚のfixtureで切り替えてマウントし、
// 「写真スロットが2枚以上の時だけスロット切替UIが出る」しきい値を検証できるようにする。
// 通常のUI導線からは到達しない（?e2e=layerPanel クエリでのみ表示）。
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import CreativeLayerListPanel from '../../components/creative/CreativeLayerListPanel';
import { FIXTURE_1SLOT, FIXTURE_3SLOT } from '../../e2e/fixtures';

export default function E2ELayerPanelScreen() {
  const [mode, setMode] = useState<'1slot' | '3slot'>('1slot');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeSlotId, setActiveSlotId] = useState<string | null>('photo_1');
  const fixture = mode === '1slot' ? FIXTURE_1SLOT : FIXTURE_3SLOT;

  return (
    <View style={styles.wrap}>
      <View style={styles.switcher}>
        <TouchableOpacity testID="e2e-mode-1slot" onPress={() => setMode('1slot')}>
          <Text style={styles.switchText}>1slot</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="e2e-mode-3slot" onPress={() => setMode('3slot')}>
          <Text style={styles.switchText}>3slot</Text>
        </TouchableOpacity>
      </View>
      <CreativeLayerListPanel
        photoSlots={fixture.photoSlots}
        photoAssignments={[]}
        layers={fixture.layers}
        textLayers={fixture.textLayers}
        selectedId={selectedId}
        activeSlotId={activeSlotId}
        onSelectSlot={setActiveSlotId}
        onSwapSlots={() => {}}
        onSelectItem={setSelectedId}
        onToggleTextVisible={() => {}}
        onBringToFront={() => {}}
        onSendToBack={() => {}}
        onRemoveText={() => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000', paddingTop: 40 },
  switcher: { flexDirection: 'row', gap: 16, paddingHorizontal: 16, marginBottom: 16 },
  switchText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});

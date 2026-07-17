// Playwright回帰テスト専用の恒久ハーネス画面（フェーズ5）。
// CreativeCanvasを固定fixtureで直接マウントし、ログインや実データに依存せず
// 描画順序・スロット独立性を検証できるようにする。通常のUI導線からは到達しない
// （?e2e=creativeCanvas クエリでのみ表示、src/navigation/RootNavigator.tsx参照）。
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import CreativeCanvas from '../../components/creative/CreativeCanvas';
import { PhotoAssignment } from '../../store/creativeEditorStore';
import { TextLayer } from '../../types/creativeTemplate';
import { FIXTURE_3SLOT, FIXTURE_PHOTO_URIS } from '../../e2e/fixtures';

// どのphotoSlotとも重ならない、キャンバス下部の余白（y:1280〜1920）に置く小さいテキスト。
// 表示上小さい要素（未選択のテキスト・ステッカー等）を指2本でピンチ拡大できることの
// 回帰テスト、および排他ロック（2本指でそれぞれ別要素に触れても片方しか反応しない）の
// 回帰テストに使う。
const E2E_TEXT_LAYER: TextLayer = {
  id: 'title', text: 'テスト', x: 200, y: 1500, font: 'gothic', color: '#FFFFFF',
  size: 40, scale: 1, rotation: 0, visible: true,
};

export default function E2ECreativeCanvasScreen() {
  // photo_1は意図的にスロットよりワイドな比率（1600x640）にし、cover-fit後も左右に
  // スラックが残るようにする（pan操作でオフセットが実際に動くことをテストで確認するため。
  // スロットとぴったり同じ比率だとcover-fitでスラックがゼロになり、隙間防止クランプにより
  // オフセットが常に0へ戻ってしまう＝パン操作の効果が測れない）。
  const [assignments, setAssignments] = useState<PhotoAssignment[]>([
    { slotId: 'photo_1', uri: FIXTURE_PHOTO_URIS.photo1, offsetX: 0, offsetY: 0, scale: 1, naturalW: 1600, naturalH: 640 },
    { slotId: 'photo_2', uri: FIXTURE_PHOTO_URIS.photo2, offsetX: 0, offsetY: 0, scale: 1, naturalW: 540, naturalH: 640 },
    { slotId: 'photo_3', uri: FIXTURE_PHOTO_URIS.photo3, offsetX: 0, offsetY: 0, scale: 1, naturalW: 540, naturalH: 640 },
  ]);
  const [textLayer, setTextLayer] = useState<TextLayer>(E2E_TEXT_LAYER);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSlotChange = (slotId: string, patch: { offsetX: number; offsetY: number; scale: number }) => {
    setAssignments((prev) => prev.map((a) => (a.slotId === slotId ? { ...a, ...patch } : a)));
  };
  const handleTextChange = (id: string, patch: { x: number; y: number; scale: number; rotation: number }) => {
    setTextLayer((prev) => (prev.id === id ? { ...prev, ...patch } : prev));
  };

  return (
    <View style={styles.wrap}>
      <View testID="e2e-offsets">
        {assignments.map((a) => (
          <Text key={a.slotId} testID={`e2e-offset-${a.slotId}`}>
            {a.slotId}: x={a.offsetX.toFixed(1)} y={a.offsetY.toFixed(1)} scale={a.scale.toFixed(2)}
          </Text>
        ))}
        <Text testID="e2e-offset-title">
          title: x={textLayer.x.toFixed(1)} y={textLayer.y.toFixed(1)} scale={textLayer.scale.toFixed(2)} rotation={textLayer.rotation.toFixed(1)}
        </Text>
      </View>
      <CreativeCanvas
        photoSlots={FIXTURE_3SLOT.photoSlots}
        layers={FIXTURE_3SLOT.layers}
        textLayers={[textLayer]}
        photoAssignments={assignments}
        selectedId={selectedId}
        onSelectSlot={setSelectedId}
        onSlotChange={handleSlotChange}
        onSelectText={setSelectedId}
        onTextChange={handleTextChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000', paddingTop: 40, alignItems: 'center' },
});

// Playwright回帰テスト・目視確認専用の恒久ハーネス画面（テンプレート作成の枠調整用）。
// PositionCanvasを直接マウントし、ログインや管理者権限に依存せず検証できるようにする。
// 通常のUI導線からは到達しない（?e2e=positionCanvas クエリでのみ表示）。
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import PositionCanvas, { PositionCanvasBox } from '../../components/PositionCanvas';
import { COLLAGE_W, COLLAGE_H } from '../../utils/collageCompositor';

export default function E2EPositionCanvasScreen() {
  // 上下に隣接する2枚の写真エリア。上の枠をドラッグして下の枠にぴったり隙間なく
  // 揃えられるか（ガイド線が出て、隙間なく揃うか）を確認するためのfixture
  const [boxes, setBoxes] = useState<PositionCanvasBox[]>([
    { key: 'a', x: 0, y: 0, w: COLLAGE_W, h: COLLAGE_H / 2 - 40, color: '#E1306C', resizable: true },
    { key: 'b', x: 0, y: COLLAGE_H / 2, w: COLLAGE_W, h: COLLAGE_H / 2, color: '#4A90D9', resizable: true },
  ]);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingTop: 40, alignItems: 'center' }}>
      <View testID="e2e-boxes-readout">
        {boxes.map((b) => (
          <Text key={b.key} testID={`e2e-box-${b.key}`}>
            {b.key}: x={b.x.toFixed(1)} y={b.y.toFixed(1)} w={b.w.toFixed(1)} h={b.h.toFixed(1)}
          </Text>
        ))}
      </View>
      <PositionCanvas
        backgroundUri={null}
        boxes={boxes.map((b) => ({ ...b, selected: b.key === selected }))}
        onMove={(key, x, y) => setBoxes((prev) => prev.map((b) => (b.key === key ? { ...b, x, y } : b)))}
        onResize={(key, w, h) => setBoxes((prev) => prev.map((b) => (b.key === key ? { ...b, w, h } : b)))}
        onSelect={(key) => setSelected(key)}
        maxWidth={340}
      />
    </View>
  );
}

// 1080x1920固定の論理キャンバスを、画面幅に合わせて縮小表示するコンテナ。
// 各レイヤーをDraggableLayerでラップし、指操作で移動・拡大縮小・回転できるようにする。
import React from 'react';
import { View, Image, Text, StyleSheet, Dimensions } from 'react-native';
import DraggableLayer from './DraggableLayer';
import { useStoryEditorStore, StoryLayer } from '../../store/storyEditorStore';
import { COLORS } from '../../utils/theme';

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

const screenW = Dimensions.get('window').width;
export const DISPLAY_W = Math.min(screenW - 64, 300);
export const DISPLAY_SCALE = DISPLAY_W / CANVAS_W;
export const DISPLAY_H = CANVAS_H * DISPLAY_SCALE;

// 「他の候補を見る」など一覧確認用の、さらに小さい縮小表示（画面内に全体が収まるサイズ）
export const PREVIEW_DISPLAY_W = Math.min(screenW - 120, 180);

interface Props {
  canvasRef?: React.RefObject<View>;
  /** 表示幅を上書きする（省略時はDISPLAY_W）。候補プレビューなど、より小さく出したい場合に使う */
  displayWidth?: number;
  /** trueの間はドラッグ・拡大縮小・回転などの操作を受け付けない（確定前のプレビュー用） */
  locked?: boolean;
}

function LayerContent({ layer, displayScale }: { layer: StoryLayer; displayScale: number }) {
  if (layer.type === 'photo' || layer.type === 'background') {
    // 写真・背景はキャンバス全面を隙間なく埋める（コンテインだと黒帯ができてしまうため cover でクロップ）
    const uri = 'uri' in layer ? layer.uri : undefined;
    if (!uri) return null;
    const size = { width: CANVAS_W * displayScale, height: CANVAS_H * displayScale };
    return <Image source={{ uri }} style={[size, styles.layerImage]} resizeMode="cover" />;
  }
  if (layer.type === 'frame') {
    // フレーム素材はストーリーと同じ9:16（1080x1920）比率で用意する前提。
    // キャンバス全面にフィットさせる（縦横比が一致していればcoverでも見た目は変わらない）
    const uri = 'uri' in layer ? layer.uri : undefined;
    if (!uri) return null;
    const size = { width: CANVAS_W * displayScale, height: CANVAS_H * displayScale };
    return <Image source={{ uri }} style={[size, styles.layerImage]} resizeMode="cover" />;
  }
  if (layer.type === 'flower' || layer.type === 'decoration') {
    const uri = 'uri' in layer ? layer.uri : undefined;
    if (!uri) return null;
    const size = { width: 260 * displayScale, height: 260 * displayScale };
    return <Image source={{ uri }} style={[size, styles.layerImage]} resizeMode="contain" />;
  }
  if (layer.type === 'text' || layer.type === 'cta') {
    return (
      <Text style={{ color: layer.color, fontSize: layer.size * displayScale, fontWeight: '800' }}>
        {layer.text}
      </Text>
    );
  }
  return null;
}

export default function StoryCanvas({ canvasRef, displayWidth, locked }: Props) {
  const layers = useStoryEditorStore((s) => s.layers);
  const selectedLayerId = useStoryEditorStore((s) => s.selectedLayerId);
  const selectLayer = useStoryEditorStore((s) => s.selectLayer);
  const updateLayer = useStoryEditorStore((s) => s.updateLayer);

  const width = displayWidth ?? DISPLAY_W;
  const scale = width / CANVAS_W;
  const height = CANVAS_H * scale;

  return (
    <View ref={canvasRef} style={[styles.canvas, { width, height }]} collapsable={false}>
      {layers.filter((l) => l.visible !== false).map((layer) => (
        <DraggableLayer
          key={layer.id}
          x={layer.x}
          y={layer.y}
          scale={layer.scale}
          rotation={layer.rotation}
          displayScale={scale}
          locked={locked}
          selected={!locked && selectedLayerId === layer.id}
          onSelect={() => selectLayer(layer.id)}
          onChange={(patch) => updateLayer(layer.id, patch)}
        >
          <LayerContent layer={layer} displayScale={scale} />
        </DraggableLayer>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: COLORS.background,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignSelf: 'center',
  },
  layerImage: {},
});

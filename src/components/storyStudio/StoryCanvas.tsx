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
export const DISPLAY_W = Math.min(screenW - 32, 420);
export const DISPLAY_SCALE = DISPLAY_W / CANVAS_W;
export const DISPLAY_H = CANVAS_H * DISPLAY_SCALE;

interface Props {
  canvasRef?: React.RefObject<View>;
}

function LayerContent({ layer }: { layer: StoryLayer }) {
  if (layer.type === 'photo' || layer.type === 'background') {
    // 写真・背景はキャンバス全面を隙間なく埋める（コンテインだと黒帯ができてしまうため cover でクロップ）
    const uri = 'uri' in layer ? layer.uri : undefined;
    if (!uri) return null;
    const size = { width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE };
    return <Image source={{ uri }} style={[size, styles.layerImage]} resizeMode="cover" />;
  }
  if (layer.type === 'frame') {
    // フレーム素材は正方形に近い柄のため、9:16キャンバス全面に引き伸ばすと
    // 縦に約5倍伸びて柄が潰れ見えなくなってしまう。横幅いっぱいの装飾バンドとして
    // 縦横比を保ったまま表示し、位置・大きさはユーザーが指で調整する前提にする。
    const uri = 'uri' in layer ? layer.uri : undefined;
    if (!uri) return null;
    const size = { width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_W * 0.85 * DISPLAY_SCALE };
    return <Image source={{ uri }} style={[size, styles.layerImage]} resizeMode="contain" />;
  }
  if (layer.type === 'flower' || layer.type === 'decoration') {
    const uri = 'uri' in layer ? layer.uri : undefined;
    if (!uri) return null;
    const size = { width: 260 * DISPLAY_SCALE, height: 260 * DISPLAY_SCALE };
    return <Image source={{ uri }} style={[size, styles.layerImage]} resizeMode="contain" />;
  }
  if (layer.type === 'text' || layer.type === 'cta') {
    return (
      <Text style={{ color: layer.color, fontSize: layer.size * DISPLAY_SCALE, fontWeight: '800' }}>
        {layer.text}
      </Text>
    );
  }
  return null;
}

export default function StoryCanvas({ canvasRef }: Props) {
  const layers = useStoryEditorStore((s) => s.layers);
  const selectedLayerId = useStoryEditorStore((s) => s.selectedLayerId);
  const selectLayer = useStoryEditorStore((s) => s.selectLayer);
  const updateLayer = useStoryEditorStore((s) => s.updateLayer);

  return (
    <View ref={canvasRef} style={[styles.canvas, { width: DISPLAY_W, height: DISPLAY_H }]} collapsable={false}>
      {layers.filter((l) => l.visible !== false).map((layer) => (
        <DraggableLayer
          key={layer.id}
          x={layer.x}
          y={layer.y}
          scale={layer.scale}
          rotation={layer.rotation}
          displayScale={DISPLAY_SCALE}
          selected={selectedLayerId === layer.id}
          onSelect={() => selectLayer(layer.id)}
          onChange={(patch) => updateLayer(layer.id, patch)}
        >
          <LayerContent layer={layer} />
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

// 「ストーリー作成」統合の共通レンダラー。写真枚数やテンプレート種別で分岐する
// 専用コンポーネントは作らず、常にphotoSlots/layers/textLayersを読み取って
// 同じ描画順序（背景→写真背面の装飾→写真→写真前面の装飾→フレーム→テキスト）で描く。
//
// 背景・フレーム・装飾（layers）は管理者がテンプレートとして作り込む要素のため、
// このコンポーネント内では常に静止画として描画する（エンドユーザーは動かせない）。
// 動かせるのはphotoSlots（位置・拡大率）とtextLayers（位置・拡大率・回転）のみ。
import React from 'react';
import { View, Image, Text, Dimensions, StyleSheet } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import DraggableLayer from './DraggableLayer';
import DraggablePhotoSlot from './DraggablePhotoSlot';
import BackgroundPresetSvg from './BackgroundPresetSvg';
import { CANVAS_W, CANVAS_H, PhotoSlot, TemplateLayer, TextLayer, resolveLayerBand } from '../../types/creativeTemplate';
import { PhotoAssignment } from '../../store/creativeEditorStore';
import { getFontPreset } from '../../utils/fontPresets';
import { getBackgroundPreset } from '../../utils/backgroundPresets';
import { COLORS } from '../../utils/theme';

const screenW = Dimensions.get('window').width;
export const DISPLAY_W = Math.min(screenW - 64, 300);
export const DISPLAY_SCALE = DISPLAY_W / CANVAS_W;
export const DISPLAY_H = CANVAS_H * DISPLAY_SCALE;

/** 「他の候補を見る」など一覧確認用の、さらに小さい縮小表示 */
export const PREVIEW_DISPLAY_W = Math.min(screenW - 120, 180);

function sortByZIndex<T extends { zIndex?: number }>(items: T[]): T[] {
  return items.map((item, index) => ({ item, key: item.zIndex ?? index })).sort((a, b) => a.key - b.key).map((x) => x.item);
}

function StaticLayerImage({ layer, displayScale }: { layer: TemplateLayer; displayScale: number }) {
  const w = layer.w * displayScale;
  const h = layer.h * displayScale;
  return (
    // frame/decorationは常に静止画（エンドユーザーは動かせない）だが、写真スロットより
    // 前面に描画されることがある（例: フレームは写真の上に重なる）。ImageはpointerEventsを
    // 型上受け付けないため、Viewで包んでpointerEvents='none'にする。これがないとこの
    // Imageがタッチを吸収してしまい、下の写真スロットを操作できなくなる。
    <View
      testID={`layer-${layer.id}`}
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: layer.x * displayScale, top: layer.y * displayScale,
        width: w, height: h,
        transform: layer.rotation ? [{ rotateZ: `${layer.rotation}deg` }] : undefined,
      }}
    >
      {layer.bgPresetId ? (
        <BackgroundPresetSvg preset={getBackgroundPreset(layer.bgPresetId)} width={w} height={h} />
      ) : (
        <Image source={{ uri: layer.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      )}
    </View>
  );
}

function TextContent({ layer, displayScale }: { layer: TextLayer; displayScale: number }) {
  const preset = getFontPreset(layer.font);
  return (
    <Text
      style={{
        width: layer.maxWidth ? layer.maxWidth * displayScale : undefined,
        color: layer.color,
        fontSize: layer.size * displayScale,
        fontFamily: preset.family,
        fontWeight: preset.fontWeight as any,
        textAlign: layer.align ?? 'left',
        lineHeight: layer.size * displayScale * (layer.lineHeight ?? 1.25),
        letterSpacing: (layer.letterSpacing ?? 0) * displayScale,
      }}
      numberOfLines={layer.maxLines ?? 3}
    >
      {layer.text}
    </Text>
  );
}

interface Props {
  canvasRef?: React.RefObject<View>;
  photoSlots: PhotoSlot[];
  layers: TemplateLayer[];
  textLayers: TextLayer[];
  photoAssignments: PhotoAssignment[];
  /** 表示幅を上書きする（省略時はDISPLAY_W） */
  displayWidth?: number;
  /** trueの間はphotoSlots・textLayersも含め一切の操作を受け付けない（確定前のプレビュー用） */
  locked?: boolean;
  selectedId?: string | null;
  onSelectSlot?: (slotId: string) => void;
  onSlotChange?: (slotId: string, patch: { offsetX: number; offsetY: number; scale: number }) => void;
  onPickPhoto?: (slotId: string) => void;
  onSelectText?: (id: string) => void;
  onTextChange?: (id: string, patch: { x: number; y: number; scale: number; rotation: number }) => void;
}

export default function CreativeCanvas({
  canvasRef, photoSlots, layers, textLayers, photoAssignments,
  displayWidth, locked,
  selectedId, onSelectSlot, onSlotChange, onPickPhoto, onSelectText, onTextChange,
}: Props) {
  const width = displayWidth ?? DISPLAY_W;
  const displayScale = width / CANVAS_W;
  const height = CANVAS_H * displayScale;
  // このキャンバス上の全photoSlots/textLayersで共有するロック。ある要素を指で操作している
  // 間、別の指が他の要素に触れても反応しないようにする排他制御に使う（DraggableLayer参照）
  const activeOwner = useSharedValue<string | null>(null);

  const backgroundLayers = sortByZIndex(layers.filter((l) => resolveLayerBand(l) === 'background'));
  const decorBehind = sortByZIndex(layers.filter((l) => resolveLayerBand(l) === 'decorBehind'));
  const decorFront = sortByZIndex(layers.filter((l) => resolveLayerBand(l) === 'decorFront'));
  const frameLayers = sortByZIndex(layers.filter((l) => resolveLayerBand(l) === 'frame'));
  const visibleTextLayers = sortByZIndex(textLayers.filter((t) => t.visible !== false));

  return (
    <View ref={canvasRef} style={[styles.canvas, { width, height }]} collapsable={false}>
      {/* 1. background */}
      {backgroundLayers.map((l) => <StaticLayerImage key={l.id} layer={l} displayScale={displayScale} />)}
      {/* 2. decorBehind（写真背面の装飾） */}
      {decorBehind.map((l) => <StaticLayerImage key={l.id} layer={l} displayScale={displayScale} />)}
      {/* 3. photoSlots */}
      {photoSlots.map((slot) => (
        <DraggablePhotoSlot
          key={slot.id}
          testID={`layer-${slot.id}`}
          slot={slot}
          assignment={photoAssignments.find((a) => a.slotId === slot.id)}
          displayScale={displayScale}
          selected={!locked && selectedId === slot.id}
          locked={locked}
          activeOwner={activeOwner}
          onSelect={() => onSelectSlot?.(slot.id)}
          onChange={(patch) => onSlotChange?.(slot.id, patch)}
          onPickPhoto={() => onPickPhoto?.(slot.id)}
        />
      ))}
      {/* 4. decorFront（写真前面の装飾） */}
      {decorFront.map((l) => <StaticLayerImage key={l.id} layer={l} displayScale={displayScale} />)}
      {/* 5. frame */}
      {frameLayers.map((l) => <StaticLayerImage key={l.id} layer={l} displayScale={displayScale} />)}
      {/* 6. text */}
      {visibleTextLayers.map((t) => (
        <DraggableLayer
          key={t.id}
          testID={`layer-${t.id}`}
          x={t.x} y={t.y} scale={t.scale} rotation={t.rotation}
          displayScale={displayScale}
          selected={!locked && selectedId === t.id}
          locked={locked}
          activeOwner={activeOwner}
          onSelect={() => onSelectText?.(t.id)}
          onChange={(patch) => onTextChange?.(t.id, patch)}
        >
          <TextContent layer={t} displayScale={displayScale} />
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
});

// 「ストーリー作成」統合の共通レンダラー。写真枚数やテンプレート種別で分岐する
// 専用コンポーネントは作らず、常にphotoSlots/layers/textLayersを読み取って
// 同じ描画順序（背景→写真背面の装飾→写真→写真前面の装飾→フレーム→テキスト）で描く。
//
// 背景・フレーム・装飾（layers）は管理者がテンプレートとして作り込む要素のため、
// このコンポーネント内では常に静止画として描画する（エンドユーザーは動かせない）。
// 動かせるのはphotoSlots（位置・拡大率）とtextLayers（位置・拡大率・回転）のみ。
import React from 'react';
import { View, Image, Text, Dimensions, StyleSheet } from 'react-native';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import DraggableLayer, { ActiveLayerRefs } from './DraggableLayer';
import DraggablePhotoSlot from './DraggablePhotoSlot';
import BackgroundPresetSvg from './BackgroundPresetSvg';
import { CANVAS_W, CANVAS_H, PhotoSlot, TemplateLayer, TextLayer, resolveLayerBand } from '../../types/creativeTemplate';
import { PhotoAssignment } from '../../store/creativeEditorStore';
import { getFontPreset } from '../../utils/fontPresets';
import { getBackgroundPreset } from '../../utils/backgroundPresets';
import { clampPhotoOffset } from '../../utils/photoSlotMath';
import { snapValueWithHit } from '../../utils/snap';
import { COLORS } from '../../utils/theme';

// 倍率がスナップ先とみなされる許容量（比率そのもの。0.04 = 4%以内）。DraggableLayerの
// 位置スナップ許容量と対になる値だが、ピンチ・回転はこのファイル側のキャンバス全体
// ジェスチャーで扱うため、ここに置く（詳細はDraggableLayer.tsx冒頭のコメント参照）。
const SCALE_SNAP_ZONE = 0.04;
// 2本指でサイズ変更（ピンチ）するつもりでも、指の動きは完全に一直線にはならず、
// わずかな角度のブレが必ず生じる。そのブレをそのまま回転として反映すると
// 「サイズを変えただけなのに最初から角度が変わってしまう」と感じられてしまうため、
// この角度（度）未満の変化は無視し、指の開始位置を基準として回転が「効いていない」
// 状態を保つ。超えた場合も、しきい値の分だけ角度が急に飛ばないよう差し引いてから
// 反映する（超えた瞬間になめらかに回転が始まるようにするため）。
const ROTATION_DEADZONE_DEG = 6;

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
  // activeOwnerと対になる、現在の操作対象要素のshared value参照。下記のキャンバス全体の
  // ピンチ・回転ジェスチャーが、これを介して対象要素のscale/rotationを直接更新する
  const activeRefs = useSharedValue<ActiveLayerRefs | null>(null);
  // ピンチ・回転ジェスチャー自身が今回のセッションで対象にしているshared value参照の
  // スナップショット。2本指を同時に離すと、対象要素側のpan/tapのonTouchesUpが
  // activeRefsをnullに戻す処理と、このジェスチャー自身のonEndが同じフレームで
  // 競合することがあり、onEndの中でactiveRefs.valueを読み直すと既にnullになっていて
  // 最後の確定（commit）が失われることがあった。onBegin時点（まだ誰にもクリアされて
  // いない安全なタイミング）でこちらへ複製しておき、onUpdate/onEndは常にこちらを使う
  const sessionRefs = useSharedValue<ActiveLayerRefs | null>(null);

  // ピンチ・回転操作が終わった時にReact state側へ確定する。対象がphotoSlotかtextLayer
  // かでpatchの形が異なる（写真はoffsetX/offsetY、テキストはx/y/rotationそのまま）ため、
  // ここで振り分ける
  const onCommitActive = (targetId: string, x: number, y: number, scale: number, rotation: number) => {
    const slot = photoSlots.find((s) => s.id === targetId);
    if (slot) {
      const assignment = photoAssignments.find((a) => a.slotId === targetId);
      if (!assignment) return;
      onSlotChange?.(targetId, clampPhotoOffset(slot, assignment, x, y, scale));
      return;
    }
    onTextChange?.(targetId, { x, y, scale, rotation });
  };

  // ピンチ・回転は要素ごとではなく、キャンバス全体を覆うこの1つのジェスチャーで受け止める
  // （react-native-gesture-handlerのWeb実装は、新しいタッチを「そのView自身の実際のDOM
  // 矩形内かどうか」だけで捕捉するかを決めており、hitSlopは新規タッチの捕捉範囲を広げない
  // ため、要素側のhitSlopをどれだけ広げても「小さい要素に1本指で触れていれば、もう1本の
  // 指はどこに触れてもよい」という挙動は実現できない。詳細はDraggableLayer.tsx参照）。
  // activeRefsに登録されている「今の操作対象要素」がある時だけ、そのshared valueを
  // 直接更新する。対象がなければ何もしない（キャンバスの空きスペースでのピンチは無効）
  const canvasPinch = Gesture.Pinch()
    .enabled(!locked)
    .onBegin(() => {
      const refs = activeRefs.value;
      sessionRefs.value = refs;
      if (!refs) return;
      refs.baseScale.value = refs.savedScale.value;
    })
    .onUpdate((e) => {
      const refs = sessionRefs.value;
      if (!refs) return;
      let s = Math.min(refs.maxScale, Math.max(refs.minScale, refs.baseScale.value * e.scale));
      let snapped = false;
      if (refs.snapScale) {
        const r = snapValueWithHit(s, refs.snapScale, SCALE_SNAP_ZONE);
        s = r.value;
        if (r.hit !== null) snapped = true;
      }
      refs.savedScale.value = s;
      refs.isSnapped.value = snapped;
    })
    .onEnd(() => {
      const refs = sessionRefs.value;
      if (!refs) return;
      refs.isSnapped.value = false;
      runOnJS(onCommitActive)(refs.id, refs.translateX.value, refs.translateY.value, refs.savedScale.value, refs.savedRotation.value);
    });

  const canvasRotate = Gesture.Rotation()
    .enabled(!locked)
    .onBegin(() => {
      const refs = activeRefs.value;
      sessionRefs.value = refs;
      if (!refs || !refs.rotatable) return;
      refs.baseRotation.value = refs.savedRotation.value;
    })
    .onUpdate((e) => {
      const refs = sessionRefs.value;
      if (!refs || !refs.rotatable) return;
      const deltaDeg = (e.rotation * 180) / Math.PI;
      let applied = 0;
      if (deltaDeg > ROTATION_DEADZONE_DEG) applied = deltaDeg - ROTATION_DEADZONE_DEG;
      else if (deltaDeg < -ROTATION_DEADZONE_DEG) applied = deltaDeg + ROTATION_DEADZONE_DEG;
      refs.savedRotation.value = refs.baseRotation.value + applied;
    })
    .onEnd(() => {
      const refs = sessionRefs.value;
      if (!refs || !refs.rotatable) return;
      runOnJS(onCommitActive)(refs.id, refs.translateX.value, refs.translateY.value, refs.savedScale.value, refs.savedRotation.value);
    });

  const canvasGesture = Gesture.Simultaneous(canvasPinch, canvasRotate);
  // 各要素のpan/tapに「このジェスチャーとは同時に認識してよい」と伝えるための配列
  // （simultaneousWithExternalGestureに渡す。詳細はDraggableLayer.tsx参照）
  const canvasGestures = [canvasPinch, canvasRotate];

  const backgroundLayers = sortByZIndex(layers.filter((l) => resolveLayerBand(l) === 'background'));
  const decorBehind = sortByZIndex(layers.filter((l) => resolveLayerBand(l) === 'decorBehind'));
  const decorFront = sortByZIndex(layers.filter((l) => resolveLayerBand(l) === 'decorFront'));
  const frameLayers = sortByZIndex(layers.filter((l) => resolveLayerBand(l) === 'frame'));
  const visibleTextLayers = sortByZIndex(textLayers.filter((t) => t.visible !== false));

  return (
    <GestureDetector gesture={canvasGesture}>
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
            activeRefs={activeRefs}
            canvasGestures={canvasGestures}
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
            id={t.id}
            testID={`layer-${t.id}`}
            x={t.x} y={t.y} scale={t.scale} rotation={t.rotation}
            displayScale={displayScale}
            selected={!locked && selectedId === t.id}
            locked={locked}
            activeOwner={activeOwner}
            activeRefs={activeRefs}
            canvasGestures={canvasGestures}
            onSelect={() => onSelectText?.(t.id)}
            onChange={(patch) => onTextChange?.(t.id, patch)}
          >
            <TextContent layer={t} displayScale={displayScale} />
          </DraggableLayer>
        ))}
      </View>
    </GestureDetector>
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

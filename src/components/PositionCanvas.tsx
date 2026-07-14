// 写真エリア・テキストレイヤー・装飾画像の位置を、背景画像の上に重ねたボックスを指で
// ドラッグして直感的に調整できるキャンバス。主要機種がスマホであることを踏まえ、
// 数値入力＋10px単位の矢印ボタンだけに頼らず、ドラッグでの大まかな移動を可能にする。
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, PanResponder, GestureResponderEvent, useWindowDimensions } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import { COLLAGE_W, COLLAGE_H } from '../utils/collageCompositor';
import { snapValueWithHit } from '../utils/snap';

// 中央寄せ・端（キャンバスの縁にちょうど揃う位置/サイズ）や他の枠の端に近づいたら
// 一瞬止まる（スナップする）ときの許容量（画面px基準。表示スケールに応じて論理px換算する）
const SNAP_SCREEN_PX = 8;
// スナップ中に表示する、見えやすいガイド線の色
const GUIDE_COLOR = '#00E5FF';

/** 移動中のボックスのx（左端）が候補になり得る値：キャンバス端・中央・他ボックスの
 *  左端/右端（同じ左端で揃える、または隙間なく隣接させる、のどちらにもスナップできるように） */
function xTargets(w: number, others: PositionCanvasBox[]): number[] {
  const targets = [0, (COLLAGE_W - w) / 2, COLLAGE_W - w];
  others.forEach((o) => { targets.push(o.x, o.x + o.w, o.x - w); });
  return targets;
}
function yTargets(h: number, others: PositionCanvasBox[]): number[] {
  const targets = [0, (COLLAGE_H - h) / 2, COLLAGE_H - h];
  others.forEach((o) => { targets.push(o.y, o.y + o.h, o.y - h); });
  return targets;
}

export interface PositionCanvasBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 枠線・塗りの色（要素の種類ごとに色分けする用）。未指定はプライマリカラー */
  color?: string;
  /** trueの場合、右下にリサイズハンドルを表示し、ボックス自体を2本指でつまんでも
   *  拡大縮小できるようにする（写真エリア・装飾画像用。テキストは不可） */
  resizable?: boolean;
  /** 選択中かどうか（選択中は枠を太く表示する） */
  selected?: boolean;
  /** テキストレイヤー用: ボックス内に実際のサンプル文言をプレビュー表示する */
  previewText?: string;
  previewTextColor?: string;
  previewFontSize?: number;
  previewAlign?: 'left' | 'center' | 'right';
  /** 選択中フォントのCSSフォントファミリー名（Google Fontsの<link>読み込み後に反映される） */
  previewFontFamily?: string;
  previewFontWeight?: string;
}

/** 2本指ピンチの指間距離（PanResponderのtouches配列から算出。scaleに関わらず
 *  比率だけを使うので、キャンバスのスケール変換を考慮する必要はない） */
function touchDistance(touches: GestureResponderEvent['nativeEvent']['touches']): number {
  if (!touches || touches.length < 2) return 0;
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

interface PositionCanvasProps {
  /** 背景に敷く画像（実際のデザイン画像やアップロード直後のURL） */
  backgroundUri?: string | null;
  boxes: PositionCanvasBox[];
  onMove: (key: string, x: number, y: number) => void;
  /** resizable:trueのボックスのみに右下のリサイズハンドルを表示し、ドラッグで幅・高さも変更できる */
  onResize?: (key: string, w: number, h: number) => void;
  /** ボックスをタップ（ドラッグ開始）した時に呼ばれる。選択状態の管理に使う */
  onSelect?: (key: string) => void;
  maxWidth?: number;
  /** 指定時は、幅だけでなく高さもこの値に収まるようアスペクト比を保ったまま縮小する
   *  （プロパティパネルとあわせて画面内に収まる高さを親から計算して渡す用途） */
  maxHeight?: number;
  /**
   * ドラッグの開始・終了を親に通知する。キャンバスを囲むScrollViewのscrollEnabledを
   * ドラッグ中だけfalseにするために使う（そうしないとWeb上でドラッグ中に画面が
   * スクロールしてしまう不具合が起きる）。
   */
  onDragStateChange?: (dragging: boolean) => void;
}

const MIN_SIZE = 30;
const HANDLE_SIZE = 24;

export default function PositionCanvas({ backgroundUri, boxes, onMove, onResize, onSelect, maxWidth = 420, maxHeight, onDragStateChange }: PositionCanvasProps) {
  const { width: windowWidth } = useWindowDimensions();
  let canvasWidth = Math.min(windowWidth - SPACING.md * 4, maxWidth);
  let canvasHeight = (canvasWidth * COLLAGE_H) / COLLAGE_W;
  if (maxHeight && canvasHeight > maxHeight) {
    canvasHeight = maxHeight;
    canvasWidth = (canvasHeight * COLLAGE_W) / COLLAGE_H;
  }
  const scale = canvasWidth / COLLAGE_W;

  // ドラッグ・リサイズ中、中央・端・他の枠にスナップした位置へ見えやすいガイド線を表示する
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });

  return (
    <View style={[styles.canvas, { width: canvasWidth, height: canvasHeight }]}>
      {backgroundUri ? (
        <Image source={{ uri: backgroundUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {boxes.map((box) => (
        <DraggableBox
          key={box.key}
          box={box}
          otherBoxes={boxes.filter((b) => b.key !== box.key)}
          scale={scale}
          onMove={(x, y) => onMove(box.key, x, y)}
          onResize={box.resizable && onResize ? (w, h) => onResize(box.key, w, h) : undefined}
          onSelect={onSelect ? () => onSelect(box.key) : undefined}
          onDragStateChange={onDragStateChange}
          onGuideChange={setGuides}
        />
      ))}
      {/* リサイズハンドルはボックスの子ではなく兄弟として描画する。ネストしたPanResponder同士は
          Web上でタッチの取り合いが不安定になり、ドラッグ中に親（移動）側へ横取りされることがあるため。 */}
      {onResize && boxes.filter((b) => b.resizable).map((box) => (
        <ResizeHandle
          key={`resize-${box.key}`}
          box={box}
          scale={scale}
          onResize={(w, h) => onResize(box.key, w, h)}
          onDragStateChange={onDragStateChange}
          onGuideChange={setGuides}
        />
      ))}
      {guides.v.map((x, i) => (
        <View key={`gv-${i}`} testID="position-guide-v" pointerEvents="none" style={[styles.guideV, { left: x * scale }]} />
      ))}
      {guides.h.map((y, i) => (
        <View key={`gh-${i}`} testID="position-guide-h" pointerEvents="none" style={[styles.guideH, { top: y * scale }]} />
      ))}
    </View>
  );
}

function DraggableBox({ box, otherBoxes, scale, onMove, onResize, onSelect, onDragStateChange, onGuideChange }: {
  box: PositionCanvasBox;
  otherBoxes: PositionCanvasBox[];
  scale: number;
  onMove: (x: number, y: number) => void;
  onResize?: (w: number, h: number) => void;
  onSelect?: () => void;
  onDragStateChange?: (dragging: boolean) => void;
  onGuideChange?: (guides: { v: number[]; h: number[] }) => void;
}) {
  // PanResponderは初回マウント時のクロージャに固定されるため、最新のbox/コールバックは
  // refで読み書きする（ColorPickerModalのドラッグ不具合修正と同じ手法）
  const boxRef = useRef(box);
  useEffect(() => { boxRef.current = box; });
  const otherBoxesRef = useRef(otherBoxes);
  useEffect(() => { otherBoxesRef.current = otherBoxes; });
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; });
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; });
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });
  const onDragStateChangeRef = useRef(onDragStateChange);
  useEffect(() => { onDragStateChangeRef.current = onDragStateChange; });
  const onGuideChangeRef = useRef(onGuideChange);
  useEffect(() => { onGuideChangeRef.current = onGuideChange; });

  // 1本指ならドラッグ移動、2本指ならピンチで拡大縮小（つまむ距離の比率でw/hをスケールする）。
  // 指の本数はジェスチャー中に変わりうる（1本→2本に増える等）ため、touches.lengthが
  // 前回と変わるたびに開始地点を取り直す。
  const moveStart = useRef({ pageX: 0, pageY: 0, x: 0, y: 0 });
  const pinchStart = useRef({ distance: 0, w: 0, h: 0 });
  const lastTouchCount = useRef(0);

  const beginGesture = (evt: GestureResponderEvent) => {
    const touches = evt.nativeEvent.touches;
    lastTouchCount.current = touches?.length ?? 1;
    if (lastTouchCount.current >= 2 && onResizeRef.current) {
      pinchStart.current = { distance: touchDistance(touches), w: boxRef.current.w, h: boxRef.current.h };
    } else {
      moveStart.current = {
        pageX: evt.nativeEvent.pageX, pageY: evt.nativeEvent.pageY,
        x: boxRef.current.x, y: boxRef.current.y,
      };
    }
  };

  const moveResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        onSelectRef.current?.();
        onDragStateChangeRef.current?.(true);
        beginGesture(evt);
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        const touches = evt.nativeEvent.touches;
        const touchCount = touches?.length ?? 1;
        if (touchCount !== lastTouchCount.current) beginGesture(evt);

        const snapZone = SNAP_SCREEN_PX / scale;
        if (touchCount >= 2 && onResizeRef.current) {
          const dist = touchDistance(touches);
          const ratio = pinchStart.current.distance > 0 ? dist / pinchStart.current.distance : 1;
          const b = boxRef.current;
          const wr = snapValueWithHit(Math.max(MIN_SIZE, pinchStart.current.w * ratio), [COLLAGE_W - b.x], snapZone);
          const hr = snapValueWithHit(Math.max(MIN_SIZE, pinchStart.current.h * ratio), [COLLAGE_H - b.y], snapZone);
          onGuideChangeRef.current?.({
            v: wr.hit !== null ? [b.x + wr.hit] : [],
            h: hr.hit !== null ? [b.y + hr.hit] : [],
          });
          onResizeRef.current(wr.value, hr.value);
          return;
        }
        const dx = (evt.nativeEvent.pageX - moveStart.current.pageX) / scale;
        const dy = (evt.nativeEvent.pageY - moveStart.current.pageY) / scale;
        const b = boxRef.current;
        const others = otherBoxesRef.current;
        const xr = snapValueWithHit(moveStart.current.x + dx, xTargets(b.w, others), snapZone);
        const yr = snapValueWithHit(moveStart.current.y + dy, yTargets(b.h, others), snapZone);
        onGuideChangeRef.current?.({
          v: xr.hit !== null ? [xr.hit] : [],
          h: yr.hit !== null ? [yr.hit] : [],
        });
        onMoveRef.current(xr.value, yr.value);
      },
      onPanResponderRelease: () => { onDragStateChangeRef.current?.(false); onGuideChangeRef.current?.({ v: [], h: [] }); },
      onPanResponderTerminate: () => { onDragStateChangeRef.current?.(false); onGuideChangeRef.current?.({ v: [], h: [] }); },
    })
  ).current;

  return (
    <View
      testID={`position-box-${box.key}`}
      style={[
        styles.box,
        {
          left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale,
          borderColor: box.color ?? COLORS.primary,
          borderWidth: box.selected ? 3 : 2,
          borderStyle: box.selected ? 'solid' : 'dashed',
        },
      ]}
      {...moveResponder.panHandlers}
    >
      {box.previewText ? (
        <Text
          style={{
            color: box.previewTextColor ?? '#fff',
            fontSize: Math.max(8, (box.previewFontSize ?? 40) * scale),
            textAlign: box.previewAlign ?? 'left',
            fontFamily: box.previewFontFamily,
            fontWeight: box.previewFontWeight as any,
          }}
          numberOfLines={2}
        >
          {box.previewText}
        </Text>
      ) : null}
    </View>
  );
}

function ResizeHandle({ box, scale, onResize, onDragStateChange, onGuideChange }: {
  box: PositionCanvasBox;
  scale: number;
  onResize: (w: number, h: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
  onGuideChange?: (guides: { v: number[]; h: number[] }) => void;
}) {
  const boxRef = useRef(box);
  useEffect(() => { boxRef.current = box; });
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; });
  const onDragStateChangeRef = useRef(onDragStateChange);
  useEffect(() => { onDragStateChangeRef.current = onDragStateChange; });
  const onGuideChangeRef = useRef(onGuideChange);
  useEffect(() => { onGuideChangeRef.current = onGuideChange; });

  const resizeStart = useRef({ pageX: 0, pageY: 0, w: 0, h: 0 });
  const resizeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        onDragStateChangeRef.current?.(true);
        resizeStart.current = {
          pageX: evt.nativeEvent.pageX, pageY: evt.nativeEvent.pageY,
          w: boxRef.current.w, h: boxRef.current.h,
        };
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        const snapZone = SNAP_SCREEN_PX / scale;
        const dw = (evt.nativeEvent.pageX - resizeStart.current.pageX) / scale;
        const dh = (evt.nativeEvent.pageY - resizeStart.current.pageY) / scale;
        const b = boxRef.current;
        const wr = snapValueWithHit(Math.max(MIN_SIZE, resizeStart.current.w + dw), [COLLAGE_W - b.x], snapZone);
        const hr = snapValueWithHit(Math.max(MIN_SIZE, resizeStart.current.h + dh), [COLLAGE_H - b.y], snapZone);
        onGuideChangeRef.current?.({
          v: wr.hit !== null ? [b.x + wr.hit] : [],
          h: hr.hit !== null ? [b.y + hr.hit] : [],
        });
        onResizeRef.current(wr.value, hr.value);
      },
      onPanResponderRelease: () => { onDragStateChangeRef.current?.(false); onGuideChangeRef.current?.({ v: [], h: [] }); },
      onPanResponderTerminate: () => { onDragStateChangeRef.current?.(false); onGuideChangeRef.current?.({ v: [], h: [] }); },
    })
  ).current;

  return (
    <View
      style={[
        styles.resizeHandle,
        {
          left: box.x * scale + box.w * scale - HANDLE_SIZE / 2,
          top: box.y * scale + box.h * scale - HANDLE_SIZE / 2,
          backgroundColor: box.color ?? COLORS.primary,
        },
      ]}
      {...resizeResponder.panHandlers}
    />
  );
}

const styles = StyleSheet.create({
  canvas: {
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, overflow: 'hidden', alignSelf: 'center', marginBottom: SPACING.sm,
  },
  box: {
    position: 'absolute',
    backgroundColor: 'rgba(225,48,108,0.15)',
    overflow: 'hidden',
    padding: 2,
  },
  resizeHandle: {
    position: 'absolute', width: HANDLE_SIZE, height: HANDLE_SIZE, borderRadius: HANDLE_SIZE / 2,
    borderWidth: 2, borderColor: '#fff',
  },
  // ドラッグ・リサイズ中、中央・端・他の枠にスナップしたときだけ表示する見えやすいガイド線
  guideV: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: GUIDE_COLOR },
  guideH: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: GUIDE_COLOR },
});

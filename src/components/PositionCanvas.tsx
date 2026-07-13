// 写真エリア・テキストレイヤー・装飾画像の位置を、背景画像の上に重ねたボックスを指で
// ドラッグして直感的に調整できるキャンバス。主要機種がスマホであることを踏まえ、
// 数値入力＋10px単位の矢印ボタンだけに頼らず、ドラッグでの大まかな移動を可能にする。
import React, { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, PanResponder, GestureResponderEvent, useWindowDimensions } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import { COLLAGE_W, COLLAGE_H } from '../utils/collageCompositor';

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

  return (
    <View style={[styles.canvas, { width: canvasWidth, height: canvasHeight }]}>
      {backgroundUri ? (
        <Image source={{ uri: backgroundUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {boxes.map((box) => (
        <DraggableBox
          key={box.key}
          box={box}
          scale={scale}
          onMove={(x, y) => onMove(box.key, x, y)}
          onResize={box.resizable && onResize ? (w, h) => onResize(box.key, w, h) : undefined}
          onSelect={onSelect ? () => onSelect(box.key) : undefined}
          onDragStateChange={onDragStateChange}
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
        />
      ))}
    </View>
  );
}

function DraggableBox({ box, scale, onMove, onResize, onSelect, onDragStateChange }: {
  box: PositionCanvasBox;
  scale: number;
  onMove: (x: number, y: number) => void;
  onResize?: (w: number, h: number) => void;
  onSelect?: () => void;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  // PanResponderは初回マウント時のクロージャに固定されるため、最新のbox/コールバックは
  // refで読み書きする（ColorPickerModalのドラッグ不具合修正と同じ手法）
  const boxRef = useRef(box);
  useEffect(() => { boxRef.current = box; });
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; });
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; });
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });
  const onDragStateChangeRef = useRef(onDragStateChange);
  useEffect(() => { onDragStateChangeRef.current = onDragStateChange; });

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

        if (touchCount >= 2 && onResizeRef.current) {
          const dist = touchDistance(touches);
          const ratio = pinchStart.current.distance > 0 ? dist / pinchStart.current.distance : 1;
          onResizeRef.current(
            Math.max(MIN_SIZE, pinchStart.current.w * ratio),
            Math.max(MIN_SIZE, pinchStart.current.h * ratio)
          );
          return;
        }
        const dx = (evt.nativeEvent.pageX - moveStart.current.pageX) / scale;
        const dy = (evt.nativeEvent.pageY - moveStart.current.pageY) / scale;
        onMoveRef.current(moveStart.current.x + dx, moveStart.current.y + dy);
      },
      onPanResponderRelease: () => onDragStateChangeRef.current?.(false),
      onPanResponderTerminate: () => onDragStateChangeRef.current?.(false),
    })
  ).current;

  return (
    <View
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
          }}
          numberOfLines={2}
        >
          {box.previewText}
        </Text>
      ) : null}
    </View>
  );
}

function ResizeHandle({ box, scale, onResize, onDragStateChange }: {
  box: PositionCanvasBox;
  scale: number;
  onResize: (w: number, h: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  const boxRef = useRef(box);
  useEffect(() => { boxRef.current = box; });
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; });
  const onDragStateChangeRef = useRef(onDragStateChange);
  useEffect(() => { onDragStateChangeRef.current = onDragStateChange; });

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
        const dw = (evt.nativeEvent.pageX - resizeStart.current.pageX) / scale;
        const dh = (evt.nativeEvent.pageY - resizeStart.current.pageY) / scale;
        onResizeRef.current(
          Math.max(MIN_SIZE, resizeStart.current.w + dw),
          Math.max(MIN_SIZE, resizeStart.current.h + dh)
        );
      },
      onPanResponderRelease: () => onDragStateChangeRef.current?.(false),
      onPanResponderTerminate: () => onDragStateChangeRef.current?.(false),
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
});

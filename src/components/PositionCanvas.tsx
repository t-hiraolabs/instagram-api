// 写真エリア・テキストレイヤーの位置を、背景画像の上に重ねたボックスを指で
// ドラッグして直感的に調整できるキャンバス。主要機種がスマホであることを踏まえ、
// 数値入力＋10px単位の矢印ボタンだけに頼らず、ドラッグでの大まかな移動を可能にする。
import React, { useEffect, useRef } from 'react';
import { View, Image, StyleSheet, PanResponder, GestureResponderEvent, useWindowDimensions } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import { COLLAGE_W, COLLAGE_H } from '../utils/collageCompositor';

export interface PositionCanvasBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 枠線・塗りの色（写真エリアとテキストレイヤーを色分けする用）。未指定はプライマリカラー */
  color?: string;
}

interface PositionCanvasProps {
  /** 背景に敷く画像（実際のデザイン画像やアップロード直後のURL） */
  backgroundUri?: string | null;
  boxes: PositionCanvasBox[];
  onMove: (key: string, x: number, y: number) => void;
  /** 指定時、各ボックス右下にリサイズハンドルを表示しドラッグで幅・高さも変更できる */
  onResize?: (key: string, w: number, h: number) => void;
  maxWidth?: number;
  /**
   * ドラッグの開始・終了を親に通知する。キャンバスを囲むScrollViewのscrollEnabledを
   * ドラッグ中だけfalseにするために使う（そうしないとWeb上でドラッグ中に画面が
   * スクロールしてしまう不具合が起きる）。
   */
  onDragStateChange?: (dragging: boolean) => void;
}

const MIN_SIZE = 30;
const HANDLE_SIZE = 24;

export default function PositionCanvas({ backgroundUri, boxes, onMove, onResize, maxWidth = 420, onDragStateChange }: PositionCanvasProps) {
  const { width: windowWidth } = useWindowDimensions();
  const canvasWidth = Math.min(windowWidth - SPACING.md * 4, maxWidth);
  const canvasHeight = (canvasWidth * COLLAGE_H) / COLLAGE_W;
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
          onDragStateChange={onDragStateChange}
        />
      ))}
      {/* リサイズハンドルはボックスの子ではなく兄弟として描画する。ネストしたPanResponder同士は
          Web上でタッチの取り合いが不安定になり、ドラッグ中に親（移動）側へ横取りされることがあるため。 */}
      {onResize && boxes.map((box) => (
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

function DraggableBox({ box, scale, onMove, onDragStateChange }: {
  box: PositionCanvasBox;
  scale: number;
  onMove: (x: number, y: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  // PanResponderは初回マウント時のクロージャに固定されるため、最新のbox/コールバックは
  // refで読み書きする（ColorPickerModalのドラッグ不具合修正と同じ手法）
  const boxRef = useRef(box);
  useEffect(() => { boxRef.current = box; });
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; });
  const onDragStateChangeRef = useRef(onDragStateChange);
  useEffect(() => { onDragStateChangeRef.current = onDragStateChange; });

  const moveStart = useRef({ pageX: 0, pageY: 0, x: 0, y: 0 });
  const moveResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        onDragStateChangeRef.current?.(true);
        moveStart.current = {
          pageX: evt.nativeEvent.pageX, pageY: evt.nativeEvent.pageY,
          x: boxRef.current.x, y: boxRef.current.y,
        };
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
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
        },
      ]}
      {...moveResponder.panHandlers}
    />
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
    position: 'absolute', borderWidth: 2, borderStyle: 'dashed',
    backgroundColor: 'rgba(225,48,108,0.15)',
  },
  resizeHandle: {
    position: 'absolute', width: HANDLE_SIZE, height: HANDLE_SIZE, borderRadius: HANDLE_SIZE / 2,
    borderWidth: 2, borderColor: '#fff',
  },
});

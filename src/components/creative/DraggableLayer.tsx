// レイヤー共通のジェスチャーラッパー：移動・拡大縮小・回転を指操作だけで行う。
// 座標は常に論理座標（呼び出し側が渡すキャンバス/スロット基準）で保持し、
// 表示側でdisplayScaleを掛けて縮小表示する。x,yはレイヤーの左上位置。
// scale/rotationは各レイヤー自身の中心を軸に効く（React Nativeのtransformは
// デフォルトで要素自身の中心が基準になるため）。
// storyStudio/DraggableLayer.tsxのジェスチャーロジックをそのまま移植したもの
// （「ストーリー作成」統合により、写真1枚のテンプレートに限らず汎用のドラッグ可能な
// レイヤーコンテナとして使う）。
import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';

interface Props {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  displayScale: number;
  selected: boolean;
  /** trueの間はドラッグ・拡大縮小・回転・選択を一切受け付けない（確定前のプレビュー用） */
  locked?: boolean;
  /** falseにすると回転ジェスチャーを無効化する（写真スロットは位置・拡大率のみ操作可能にするため） */
  rotatable?: boolean;
  /** ピンチで縮小できる下限・拡大できる上限。既定は0.2〜4（写真スロットは「スロットを覆いきる
   *  倍率」を下限にするため、呼び出し側から動的な値を渡せるようにしている） */
  minScale?: number;
  maxScale?: number;
  onSelect: () => void;
  onChange: (patch: { x: number; y: number; scale: number; rotation: number }) => void;
  children: React.ReactNode;
}

export default function DraggableLayer({
  x, y, scale, rotation, displayScale, selected, locked, rotatable = true,
  minScale = 0.2, maxScale = 4, onSelect, onChange, children,
}: Props) {
  const translateX = useSharedValue(x);
  const translateY = useSharedValue(y);
  const savedScale = useSharedValue(scale);
  const savedRotation = useSharedValue(rotation);

  // 外部（他の編集操作・レイヤー切替）からの値変更を反映
  React.useEffect(() => { translateX.value = x; }, [x]);
  React.useEffect(() => { translateY.value = y; }, [y]);
  React.useEffect(() => { savedScale.value = scale; }, [scale]);
  React.useEffect(() => { savedRotation.value = rotation; }, [rotation]);

  const commit = () => {
    onChange({
      x: translateX.value,
      y: translateY.value,
      scale: savedScale.value,
      rotation: savedRotation.value,
    });
  };

  const pan = Gesture.Pan()
    .enabled(!locked)
    .onBegin(() => runOnJS(onSelect)())
    .onUpdate((e) => {
      translateX.value = x + e.translationX / displayScale;
      translateY.value = y + e.translationY / displayScale;
    })
    .onEnd(() => runOnJS(commit)());

  const pinch = Gesture.Pinch()
    .enabled(!locked)
    .onBegin(() => runOnJS(onSelect)())
    .onUpdate((e) => {
      savedScale.value = Math.min(maxScale, Math.max(minScale, scale * e.scale));
    })
    .onEnd(() => runOnJS(commit)());

  const rotate = Gesture.Rotation()
    .enabled(!locked && rotatable)
    .onBegin(() => runOnJS(onSelect)())
    .onUpdate((e) => {
      savedRotation.value = rotation + (e.rotation * 180) / Math.PI;
    })
    .onEnd(() => runOnJS(commit)());

  const tap = Gesture.Tap().enabled(!locked).onEnd(() => runOnJS(onSelect)());

  const composed = Gesture.Simultaneous(pan, pinch, rotate, tap);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value * displayScale },
      { translateY: translateY.value * displayScale },
      { scale: savedScale.value },
      { rotateZ: `${savedRotation.value}deg` },
    ] as any,
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={[
          styles.wrap,
          style,
          selected && styles.selected,
        ]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0 },
  selected: { borderWidth: 1.5, borderColor: '#4A90D9', borderStyle: 'dashed' },
});

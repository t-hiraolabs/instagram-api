// レイヤー共通のジェスチャーラッパー：移動・拡大縮小・回転を指操作だけで行う。
// 座標は常に論理座標（1080x1920基準）で保持し、表示側でdisplayScaleを掛けて縮小表示する。
// x,yはレイヤーの左上位置。scale/rotationは各レイヤー自身の中心を軸に効く
// （React Nativeのtransformはデフォルトで要素自身の中心が基準になるため）。
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
  onSelect: () => void;
  onChange: (patch: { x: number; y: number; scale: number; rotation: number }) => void;
  children: React.ReactNode;
}

export default function DraggableLayer({
  x, y, scale, rotation, displayScale, selected, onSelect, onChange, children,
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
    .onBegin(() => runOnJS(onSelect)())
    .onUpdate((e) => {
      translateX.value = x + e.translationX / displayScale;
      translateY.value = y + e.translationY / displayScale;
    })
    .onEnd(() => runOnJS(commit)());

  const pinch = Gesture.Pinch()
    .onBegin(() => runOnJS(onSelect)())
    .onUpdate((e) => {
      savedScale.value = Math.min(4, Math.max(0.2, scale * e.scale));
    })
    .onEnd(() => runOnJS(commit)());

  const rotate = Gesture.Rotation()
    .onBegin(() => runOnJS(onSelect)())
    .onUpdate((e) => {
      savedRotation.value = rotation + (e.rotation * 180) / Math.PI;
    })
    .onEnd(() => runOnJS(commit)());

  const tap = Gesture.Tap().onEnd(() => runOnJS(onSelect)());

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
  wrap: { position: 'absolute' },
  selected: { borderWidth: 1.5, borderColor: '#4A90D9', borderStyle: 'dashed' },
});

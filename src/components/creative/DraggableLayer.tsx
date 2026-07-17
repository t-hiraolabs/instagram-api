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
  SharedValue,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { snapValueWithHit } from '../../utils/snap';

// きりのいい位置・倍率（中央寄せ、スロットをちょうど覆う倍率など）に近づいたときに
// 一瞬止まる感触を出すための許容量。位置は画面px基準（displayScaleで論理px換算）、
// 倍率は比率そのもの（0.04 = 4%以内）。
const POSITION_SNAP_SCREEN_PX = 8;
const SCALE_SNAP_ZONE = 0.04;
// スナップ中だけ表示する、見えやすい枠線の色
const GUIDE_COLOR = '#00E5FF';
// 文字・ステッカーなど表示上小さい要素は、指2本を近づけて操作する「縮小ピンチ」の
// 開始位置が実際の見た目の範囲内に収まりにくい（指先の接地面はpxよりずっと大きいため）。
// タッチ判定領域を見た目より広げることで小さい要素でも指2本を置きやすくする。
// 以前はこれを選択中の要素だけに絞って未選択要素は狭くしていたが、それだと逆に
// 未選択の小さい要素（テキスト等）を拡大しようとする最初のピンチ自体が始めにくくなって
// しまっていた。他要素への干渉はhitSlopの大小ではなくactiveOwner（下記）による
// 排他制御で防ぐことにしたため、hitSlopは全要素で常に広げてよい。
const HIT_SLOP = 100;

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
  /** 近づいたときに一瞬止まる位置・倍率のスナップ先（論理px／倍率）。写真スロットの中央・
   *  スロットをちょうど覆う倍率などに使う。未指定ならスナップしない */
  snapX?: number[];
  snapY?: number[];
  snapScale?: number[];
  /** 同じキャンバス上の全レイヤーで共有するshared value。ある要素を指で操作している間、
   *  他の要素が別の指の操作に反応しないようにする排他ロックに使う（下記参照）。
   *  未指定なら排他制御なし（従来通り、各要素が独立して各自のタッチに反応する） */
  activeOwner?: SharedValue<string | null>;
  testID?: string;
  onSelect: () => void;
  onChange: (patch: { x: number; y: number; scale: number; rotation: number }) => void;
  children: React.ReactNode;
}

let nextInstanceId = 0;

export default function DraggableLayer({
  x, y, scale, rotation, displayScale, selected, locked, rotatable = true,
  minScale = 0.2, maxScale = 4, snapX, snapY, snapScale, activeOwner, testID, onSelect, onChange, children,
}: Props) {
  // activeOwnerロックの持ち主を識別するためだけの、このコンポーネントインスタンス固有のID
  const myId = React.useRef(`layer_${nextInstanceId++}`).current;
  const translateX = useSharedValue(x);
  const translateY = useSharedValue(y);
  const savedScale = useSharedValue(scale);
  const savedRotation = useSharedValue(rotation);
  // 各ジェスチャー開始時点の値を控えておき、そこからの差分で計算する（onUpdateの中で
  // 直接x/y/scale/rotation propsを参照すると、ジェスチャー中に親が再レンダーされた
  // 場合に古いクロージャ値を基準にしてしまい、位置や拡大率が一瞬で元に戻る不具合の
  // 原因になっていた。shared valueだけを基準にすることで再レンダーの影響を受けない）
  const baseX = useSharedValue(x);
  const baseY = useSharedValue(y);
  const baseScale = useSharedValue(scale);
  const baseRotation = useSharedValue(rotation);
  // きりのいい位置・倍率にスナップしている間だけtrueにし、見えやすい枠線を表示する
  const isSnapped = useSharedValue(false);

  // 指がこの要素に触れた瞬間に呼ぶ：既に「別の」要素がロックを持っていればこの要素への
  // タッチ自体を失敗させ、そちらの要素だけが反応し続けるようにする（2本指でそれぞれ別の
  // 要素を同時に操作できてしまう不具合の対策）。ロックが空いていれば自分が獲得する。
  const acquireLock = (manager: { fail: () => void }) => {
    'worklet';
    if (!activeOwner) return;
    if (activeOwner.value !== null && activeOwner.value !== myId) {
      manager.fail();
      return;
    }
    activeOwner.value = myId;
  };
  // この要素上の全ての指が離れたらロックを解放する（自分が持っている場合のみ）
  const releaseLockIfEmpty = (numberOfTouches: number) => {
    'worklet';
    if (!activeOwner) return;
    if (numberOfTouches === 0 && activeOwner.value === myId) {
      activeOwner.value = null;
    }
  };

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
    .hitSlop(HIT_SLOP)
    .onTouchesDown((_e, manager) => acquireLock(manager))
    .onTouchesUp((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onTouchesCancelled((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onBegin(() => {
      baseX.value = translateX.value;
      baseY.value = translateY.value;
      runOnJS(onSelect)();
    })
    .onUpdate((e) => {
      const zone = POSITION_SNAP_SCREEN_PX / displayScale;
      let nx = baseX.value + e.translationX / displayScale;
      let ny = baseY.value + e.translationY / displayScale;
      let snapped = false;
      if (snapX) { const r = snapValueWithHit(nx, snapX, zone); nx = r.value; if (r.hit !== null) snapped = true; }
      if (snapY) { const r = snapValueWithHit(ny, snapY, zone); ny = r.value; if (r.hit !== null) snapped = true; }
      translateX.value = nx;
      translateY.value = ny;
      isSnapped.value = snapped;
    })
    .onEnd(() => { isSnapped.value = false; runOnJS(commit)(); });

  const pinch = Gesture.Pinch()
    .enabled(!locked)
    .hitSlop(HIT_SLOP)
    .onTouchesDown((_e, manager) => acquireLock(manager))
    .onTouchesUp((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onTouchesCancelled((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onBegin(() => {
      baseScale.value = savedScale.value;
      runOnJS(onSelect)();
    })
    .onUpdate((e) => {
      let s = Math.min(maxScale, Math.max(minScale, baseScale.value * e.scale));
      let snapped = false;
      if (snapScale) { const r = snapValueWithHit(s, snapScale, SCALE_SNAP_ZONE); s = r.value; if (r.hit !== null) snapped = true; }
      savedScale.value = s;
      isSnapped.value = snapped;
    })
    .onEnd(() => { isSnapped.value = false; runOnJS(commit)(); });

  const rotate = Gesture.Rotation()
    .enabled(!locked && rotatable)
    .hitSlop(HIT_SLOP)
    .onTouchesDown((_e, manager) => acquireLock(manager))
    .onTouchesUp((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onTouchesCancelled((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onBegin(() => {
      baseRotation.value = savedRotation.value;
      runOnJS(onSelect)();
    })
    .onUpdate((e) => {
      savedRotation.value = baseRotation.value + (e.rotation * 180) / Math.PI;
    })
    .onEnd(() => runOnJS(commit)());

  const tap = Gesture.Tap()
    .enabled(!locked)
    .hitSlop(HIT_SLOP)
    .onTouchesDown((_e, manager) => acquireLock(manager))
    .onTouchesUp((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onTouchesCancelled((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onEnd(() => runOnJS(onSelect)());

  const composed = Gesture.Simultaneous(pan, pinch, rotate, tap);

  const style = useAnimatedStyle(() => {
    // 枠線の優先順位: スナップ中（見えやすい色）＞選択中（通常の選択枠）＞非表示
    let borderWidth = 0;
    let borderColor = 'transparent';
    let borderStyle: 'solid' | 'dashed' = 'dashed';
    if (isSnapped.value) {
      borderWidth = 2.5; borderColor = GUIDE_COLOR; borderStyle = 'solid';
    } else if (selected) {
      borderWidth = 1.5; borderColor = '#4A90D9'; borderStyle = 'dashed';
    }
    return {
      transform: [
        { translateX: translateX.value * displayScale },
        { translateY: translateY.value * displayScale },
        { scale: savedScale.value },
        { rotateZ: `${savedRotation.value}deg` },
      ] as any,
      borderWidth, borderColor, borderStyle,
    };
  });

  return (
    <GestureDetector gesture={composed}>
      <Animated.View testID={testID} style={[styles.wrap, style]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0 },
});

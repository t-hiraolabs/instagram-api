// レイヤー共通のジェスチャーラッパー：移動・タップ選択を指操作で行う。
// 座標は常に論理座標（呼び出し側が渡すキャンバス/スロット基準）で保持し、
// 表示側でdisplayScaleを掛けて縮小表示する。x,yはレイヤーの左上位置。
// scale/rotationは各レイヤー自身の中心を軸に効く（React Nativeのtransformは
// デフォルトで要素自身の中心が基準になるため）。
//
// 拡大縮小・回転（ピンチ・回転ジェスチャー）はこのコンポーネント自身では扱わない。
// react-native-gesture-handlerのWeb実装は、新しいタッチの捕捉先を「そのView自身の
// 実際のDOM矩形内かどうか」だけで判定し、hitSlopは（begin後の継続判定にしか使われず）
// 新規タッチの捕捉範囲を広げない（isPointerInBoundsが素のgetBoundingClientRectしか
// 見ていないため）。そのため「小さい要素に1本指で触れていれば、もう1本の指は
// どこに触れてもピンチとして扱ってよい」という挙動は、要素ごとの当たり判定を
// 広げる方式では実現できない。代わりに、ピンチ・回転はキャンバス全体を覆う
// CreativeCanvas側の1つのジェスチャーで受け止め、「今どの要素が操作対象か」を
// 示すactiveRefs（下記）を介して対象要素のshared valueを直接更新する。
// このコンポーネントが担当するのは、指1本での移動（pan）とタップ選択、および
// 「今操作対象になっている要素はどれか」をactiveOwner/activeRefsへ登録することだけ。
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
  GestureType,
} from 'react-native-gesture-handler';
import { snapValueWithHit } from '../../utils/snap';

// きりのいい位置（中央寄せなど）に近づいたときに一瞬止まる感触を出すための許容量
// （画面px基準、displayScaleで論理px換算）。
const POSITION_SNAP_SCREEN_PX = 8;
// スナップ中だけ表示する、見えやすい枠線の色
const GUIDE_COLOR = '#00E5FF';
// 移動・タップ選択の当たり判定は見た目の範囲より少し広めに取る（指先の接地面は
// pxよりずっと大きいため、小さい要素でも触れやすくする）。
const HIT_SLOP = 100;

/** キャンバス全体で共有する、「今どの要素が操作対象か」を示すロックの中身。
 *  ピンチ・回転はCreativeCanvas側の1つのジェスチャーで受け止め、これを介して
 *  対象要素のshared valueを直接更新する（詳細はファイル先頭のコメント参照）。 */
export interface ActiveLayerRefs {
  id: string;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  baseScale: SharedValue<number>;
  savedScale: SharedValue<number>;
  baseRotation: SharedValue<number>;
  savedRotation: SharedValue<number>;
  isSnapped: SharedValue<boolean>;
  minScale: number;
  maxScale: number;
  rotatable: boolean;
  snapScale?: number[];
}

interface Props {
  /** 写真スロットID・テキストレイヤーIDなど、呼び出し側での意味のある一意なID。
   *  activeOwner/activeRefsの持ち主を識別するのに使う */
  id: string;
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
  /** 同じキャンバス上の全レイヤーで共有するshared value。「今操作対象になっている要素の
   *  ID」を持ち、他の要素が別の指の操作に反応しないようにする排他ロックに使う */
  activeOwner: SharedValue<string | null>;
  /** activeOwnerと対になる、対象要素のshared value参照。CreativeCanvas側のピンチ・回転
   *  ジェスチャーがこれを介して直接scale/rotationを更新する */
  activeRefs: SharedValue<ActiveLayerRefs | null>;
  /** CreativeCanvas側のキャンバス全体を覆うピンチ・回転ジェスチャー。react-native-gesture-
   *  handlerは、ネストしたView同士のジェスチャーをデフォルトで排他的に扱う（子が同じ
   *  タッチを"所有"すると判断すると、たとえ子のジェスチャーが後でfailしても親は
   *  そのタッチを一切受け取れない）。simultaneousWithExternalGestureで明示的に
   *  「同時に認識してよい」関係を宣言しないと、2本目の指が他の要素の上に乗った時に
   *  キャンバス側のピンチ・回転が全く反応しなくなってしまう */
  canvasGestures: GestureType[];
  testID?: string;
  onSelect: () => void;
  onChange: (patch: { x: number; y: number; scale: number; rotation: number }) => void;
  children: React.ReactNode;
}

export default function DraggableLayer({
  id, x, y, scale, rotation, displayScale, selected, locked, rotatable = true,
  minScale = 0.2, maxScale = 4, snapX, snapY, snapScale, activeOwner, activeRefs, canvasGestures, testID, onSelect, onChange, children,
}: Props) {
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
  // 要素を同時に操作できてしまう不具合の対策）。ロックが空いていれば自分が獲得し、
  // 同時にactiveRefsへ自分のshared value参照を登録する（ピンチ・回転はキャンバス
  // レベルのジェスチャーがこれを見て、この要素を直接操作できるようにするため）。
  const acquireLock = (manager: { fail: () => void }) => {
    'worklet';
    if (activeOwner.value !== null && activeOwner.value !== id) {
      manager.fail();
      return;
    }
    activeOwner.value = id;
    activeRefs.value = {
      id, translateX, translateY, baseScale, savedScale, baseRotation, savedRotation, isSnapped,
      minScale, maxScale, rotatable, snapScale,
    };
  };
  // この要素上の全ての指が離れたらロックを解放する（自分が持っている場合のみ）
  const releaseLockIfEmpty = (numberOfTouches: number) => {
    'worklet';
    if (numberOfTouches === 0 && activeOwner.value === id) {
      activeOwner.value = null;
      activeRefs.value = null;
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
    .simultaneousWithExternalGesture(...canvasGestures)
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

  const tap = Gesture.Tap()
    .enabled(!locked)
    .hitSlop(HIT_SLOP)
    .simultaneousWithExternalGesture(...canvasGestures)
    .onTouchesDown((_e, manager) => acquireLock(manager))
    .onTouchesUp((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onTouchesCancelled((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onEnd(() => runOnJS(onSelect)());

  const composed = Gesture.Simultaneous(pan, tap);

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

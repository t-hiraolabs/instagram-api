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
import { CANVAS_W, CANVAS_H } from '../../types/creativeTemplate';

// きりのいい位置（中央寄せなど）に近づいたときに一瞬止まる感触を出すための許容量
// （画面px基準、displayScaleで論理px換算）。
const POSITION_SNAP_SCREEN_PX = 8;
// スナップ中だけ表示する、見えやすい枠線の色
export const GUIDE_COLOR = '#00E5FF';
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
  /** 要素の実寸（論理px）。指定した場合のみ、移動中に要素の中心がキャンバスの水平・垂直
   *  中央線に近づいたときに一瞬止まり、guideV/guideHで渡されたキャンバス全体のガイド線を
   *  表示する。テキストなど実寸が動的な要素は呼び出し側でonLayout等から測って渡す */
  width?: number;
  height?: number;
  /** キャンバス全体を貫くガイド線の表示状態（CreativeCanvas側で1つ生成し、全レイヤーで
   *  共有する）。値はガイド線を描画するキャンバス絶対座標（論理px）。該当軸がスナップして
   *  いない間はnullで非表示にする。写真スロットのようにx/yがスロット内ローカル座標の
   *  要素でも、線自体は常にキャンバス絶対座標で正しい位置に描ける */
  guideV?: SharedValue<number | null>;
  guideH?: SharedValue<number | null>;
  /** guideV/guideHがヒットした時に実際に表示する位置（論理px、キャンバス絶対座標）。
   *  省略時はキャンバス全体の中心（CANVAS_W/2, CANVAS_H/2）。写真スロットは自分自身の
   *  中央（スロットの絶対位置＋幅高さの半分）を渡し、「スロットにとっての中央」を
   *  正しく示す線にする */
  guideVAt?: number;
  guideHAt?: number;
  /** falseにすると選択中の青い枠線を表示しない（写真は枠線なしにしたいが、スナップ中の
   *  見えやすい枠線(isSnapped)は選択枠線とは別物なので、falseでも影響を受けない） */
  showSelectionBorder?: boolean;
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
  /** 指で実際に動かし始めた・動かし終えた瞬間に呼ぶ（tapのみで移動を伴わない選択とは
   *  区別する）。呼び出し側はこれを使って、移動中はプロパティパネルを隠すなどの
   *  切り替えができる */
  onDragStateChange?: (dragging: boolean) => void;
  /** 移動を伴わない「タップして指を離した」時だけ呼ぶ（onSelectはドラッグ開始時にも
   *  呼ばれるため、それとは区別してプロパティパネルを開く等の用途に使う） */
  onTap?: () => void;
  children: React.ReactNode;
}

export default function DraggableLayer({
  id, x, y, scale, rotation, displayScale, selected, locked, rotatable = true,
  minScale = 0.2, maxScale = 4, snapX, snapY, snapScale, width, height, guideV, guideH, guideVAt, guideHAt,
  showSelectionBorder = true, activeOwner, activeRefs, canvasGestures, testID, onSelect, onChange,
  onDragStateChange, onTap, children,
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
  // 今回のpanセッションで実際に指が動いてonDragStateChange(true)を通知済みかどうか。
  // タップだけ（移動なし）ではonUpdate自体が呼ばれないため、実際に動いた時だけ
  // 一度だけ通知する（毎フレームJSへ呼び出しを飛ばさないためのガード）
  const dragNotified = useSharedValue(false);
  // このジェスチャーセッションの間、自分がロックの持ち主として確定したかどうかの
  // スナップショット。activeOwner.valueを都度読み直すのではなく、開始時点で一度だけ
  // 判定してここへ控える：終了時（onTouchesUp）にactiveOwnerをクリアする処理と、
  // 同じタッチイベントに対するonEnd（確定処理）の実行順序は保証されないため、onEnd
  // の中でactiveOwner.valueを読み直すと既にnullへクリアされていて、本来コミットする
  // べき値が失われることがあった（自分が正当な持ち主だったのに動きが確定しない
  // 不具合の原因）。開始時点のスナップショットを使うことでこの競合を避ける。
  const isActiveSession = useSharedValue(false);

  // 指がこの要素に触れた瞬間に呼ぶ：既に「別の」要素がロックを持っていればこの要素への
  // タッチ自体を失敗させ、そちらの要素だけが反応し続けるようにする（2本指でそれぞれ別の
  // 要素を同時に操作できてしまう不具合の対策）。ロックが空いていれば自分が獲得し、
  // 同時にactiveRefsへ自分のshared value参照を登録する（ピンチ・回転はキャンバス
  // レベルのジェスチャーがこれを見て、この要素を直接操作できるようにするため）。
  // manager.fail()は「ジェスチャーが既にBEGAN/ACTIVE状態に達している場合」にしか
  // 効果がない（react-native-gesture-handlerの実装上、UNDETERMINED状態での
  // fail()呼び出しは実質no-op）。onTouchesDown発火時点ではまだUNDETERMINEDの
  // ことがほとんどのため、ここでfail()を呼んでもネイティブ側のジェスチャー認識
  // 自体は止まらず、後続のonBegin/onUpdateがそのまま実行されてしまう
  // （＝ロックを取れなかった要素が実際には動いてしまう不具合の原因だった）。
  // そのため、ここでは「ロックの持ち主を記録する」ことだけを行い、実際に値を
  // 変更する処理（onBegin/onUpdate/onEnd）側で毎回activeOwner.value===idを
  // 確認してから初めて反映する、という二重の防御にしている。
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
      isActiveSession.value = activeOwner.value === id;
      if (!isActiveSession.value) return;
      baseX.value = translateX.value;
      baseY.value = translateY.value;
      dragNotified.value = false;
      runOnJS(onSelect)();
    })
    .onUpdate((e) => {
      if (!isActiveSession.value) return;
      if (!dragNotified.value) {
        dragNotified.value = true;
        if (onDragStateChange) runOnJS(onDragStateChange)(true);
      }
      const zone = POSITION_SNAP_SCREEN_PX / displayScale;
      let nx = baseX.value + e.translationX / displayScale;
      let ny = baseY.value + e.translationY / displayScale;
      // 縦(X)・横(Y)、それぞれ実際に基準が指定されている軸だけを判定する。写真スロット
      // のように片方の軸に元々動く余地が無い要素（例: スロットと写真の縦横比が一致し、
      // 縦方向には常にセンター位置しか取り得ない）だと、その軸は指を全く動かさなくても
      // 常に基準へ「ヒット」してしまう。これを考慮せず「どちらか一方でもヒットしたら
      // スナップ中」（OR）にしてしまうと、もう片方の軸（実際に動かしている側）がどこに
      // あってもずっと枠線が点灯し続け、「止まって見えた位置」と「実際に指を離した位置」
      // が食い違う不具合の原因になっていた。指定された軸すべてが同時に基準に収まった
      // 時だけ「中央に揃った」とみなす（AND）ことで、この誤検知を防ぐ
      const xConfigured = !!snapX || !!width;
      const yConfigured = !!snapY || !!height;
      let xHit = false;
      let yHit = false;
      if (snapX) { const r = snapValueWithHit(nx, snapX, zone); nx = r.value; if (r.hit !== null) xHit = true; }
      if (snapY) { const r = snapValueWithHit(ny, snapY, zone); ny = r.value; if (r.hit !== null) yHit = true; }
      // キャンバス中央への整列ガイド（実寸がわかっている要素のみ。widthは水平中央線＝
      // 縦のガイド線、heightは垂直中央線＝横のガイド線に対応する）
      if (width) {
        const centerX = nx + width / 2;
        const r = snapValueWithHit(centerX, [CANVAS_W / 2], zone);
        if (r.hit !== null) { nx = r.value - width / 2; xHit = true; }
      }
      if (height) {
        const centerY = ny + height / 2;
        const r = snapValueWithHit(centerY, [CANVAS_H / 2], zone);
        if (r.hit !== null) { ny = r.value - height / 2; yHit = true; }
      }
      translateX.value = nx;
      translateY.value = ny;
      isSnapped.value = (xConfigured ? xHit : true) && (yConfigured ? yHit : true) && (xConfigured || yConfigured);
      if (guideV) guideV.value = xHit ? (guideVAt ?? CANVAS_W / 2) : null;
      if (guideH) guideH.value = yHit ? (guideHAt ?? CANVAS_H / 2) : null;
    })
    .onEnd(() => {
      if (!isActiveSession.value) return;
      isSnapped.value = false;
      if (guideV) guideV.value = null;
      if (guideH) guideH.value = null;
      // ここではdragNotified.valueをfalseへ戻さない：同じ指を離す瞬間にtap側の
      // onEndも同時に発火するが、2つのジェスチャーのonEnd同士の実行順序は保証
      // されないため、ここでリセットしてしまうとtap側が「動いていない」と
      // 誤判定し、移動して離した直後にプロパティが開いてしまう不具合の原因になる。
      // 次のセッション開始時（pan.onBegin）で改めてfalseにリセットすれば十分
      if (dragNotified.value && onDragStateChange) runOnJS(onDragStateChange)(false);
      runOnJS(commit)();
    });

  const tap = Gesture.Tap()
    .enabled(!locked)
    .hitSlop(HIT_SLOP)
    .simultaneousWithExternalGesture(...canvasGestures)
    .onTouchesDown((_e, manager) => {
      acquireLock(manager);
      isActiveSession.value = activeOwner.value === id;
    })
    .onTouchesUp((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onTouchesCancelled((e) => releaseLockIfEmpty(e.numberOfTouches))
    .onEnd(() => {
      if (!isActiveSession.value) return;
      runOnJS(onSelect)();
      // RNGHのTapジェスチャー自身の移動量しきい値には頼らず、実際にpan側で
      // 動きを検出したセッションかどうか（dragNotified）で厳密に判定する
      // （タップ用ジェスチャーの判定だけでは、移動を伴うドラッグ操作の直後にも
      // 稀にonEndが発火し、意図せずプロパティが開いてしまうことがあったため）
      if (onTap && !dragNotified.value) runOnJS(onTap)();
    });

  const composed = Gesture.Simultaneous(pan, tap);

  const style = useAnimatedStyle(() => {
    // 枠線の優先順位: スナップ中（見えやすい色）＞選択中（通常の選択枠）＞非表示
    let borderWidth = 0;
    let borderColor = 'transparent';
    let borderStyle: 'solid' | 'dashed' = 'dashed';
    if (isSnapped.value) {
      borderWidth = 2.5; borderColor = GUIDE_COLOR; borderStyle = 'solid';
    } else if (selected && showSelectionBorder) {
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

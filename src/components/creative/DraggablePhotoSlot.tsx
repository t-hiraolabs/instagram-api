// 「ストーリー作成」統合の核心部分。写真スロット1件を、スロット自身の矩形で
// overflow:hiddenクリップし、その内側だけで写真をpan+pinch+回転操作できるようにする。
// 旧StoryCanvas.tsxは常にキャンバス全面1枚だけを暗黙のスロットとして扱っていたが、
// これを複数の独立したスロットに一般化したもの。
//
// - 拡大率1.0は「スロットを覆いきる（cover）」倍率で、そこに近づくと一瞬止まる
//   （スナップする）ガイドとして機能する。ただし固定の下限ではなく、そこからさらに
//   縮小することもできる（縮小するとスロットの外側に背景が見える余白ができる。
//   これは意図した挙動で、常に隙間なく覆う必要がある場合はscale=1で使う）。
// - パン（位置調整）は、画像が拡大率1.0以上（スロットを覆っている間）は画像の端が
//   スロットの端より内側に入らないようクランプする。拡大率1.0未満（余白がある状態）
//   では画像は自動的に中央に固定される（このクランプは軸に沿った矩形を前提にした
//   近似のため、回転中は多少の誤差が生じうる）。
import React from 'react';
import { View, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SharedValue } from 'react-native-reanimated';
import { GestureType } from 'react-native-gesture-handler';
import DraggableLayer, { ActiveLayerRefs } from './DraggableLayer';
import { PhotoSlot } from '../../types/creativeTemplate';
import { PhotoAssignment } from '../../store/creativeEditorStore';
import { COLORS } from '../../utils/theme';
import { MIN_PHOTO_SCALE, photoSlotGeometry, clampPhotoOffset } from '../../utils/photoSlotMath';

interface Props {
  slot: PhotoSlot;
  assignment: PhotoAssignment | undefined;
  displayScale: number;
  selected: boolean;
  locked?: boolean;
  testID?: string;
  /** キャンバス全体で共有するshared value（DraggableLayer参照） */
  activeOwner: SharedValue<string | null>;
  activeRefs: SharedValue<ActiveLayerRefs | null>;
  /** キャンバス中央整列ガイド線の表示状態（DraggableLayer参照） */
  guideV: SharedValue<boolean>;
  guideH: SharedValue<boolean>;
  /** CreativeCanvas側のキャンバス全体を覆うピンチ・回転ジェスチャー（DraggableLayer参照） */
  canvasGestures: GestureType[];
  onSelect: () => void;
  onChange: (patch: { offsetX: number; offsetY: number; scale: number; rotation: number }) => void;
  onPickPhoto?: () => void;
}

export default function DraggablePhotoSlot({
  slot, assignment, displayScale, selected, locked, testID, activeOwner, activeRefs, guideV, guideH, canvasGestures, onSelect, onChange, onPickPhoto,
}: Props) {
  const clipStyle = {
    position: 'absolute' as const,
    left: slot.x * displayScale,
    top: slot.y * displayScale,
    width: slot.w * displayScale,
    height: slot.h * displayScale,
    overflow: 'hidden' as const,
  };

  if (!assignment) {
    // 背景（layers内のkind:'background'）は写真スロットの背面（描画順序上はこのスロットより
    // 手前だが、CreativeCanvas側でスロット自体をここに配置している）に置かれるため、
    // 写真未設定のプレースホルダーが不透明だと背景を完全に覆い隠してしまう
    // （「背景のみで投稿したい」場合に背景が全く見えない不具合の原因だった）。
    // 背景が見えるよう透明にし、タップ対象のヒントとして枠線とアイコンだけ残す
    return (
      <TouchableOpacity testID={testID} style={[clipStyle, styles.placeholder]} onPress={onPickPhoto} activeOpacity={0.7}>
        <Ionicons name="image-outline" size={28 * displayScale} color={COLORS.textMuted} />
      </TouchableOpacity>
    );
  }

  // スロットをcoverする基準サイズ（assignment.scale===1のときにちょうどスロットを覆う）
  const { imgW, imgH, centerX, centerY } = photoSlotGeometry(slot, assignment);

  const handleChange = (patch: { x: number; y: number; scale: number; rotation: number }) => {
    onChange(clampPhotoOffset(slot, assignment, patch.x, patch.y, patch.scale, patch.rotation));
  };

  return (
    <View style={clipStyle} testID={testID}>
      <DraggableLayer
        id={slot.id}
        x={centerX + assignment.offsetX}
        y={centerY + assignment.offsetY}
        scale={assignment.scale}
        rotation={assignment.rotation}
        minScale={MIN_PHOTO_SCALE}
        maxScale={4}
        // 中央（隙間なくスロットに収まる基準位置）と、スロットをちょうど覆う倍率（scale=1、
        // 縮小していくとスロットの上下または左右がぴったり収まる境目）に近づいたら一瞬止まる
        snapX={[centerX]}
        snapY={[centerY]}
        snapScale={[1]}
        width={imgW}
        height={imgH}
        // このDraggableLayerのx/yはスロット自身の矩形内でのローカル座標（親のclipStyleが
        // slot.x/slot.y分だけ既にずれた位置にある）。中央整列ガイドはキャンバス全体の中心を
        // 基準に判定するため、スロットの絶対位置をここで伝えてローカル→絶対座標に補正する
        canvasOffsetX={slot.x}
        canvasOffsetY={slot.y}
        guideV={guideV}
        guideH={guideH}
        showSelectionBorder={false}
        displayScale={displayScale}
        selected={selected}
        locked={locked}
        activeOwner={activeOwner}
        activeRefs={activeRefs}
        canvasGestures={canvasGestures}
        onSelect={onSelect}
        onChange={handleChange}
      >
        <Image
          source={{ uri: assignment.uri }}
          style={{ width: imgW * displayScale, height: imgH * displayScale }}
          resizeMode="cover"
          // Web版のブラウザは<img>の既定のドラッグ&ドロップ操作を許可しており、これが
          // DraggableLayerのpanジェスチャーと競合して、ブラウザ自身が独自にドラッグを
          // 開始し、ページの再読み込み（キャッシュされた古いバンドルへの切り替わり）を
          // 引き起こす不具合の原因になる。draggable={false}で無効化し、pointerEvents=
          // "none"でこの要素自体への当たり判定も外し、タッチ操作は必ず親の
          // DraggableLayer（GestureDetector）が受け取るようにする
          draggable={false}
          pointerEvents="none"
        />
      </DraggableLayer>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
});

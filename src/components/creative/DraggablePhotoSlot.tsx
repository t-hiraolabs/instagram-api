// 「ストーリー作成」統合の核心部分。写真スロット1件を、スロット自身の矩形で
// overflow:hiddenクリップし、その内側だけで写真をpan+pinch操作できるようにする。
// 旧StoryCanvas.tsxは常にキャンバス全面1枚だけを暗黙のスロットとして扱っていたが、
// これを複数の独立したスロットに一般化したもの。
//
// - 最小スケールは「スロットを覆いきる（cover）」倍率を1.0として動的に決まるため、
//   ズームアウトしてスロットの外側（余白）が見えることはない。
// - パン（位置調整）も、画像の端がスロットの端より内側に入らないようクランプするため、
//   隙間が出ることはない。
// - 回転は無効（「位置と拡大率」のみが要件のため）。
import React from 'react';
import { View, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DraggableLayer from './DraggableLayer';
import { PhotoSlot } from '../../types/creativeTemplate';
import { PhotoAssignment } from '../../store/creativeEditorStore';
import { COLORS } from '../../utils/theme';

interface Props {
  slot: PhotoSlot;
  assignment: PhotoAssignment | undefined;
  displayScale: number;
  selected: boolean;
  locked?: boolean;
  testID?: string;
  onSelect: () => void;
  onChange: (patch: { offsetX: number; offsetY: number; scale: number }) => void;
  onPickPhoto?: () => void;
}

export default function DraggablePhotoSlot({
  slot, assignment, displayScale, selected, locked, testID, onSelect, onChange, onPickPhoto,
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
    return (
      <TouchableOpacity testID={testID} style={[clipStyle, styles.placeholder]} onPress={onPickPhoto} activeOpacity={0.7}>
        <Ionicons name="image-outline" size={28 * displayScale} color={COLORS.textMuted} />
      </TouchableOpacity>
    );
  }

  // スロットをcoverする基準サイズ（assignment.scale===1のときにちょうどスロットを覆う）
  const coverScale = Math.max(slot.w / assignment.naturalW, slot.h / assignment.naturalH);
  const imgW = assignment.naturalW * coverScale;
  const imgH = assignment.naturalH * coverScale;
  const centerX = (slot.w - imgW) / 2;
  const centerY = (slot.h - imgH) / 2;

  const handleChange = (patch: { x: number; y: number; scale: number }) => {
    const scale = Math.max(1, Math.min(4, patch.scale));
    // 画像の端がスロットの端より内側に入らないよう、現在のscaleに応じてoffsetをクランプする
    // （DraggableLayerのscale transformはbox自身の中心を軸に効くため、画像の中心は
    // offsetに関わらず固定。境界はimgW*scale/imgH*scaleから導出できる）
    const boundX = Math.max(0, (imgW * scale - slot.w) / 2);
    const boundY = Math.max(0, (imgH * scale - slot.h) / 2);
    const offsetX = Math.max(-boundX, Math.min(boundX, patch.x - centerX));
    const offsetY = Math.max(-boundY, Math.min(boundY, patch.y - centerY));
    onChange({ offsetX, offsetY, scale });
  };

  return (
    <View style={clipStyle} testID={testID}>
      <DraggableLayer
        x={centerX + assignment.offsetX}
        y={centerY + assignment.offsetY}
        scale={assignment.scale}
        rotation={0}
        rotatable={false}
        minScale={1}
        maxScale={4}
        // 中央（隙間なくスロットに収まる基準位置）と、スロットをちょうど覆う倍率（scale=1、
        // 縮小していくとスロットの上下または左右がぴったり収まる境目）に近づいたら一瞬止まる
        snapX={[centerX]}
        snapY={[centerY]}
        snapScale={[1]}
        displayScale={displayScale}
        selected={selected}
        locked={locked}
        onSelect={onSelect}
        onChange={handleChange}
      >
        <Image
          source={{ uri: assignment.uri }}
          style={{ width: imgW * displayScale, height: imgH * displayScale }}
          resizeMode="cover"
        />
      </DraggableLayer>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
});

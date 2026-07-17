// 写真スロット内での画像のcover-fitサイズ・オフセットクランプ計算。
// DraggablePhotoSlot（スロット単体のドラッグ操作）とCreativeCanvas（ピンチ/回転を
// キャンバス全体レベルで扱う排他ロック機構）の両方から同じ計算式を使うための共通化。
import { PhotoSlot } from '../types/creativeTemplate';
import { PhotoAssignment } from '../store/creativeEditorStore';

/** 写真の縮小下限（0.2 = スロットを覆う倍率の20%まで縮小可能。テキスト/ステッカーと同じ既定値） */
export const MIN_PHOTO_SCALE = 0.2;

/** スロットをcoverする基準サイズ・中央位置（assignment.scale===1のときにちょうどスロットを覆う） */
export function photoSlotGeometry(slot: PhotoSlot, assignment: PhotoAssignment) {
  const coverScale = Math.max(slot.w / assignment.naturalW, slot.h / assignment.naturalH);
  const imgW = assignment.naturalW * coverScale;
  const imgH = assignment.naturalH * coverScale;
  const centerX = (slot.w - imgW) / 2;
  const centerY = (slot.h - imgH) / 2;
  return { imgW, imgH, centerX, centerY };
}

/** DraggableLayerが渡してくる論理座標（x, y, scale）を、スロット内に収まるoffsetX/offsetY/scaleへ変換する */
export function clampPhotoOffset(
  slot: PhotoSlot, assignment: PhotoAssignment, x: number, y: number, rawScale: number,
): { offsetX: number; offsetY: number; scale: number } {
  const { imgW, imgH, centerX, centerY } = photoSlotGeometry(slot, assignment);
  const scale = Math.max(MIN_PHOTO_SCALE, Math.min(4, rawScale));
  // 画像の端がスロットの端より内側に入らないよう、現在のscaleに応じてoffsetをクランプする
  // （scaleが1未満で画像がスロットより小さいときはbound=0となり、常に中央に固定される）
  const boundX = Math.max(0, (imgW * scale - slot.w) / 2);
  const boundY = Math.max(0, (imgH * scale - slot.h) / 2);
  const offsetX = Math.max(-boundX, Math.min(boundX, x - centerX));
  const offsetY = Math.max(-boundY, Math.min(boundY, y - centerY));
  return { offsetX, offsetY, scale };
}

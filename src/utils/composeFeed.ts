// フィード投稿用：写真を正方形(1080x1080)にトリミング合成する（web/Canvas専用）
import { loadImage } from './composeStory';

// 切り抜き枠（写真に対する割合 0..1）。x,y は左上、size は一辺（幅に対する割合）。
export interface FeedCrop {
  x: number;
  y: number;
  size: number;
}

export const FEED_SIZE = 1080;

/** 写真URI＋切り抜き枠（正規化）から正方形画像を生成。Blobとプレビューを返す */
export async function composeSquareImage(
  imageUri: string,
  crop: FeedCrop
): Promise<{ blob: Blob; previewUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = FEED_SIZE;
  canvas.height = FEED_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  const img = await loadImage(imageUri);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, FEED_SIZE, FEED_SIZE);

  // 正規化された枠を元画像のピクセルへ変換（size は幅基準だが contain で縦横同スケール）
  const sx = crop.x * img.width;
  const sy = crop.y * img.height;
  const sSide = crop.size * img.width;

  ctx.drawImage(img, sx, sy, sSide, sSide, 0, 0, FEED_SIZE, FEED_SIZE);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画像の生成に失敗しました'))),
      'image/jpeg',
      0.92
    )
  );
  return { blob, previewUrl: canvas.toDataURL('image/jpeg', 0.9) };
}

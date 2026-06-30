// フィード投稿用：写真を正方形(1080x1080)にトリミング合成する（web/Canvas専用）
import { loadImage } from './composeStory';

// 写真の「拡大・移動」情報。x/y はフレーム全体に対する割合（0=中央）で保持し、
// プレビュー(任意サイズ)と最終出力(1080px)で同じ見た目になるようにする。
export interface FeedTransform {
  scale: number; // 拡大率（1 = cover でぴったり収まる基準）
  x: number;     // 横移動（フレーム比, 0 = 中央）
  y: number;     // 縦移動（フレーム比, 0 = 中央）
}

export const DEFAULT_FEED_TRANSFORM: FeedTransform = { scale: 1, x: 0, y: 0 };

export const FEED_SIZE = 1080;

/** 写真URI＋transform から正方形画像を生成。Blob（アップロード用）とプレビューURLを返す */
export async function composeSquareImage(
  imageUri: string,
  t: FeedTransform = DEFAULT_FEED_TRANSFORM
): Promise<{ blob: Blob; previewUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = FEED_SIZE;
  canvas.height = FEED_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  const img = await loadImage(imageUri);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, FEED_SIZE, FEED_SIZE);

  // cover基準（フレームを覆う最小倍率）→ 拡大率を掛ける
  const cover = Math.max(FEED_SIZE / img.width, FEED_SIZE / img.height);
  const scale = cover * t.scale;
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (FEED_SIZE - dw) / 2 + t.x * FEED_SIZE;
  const dy = (FEED_SIZE - dh) / 2 + t.y * FEED_SIZE;
  ctx.drawImage(img, dx, dy, dw, dh);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画像の生成に失敗しました'))),
      'image/jpeg',
      0.92
    )
  );
  return { blob, previewUrl: canvas.toDataURL('image/jpeg', 0.9) };
}

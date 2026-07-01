// フィード投稿用：写真を指定比率(1:1 または 4:5)にトリミング合成する（web/Canvas専用）
import { loadImage } from './composeStory';

// 写真の「拡大・移動」情報。x/y はフレームに対する割合（0=中央, 幅/高さ基準）。
export interface FeedTransform {
  scale: number; // 拡大率（1 = cover でフレームにぴったり）
  x: number;     // 横移動（フレーム幅に対する割合）
  y: number;     // 縦移動（フレーム高さに対する割合）
}

export const DEFAULT_FEED_TRANSFORM: FeedTransform = { scale: 1, x: 0, y: 0 };

// アスペクト比（幅/高さ）
export const ASPECTS = { square: 1, portrait: 4 / 5 } as const;
export type AspectKey = keyof typeof ASPECTS;

export const FEED_W = 1080;

/** 写真URI＋transform＋比率 から画像を生成。Blob（アップロード用）とプレビューURLを返す */
export async function composeFeedImage(
  imageUri: string,
  t: FeedTransform,
  ar: number
): Promise<{ blob: Blob; previewUrl: string }> {
  const W = FEED_W;
  const H = Math.round(FEED_W / ar);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  const img = await loadImage(imageUri);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // 自動背景: 写真を極小サイズに縮小 → 引き伸ばして描画することで
  // ブラウザ非依存のぼかし背景にする（ctx.filter が効かない環境対策）
  {
    const sw = 12; // 小さいほど強くぼける
    const sh = Math.max(1, Math.round(sw / ar));
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext('2d');
    if (sctx) {
      const bgCover = Math.max(sw / img.width, sh / img.height);
      const bw = img.width * bgCover;
      const bh = img.height * bgCover;
      sctx.drawImage(img, (sw - bw) / 2, (sh - bh) / 2, bw, bh);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      // @ts-ignore ベンダー品質指定
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, W, H);
      ctx.restore();
    }
  }

  const cover = Math.max(W / img.width, H / img.height);
  const scale = cover * t.scale;
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (W - dw) / 2 + t.x * W;
  const dy = (H - dh) / 2 + t.y * H;
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

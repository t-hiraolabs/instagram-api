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

// 縮小して余白を埋める際の背景の作り方。「blur」は写真自体をぼかして敷き詰め、
// 「color」は写真の平均色でベタ塗りする（余白を目立たせたくない場合に使う）
export type BgMode = 'blur' | 'color';

/** 写真を小さなキャンバスに縮小して読み取り、全体の平均色を[r,g,b]で返す */
function getAverageColor(img: HTMLImageElement): [number, number, number] {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [32, 32, 32];
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  let r = 0, g = 0, b = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

/** [r,g,b]を明るく（amt>0）または暗く（amt<0）した色をrgb文字列で返す */
function shade(rgb: [number, number, number], amt: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp(rgb[0] + amt)}, ${clamp(rgb[1] + amt)}, ${clamp(rgb[2] + amt)})`;
}

/** 写真の平均色を基準に、左上（明るめ）から右下（暗め）への控えめなグラデーションで塗る */
function drawColorBackground(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number,
  H: number
) {
  const avg = getAverageColor(img);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, shade(avg, 28));
  g.addColorStop(1, shade(avg, -28));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/**
 * ぼかし背景をキャンバスに描画する（プレビュー・焼き込みで共通利用＝完全一致）。
 * 極小に縮小→段階的に拡大でなめらかにぼかし、周辺減光を加える。
 */
function drawBlurredBackground(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number,
  H: number
) {
  const ar = W / H;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // どの端末でも確実にぼけるよう、縮小→段階拡大方式で背景を作る
  const sw = 14;
  const sh = Math.max(1, Math.round(sw / ar));
  let cur = document.createElement('canvas');
  cur.width = sw;
  cur.height = sh;
  const sctx = cur.getContext('2d');
  if (!sctx) return;
  const bgCover = Math.max(sw / img.width, sh / img.height);
  const bw = img.width * bgCover;
  const bh = img.height * bgCover;
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(img, (sw - bw) / 2, (sh - bh) / 2, bw, bh);

  let cw = sw;
  let ch = sh;
  while (cw < W) {
    const nw = Math.min(W, cw * 2);
    const nh = Math.min(H, ch * 2);
    const next = document.createElement('canvas');
    next.width = nw;
    next.height = nh;
    const nctx = next.getContext('2d');
    if (!nctx) break;
    nctx.imageSmoothingEnabled = true;
    // @ts-ignore
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(cur, 0, 0, nw, nh);
    cur = next;
    cw = nw;
    ch = nh;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  // @ts-ignore
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, W, H);
  ctx.restore();

  // 周辺減光（ビネット）
  ctx.save();
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number,
  H: number,
  mode: BgMode
) {
  if (mode === 'color') drawColorBackground(ctx, img, W, H);
  else drawBlurredBackground(ctx, img, W, H);
}

/** 余白を埋める背景だけを生成してdataURLで返す（プレビュー用。焼き込みと同一の見た目） */
export async function makeBackgroundUrl(imageUri: string, ar: number, mode: BgMode = 'blur'): Promise<string> {
  const W = FEED_W;
  const H = Math.round(FEED_W / ar);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = await loadImage(imageUri);
  drawBackground(ctx, img, W, H, mode);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** 写真URI＋transform＋比率 から画像を生成。Blob（アップロード用）とプレビューURLを返す */
export async function composeFeedImage(
  imageUri: string,
  t: FeedTransform,
  ar: number,
  bgMode: BgMode = 'blur'
): Promise<{ blob: Blob; previewUrl: string }> {
  const W = FEED_W;
  const H = Math.round(FEED_W / ar);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  const img = await loadImage(imageUri);
  drawBackground(ctx, img, W, H, bgMode);

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

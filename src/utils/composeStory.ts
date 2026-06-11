// 写真の上に文字を合成して、Instagramストーリー用の1枚画像(JPEG)を作る（web/Canvas専用）
export interface StoryOverlay {
  title: string;
  bodyText: string;
  cta: string;
  textColor?: string;
}

// 写真・文字の「移動・拡大縮小」情報（編集画面で操作する）
export interface StoryTransform {
  imgScale: number; // 背景写真の拡大率（1 = ぴったり収まる基準）
  imgX: number; // 背景写真の横移動（キャンバスpx, 0 = 中央）
  imgY: number; // 背景写真の縦移動
  textScale: number; // 文字の拡大率（1 = 標準）
  textX: number; // 文字全体の横移動
  textY: number; // 文字全体の縦移動
}

export const DEFAULT_TRANSFORM: StoryTransform = {
  imgScale: 1,
  imgX: 0,
  imgY: 0,
  textScale: 1,
  textX: 0,
  textY: 0,
};

export const W = 1080;
export const H = 1920;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = src;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let line = '';
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 写真＋文字＋transform から1枚を描画する（編集プレビューと最終出力で共通利用） */
export function drawStory(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  overlay: StoryOverlay,
  t: StoryTransform
) {
  // リセット
  ctx.clearRect(0, 0, W, H);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 背景: 9:16にcoverで配置 → さらに拡大率と移動を適用
  const cover = Math.max(W / img.width, H / img.height);
  const scale = cover * t.imgScale;
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (W - dw) / 2 + t.imgX, (H - dh) / 2 + t.imgY, dw, dh);

  // 下半分に暗いグラデーション（文字を読みやすく）
  const grad = ctx.createLinearGradient(0, H * 0.4, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.78)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.4, W, H * 0.6);

  // ここから文字: 全体を移動＆拡大できるようにtranslate＋scale係数を適用
  ctx.save();
  ctx.translate(t.textX, t.textY);

  const s = t.textScale;
  const color = overlay.textColor || '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 12 * s;

  const margin = 110;
  let cursorY = H - margin;

  // CTAバッジ（最下部）
  if (overlay.cta) {
    ctx.shadowBlur = 0;
    ctx.font = `bold ${46 * s}px sans-serif`;
    const tw = ctx.measureText(overlay.cta).width;
    const padX = 52 * s;
    const bh = 110 * s;
    const bw = tw + padX * 2;
    const bx = (W - bw) / 2;
    const by = cursorY - bh;
    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'middle';
    ctx.fillText(overlay.cta, W / 2, by + bh / 2);
    ctx.textBaseline = 'alphabetic';
    cursorY = by - 50 * s;
  }

  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 12 * s;

  // 本文（CTAの上）
  if (overlay.bodyText) {
    ctx.fillStyle = color;
    ctx.font = `${50 * s}px sans-serif`;
    const lines = wrapText(ctx, overlay.bodyText, W - 200).reverse();
    for (const line of lines) {
      ctx.fillText(line, W / 2, cursorY);
      cursorY -= 70 * s;
    }
    cursorY -= 24 * s;
  }

  // タイトル（本文の上）
  if (overlay.title) {
    ctx.fillStyle = color;
    ctx.font = `bold ${96 * s}px sans-serif`;
    const lines = wrapText(ctx, overlay.title, W - 160).reverse();
    for (const line of lines) {
      ctx.fillText(line, W / 2, cursorY);
      cursorY -= 112 * s;
    }
  }

  ctx.restore();
}

/** 写真URI＋文字＋transform から合成画像を生成。Blob（アップロード用）とプレビューURLを返す */
export async function composeStoryImage(
  imageUri: string,
  overlay: StoryOverlay,
  transform: StoryTransform = DEFAULT_TRANSFORM
): Promise<{ blob: Blob; previewUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  const img = await loadImage(imageUri);
  drawStory(ctx, img, overlay, transform);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画像の生成に失敗しました'))),
      'image/jpeg',
      0.92
    )
  );
  return { blob, previewUrl: canvas.toDataURL('image/jpeg', 0.9) };
}

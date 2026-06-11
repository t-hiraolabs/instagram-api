// 写真の上に文字を合成して、Instagramストーリー用の1枚画像(JPEG)を作る（web/Canvas専用）
export interface StoryOverlay {
  title: string;
  bodyText: string;
  cta: string;
  textColor?: string;
}

const W = 1080;
const H = 1920;

function loadImage(src: string): Promise<HTMLImageElement> {
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

/** 写真URI＋文字から合成画像を生成。Blob（アップロード用）とプレビューURLを返す */
export async function composeStoryImage(
  imageUri: string,
  overlay: StoryOverlay
): Promise<{ blob: Blob; previewUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  // 背景写真を9:16にcoverで配置
  const img = await loadImage(imageUri);
  const scale = Math.max(W / img.width, H / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

  // 下半分に暗いグラデーション（文字を読みやすく）
  const grad = ctx.createLinearGradient(0, H * 0.4, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.78)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.4, W, H * 0.6);

  const color = overlay.textColor || '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 12;

  // 下から積み上げるため、まず高さを計算
  const margin = 110;

  // CTAバッジ（最下部）
  let cursorY = H - margin;
  if (overlay.cta) {
    ctx.shadowBlur = 0;
    ctx.font = 'bold 46px sans-serif';
    const tw = ctx.measureText(overlay.cta).width;
    const padX = 52;
    const bh = 110;
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
    cursorY = by - 50;
  }

  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 12;

  // 本文（CTAの上）
  if (overlay.bodyText) {
    ctx.fillStyle = color;
    ctx.font = '50px sans-serif';
    const lines = wrapText(ctx, overlay.bodyText, W - 200).reverse();
    for (const line of lines) {
      ctx.fillText(line, W / 2, cursorY);
      cursorY -= 70;
    }
    cursorY -= 24;
  }

  // タイトル（本文の上）
  if (overlay.title) {
    ctx.fillStyle = color;
    ctx.font = 'bold 96px sans-serif';
    const lines = wrapText(ctx, overlay.title, W - 160).reverse();
    for (const line of lines) {
      ctx.fillText(line, W / 2, cursorY);
      cursorY -= 112;
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画像の生成に失敗しました'))),
      'image/jpeg',
      0.92
    )
  );
  return { blob, previewUrl: canvas.toDataURL('image/jpeg', 0.9) };
}

// 写真＋見出し・詳細・価格などを組み合わせて「パンフレット/チラシ風」の1枚画像(JPEG)を作る（web/Canvas専用）
import { loadImage } from './composeStory';

export interface FlyerSpec {
  headline: string; // 見出し（15文字以内目安）
  subheadline?: string; // 補足の一言
  details: string[]; // 箇条書きの詳細（最大4つ程度）
  price?: string; // 価格・料金表示（任意）
  footer?: string; // 連絡先・CTAなど（任意）
  accentColor: string; // アクセントカラー（帯・見出し文字色）
  textColor?: string; // 本文の文字色（デフォルト #222222）
}

export const FLYER_W = 1080;
export const FLYER_H = 1350; // 4:5（フィード投稿にそのまま使える比率）

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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

/** 写真＋FlyerSpec から1枚を描画する（上部に写真、下部に情報パネル） */
export function drawFlyer(ctx: CanvasRenderingContext2D, img: HTMLImageElement, spec: FlyerSpec) {
  const W = FLYER_W;
  const H = FLYER_H;
  ctx.clearRect(0, 0, W, H);

  // 上部55%: 写真をcoverで配置
  const photoH = H * 0.55;
  const cover = Math.max(W / img.width, photoH / img.height);
  const dw = img.width * cover;
  const dh = img.height * cover;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, photoH);
  ctx.clip();
  ctx.drawImage(img, (W - dw) / 2, (photoH - dh) / 2, dw, dh);
  ctx.restore();

  // アクセントカラーの帯（写真とパネルの境目）
  const barH = 14;
  ctx.fillStyle = spec.accentColor || '#E1306C';
  ctx.fillRect(0, photoH, W, barH);

  // 下部: 白パネル
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, photoH + barH, W, H - photoH - barH);

  const textColor = spec.textColor || '#222222';
  const padX = 70;
  let y = photoH + barH + 90;

  // 見出し
  ctx.textAlign = 'left';
  ctx.fillStyle = spec.accentColor || '#E1306C';
  ctx.font = 'bold 62px sans-serif';
  const headlineLines = wrapText(ctx, spec.headline, W - padX * 2);
  for (const line of headlineLines) {
    ctx.fillText(line, padX, y);
    y += 74;
  }

  // 補足
  if (spec.subheadline) {
    y += 8;
    ctx.fillStyle = textColor;
    ctx.font = '38px sans-serif';
    const lines = wrapText(ctx, spec.subheadline, W - padX * 2);
    for (const line of lines) {
      ctx.fillText(line, padX, y);
      y += 50;
    }
  }

  // 区切り線
  y += 20;
  ctx.strokeStyle = '#E5E5E5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, y);
  ctx.lineTo(W - padX, y);
  ctx.stroke();
  y += 50;

  // 詳細（箇条書き）
  ctx.fillStyle = textColor;
  ctx.font = '36px sans-serif';
  for (const d of spec.details.slice(0, 4)) {
    ctx.fillStyle = spec.accentColor || '#E1306C';
    ctx.fillText('・', padX, y);
    ctx.fillStyle = textColor;
    const lines = wrapText(ctx, d, W - padX * 2 - 40);
    lines.forEach((line, i) => {
      ctx.fillText(line, padX + 40, y + i * 46);
    });
    y += 46 * Math.max(1, lines.length) + 16;
  }

  // 価格バッジ
  if (spec.price) {
    const badgeY = H - 190;
    ctx.font = 'bold 44px sans-serif';
    const tw = ctx.measureText(spec.price).width;
    const bw = tw + 80;
    const bh = 90;
    ctx.fillStyle = spec.accentColor || '#E1306C';
    ctx.beginPath();
    ctx.moveTo(padX + 20, badgeY);
    ctx.lineTo(padX + bw + 20, badgeY);
    ctx.lineTo(padX + bw + 20, badgeY + bh);
    ctx.lineTo(padX + 20, badgeY + bh);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.price, padX + 60, badgeY + bh / 2);
    ctx.textBaseline = 'alphabetic';
  }

  // フッター（連絡先・CTA）
  if (spec.footer) {
    ctx.fillStyle = '#888888';
    ctx.font = '30px sans-serif';
    ctx.fillText(spec.footer, padX, H - 50);
  }
}

/** 写真URI＋FlyerSpec から合成画像を生成。Blob（アップロード用）とプレビューURLを返す */
export async function composeFlyerImage(
  imageUri: string,
  spec: FlyerSpec
): Promise<{ blob: Blob; previewUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = FLYER_W;
  canvas.height = FLYER_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  const img = await loadImage(imageUri);
  drawFlyer(ctx, img, spec);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画像の生成に失敗しました'))),
      'image/jpeg',
      0.92
    )
  );
  return { blob, previewUrl: canvas.toDataURL('image/jpeg', 0.9) };
}

// 「本日の出勤」ストーリー画像を作る（web/Canvas専用）
// その日のグループ写真1枚に、見出し＋日付＋メンバー名を重ねる

const W = 1080;
const H = 1920;

const FONT_NAME = 'Zen Kaku Gothic New';
const FONT_FAMILY = `"${FONT_NAME}", sans-serif`;

function ensureFontLink() {
  if (typeof document === 'undefined') return;
  const id = 'roster-font-link';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700;900&display=swap';
  document.head.appendChild(link);
}

async function loadFontFor(text: string) {
  if (typeof document === 'undefined') return;
  ensureFontLink();
  try {
    await (document as any).fonts.load(`900 100px "${FONT_NAME}"`, text);
    await (document as any).fonts.load(`700 48px "${FONT_NAME}"`, text);
    await (document as any).fonts.ready;
  } catch (_e) {
    // フォールバック
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = src;
  });
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

export function todayLabel(d = new Date()): string {
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${wd}）`;
}

export interface RosterOptions {
  title?: string;
  dateText?: string;
  accent?: string;
}

/** グループ写真1枚＋メンバー名から「本日の出勤」ストーリー画像を生成 */
export async function composeRoster(
  photoUri: string,
  names: string[],
  opts: RosterOptions = {}
): Promise<{ blob: Blob; previewUrl: string }> {
  const title = opts.title?.trim() || '本日の出勤';
  const date = opts.dateText || todayLabel();
  const accent = opts.accent || '#E1306C';
  const memberNames = names.map((n) => n.trim()).filter(Boolean);

  await loadFontFor(title + date + memberNames.join(''));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const img = await loadImage(photoUri);

  // 背景：写真をcover＋ぼかして敷く（黒帯防止）
  const coverScale = Math.max(W / img.width, H / img.height);
  ctx.filter = 'blur(28px)';
  ctx.drawImage(img, (W - img.width * coverScale) / 2, (H - img.height * coverScale) / 2, img.width * coverScale, img.height * coverScale);
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, W, H);

  // 前景：写真全体が入るようcontainで中央配置
  const fitScale = Math.min(W / img.width, H / img.height);
  const fw = img.width * fitScale;
  const fh = img.height * fitScale;
  ctx.drawImage(img, (W - fw) / 2, (H - fh) / 2, fw, fh);

  // 上部：見出し＋日付（読みやすいよう上に暗いグラデーション）
  const topGrad = ctx.createLinearGradient(0, 0, 0, 420);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.72)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, W, 420);

  ctx.textAlign = 'center';
  ctx.fillStyle = accent;
  ctx.fillRect(W / 2 - 60, 120, 120, 10);
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 12;
  ctx.font = `900 104px ${FONT_FAMILY}`;
  ctx.fillText(title, W / 2, 250);
  ctx.fillStyle = '#EDEDED';
  ctx.font = `700 48px ${FONT_FAMILY}`;
  ctx.fillText(date, W / 2, 322);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // 下部：メンバー名をピル（バッジ）で並べる
  if (memberNames.length > 0) {
    const botGrad = ctx.createLinearGradient(0, H - 560, 0, H);
    botGrad.addColorStop(0, 'rgba(0,0,0,0)');
    botGrad.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, H - 560, W, 560);

    ctx.font = `900 52px ${FONT_FAMILY}`;
    const padX = 40;
    const pillH = 92;
    const gap = 24;
    const maxRowW = W - 80;

    // 行ごとに詰める
    const rows: { name: string; w: number }[][] = [];
    let row: { name: string; w: number }[] = [];
    let rowW = 0;
    for (const name of memberNames) {
      const w = ctx.measureText(name).width + padX * 2;
      if (rowW + w + (row.length ? gap : 0) > maxRowW && row.length) {
        rows.push(row);
        row = [];
        rowW = 0;
      }
      row.push({ name, w });
      rowW += w + (row.length > 1 ? gap : 0);
    }
    if (row.length) rows.push(row);

    const totalH = rows.length * pillH + (rows.length - 1) * gap;
    let y = H - 120 - totalH; // 下から少し上

    for (const r of rows) {
      const rw = r.reduce((s, p) => s + p.w, 0) + gap * (r.length - 1);
      let x = (W - rw) / 2;
      for (const p of r) {
        roundRect(ctx, x, y, p.w, pillH, pillH / 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.name, x + p.w / 2, y + pillH / 2 + 2);
        ctx.textBaseline = 'alphabetic';
        x += p.w + gap;
      }
      y += pillH + gap;
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

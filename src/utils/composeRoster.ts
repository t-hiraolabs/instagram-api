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

export interface RosterMember {
  imageUri: string;
  name?: string;
}

export interface RosterOptions {
  title?: string;
  dateText?: string;
  accent?: string;
}

/** 選んだメンバー（写真＋名前）をグリッド配置して「本日の出勤」ストーリーを生成 */
export async function composeRoster(
  members: RosterMember[],
  opts: RosterOptions = {}
): Promise<{ blob: Blob; previewUrl: string }> {
  if (members.length === 0) throw new Error('出勤メンバーを1人以上選んでください');

  const title = opts.title?.trim() || '本日の出勤';
  const date = opts.dateText || todayLabel();
  const accent = opts.accent || '#E1306C';

  await loadFontFor(title + date + members.map((m) => m.name ?? '').join(''));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  // 背景（暗め＋上部にアクセントのグロー）
  ctx.fillStyle = '#0E0E10';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 120, 50, W / 2, 120, 700);
  glow.addColorStop(0, accent + '55');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 600);

  // ヘッダー
  ctx.textAlign = 'center';
  ctx.fillStyle = accent;
  ctx.fillRect(W / 2 - 60, 120, 120, 10);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `900 104px ${FONT_FAMILY}`;
  ctx.fillText(title, W / 2, 250);
  ctx.fillStyle = '#CFCFD4';
  ctx.font = `700 46px ${FONT_FAMILY}`;
  ctx.fillText(date, W / 2, 320);

  // グリッド領域
  const bodyTop = 380;
  const bodyBottom = H - 70;
  const bodyH = bodyBottom - bodyTop;
  const margin = 44;
  const gap = 24;

  const n = members.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cellW = (W - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = (bodyH - gap * (rows - 1)) / rows;

  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = margin + c * (cellW + gap);
    const y = bodyTop + r * (cellH + gap);

    const img = await loadImage(members[i].imageUri);

    ctx.save();
    roundRect(ctx, x, y, cellW, cellH, 28);
    ctx.clip();

    const scale = Math.max(cellW / img.width, cellH / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh);

    const name = members[i].name?.trim();
    if (name) {
      const barH = Math.min(120, cellH * 0.24);
      const grad = ctx.createLinearGradient(0, y + cellH - barH, 0, y + cellH);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.82)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y + cellH - barH, cellW, barH);

      ctx.fillStyle = accent;
      ctx.fillRect(x + cellW / 2 - 26, y + cellH - barH + 18, 52, 6);

      ctx.fillStyle = '#FFFFFF';
      const fs = Math.max(36, Math.min(58, cellW / 6.5));
      ctx.font = `900 ${fs}px ${FONT_FAMILY}`;
      ctx.fillText(name, x + cellW / 2, y + cellH - 30, cellW - 24);
    }
    ctx.restore();
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

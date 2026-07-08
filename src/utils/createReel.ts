// コラージュ型ストーリー画像の合成（composeCollage/composeTemplatePreview）で使う
// canvas描画ヘルパー群。

// おしゃれな日本語フォント（極太）をWebフォントとして読み込んで使う
const FONT_NAME = 'Zen Kaku Gothic New';
const FONT_FAMILY = `"${FONT_NAME}", sans-serif`;

function ensureFontLink() {
  if (typeof document === 'undefined') return;
  const id = 'reel-font-link';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@900&display=swap';
  document.head.appendChild(link);
}

// 指定テキストに必要なフォント(サブセット)を読み込んでから使う
async function loadFontFor(text: string) {
  if (typeof document === 'undefined') return;
  ensureFontLink();
  try {
    await (document as any).fonts.load(`900 80px "${FONT_NAME}"`, text);
    await (document as any).fonts.ready;
  } catch (_e) {
    // 失敗時は標準フォントにフォールバック
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

// 行頭に来てはいけない文字（禁則処理）
const NO_LINE_START =
  '、。，．・：；！？)）」』】〕》〉ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョ々…〜';

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let line = '';
  for (const ch of chars) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      // 改行で次行が禁則文字始まりになる場合は、その文字を今の行に残す（軽いはみ出し許容）
      if (NO_LINE_START.includes(ch)) {
        line = test;
      } else {
        lines.push(line);
        line = ch;
      }
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// 文字サイズを自動調整：短い文は大きく1行、長い文は縮めて1行、
// 最小でも収まらない時だけ改行する。ctx.font に最終サイズをセットして返す。
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  baseSize = 82,
  minSize = 46
): { lines: string[]; fontSize: number; lineH: number } {
  for (let size = baseSize; size >= minSize; size -= 3) {
    ctx.font = `900 ${size}px ${FONT_FAMILY}`;
    if (ctx.measureText(text).width <= maxWidth) {
      return { lines: [text], fontSize: size, lineH: Math.round(size * 1.25) };
    }
  }
  ctx.font = `900 ${minSize}px ${FONT_FAMILY}`;
  return {
    lines: wrapText(ctx, text, maxWidth),
    fontSize: minSize,
    lineH: Math.round(minSize * 1.25),
  };
}


// ===== コラージュ型ストーリーテンプレート =====
//
// 画像素材を1枚も持たず、「レイアウト（写真の並べ方）× テーマ（色）」の
// 組み合わせだけで見た目のバリエーションを作る。テンプレートを増やしたい
// ときは、下の COLLAGE_TEMPLATES に1件足すだけでよい（テーマは自動で掛け算される）。

export interface CollageTheme {
  name: string;
  background: string;
  /** 背景のグラデーション終点色（background→background2の縦グラデーション） */
  background2: string;
  accent: string;
}

// 花やチェーン柄などの独自イラストは使わず、色・丸・線などcanvasで描ける
// シンプルな図形だけで「テンプレートらしさ」を出す。
export const COLLAGE_THEMES: CollageTheme[] = [
  { name: 'ベージュ', background: '#F6ECE1', background2: '#EAD9C6', accent: '#B5651D' },
  { name: 'ピンク', background: '#FDECEF', background2: '#F6D3DA', accent: '#D6597A' },
  { name: 'ミント', background: '#EAF6F0', background2: '#D6EEE1', accent: '#3E8E6E' },
  { name: 'モノトーン', background: '#F5F5F5', background2: '#E2E2E2', accent: '#333333' },
];

// 背景を単色ではなく、縦方向の淡いグラデーションにする（のっぺり感を防ぐ）
function drawGradientBackground(ctx: CanvasRenderingContext2D, theme: CollageTheme) {
  const g = ctx.createLinearGradient(0, 0, 0, COLLAGE_H);
  g.addColorStop(0, theme.background);
  g.addColorStop(1, theme.background2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, COLLAGE_W, COLLAGE_H);
}

const COLLAGE_W = 1080;
const COLLAGE_H = 1920;

interface CollageArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CollageTemplate {
  id: string;
  name: string;
  /** この並べ方に必要な写真の枚数 */
  photoCount: 1 | 2 | 3 | 4;
  /** グリッド領域内に写真カードを配置する（枚数はphotoCountと一致させる） */
  drawPhotos: (ctx: CanvasRenderingContext2D, photos: string[], area: CollageArea) => Promise<void>;
  /** レイアウトごとの装飾（区切り線・フレームなど） */
  drawDecoration?: (ctx: CanvasRenderingContext2D, area: CollageArea, accent: string) => void;
}

// 円のドットを角に散らして「テンプレートらしい」装飾にする（花イラストの簡易代替）
function drawCornerDots(ctx: CanvasRenderingContext2D, color: string) {
  const dots: [number, number, number][] = [
    [70, 90, 14], [110, 60, 8], [40, 140, 6],
    [COLLAGE_W - 70, COLLAGE_H - 100, 16], [COLLAGE_W - 120, COLLAGE_H - 60, 9], [COLLAGE_W - 40, COLLAGE_H - 150, 7],
  ];
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = color;
  for (const [x, y, r] of dots) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 縦の点線区切り（「C」チェーン柄の簡易代替）
function drawDottedDivider(ctx: CanvasRenderingContext2D, x: number, yTop: number, yBottom: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.setLineDash([2, 18]);
  ctx.beginPath();
  ctx.moveTo(x, yTop);
  ctx.lineTo(x, yBottom);
  ctx.stroke();
  ctx.restore();
}

// 横の実線区切り
function drawSolidDividerH(ctx: CanvasRenderingContext2D, y: number, xLeft: number, xRight: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(xLeft, y);
  ctx.lineTo(xRight, y);
  ctx.stroke();
  ctx.restore();
}

// 領域全体を囲む二重線フレーム＋四隅のL字アクセント（花柄の代わりの控えめな装飾）
function drawDoubleFrame(ctx: CanvasRenderingContext2D, area: CollageArea, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(area.x - 14, area.y - 14, area.w + 28, area.h + 28);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(area.x - 22, area.y - 22, area.w + 44, area.h + 44);

  const len = 46;
  const off = 34;
  const corners: [number, number, number, number][] = [
    [area.x - off, area.y - off, 1, 1],
    [area.x + area.w + off, area.y - off, -1, 1],
    [area.x - off, area.y + area.h + off, 1, -1],
    [area.x + area.w + off, area.y + area.h + off, -1, -1],
  ];
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + len * dx, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + len * dy);
    ctx.stroke();
  }
  ctx.restore();
}

// 円形に切り抜いた写真バッジ（サブ写真用）
async function drawCircularPhoto(ctx: CanvasRenderingContext2D, uri: string, cx: number, cy: number, r: number, ringColor?: string) {
  const img = await loadImage(uri);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  const inner = r - 8;
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.clip();
  const cover = Math.max((inner * 2) / img.width, (inner * 2) / img.height);
  ctx.drawImage(img, cx - (img.width * cover) / 2, cy - (img.height * cover) / 2, img.width * cover, img.height * cover);
  ctx.restore();

  if (ringColor) {
    ctx.save();
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

// 写真を白枠付きの角丸カードとして描く（cover fit）。rotateDeg指定でポラロイド風に少し傾ける。
async function drawPhotoCard(
  ctx: CanvasRenderingContext2D,
  uri: string,
  x: number,
  y: number,
  w: number,
  h: number,
  rotateDeg = 0
) {
  const img = await loadImage(uri);
  const pad = 10;
  const radius = 18;
  ctx.save();
  if (rotateDeg !== 0) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((rotateDeg * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  ctx.fillStyle = '#FFFFFF';
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  const ix = x + pad;
  const iy = y + pad;
  const iw = w - pad * 2;
  const ih = h - pad * 2;
  roundRectPath(ctx, ix, iy, iw, ih, Math.max(0, radius - pad));
  ctx.clip();
  const cover = Math.max(iw / img.width, ih / img.height);
  ctx.drawImage(
    img,
    ix + (iw - img.width * cover) / 2,
    iy + (ih - img.height * cover) / 2,
    img.width * cover,
    img.height * cover
  );
  ctx.restore();
}

// ===== 5種類のレイアウト（写真の並べ方）=====
// テーマ（色）とは独立しているので、テーマ4色 × レイアウト5種 = 20通りの見た目になる。
export const COLLAGE_TEMPLATES: CollageTemplate[] = [
  {
    id: 'simple1',
    name: 'シンプル1枚',
    photoCount: 1,
    drawPhotos: async (ctx, photos, area) => {
      await drawPhotoCard(ctx, photos[0], area.x, area.y, area.w, area.h);
    },
    drawDecoration: (ctx, area, accent) => drawDoubleFrame(ctx, area, accent),
  },
  {
    id: 'stack2',
    name: '縦2分割',
    photoCount: 2,
    drawPhotos: async (ctx, photos, area) => {
      const gap = 24;
      const cellH = (area.h - gap) / 2;
      await drawPhotoCard(ctx, photos[0], area.x, area.y, area.w, cellH);
      await drawPhotoCard(ctx, photos[1], area.x, area.y + cellH + gap, area.w, cellH);
    },
    drawDecoration: (ctx, area, accent) => {
      const gap = 24;
      const cellH = (area.h - gap) / 2;
      drawSolidDividerH(ctx, area.y + cellH + gap / 2, area.x + 30, area.x + area.w - 30, accent);
    },
  },
  {
    id: 'grid4',
    name: '2x2グリッド',
    photoCount: 4,
    drawPhotos: async (ctx, photos, area) => {
      const gap = 24;
      const cellW = (area.w - gap) / 2;
      const cellH = (area.h - gap) / 2;
      await drawPhotoCard(ctx, photos[0], area.x, area.y, cellW, cellH);
      await drawPhotoCard(ctx, photos[1], area.x + cellW + gap, area.y, cellW, cellH);
      await drawPhotoCard(ctx, photos[2], area.x, area.y + cellH + gap, cellW, cellH);
      await drawPhotoCard(ctx, photos[3], area.x + cellW + gap, area.y + cellH + gap, cellW, cellH);
    },
    drawDecoration: (ctx, area, accent) => {
      const gap = 24;
      const cellW = (area.w - gap) / 2;
      drawDottedDivider(ctx, area.x + cellW + gap / 2, area.y, area.y + area.h, accent);
      drawCornerDots(ctx, accent);
    },
  },
  {
    id: 'polaroid',
    name: 'メイン＋ポラロイド',
    photoCount: 2,
    drawPhotos: async (ctx, photos, area) => {
      await drawPhotoCard(ctx, photos[0], area.x, area.y, area.w, area.h);
      const subW = area.w * 0.52;
      const subH = subW * 1.15;
      await drawPhotoCard(
        ctx,
        photos[1],
        area.x + area.w - subW + 20,
        area.y + area.h - subH + 20,
        subW,
        subH,
        -6
      );
    },
  },
  {
    id: 'heroBottom2',
    name: '上1枚＋下2枚',
    photoCount: 3,
    drawPhotos: async (ctx, photos, area) => {
      const gap = 24;
      const topH = area.h * 0.58;
      const bottomH = area.h - topH - gap;
      const cellW = (area.w - gap) / 2;
      await drawPhotoCard(ctx, photos[0], area.x, area.y, area.w, topH);
      await drawPhotoCard(ctx, photos[1], area.x, area.y + topH + gap, cellW, bottomH);
      await drawPhotoCard(ctx, photos[2], area.x + cellW + gap, area.y + topH + gap, cellW, bottomH);
    },
    drawDecoration: (ctx, area, accent) => {
      const gap = 24;
      const topH = area.h * 0.58;
      const bottomH = area.h - topH - gap;
      const cellW = (area.w - gap) / 2;
      drawDottedDivider(ctx, area.x + cellW + gap / 2, area.y + topH + gap, area.y + topH + gap + bottomH, accent);
    },
  },
  {
    id: 'circleBadge',
    name: 'メイン＋丸バッジ',
    photoCount: 2,
    drawPhotos: async (ctx, photos, area) => {
      await drawPhotoCard(ctx, photos[0], area.x, area.y, area.w, area.h);
      const r = area.w * 0.22;
      await drawCircularPhoto(ctx, photos[1], area.x + area.w - r + 10, area.y + r - 10, r);
    },
    drawDecoration: (ctx, area, accent) => {
      const r = area.w * 0.22;
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(area.x + area.w - r + 10, area.y + r - 10, r + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    },
  },
];

/**
 * テンプレート（写真の並べ方）とテーマ（色）を組み合わせて、1枚のコラージュ風
 * ストーリー画像を作る。花やチェーン柄などの独自イラストの代わりに、色・丸・
 * 点線などcanvasで描けるシンプルな図形で「テンプレートらしさ」を出している。
 */
export async function composeCollage(
  photos: string[],
  template: CollageTemplate,
  theme: CollageTheme,
  accentText: string,
  caption: string
): Promise<{ blob: Blob; previewUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = COLLAGE_W;
  canvas.height = COLLAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  drawGradientBackground(ctx, theme);

  const margin = 48;
  const gridTop = 200;
  const gridBottom = COLLAGE_H - 260;
  const area: CollageArea = { x: margin, y: gridTop, w: COLLAGE_W - margin * 2, h: gridBottom - gridTop };

  await template.drawPhotos(ctx, photos, area);
  template.drawDecoration?.(ctx, area, theme.accent);

  if (accentText.trim()) {
    await loadFontFor(accentText);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = theme.accent;
    ctx.font = `900 96px ${FONT_FAMILY}`;
    const textY = gridTop - 60;
    ctx.fillText(accentText.trim(), COLLAGE_W / 2, textY);
    // 文字の左右に短い装飾線を添えて、ただのテキストより「あしらい」らしく見せる
    const textW = ctx.measureText(accentText.trim()).width;
    const lineY = textY - 30;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(COLLAGE_W / 2 - textW / 2 - 60, lineY);
    ctx.lineTo(COLLAGE_W / 2 - textW / 2 - 16, lineY);
    ctx.moveTo(COLLAGE_W / 2 + textW / 2 + 16, lineY);
    ctx.lineTo(COLLAGE_W / 2 + textW / 2 + 60, lineY);
    ctx.stroke();
  }

  if (caption.trim()) {
    await loadFontFor(caption);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2A2A2A';
    const { lines, lineH } = fitText(ctx, caption.trim(), area.w, 44, 28);
    let y = gridBottom + 70;
    for (const line of lines) {
      ctx.fillText(line, COLLAGE_W / 2, y);
      y += lineH;
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

let placeholderPhotoUrl: string | null = null;

// テンプレート選択用のプレビューで、実際の写真の代わりに敷くグレーの正方形
function getPlaceholderPhoto(): string {
  if (placeholderPhotoUrl) return placeholderPhotoUrl;
  const c = document.createElement('canvas');
  c.width = 40;
  c.height = 40;
  const g = c.getContext('2d')!;
  g.fillStyle = '#B9B9B9';
  g.fillRect(0, 0, 40, 40);
  placeholderPhotoUrl = c.toDataURL('image/png');
  return placeholderPhotoUrl;
}

/**
 * テンプレート一覧の選択画面で、実際の写真を選ぶ前に「だいたいの見た目」を
 * 確認できるよう、グレーのプレースホルダー写真でcomposeCollageと同じ処理を
 * 走らせてプレビュー画像を作る（実際に写真を入れたときと同じレイアウト・
 * 色・装飾になる）。
 */
export async function composeTemplatePreview(template: CollageTemplate, theme: CollageTheme): Promise<string> {
  const placeholder = getPlaceholderPhoto();
  const photos = Array.from({ length: template.photoCount }, () => placeholder);
  const { previewUrl } = await composeCollage(photos, template, theme, '', '');
  return previewUrl;
}

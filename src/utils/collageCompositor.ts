// コラージュ型ストーリー画像の合成（composeCollage/composeLayoutPreview）で使う
// canvas描画ヘルパー群。

// 花のイラスト素材（base64データURLとして埋め込み済み。require()経由のアセット
// 解決だとWeb上でURIが正しく解決されず花が表示されない不具合があったため）
import {
  FLOWER_CORNER_TL,
  FLOWER_CORNER_TR,
  FLOWER_FRAME_BORDER,
  FLOWER_CLUSTER,
} from './collageAssets';

// おしゃれな日本語フォント（極太）をWebフォントとして読み込んで使う（デフォルト）
const FONT_NAME = 'Zen Kaku Gothic New';
const FONT_FAMILY = `"${FONT_NAME}", sans-serif`;

/** コラージュスタイルの管理画面で選べるフォントのプリセット。
 *  idはCollageStyleAssets.accentFont/captionFontに保存する値と一致させる。 */
export interface FontPreset {
  id: string;
  label: string;
  family: string;
  weight: string;
  googleParam: string;
}
export const COLLAGE_FONT_PRESETS: FontPreset[] = [
  { id: 'gothic', label: 'ゴシック（極太）', family: FONT_NAME, weight: '900', googleParam: 'Zen+Kaku+Gothic+New:wght@900' },
  { id: 'mincho', label: '明朝（上品）', family: 'Shippori Mincho', weight: '800', googleParam: 'Shippori+Mincho:wght@800' },
  { id: 'rounded', label: '丸ゴシック（やわらか）', family: 'M PLUS Rounded 1c', weight: '800', googleParam: 'M+PLUS+Rounded+1c:wght@800' },
  { id: 'decor', label: '装飾セリフ', family: 'Kaisei Decol', weight: '700', googleParam: 'Kaisei+Decol:wght@700' },
];
function getFontPreset(id?: string): FontPreset {
  return COLLAGE_FONT_PRESETS.find((f) => f.id === id) ?? COLLAGE_FONT_PRESETS[0];
}

const loadedFontLinkIds = new Set<string>();
function ensureFontLink(preset: FontPreset) {
  if (typeof document === 'undefined') return;
  const id = `collage-font-link-${preset.id}`;
  if (loadedFontLinkIds.has(id) || document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${preset.googleParam}&display=swap`;
  document.head.appendChild(link);
  loadedFontLinkIds.add(id);
}

// 指定テキストに必要なフォント(サブセット)を読み込んでから使う
async function loadFontFor(text: string, fontId?: string) {
  if (typeof document === 'undefined') return;
  const preset = getFontPreset(fontId);
  ensureFontLink(preset);
  try {
    await (document as any).fonts.load(`${preset.weight} 80px "${preset.family}"`, text);
    await (document as any).fonts.ready;
  } catch (_e) {
    // 失敗時は標準フォントにフォールバック
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('画像のURLが空です'));
      return;
    }
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    // 素材の解決に失敗してonload/onerrorが発火しないケースでも画面が
    // 固まらないよう、念のためタイムアウトで打ち切る
    const timer = setTimeout(() => reject(new Error('画像の読み込みがタイムアウトしました')), 10000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('画像の読み込みに失敗しました')); };
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
  minSize = 46,
  fontFamily: string = FONT_FAMILY,
  weight: string = '900'
): { lines: string[]; fontSize: number; lineH: number } {
  for (let size = baseSize; size >= minSize; size -= 3) {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) {
      return { lines: [text], fontSize: size, lineH: Math.round(size * 1.25) };
    }
  }
  ctx.font = `${weight} ${minSize}px ${fontFamily}`;
  return {
    lines: wrapText(ctx, text, maxWidth),
    fontSize: minSize,
    lineH: Math.round(minSize * 1.25),
  };
}


// ===== コラージュ型ストーリーのレイアウト =====
//
// 画像素材を1枚も持たず、「レイアウト（写真の並べ方）× テーマ（色）」の
// 組み合わせだけで見た目のバリエーションを作る。レイアウトを増やしたい
// ときは、下の COLLAGE_LAYOUTS に1件足すだけでよい（テーマは自動で掛け算される）。

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

export interface CollageLayout {
  id: string;
  name: string;
  /** この並べ方に必要な写真の枚数 */
  photoCount: 1 | 2 | 3 | 4;
  /** グリッド領域内に写真カードを配置する（枚数はphotoCountと一致させる） */
  drawPhotos: (ctx: CanvasRenderingContext2D, photos: string[], area: CollageArea) => Promise<void>;
  /** レイアウトごとの装飾（区切り線・フレームなど） */
  drawDecoration?: (ctx: CanvasRenderingContext2D, area: CollageArea, accent: string) => void | Promise<void>;
}

// 花のイラスト素材（透過PNG／base64データURL）を指定位置に描く
async function drawFlowerAsset(ctx: CanvasRenderingContext2D, dataUrl: string, x: number, y: number, w: number, h: number) {
  if (!dataUrl) return;
  const img = await loadImage(dataUrl);
  ctx.drawImage(img, x, y, w, h);
}

// 実際の花イラスト素材を、左下・右上の角に配置する
async function drawCornerFlowers(ctx: CanvasRenderingContext2D) {
  const blW = 300, blH = 264;
  const trW = 190, trH = 218;
  await drawFlowerAsset(ctx, FLOWER_CORNER_TL, -20, COLLAGE_H - blH + 20, blW, blH);
  await drawFlowerAsset(ctx, FLOWER_CORNER_TR, COLLAGE_W - trW + 20, -20, trW, trH);
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

// 縦の細い実線区切り（上品なレイアウト用。drawDottedDividerより控えめな見た目）
function drawSolidDividerV(ctx: CanvasRenderingContext2D, x: number, yTop: number, yBottom: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, yTop);
  ctx.lineTo(x, yBottom);
  ctx.stroke();
  ctx.restore();
}

// ビフォーアフター等の短いラベルを、角丸ピル型のバッジとして描く
function drawLabelBadge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, accent: string) {
  ctx.save();
  ctx.font = '700 26px sans-serif';
  const paddingX = 20;
  const textH = 26;
  const paddingY = 10;
  const textW = ctx.measureText(text).width;
  const w = textW + paddingX * 2;
  const h = textH + paddingY * 2;
  ctx.fillStyle = accent;
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + paddingX, y + h / 2 + 1);
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

// ===== 13種類のレイアウト（写真の並べ方）=====
// テーマ（色）とは独立しているので、テーマ4色 × レイアウト13種 = 52通りの見た目になる。
export const COLLAGE_LAYOUTS: CollageLayout[] = [
  {
    id: 'simple1',
    name: 'シンプル1枚',
    photoCount: 1,
    drawPhotos: async (ctx, photos, area) => {
      await drawPhotoCard(ctx, photos[0], area.x, area.y, area.w, area.h);
    },
    drawDecoration: async (ctx, area) => {
      const pad = 26;
      await drawFlowerAsset(ctx, FLOWER_FRAME_BORDER, area.x - pad, area.y - pad, area.w + pad * 2, area.h + pad * 2);
    },
  },
  {
    id: 'framedSingle',
    name: 'フレーム1枚',
    photoCount: 1,
    drawPhotos: async (ctx, photos, area) => {
      await drawPhotoCard(ctx, photos[0], area.x, area.y, area.w, area.h);
    },
    drawDecoration: (ctx, area, accent) => {
      const pad = 20;
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 10;
      roundRectPath(ctx, area.x - pad, area.y - pad, area.w + pad * 2, area.h + pad * 2, 28);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    id: 'magazine1',
    name: 'マガジン風',
    photoCount: 1,
    drawPhotos: async (ctx, photos, area) => {
      const photoH = area.h * 0.82;
      await drawPhotoCard(ctx, photos[0], area.x, area.y, area.w, photoH);
    },
    drawDecoration: (ctx, area, accent) => {
      const photoH = area.h * 0.82;
      const bandY = area.y + photoH - 6;
      const bandH = area.h - photoH + 6;
      ctx.save();
      ctx.fillStyle = accent;
      roundRectPath(ctx, area.x, bandY, area.w, bandH, 14);
      ctx.fill();
      ctx.restore();
    },
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
    id: 'sideBySide2',
    name: '横2分割',
    photoCount: 2,
    drawPhotos: async (ctx, photos, area) => {
      const gap = 24;
      const cellW = (area.w - gap) / 2;
      await drawPhotoCard(ctx, photos[0], area.x, area.y, cellW, area.h);
      await drawPhotoCard(ctx, photos[1], area.x + cellW + gap, area.y, cellW, area.h);
    },
    drawDecoration: (ctx, area, accent) => {
      const gap = 24;
      const cellW = (area.w - gap) / 2;
      drawDottedDivider(ctx, area.x + cellW + gap / 2, area.y + 20, area.y + area.h - 20, accent);
    },
  },
  {
    id: 'beforeAfter2',
    name: 'ビフォーアフター',
    photoCount: 2,
    drawPhotos: async (ctx, photos, area) => {
      const gap = 24;
      const cellW = (area.w - gap) / 2;
      await drawPhotoCard(ctx, photos[0], area.x, area.y, cellW, area.h);
      await drawPhotoCard(ctx, photos[1], area.x + cellW + gap, area.y, cellW, area.h);
    },
    drawDecoration: (ctx, area, accent) => {
      const gap = 24;
      const cellW = (area.w - gap) / 2;
      drawSolidDividerV(ctx, area.x + cellW + gap / 2, area.y + 20, area.y + area.h - 20, accent);
      drawLabelBadge(ctx, 'BEFORE', area.x + 20, area.y + 20, accent);
      drawLabelBadge(ctx, 'AFTER', area.x + cellW + gap + 20, area.y + 20, accent);
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
    drawDecoration: async (ctx, area, accent) => {
      const gap = 24;
      const cellW = (area.w - gap) / 2;
      drawDottedDivider(ctx, area.x + cellW + gap / 2, area.y, area.y + area.h, accent);
      await drawCornerFlowers(ctx);
    },
  },
  {
    id: 'mosaic4',
    name: 'メイン＋3枚モザイク',
    photoCount: 4,
    drawPhotos: async (ctx, photos, area) => {
      const gap = 20;
      const leftW = area.w * 0.6 - gap / 2;
      const rightW = area.w - leftW - gap;
      const rightX = area.x + leftW + gap;
      const cellH = (area.h - gap * 2) / 3;
      await drawPhotoCard(ctx, photos[0], area.x, area.y, leftW, area.h);
      await drawPhotoCard(ctx, photos[1], rightX, area.y, rightW, cellH);
      await drawPhotoCard(ctx, photos[2], rightX, area.y + cellH + gap, rightW, cellH);
      await drawPhotoCard(ctx, photos[3], rightX, area.y + (cellH + gap) * 2, rightW, cellH);
    },
    drawDecoration: (ctx, area, accent) => {
      const gap = 20;
      const leftW = area.w * 0.6 - gap / 2;
      drawDottedDivider(ctx, area.x + leftW + gap / 2, area.y, area.y + area.h, accent);
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
    drawDecoration: async (ctx, area) => {
      await drawFlowerAsset(ctx, FLOWER_CLUSTER, area.x - 40, area.y - 30, 150, 80);
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
    id: 'filmStrip3',
    name: 'フィルムストリップ',
    photoCount: 3,
    drawPhotos: async (ctx, photos, area) => {
      const gap = 20;
      const cellW = (area.w - gap * 2) / 3;
      await drawPhotoCard(ctx, photos[0], area.x, area.y, cellW, area.h);
      await drawPhotoCard(ctx, photos[1], area.x + cellW + gap, area.y, cellW, area.h);
      await drawPhotoCard(ctx, photos[2], area.x + (cellW + gap) * 2, area.y, cellW, area.h);
    },
    drawDecoration: (ctx, area, accent) => {
      const gap = 20;
      const cellW = (area.w - gap * 2) / 3;
      drawDottedDivider(ctx, area.x + cellW + gap / 2, area.y, area.y + area.h, accent);
      drawDottedDivider(ctx, area.x + (cellW + gap) * 2 - gap / 2, area.y, area.y + area.h, accent);
    },
  },
  {
    id: 'elegantTriptych3',
    name: 'エレガント3分割',
    photoCount: 3,
    drawPhotos: async (ctx, photos, area) => {
      const gap = 36;
      const cellW = (area.w - gap * 2) / 3;
      await drawPhotoCard(ctx, photos[0], area.x, area.y, cellW, area.h);
      await drawPhotoCard(ctx, photos[1], area.x + cellW + gap, area.y, cellW, area.h);
      await drawPhotoCard(ctx, photos[2], area.x + (cellW + gap) * 2, area.y, cellW, area.h);
    },
    drawDecoration: (ctx, area, accent) => {
      const gap = 36;
      const cellW = (area.w - gap * 2) / 3;
      const lineTop = area.y + 40;
      const lineBottom = area.y + area.h - 40;
      drawSolidDividerV(ctx, area.x + cellW + gap / 2, lineTop, lineBottom, accent);
      drawSolidDividerV(ctx, area.x + (cellW + gap) * 2 - gap / 2, lineTop, lineBottom, accent);
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
 * 画像ベースの「スタイル」。指定すると背景・フレームの質感画像を使い、
 * テーマ（色）のグラデーション背景の代わりになる（シネマ風・レトロ風など）。
 */
export interface CollageStyleAssets {
  /** 全面に敷く背景テクスチャ画像（cover-fit）。指定時はテーマのグラデーションを使わない */
  backgroundUrl?: string;
  /** 写真・装飾の上に全面（1080×1920）で重ねる縁取り画像。中央は透過している前提 */
  frameUrl?: string;
  /** あしらい文字の色。指定時はテーマの色より優先する */
  accentColor?: string;
  /** あしらい文字のフォント（COLLAGE_FONT_PRESETSのid）。未指定はデフォルトのゴシック */
  accentFont?: string;
  /** あしらい文字の縦位置の微調整（px、+で下へ）。未指定は0 */
  accentYOffset?: number;
  /** キャプションの色。未指定はaccentColor、それも無ければ既定色 */
  captionColor?: string;
  /** キャプションのフォント（COLLAGE_FONT_PRESETSのid）。未指定はデフォルトのゴシック */
  captionFont?: string;
  /** キャプションの縦位置の微調整（px、+で下へ）。未指定は0 */
  captionYOffset?: number;
}

/**
 * レイアウト（写真の並べ方）とテーマ（色）を組み合わせて、1枚のコラージュ風
 * ストーリー画像を作る。花やチェーン柄などの独自イラストの代わりに、色・丸・
 * 点線などcanvasで描けるシンプルな図形で「レイアウトらしさ」を出している。
 * styleAssetsを渡すと、質感画像を使ったスタイル（シネマ風・レトロ風など）になる。
 */
export async function composeCollage(
  photos: string[],
  layout: CollageLayout,
  theme: CollageTheme,
  accentText: string,
  caption: string,
  styleAssets?: CollageStyleAssets
): Promise<{ blob: Blob; previewUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = COLLAGE_W;
  canvas.height = COLLAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  if (styleAssets?.backgroundUrl) {
    const bg = await loadImage(styleAssets.backgroundUrl);
    const cover = Math.max(COLLAGE_W / bg.width, COLLAGE_H / bg.height);
    ctx.drawImage(
      bg,
      (COLLAGE_W - bg.width * cover) / 2,
      (COLLAGE_H - bg.height * cover) / 2,
      bg.width * cover,
      bg.height * cover
    );
  } else {
    drawGradientBackground(ctx, theme);
  }

  const margin = 48;
  const gridTop = 200;
  const gridBottom = COLLAGE_H - 260;
  const area: CollageArea = { x: margin, y: gridTop, w: COLLAGE_W - margin * 2, h: gridBottom - gridTop };
  const accentColor = styleAssets?.accentColor ?? theme.accent;

  await layout.drawPhotos(ctx, photos, area);
  await layout.drawDecoration?.(ctx, area, accentColor);

  if (styleAssets?.frameUrl) {
    const frame = await loadImage(styleAssets.frameUrl);
    ctx.drawImage(frame, 0, 0, COLLAGE_W, COLLAGE_H);
  }

  if (accentText.trim()) {
    const accentPreset = getFontPreset(styleAssets?.accentFont);
    await loadFontFor(accentText, styleAssets?.accentFont);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = accentColor;
    ctx.font = `${accentPreset.weight} 96px "${accentPreset.family}"`;
    const textY = gridTop - 60 + (styleAssets?.accentYOffset ?? 0);
    ctx.fillText(accentText.trim(), COLLAGE_W / 2, textY);
    // 文字の左右に短い装飾線を添えて、ただのテキストより「あしらい」らしく見せる
    const textW = ctx.measureText(accentText.trim()).width;
    const lineY = textY - 30;
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(COLLAGE_W / 2 - textW / 2 - 60, lineY);
    ctx.lineTo(COLLAGE_W / 2 - textW / 2 - 16, lineY);
    ctx.moveTo(COLLAGE_W / 2 + textW / 2 + 16, lineY);
    ctx.lineTo(COLLAGE_W / 2 + textW / 2 + 60, lineY);
    ctx.stroke();
  }

  if (caption.trim()) {
    const captionPreset = getFontPreset(styleAssets?.captionFont);
    await loadFontFor(caption, styleAssets?.captionFont);
    ctx.textAlign = 'center';
    ctx.fillStyle = styleAssets?.captionColor ?? styleAssets?.accentColor ?? '#2A2A2A';
    const { lines, lineH } = fitText(ctx, caption.trim(), area.w, 44, 28, `"${captionPreset.family}"`, captionPreset.weight);
    let y = gridBottom + 70 + (styleAssets?.captionYOffset ?? 0);
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

// レイアウト選択用のプレビューで、実際の写真の代わりに敷くグレーの正方形
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
 * レイアウト一覧の選択画面で、実際の写真を選ぶ前に「だいたいの見た目」を
 * 確認できるよう、グレーのプレースホルダー写真でcomposeCollageと同じ処理を
 * 走らせてプレビュー画像を作る（実際に写真を入れたときと同じレイアウト・
 * 色・装飾になる）。
 */
export async function composeLayoutPreview(
  layout: CollageLayout,
  theme: CollageTheme,
  styleAssets?: CollageStyleAssets
): Promise<string> {
  const placeholder = getPlaceholderPhoto();
  const photos = Array.from({ length: layout.photoCount }, () => placeholder);
  const { previewUrl } = await composeCollage(photos, layout, theme, '', '', styleAssets);
  return previewUrl;
}

// コラージュ型ストーリー画像の合成（composeCollage/composeTemplatePreview）で使う
// canvas描画ヘルパー群。
//
// テンプレートは「管理者があらかじめ作成した完成デザイン画像（写真の差し込み場所も
// デザイン済み）＋写真を差し込む透明な窓（photoAreas）＋任意のテキストレイヤー」の
// 組み合わせだけで表現する。レイアウトパターンや装飾画像をコード側で組み合わせる
// 仕組みは持たない（それぞれのテンプレートは管理画面から1件ずつ登録する）。

// おしゃれな日本語フォント（極太）をWebフォントとして読み込んで使う（デフォルト）
const FONT_NAME = 'Zen Kaku Gothic New';

/** コラージュテンプレートの管理画面で選べるフォントのプリセット。
 *  idはCollageTextLayer.fontに保存する値と一致させる。 */
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

export const COLLAGE_W = 1080;
export const COLLAGE_H = 1920;

/**
 * 完成テンプレートのレイヤー描画順（zIndex）の目安バンド。実際の描画は全レイヤーを
 * zIndexで昇順ソートしてから行うため、この範囲外の値を入れても動作はするが、目安として提示する。
 */
export const COLLAGE_Z_BANDS = {
  photos: 25,
  text: 55,
} as const;

/** 写真を差し込む矩形（キャンバス1080×1920px基準） */
export interface CollagePhotoArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** テキストレイヤー1件。座標はキャンバス1080×1920px基準 */
export interface CollageTextLayer {
  id: string;
  label?: string;
  sampleText: string;
  x: number;
  y: number;
  maxWidth: number;
  align?: CanvasTextAlign;
  fontSize?: number;
  font?: string;
  color?: string;
  /** 行間の倍率（例: 1.25）。未指定は1.25 */
  lineHeight?: number;
  /** 文字間隔（px）。未指定は0 */
  letterSpacing?: number;
  /** これを超える行は省略記号で切り詰める。未指定は3 */
  maxLines?: number;
  /** 回転（度）。未指定は0 */
  rotation?: number;
  /** 描画順（昇順）。未指定は写真より前面のテキスト帯(55)扱い */
  zIndex?: number;
}

/**
 * 完成テンプレート1件分のアセット。backgroundUrlは管理者があらかじめ作成した
 * デザイン画像（写真の差し込み場所もデザイン済み）。photoAreasの数だけ写真を
 * 差し込み、textLayersがあればユーザーが文言を編集できる。
 */
export interface CollageTemplateAssets {
  /** 管理者が作成した完成デザイン画像（cover-fitで全面に敷く） */
  backgroundUrl?: string;
  /** 写真を差し込む矩形（1つ以上） */
  photoAreas: CollagePhotoArea[];
  /** ユーザーが文言を編集できるテキストレイヤー（任意） */
  textLayers?: CollageTextLayer[];
}

// 写真を白カード等の装飾なしで、指定矩形にそのままcover-fitで描く。
// 背景デザイン画像側で余白・縁取りをすべて表現する運用のため。
async function drawPlainPhoto(
  ctx: CanvasRenderingContext2D,
  uri: string,
  area: { x: number; y: number; w: number; h: number }
) {
  const img = await loadImage(uri);
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  const cover = Math.max(area.w / img.width, area.h / img.height);
  ctx.drawImage(
    img,
    area.x + (area.w - img.width * cover) / 2,
    area.y + (area.h - img.height * cover) / 2,
    img.width * cover,
    img.height * cover
  );
  ctx.restore();
}

// テキストレイヤー1件を指定位置・フォント・色で描く（サンプル文言はtextOverridesで上書き可能）。
// maxLines/maxWidthの範囲に収まるようフォントサイズを自動で縮め、それでも収まらない
// 場合は省略記号で切り詰める（ユーザーが長い文言に書き換えてもレイアウトが大きく崩れないように）。
async function drawTextLayer(ctx: CanvasRenderingContext2D, layer: CollageTextLayer, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const preset = getFontPreset(layer.font);
  await loadFontFor(trimmed, layer.font);
  const align = layer.align ?? 'left';
  const baseSize = layer.fontSize ?? 40;
  const minSize = Math.max(14, Math.round(baseSize * 0.5));
  const lineHeightMul = layer.lineHeight ?? 1.25;
  const maxLines = layer.maxLines ?? 3;

  let fontSize = minSize;
  let lines: string[] = [trimmed];
  for (let size = baseSize; size >= minSize; size -= 2) {
    ctx.font = `${preset.weight} ${size}px "${preset.family}"`;
    const wrapped = wrapText(ctx, trimmed, layer.maxWidth);
    fontSize = size;
    lines = wrapped;
    if (wrapped.length <= maxLines) break;
  }
  ctx.font = `${preset.weight} ${fontSize}px "${preset.family}"`;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let truncated = lines[maxLines - 1];
    while (truncated.length > 0 && ctx.measureText(truncated + '…').width > layer.maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    lines[maxLines - 1] = truncated + '…';
  }

  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = layer.color ?? '#FFFFFF';
  if ('letterSpacing' in ctx) {
    (ctx as any).letterSpacing = layer.letterSpacing ? `${layer.letterSpacing}px` : '0px';
  }
  if (layer.rotation) {
    ctx.translate(layer.x, layer.y);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.translate(-layer.x, -layer.y);
  }
  const lineH = Math.round(fontSize * lineHeightMul);
  let y = layer.y;
  for (const line of lines) {
    ctx.fillText(line, layer.x, y);
    y += lineH;
  }
  ctx.restore();
}

/**
 * 完成テンプレート（背景デザイン画像＋写真差し込み窓＋テキストレイヤー）に、
 * 実際の写真とテキストを流し込んで1枚のストーリー画像を作る。
 */
export async function composeCollage(
  photos: string[],
  template: CollageTemplateAssets,
  textOverrides?: Record<string, string>
): Promise<{ blob: Blob; previewUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = COLLAGE_W;
  canvas.height = COLLAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  if (template.backgroundUrl) {
    const bg = await loadImage(template.backgroundUrl);
    const cover = Math.max(COLLAGE_W / bg.width, COLLAGE_H / bg.height);
    ctx.drawImage(
      bg,
      (COLLAGE_W - bg.width * cover) / 2,
      (COLLAGE_H - bg.height * cover) / 2,
      bg.width * cover,
      bg.height * cover
    );
  } else {
    // 背景画像未設定時（管理画面での作成途中プレビュー用）のフォールバック
    ctx.fillStyle = '#F5F5F5';
    ctx.fillRect(0, 0, COLLAGE_W, COLLAGE_H);
  }

  type Layer = { zIndex: number; run: () => Promise<void> | void };
  const layers: Layer[] = [
    ...template.photoAreas.map((area, i): Layer => ({
      zIndex: COLLAGE_Z_BANDS.photos,
      run: () => (photos[i] ? drawPlainPhoto(ctx, photos[i], area) : undefined),
    })),
    ...(template.textLayers ?? []).map((layer): Layer => ({
      zIndex: layer.zIndex ?? COLLAGE_Z_BANDS.text,
      run: () => drawTextLayer(ctx, layer, textOverrides?.[layer.id] ?? layer.sampleText),
    })),
  ];
  layers.sort((a, b) => a.zIndex - b.zIndex);
  for (const layer of layers) {
    await layer.run();
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

// テンプレート選択画面のプレビューで、実際の写真の代わりに敷くグレーの正方形
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
 * テンプレート一覧の選択画面や管理画面で、実際の写真を選ぶ前に「だいたいの見た目」を
 * 確認できるよう、グレーのプレースホルダー写真でcomposeCollageと同じ処理を走らせて
 * プレビュー画像を作る（実際に写真を入れたときと同じ配置・テキストになる）。
 */
export async function composeTemplatePreview(
  template: CollageTemplateAssets,
  textOverrides?: Record<string, string>
): Promise<string> {
  const placeholder = getPlaceholderPhoto();
  const photos = template.photoAreas.map(() => placeholder);
  const { previewUrl } = await composeCollage(photos, template, textOverrides);
  return previewUrl;
}

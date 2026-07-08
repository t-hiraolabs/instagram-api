// 写真を数枚つないで、無音のスライドショー動画(MP4)を作る（web専用）
// ffmpeg は Metro でバンドルせず、実行時にCDNから読み込む（ビルドを壊さないため）

const W = 720;
const H = 1280;

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

const FF_VER = '0.12.10';
const UTIL_VER = '0.12.1';
const CORE_VER = '0.12.6';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`スクリプト読み込み失敗: ${src}`));
    document.head.appendChild(s);
  });
}

let ffmpegPromise: Promise<any> | null = null;

async function getFFmpeg(onLog?: (msg: string) => void) {
  if (ffmpegPromise) return ffmpegPromise;
  const p = (async () => {
    await loadScript(`https://unpkg.com/@ffmpeg/ffmpeg@${FF_VER}/dist/umd/ffmpeg.js`);
    await loadScript(`https://unpkg.com/@ffmpeg/util@${UTIL_VER}/dist/umd/index.js`);
    const { FFmpeg } = (window as any).FFmpegWASM;
    const ffmpeg = new FFmpeg();
    if (onLog) ffmpeg.on('log', ({ message }: any) => onLog(message));
    // classWorkerURL を渡すと ffmpeg は「モジュール方式」のワーカーを作る。
    // → ESM版のワーカーとコアを渡す必要がある。
    // モジュールワーカーは別オリジンでもCORS許可があれば直接読めるので blob 化は不要
    // （ESMワーカーは相対importを持つため blob 化すると壊れる）。
    const ffEsm = `https://unpkg.com/@ffmpeg/ffmpeg@${FF_VER}/dist/esm`;
    const coreEsm = `https://unpkg.com/@ffmpeg/core@${CORE_VER}/dist/esm`;
    // ワーカー本体スクリプトは「同一オリジン」でないと new Worker できない。
    // そこで「別サイトのworker.jsをimportするだけ」の極小ワーカーを同一オリジンのblobで作る。
    // （中の import はモジュールワーカーなのでCORS許可があれば別オリジンでも通る）
    const shim = `import "${ffEsm}/worker.js";`;
    const workerURL = URL.createObjectURL(new Blob([shim], { type: 'text/javascript' }));
    await ffmpeg.load({
      classWorkerURL: workerURL,
      coreURL: `${coreEsm}/ffmpeg-core.js`,
      wasmURL: `${coreEsm}/ffmpeg-core.wasm`,
    });
    return ffmpeg;
  })();
  // 失敗したらキャッシュを消して、次回やり直せるようにする
  p.catch(() => {
    if (ffmpegPromise === p) ffmpegPromise = null;
  });
  ffmpegPromise = p;
  return p;
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

export interface SlideTheme {
  accent: string;
  captionStyle: 'outline' | 'pill' | 'band';
}

const DEFAULT_SLIDE_THEME: SlideTheme = { accent: '#E1306C', captionStyle: 'outline' };

/** 1枚の写真を720x1280にcoverで配置し、文字をのせてJPEG(dataURL)を返す */
export async function renderSlide(
  imageUri: string,
  text?: string,
  theme: SlideTheme = DEFAULT_SLIDE_THEME
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const img = await loadImage(imageUri);

  // 背景：同じ写真をcover（画面いっぱい）＋ぼかして敷く（黒帯を防ぐ）
  const coverScale = Math.max(W / img.width, H / img.height);
  const cw = img.width * coverScale;
  const ch = img.height * coverScale;
  ctx.filter = 'blur(28px)';
  ctx.drawImage(img, (W - cw) / 2, (H - ch) / 2, cw, ch);
  ctx.filter = 'none';
  // 背景を少し暗くして前景を引き立てる
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, W, H);

  // 前景：写真全体が入るようにcontain（はみ出さない）で中央配置
  const fitScale = Math.min(W / img.width, H / img.height);
  const fw = img.width * fitScale;
  const fh = img.height * fitScale;
  ctx.drawImage(img, (W - fw) / 2, (H - fh) / 2, fw, fh);

  const t = text?.trim();
  if (t) {
    await loadFontFor(t); // おしゃれフォントを確実に読み込んでから描画
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    // 文字数に応じてサイズ自動調整（短ければ1行・大きく）
    const { lines, lineH } = fitText(ctx, t, W - 90);
    const blockH = lines.length * lineH;
    const cx = W / 2;
    const bottom = H - 150; // 文字ブロックの下端
    const topY = bottom - blockH; // ブロック上端

    const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width));

    if (theme.captionStyle === 'pill') {
      // アクセント色の角丸パネル＋白文字
      const padX = 46;
      const padY = 30;
      const pw = Math.min(W - 60, maxLineW + padX * 2);
      const ph = blockH + padY * 2 - (lineH - 76);
      roundRect(ctx, cx - pw / 2, topY - padY - 56, pw, ph, 28);
      ctx.fillStyle = theme.accent;
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'transparent';
      let y = topY;
      for (const line of lines) {
        ctx.fillText(line, cx, y);
        y += lineH;
      }
    } else if (theme.captionStyle === 'band') {
      // 全幅の半透明バンド＋上にアクセントライン＋白文字
      const bandTop = topY - 70;
      const bandH = blockH + 90;
      ctx.fillStyle = 'rgba(0,0,0,0.68)';
      ctx.fillRect(0, bandTop, W, bandH);
      ctx.fillStyle = theme.accent;
      ctx.fillRect(0, bandTop, W, 8);
      ctx.fillRect(0, bandTop + bandH - 8, W, 8);
      // 文字はアクセント色（＋薄い黒フチで可読性確保）でタイプの色を出す
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'transparent';
      let y = topY;
      for (const line of lines) {
        ctx.lineWidth = 8;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(line, cx, y);
        ctx.fillStyle = theme.accent;
        ctx.fillText(line, cx, y);
        y += lineH;
      }
    } else {
      // outline: 黒フチ＋白文字（＋下にアクセントの短い下線）
      const grad = ctx.createLinearGradient(0, H * 0.55, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.55, W, H * 0.45);

      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      let y = topY;
      for (const line of lines) {
        ctx.lineWidth = 16;
        ctx.strokeStyle = 'rgba(0,0,0,0.92)';
        ctx.strokeText(line, cx, y);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(line, cx, y);
        y += lineH;
      }
      ctx.fillStyle = theme.accent;
      ctx.fillRect(cx - 45, bottom + 18, 90, 8);
    }
  }

  return canvas.toDataURL('image/jpeg', 0.9);
}

// 見出しを任意サイズのcanvasに描く（写真・動画オーバーレイ共通）
// nx,ny は 0〜1 の正規化座標で文字ブロックの「中心」位置、scale は文字の拡大率
// テキストの下に敷く「ボックス」のスタイル。単なる白文字+黒縁取りだけだと
// 素人っぽく見えがちなので、Instagramのテキストスタンプ風の半透明の帯を敷く。
function drawTextBackdrop(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  blockW: number,
  blockH: number,
  radius: number
) {
  const x = cx - blockW / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(x, top, blockW, blockH, radius);
  } else {
    // roundRect未対応環境向けの手書きフォールバック
    const r = radius;
    ctx.moveTo(x + r, top);
    ctx.arcTo(x + blockW, top, x + blockW, top + blockH, r);
    ctx.arcTo(x + blockW, top + blockH, x, top + blockH, r);
    ctx.arcTo(x, top + blockH, x, top, r);
    ctx.arcTo(x, top, x + blockW, top, r);
  }
  ctx.fill();
  ctx.restore();
}

async function drawHeadline(
  ctx: CanvasRenderingContext2D,
  Wt: number,
  Ht: number,
  text: string,
  nx: number,
  ny: number,
  scale: number
) {
  await loadFontFor(text);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const base = Math.round(Wt * 0.115 * scale);
  const min = Math.round(Wt * 0.065 * scale);
  const { lines, lineH } = fitText(ctx, text, Wt - Wt * 0.12, base, min);
  const blockH = lines.length * lineH;
  const cx = nx * Wt;
  const padX = Math.round(Wt * 0.05);
  const padY = Math.round(lineH * 0.28);
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxTop = ny * Ht - blockH / 2 - padY;
  const boxH = blockH + padY * 2;
  drawTextBackdrop(ctx, cx, boxTop, widest + padX * 2, boxH, Math.min(16, boxH / 4));

  let y = ny * Ht - blockH / 2 + lineH * 0.8;
  // 縁取りは細めの影程度にとどめ、太い黒縁の「ダサさ」を避けつつ視認性を確保する
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = Math.round(Wt * 0.006);
  for (const line of lines) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(line, cx, y);
    y += lineH;
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

// 透明背景に見出しを描いたPNG(dataURL)（動画オーバーレイ用）
async function renderTextOverlay(text: string, nx = 0.5, ny = 0.85, scale = 1): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');
  await drawHeadline(ctx, W, H, text, nx, ny, scale);
  return canvas.toDataURL('image/png');
}

// 写真に見出しを合成してストーリー画像(JPEG)を作る（写真全体＋ぼかし背景）
export async function composeImageWithHeadline(
  imageUri: string,
  text: string,
  nx = 0.5,
  ny = 0.85,
  scale = 1
): Promise<{ blob: Blob; previewUrl: string }> {
  const IW = 1080;
  const IH = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = IW;
  canvas.height = IH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasを利用できません');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, IW, IH);
  const img = await loadImage(imageUri);
  const cover = Math.max(IW / img.width, IH / img.height);
  ctx.filter = 'blur(34px)';
  ctx.drawImage(
    img,
    (IW - img.width * cover) / 2,
    (IH - img.height * cover) / 2,
    img.width * cover,
    img.height * cover
  );
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, IW, IH);
  const fit = Math.min(IW / img.width, IH / img.height);
  ctx.drawImage(
    img,
    (IW - img.width * fit) / 2,
    (IH - img.height * fit) / 2,
    img.width * fit,
    img.height * fit
  );

  if (text.trim()) await drawHeadline(ctx, IW, IH, text.trim(), nx, ny, scale);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画像の生成に失敗しました'))),
      'image/jpeg',
      0.92
    )
  );
  return { blob, previewUrl: canvas.toDataURL('image/jpeg', 0.9) };
}

/** 動画に見出しテキストを焼き込んでMP4を生成（nx,ny=0〜1の中心位置） */
export async function addTextToVideo(
  videoBlob: Blob,
  text: string,
  nx = 0.5,
  ny = 0.85,
  scale = 1,
  onLog?: (msg: string) => void
): Promise<{ blob: Blob; url: string }> {
  const ffmpeg = await getFFmpeg(onLog);
  const { fetchFile } = (window as any).FFmpegUtil;

  await ffmpeg.writeFile('in.mp4', await fetchFile(videoBlob));
  const overlay = await renderTextOverlay(text, nx, ny, scale);
  await ffmpeg.writeFile('ov.png', await fetchFile(overlay));

  await ffmpeg.exec([
    '-i', 'in.mp4',
    '-i', 'ov.png',
    '-filter_complex',
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[v];[v][1:v]overlay=0:0[vo]`,
    '-map', '[vo]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    '-movflags', '+faststart',
    'out.mp4',
  ]);

  const data = await ffmpeg.readFile('out.mp4');
  const blob = new Blob([(data as Uint8Array).buffer], { type: 'video/mp4' });
  return { blob, url: URL.createObjectURL(blob) };
}

export interface ReelSlide {
  imageUri: string;
  text?: string;
  seconds?: number; // この写真の表示秒数（未指定なら secondsPer）
}

/** スライド配列からMP4を生成。Blobと再生用URLを返す */
export async function createReel(
  slides: ReelSlide[],
  secondsPer = 3,
  onLog?: (msg: string) => void,
  theme: SlideTheme = DEFAULT_SLIDE_THEME
): Promise<{ blob: Blob; url: string }> {
  if (slides.length === 0) throw new Error('写真を1枚以上選んでください');

  const ffmpeg = await getFFmpeg(onLog);
  const { fetchFile } = (window as any).FFmpegUtil;

  // 写真ごとの表示秒数
  const durations = slides.map((s) => s.seconds ?? secondsPer);

  // 各スライドを描画して書き込み（s0.jpg, s1.jpg, ...）
  for (let i = 0; i < slides.length; i++) {
    const dataUrl = await renderSlide(slides[i].imageUri, slides[i].text, theme);
    await ffmpeg.writeFile(`s${i}.jpg`, await fetchFile(dataUrl));
  }

  const N = slides.length;

  if (N === 1) {
    // 1枚だけ：その写真を指定秒数表示（無音の音声トラック付き）
    await ffmpeg.exec([
      '-framerate', '30', '-loop', '1', '-t', `${durations[0]}`, '-i', 's0.jpg',
      '-f', 'lavfi', '-t', `${durations[0]}`, '-i', 'anullsrc=r=44100:cl=stereo',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      '-movflags', '+faststart', 'out.mp4',
    ]);
  } else {
    // 複数枚：写真の切り替わりをフェード(クロスフェード)で滑らかに
    const T = 0.5; // 切り替えにかける秒数
    const inputs: string[] = [];
    for (let i = 0; i < N; i++) {
      inputs.push('-framerate', '30', '-loop', '1', '-t', `${durations[i]}`, '-i', `s${i}.jpg`);
    }
    const parts: string[] = [];
    let prev = '[0]';
    let cumul = 0;
    for (let i = 1; i < N; i++) {
      cumul += durations[i - 1];
      const offset = (cumul - i * T).toFixed(3);
      const out = i === N - 1 ? '[vchain]' : `[vx${i}]`;
      parts.push(`${prev}[${i}]xfade=transition=fade:duration=${T}:offset=${offset}${out}`);
      prev = `[vx${i}]`;
    }
    parts.push('[vchain]format=yuv420p[vo]');
    const filter = parts.join(';');

    await ffmpeg.exec([
      ...inputs,
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', // 無音の音声トラック
      '-filter_complex', filter,
      '-map', '[vo]',
      '-map', `${N}:a`,
      '-r', '30',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      '-movflags', '+faststart',
      'out.mp4',
    ]);
  }

  const data = await ffmpeg.readFile('out.mp4');
  const blob = new Blob([(data as Uint8Array).buffer], { type: 'video/mp4' });
  return { blob, url: URL.createObjectURL(blob) };
}

// ===== コラージュ型ストーリーテンプレート =====
//
// 画像素材を1枚も持たず、「レイアウト（写真の並べ方）× テーマ（色）」の
// 組み合わせだけで見た目のバリエーションを作る。テンプレートを増やしたい
// ときは、下の COLLAGE_TEMPLATES に1件足すだけでよい（テーマは自動で掛け算される）。

export interface CollageTheme {
  name: string;
  background: string;
  accent: string;
}

// 花やチェーン柄などの独自イラストは使わず、色・丸・線などcanvasで描ける
// シンプルな図形だけで「テンプレートらしさ」を出す。
export const COLLAGE_THEMES: CollageTheme[] = [
  { name: 'ベージュ', background: '#F3E7DC', accent: '#B5651D' },
  { name: 'ピンク', background: '#FBE4E8', accent: '#D6597A' },
  { name: 'ミント', background: '#E4F3EC', accent: '#3E8E6E' },
  { name: 'モノトーン', background: '#EFEFEF', accent: '#333333' },
];

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

// 領域全体を囲む二重線フレーム
function drawDoubleFrame(ctx: CanvasRenderingContext2D, area: CollageArea, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(area.x - 14, area.y - 14, area.w + 28, area.h + 28);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(area.x - 22, area.y - 22, area.w + 44, area.h + 44);
  ctx.restore();
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

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, COLLAGE_W, COLLAGE_H);

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
    ctx.fillText(accentText.trim(), COLLAGE_W / 2, gridTop - 60);
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

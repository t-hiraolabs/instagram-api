// 写真を数枚つないで、無音のスライドショー動画(MP4)を作る（web専用）
// ffmpeg は Metro でバンドルせず、実行時にCDNから読み込む（ビルドを壊さないため）

const W = 720;
const H = 1280;

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
    ctx.font = `800 ${size}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) {
      return { lines: [text], fontSize: size, lineH: Math.round(size * 1.25) };
    }
  }
  ctx.font = `800 ${minSize}px sans-serif`;
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
  const scale = Math.max(W / img.width, H / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

  const t = text?.trim();
  if (t) {
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

export interface ReelSlide {
  imageUri: string;
  text?: string;
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

  // 各スライドを描画して書き込み（s0.jpg, s1.jpg, ...）
  for (let i = 0; i < slides.length; i++) {
    const dataUrl = await renderSlide(slides[i].imageUri, slides[i].text, theme);
    await ffmpeg.writeFile(`s${i}.jpg`, await fetchFile(dataUrl));
  }

  const N = slides.length;

  if (N === 1) {
    // 1枚だけ：その写真を secondsPer 秒表示
    await ffmpeg.exec([
      '-framerate', '30', '-loop', '1', '-t', `${secondsPer}`, '-i', 's0.jpg',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'out.mp4',
    ]);
  } else {
    // 複数枚：写真の切り替わりをフェード(クロスフェード)で滑らかに
    const T = 0.5; // 切り替えにかける秒数
    const inputs: string[] = [];
    for (let i = 0; i < N; i++) {
      inputs.push('-framerate', '30', '-loop', '1', '-t', `${secondsPer}`, '-i', `s${i}.jpg`);
    }
    const parts: string[] = [];
    let prev = '[0]';
    for (let i = 1; i < N; i++) {
      const offset = (i * (secondsPer - T)).toFixed(3);
      const out = i === N - 1 ? '[vchain]' : `[vx${i}]`;
      parts.push(`${prev}[${i}]xfade=transition=fade:duration=${T}:offset=${offset}${out}`);
      prev = `[vx${i}]`;
    }
    parts.push('[vchain]format=yuv420p[vo]');
    const filter = parts.join(';');

    await ffmpeg.exec([
      ...inputs,
      '-filter_complex', filter,
      '-map', '[vo]',
      '-r', '30',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      'out.mp4',
    ]);
  }

  const data = await ffmpeg.readFile('out.mp4');
  const blob = new Blob([(data as Uint8Array).buffer], { type: 'video/mp4' });
  return { blob, url: URL.createObjectURL(blob) };
}

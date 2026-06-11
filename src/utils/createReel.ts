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

/** 1枚の写真を720x1280にcoverで配置し、文字をのせてJPEG(dataURL)を返す */
export async function renderSlide(imageUri: string, text?: string): Promise<string> {
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

  if (text && text.trim()) {
    // 控えめな下グラデーション（保険）
    const grad = ctx.createLinearGradient(0, H * 0.5, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H * 0.5, W, H * 0.5);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '800 78px sans-serif';
    try {
      (ctx as any).letterSpacing = '1px';
    } catch (_e) {
      // 未対応ブラウザは無視
    }

    const lines = wrapText(ctx, text.trim(), W - 110);
    const lineH = 96;
    const blockH = lines.length * lineH;
    const baseY = H - 170 - blockH + lineH; // 下寄せ（少し上）

    // CapCut風の縁取り太字キャプション（黒フチ＋白文字）
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    let y = baseY;
    for (const line of lines) {
      ctx.lineWidth = 16;
      ctx.strokeStyle = 'rgba(0,0,0,0.92)';
      ctx.strokeText(line, W / 2, y);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(line, W / 2, y);
      y += lineH;
    }

    try {
      (ctx as any).letterSpacing = '0px';
    } catch (_e) {
      // noop
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
  onLog?: (msg: string) => void
): Promise<{ blob: Blob; url: string }> {
  if (slides.length === 0) throw new Error('写真を1枚以上選んでください');

  const ffmpeg = await getFFmpeg(onLog);
  const { fetchFile } = (window as any).FFmpegUtil;

  // 各スライドを描画して書き込み（s0.jpg, s1.jpg, ...）
  for (let i = 0; i < slides.length; i++) {
    const dataUrl = await renderSlide(slides[i].imageUri, slides[i].text);
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

// 画像URLをHTMLImageElementとして読み込む（web/Canvas専用）。
// FeedCropEditor / composeFlyer / composeFeed から共通利用されている汎用ヘルパー。
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = src;
  });
}

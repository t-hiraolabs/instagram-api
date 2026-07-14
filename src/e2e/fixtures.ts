// Playwright回帰テスト用の決定的なfixtureデータ。
// 外部ネットワーク画像は使わず、1x1の単色PNG data URIを使う（オフラインでも安定して動く）。
import { PhotoSlot, TemplateLayer, TextLayer } from '../types/creativeTemplate';

const PNG = {
  bg: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQk9MAAADCAGXfZfLoAAAAAElFTkSuQmCC',
  decorBehind: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4IScHAAK2AQU0pnWqAAAAAElFTkSuQmCC',
  photo1: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQ2BIFAAI+ATfFDml+AAAAAElFTkSuQmCC',
  photo2: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQiDoBAAH4AUspz9deAAAAAElFTkSuQmCC',
  photo3: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOYpnECAALeAYfcRk4vAAAAAElFTkSuQmCC',
  decorFront: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4dkkEAARuAc3bhLiyAAAAAElFTkSuQmCC',
  frame: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP48OEDAAWkAtFabOJuAAAAAElFTkSuQmCC',
};

/** 写真1枚のテンプレート。スロット切替UIが出ないことの確認に使う */
export const FIXTURE_1SLOT: { photoSlots: PhotoSlot[]; layers: TemplateLayer[]; textLayers: TextLayer[] } = {
  photoSlots: [{ id: 'photo_1', x: 0, y: 0, w: 1080, h: 1920 }],
  layers: [
    { id: 'bg', kind: 'background', band: 'background', uri: PNG.bg, x: 0, y: 0, w: 1080, h: 1920 },
    { id: 'frame', kind: 'frame', band: 'frame', uri: PNG.frame, x: 0, y: 0, w: 1080, h: 1920 },
  ],
  textLayers: [
    { id: 'title', text: 'テスト見出し', x: 100, y: 260, font: 'gothic', color: '#FFFFFF', size: 72, scale: 1, rotation: 0, visible: true },
  ],
};

/** 写真3枚のテンプレート。描画順序・スロット独立性・スロット切替UIの表示確認に使う */
export const FIXTURE_3SLOT: { photoSlots: PhotoSlot[]; layers: TemplateLayer[]; textLayers: TextLayer[] } = {
  photoSlots: [
    { id: 'photo_1', x: 0, y: 0, w: 1080, h: 640 },
    { id: 'photo_2', x: 0, y: 640, w: 540, h: 640 },
    { id: 'photo_3', x: 540, y: 640, w: 540, h: 640 },
  ],
  layers: [
    { id: 'bg', kind: 'background', band: 'background', uri: PNG.bg, x: 0, y: 0, w: 1080, h: 1920 },
    { id: 'decor_behind', kind: 'decoration', band: 'decorBehind', uri: PNG.decorBehind, x: 0, y: 0, w: 1080, h: 640 },
    { id: 'decor_front', kind: 'decoration', band: 'decorFront', uri: PNG.decorFront, x: 540, y: 640, w: 540, h: 640 },
    { id: 'frame', kind: 'frame', band: 'frame', uri: PNG.frame, x: 0, y: 0, w: 1080, h: 1920 },
  ],
  textLayers: [],
};

export const FIXTURE_PHOTO_URIS = { photo1: PNG.photo1, photo2: PNG.photo2, photo3: PNG.photo3 };

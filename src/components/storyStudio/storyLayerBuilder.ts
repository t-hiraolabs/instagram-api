// テンプレートの初期レイヤー構成（layer_defaults）+ 選択した写真から、
// 編集可能なレイヤー配列を組み立てるヘルパー。
import { StoryLayer } from '../../store/storyEditorStore';
import { StoryAsset, StoryTemplate } from '../../services/storyStudioService';

let seq = 0;
function layerId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now()}_${seq}`;
}

export function buildLayersFromTemplate(
  template: StoryTemplate,
  assetsById: Record<string, StoryAsset>,
  photoUris: string[],
  overrides?: { font?: string; titleColor?: string }
): StoryLayer[] {
  const layers: StoryLayer[] = [];
  const d = template.layerDefaults;

  if (d.background) {
    const a = assetsById[d.background.assetId];
    if (a) layers.push({ id: layerId('background'), type: 'background', assetId: a.id, uri: a.storageUrl, x: 0, y: 0, scale: 1, rotation: 0, visible: true });
  }

  photoUris.slice(0, Math.max(1, d.photoSlots || 1)).forEach((uri, i) => {
    layers.push({ id: layerId('photo'), type: 'photo', uri, x: 0, y: i * 40, scale: 1, rotation: 0, visible: true });
  });

  if (d.frame) {
    const a = assetsById[d.frame.assetId];
    if (a) layers.push({ id: layerId('frame'), type: 'frame', assetId: a.id, uri: a.storageUrl, x: 0, y: 0, scale: 1, rotation: 0, visible: true });
  }
  if (d.flower) {
    const a = assetsById[d.flower.assetId];
    if (a) layers.push({ id: layerId('flower'), type: 'flower', assetId: a.id, uri: a.storageUrl, x: 780, y: 60, scale: 1, rotation: 0, visible: true });
  }
  if (d.decoration) {
    const a = assetsById[d.decoration.assetId];
    if (a) layers.push({ id: layerId('decoration'), type: 'decoration', assetId: a.id, uri: a.storageUrl, x: 60, y: 1500, scale: 1, rotation: 0, visible: true });
  }

  layers.push({
    id: layerId('text'), type: 'text', text: 'テキストを入力',
    font: overrides?.font ?? d.font ?? 'default',
    color: overrides?.titleColor ?? d.titleColor ?? '#FFFFFF',
    size: 72, x: 100, y: 260, scale: 1, rotation: 0, visible: true,
  });
  layers.push({
    id: layerId('cta'), type: 'cta', text: '詳しくはプロフィールへ',
    font: 'default', color: '#FFFFFF', size: 36,
    x: 260, y: 1780, scale: 1, rotation: 0, visible: true,
  });

  return layers;
}

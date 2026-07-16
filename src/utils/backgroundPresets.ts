// 「ストーリー作成」の背景プリセット（写真を使わず、色・グラデーション・パターンだけで
// 投稿を作れるようにする）。外部の画像素材を用意しなくても、react-native-svg（既存の
// 依存パッケージ）だけでWeb・ネイティブ両対応の背景を描画できる範囲にスコープを絞っている。
export type BackgroundPresetKind = 'solid' | 'gradient' | 'dots' | 'stripes';

export interface BackgroundPreset {
  id: string;
  label: string;
  kind: BackgroundPresetKind;
  /** solidは1色のみ使用。gradient/dots/stripesは[ベース色, アクセント色] */
  colors: [string, string];
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: 'ink', label: 'インク', kind: 'solid', colors: ['#14161B', '#14161B'] },
  { id: 'cream', label: 'クリーム', kind: 'solid', colors: ['#F5EFE6', '#F5EFE6'] },
  { id: 'terracotta', label: 'テラコッタ', kind: 'solid', colors: ['#C1653A', '#C1653A'] },
  { id: 'forest', label: 'フォレスト', kind: 'solid', colors: ['#2F4538', '#2F4538'] },
  { id: 'sunset', label: 'サンセット', kind: 'gradient', colors: ['#FF7A59', '#FFD36E'] },
  { id: 'dusk', label: 'ダスク', kind: 'gradient', colors: ['#2B1B4C', '#8B5FBF'] },
  { id: 'ocean', label: 'オーシャン', kind: 'gradient', colors: ['#0C4A6E', '#38BDF8'] },
  { id: 'mono', label: 'モノトーン', kind: 'gradient', colors: ['#1A1D24', '#4B5160'] },
  { id: 'dotsLight', label: 'ドット（ライト）', kind: 'dots', colors: ['#F5EFE6', '#D8CDBB'] },
  { id: 'dotsDark', label: 'ドット（ダーク）', kind: 'dots', colors: ['#1A1D24', '#3A3F4B'] },
  { id: 'stripesWarm', label: 'ストライプ（ウォーム）', kind: 'stripes', colors: ['#FFF7EC', '#F1D9B8'] },
  { id: 'stripesDark', label: 'ストライプ（ダーク）', kind: 'stripes', colors: ['#181A20', '#2A2D35'] },
];

export function getBackgroundPreset(id: string | undefined): BackgroundPreset {
  return BACKGROUND_PRESETS.find((p) => p.id === id) ?? BACKGROUND_PRESETS[0];
}

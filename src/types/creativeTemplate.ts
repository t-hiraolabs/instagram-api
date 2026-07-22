// 「ストーリー作成」機能の共通テンプレート型。
// Story Studio（写真1枚）とCollage（複数写真）を1つの機能として統合するにあたり、
// テンプレート種別ごとに専用の型・専用のレンダラーを持たないようにするための土台。
// 写真枚数はphotoSlots.lengthからのみ判定し、別フィールドで二重管理しない。
import { Plan } from '../utils/plans';

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

/** 写真を差し込むスロット（キャンバス1080×1920px基準）。1テンプレートに複数個持てる */
export interface PhotoSlot {
  id: string;
  x: number; y: number; w: number; h: number;
  /** 描画順（昇順）。通常はphotoSlots配列の順序で十分なため未指定が多い */
  zIndex?: number;
}

export type TemplateLayerKind = 'background' | 'frame' | 'decoration';
/** 描画順序を決めるバンド。省略時はkindから既定値を導く
 *  （background→'background', frame→'frame', decoration→'decorFront'）。
 *  写真の背面に装飾を置きたい場合だけ明示的に'decorBehind'を指定する。 */
export type TemplateLayerBand = 'background' | 'decorBehind' | 'decorFront' | 'frame';

export function resolveLayerBand(layer: Pick<TemplateLayer, 'kind' | 'band'>): TemplateLayerBand {
  if (layer.band) return layer.band;
  if (layer.kind === 'background') return 'background';
  if (layer.kind === 'frame') return 'frame';
  return 'decorFront';
}

/** 背景・フレーム・装飾画像の1件（キャンバス1080×1920px基準） */
export interface TemplateLayer {
  id: string;
  kind: TemplateLayerKind;
  band?: TemplateLayerBand;
  /** 通常は画像URL。bgPresetIdを指定した場合は無視され、色・グラデーション・
   *  パターンをsrc/utils/backgroundPresets.tsの定義から描画する（空文字でよい） */
  uri: string;
  /** 指定時、背景を画像の代わりにbackgroundPresets.tsのプリセット（色/グラデ/パターン）で描画する */
  bgPresetId?: string;
  x: number; y: number; w: number; h: number;
  rotation?: number;
  zIndex?: number;
}

/** テキストレイヤー1件。座標はボックス左上基準（キャンバス1080×1920px基準） */
export interface TextLayer {
  id: string;
  /** 管理者向けの用途ラベル（例:「見出し」）。UI表示にのみ使用し描画には影響しない */
  label?: string;
  text: string;
  x: number; y: number;
  maxWidth?: number;
  align?: 'left' | 'center' | 'right';
  /** 共有フォントプリセットID（src/utils/fontPresets.ts参照） */
  font: string;
  color: string;
  size: number;
  /** 行間の倍率。未指定は1.25 */
  lineHeight?: number;
  /** 文字間隔（px）。未指定は0 */
  letterSpacing?: number;
  /** これを超える行は省略記号で切り詰める。未指定は3 */
  maxLines?: number;
  /** ピンチ操作用の追加倍率（sizeとは独立） */
  scale: number;
  rotation: number;
  visible: boolean;
  zIndex?: number;
  /** trueの場合はCTA（行動喚起）テキストとして扱う。描画ロジックは通常のテキストと同一 */
  isCta?: boolean;
}

/** 自由に配置できる「追加写真」（ステッカーのように移動・拡大縮小・回転できる、
 *  スロットに縛られない写真）。テンプレート側にはあらかじめ用意されておらず、
 *  「ストーリー作成」画面でユーザーが追加した分だけ増える。座標はボックス左上基準
 *  （テキストレイヤーと同じ扱い。キャンバス1080×1920px基準） */
export interface PhotoLayer {
  id: string;
  uri: string;
  x: number; y: number;
  /** scale===1の時の表示サイズ（元画像のアスペクト比を維持したベースサイズ） */
  w: number; h: number;
  scale: number;
  rotation: number;
  zIndex?: number;
}

export interface CreativeTemplate {
  id: string;
  /** 今回のスコープでは常に'story'。将来feed等を足せるようUnionのまま残す */
  type: 'story';
  name: string;
  photoSlots: PhotoSlot[];
  layers: TemplateLayer[];
  textLayers: TextLayer[];
  tags: string[];
  thumbnailUrl: string | null;
  requiredPlan: Plan;
}

/** templates.layer_defaults(jsonb)に保存する形。versionはマイグレーション時の後方互換分岐に使う */
export interface TemplateDefinitionV1 {
  version: 1;
  photoSlots: PhotoSlot[];
  layers: TemplateLayer[];
  textLayers: TextLayer[];
}

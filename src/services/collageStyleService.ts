// コラージュの画像ベース「スタイル」（背景・フレーム画像＋アクセントカラー）のデータアクセス層。
// Story Studioのtemplatesテーブルをtype='collage'として流用する。
import { supabase } from './supabaseClient';
import { Plan } from '../utils/plans';
import { allowedPlans, getAssetsByIds } from './storyStudioService';

/** 装飾画像1件（矢印・キラキラ等）。座標はキャンバス1080×1920px基準 */
export interface CollageStyleDecoration {
  assetId: string;
  url?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate?: number;
}

/** テキストレイヤー1件。座標はキャンバス1080×1920px基準 */
export interface CollageStyleTextLayer {
  id: string;
  label?: string;
  sampleText: string;
  x: number;
  y: number;
  maxWidth: number;
  align?: 'left' | 'center' | 'right';
  fontSize?: number;
  font?: string;
  color?: string;
}

export interface CollageStyle {
  id: string;
  name: string;
  plan: Plan;
  isActive: boolean;
  tags: string[];
  backgroundAssetId?: string;
  frameAssetId?: string;
  backgroundUrl?: string;
  frameUrl?: string;
  accentColor?: string;
  accentFont?: string;
  accentYOffset?: number;
  captionColor?: string;
  captionFont?: string;
  captionYOffset?: number;
  /** 指定時は「完成テンプレート」。COLLAGE_LAYOUTSのidを参照し、単体タイルとしてギャラリーに並ぶ */
  layoutId?: string;
  decorations?: CollageStyleDecoration[];
  textLayers?: CollageStyleTextLayer[];
  thumbnailUrl: string | null;
}

interface CollageStyleDefaults {
  backgroundAssetId?: string;
  frameAssetId?: string;
  accentColor?: string;
  accentFont?: string;
  accentYOffset?: number;
  captionColor?: string;
  captionFont?: string;
  captionYOffset?: number;
  layoutId?: string;
  decorations?: CollageStyleDecoration[];
  textLayers?: CollageStyleTextLayer[];
}

async function rowsToStyles(rows: any[]): Promise<CollageStyle[]> {
  const assetIds = new Set<string>();
  rows.forEach((r) => {
    const d = (r.layer_defaults ?? {}) as CollageStyleDefaults;
    if (d.backgroundAssetId) assetIds.add(d.backgroundAssetId);
    if (d.frameAssetId) assetIds.add(d.frameAssetId);
    (d.decorations ?? []).forEach((dec) => assetIds.add(dec.assetId));
  });
  const assetsById = assetIds.size > 0 ? await getAssetsByIds(Array.from(assetIds)) : {};
  return rows.map((r) => {
    const d = (r.layer_defaults ?? {}) as CollageStyleDefaults;
    return {
      id: r.id,
      name: r.name,
      plan: r.plan,
      isActive: r.is_active,
      tags: (r.tags ?? []) as string[],
      backgroundAssetId: d.backgroundAssetId,
      frameAssetId: d.frameAssetId,
      backgroundUrl: d.backgroundAssetId ? assetsById[d.backgroundAssetId]?.storageUrl : undefined,
      frameUrl: d.frameAssetId ? assetsById[d.frameAssetId]?.storageUrl : undefined,
      accentColor: d.accentColor,
      accentFont: d.accentFont,
      accentYOffset: d.accentYOffset,
      captionColor: d.captionColor,
      captionFont: d.captionFont,
      captionYOffset: d.captionYOffset,
      layoutId: d.layoutId,
      decorations: d.decorations?.map((dec) => ({ ...dec, url: assetsById[dec.assetId]?.storageUrl })),
      textLayers: d.textLayers,
      thumbnailUrl: r.thumbnail_url,
    };
  });
}

/** コラージュ編集画面向け: 有効かつ自分のプランで使えるスタイルのみ */
export async function listCollageStyles(plan: Plan): Promise<CollageStyle[]> {
  const plans = allowedPlans(plan);
  const { data, error } = await supabase
    .from('templates')
    .select('id, name, plan, is_active, layer_defaults, thumbnail_url, tags')
    .eq('type', 'collage')
    .eq('is_active', true)
    .in('plan', plans);
  if (error) throw error;
  return rowsToStyles(data ?? []);
}

/** 管理画面向け: 無効化済み・全プランを含む一覧 */
export async function listAllCollageStyles(): Promise<CollageStyle[]> {
  const { data, error } = await supabase
    .from('templates')
    .select('id, name, plan, is_active, layer_defaults, thumbnail_url, tags')
    .eq('type', 'collage')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return rowsToStyles(data ?? []);
}

interface CollageStyleParams {
  name: string;
  plan: Plan;
  tags?: string[];
  backgroundAssetId?: string;
  frameAssetId?: string;
  accentColor?: string;
  accentFont?: string;
  accentYOffset?: number;
  captionColor?: string;
  captionFont?: string;
  captionYOffset?: number;
  layoutId?: string;
  decorations?: { assetId: string; x: number; y: number; w: number; h: number; rotate?: number }[];
  textLayers?: CollageStyleTextLayer[];
}

function toLayerDefaults(params: CollageStyleParams): CollageStyleDefaults {
  return {
    backgroundAssetId: params.backgroundAssetId,
    frameAssetId: params.frameAssetId,
    accentColor: params.accentColor,
    accentFont: params.accentFont,
    accentYOffset: params.accentYOffset,
    captionColor: params.captionColor,
    captionFont: params.captionFont,
    captionYOffset: params.captionYOffset,
    layoutId: params.layoutId,
    decorations: params.decorations,
    textLayers: params.textLayers,
  };
}

export async function createCollageStyle(params: CollageStyleParams): Promise<void> {
  const { error } = await supabase.from('templates').insert({
    type: 'collage',
    name: params.name,
    plan: params.plan,
    tags: params.tags ?? [],
    layer_defaults: toLayerDefaults(params),
  });
  if (error) throw error;
}

export async function updateCollageStyle(id: string, params: CollageStyleParams): Promise<void> {
  const { error } = await supabase
    .from('templates')
    .update({
      name: params.name,
      plan: params.plan,
      tags: params.tags ?? [],
      layer_defaults: toLayerDefaults(params),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function toggleCollageStyleActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('templates').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export async function deleteCollageStyle(id: string): Promise<void> {
  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw error;
}

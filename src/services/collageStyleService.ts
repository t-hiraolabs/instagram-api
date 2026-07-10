// コラージュの画像ベース「スタイル」（背景・フレーム画像＋アクセントカラー）のデータアクセス層。
// Story Studioのtemplatesテーブルをtype='collage'として流用する。
import { supabase } from './supabaseClient';
import { Plan } from '../utils/plans';
import { allowedPlans, getAssetsByIds } from './storyStudioService';

export interface CollageStyle {
  id: string;
  name: string;
  plan: Plan;
  isActive: boolean;
  backgroundAssetId?: string;
  frameAssetId?: string;
  backgroundUrl?: string;
  frameUrl?: string;
  accentColor?: string;
  thumbnailUrl: string | null;
}

interface CollageStyleDefaults {
  backgroundAssetId?: string;
  frameAssetId?: string;
  accentColor?: string;
}

async function rowsToStyles(rows: any[]): Promise<CollageStyle[]> {
  const assetIds = new Set<string>();
  rows.forEach((r) => {
    const d = (r.layer_defaults ?? {}) as CollageStyleDefaults;
    if (d.backgroundAssetId) assetIds.add(d.backgroundAssetId);
    if (d.frameAssetId) assetIds.add(d.frameAssetId);
  });
  const assetsById = assetIds.size > 0 ? await getAssetsByIds(Array.from(assetIds)) : {};
  return rows.map((r) => {
    const d = (r.layer_defaults ?? {}) as CollageStyleDefaults;
    return {
      id: r.id,
      name: r.name,
      plan: r.plan,
      isActive: r.is_active,
      backgroundAssetId: d.backgroundAssetId,
      frameAssetId: d.frameAssetId,
      backgroundUrl: d.backgroundAssetId ? assetsById[d.backgroundAssetId]?.storageUrl : undefined,
      frameUrl: d.frameAssetId ? assetsById[d.frameAssetId]?.storageUrl : undefined,
      accentColor: d.accentColor,
      thumbnailUrl: r.thumbnail_url,
    };
  });
}

/** コラージュ編集画面向け: 有効かつ自分のプランで使えるスタイルのみ */
export async function listCollageStyles(plan: Plan): Promise<CollageStyle[]> {
  const plans = allowedPlans(plan);
  const { data, error } = await supabase
    .from('templates')
    .select('id, name, plan, is_active, layer_defaults, thumbnail_url')
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
    .select('id, name, plan, is_active, layer_defaults, thumbnail_url')
    .eq('type', 'collage')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return rowsToStyles(data ?? []);
}

export async function createCollageStyle(params: {
  name: string;
  plan: Plan;
  backgroundAssetId: string;
  frameAssetId?: string;
  accentColor: string;
}): Promise<void> {
  const layerDefaults: CollageStyleDefaults = {
    backgroundAssetId: params.backgroundAssetId,
    frameAssetId: params.frameAssetId,
    accentColor: params.accentColor,
  };
  const { error } = await supabase.from('templates').insert({
    type: 'collage',
    name: params.name,
    plan: params.plan,
    layer_defaults: layerDefaults,
  });
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

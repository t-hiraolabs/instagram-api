// コラージュの「完成テンプレート」（管理者があらかじめ作成した1枚のデザイン画像＋
// 写真を差し込む透明な窓＋任意のテキストレイヤー）のデータアクセス層。
// Story Studioのtemplatesテーブルをtype='collage'として流用する。
import { supabase } from './supabaseClient';
import { Plan } from '../utils/plans';
import { allowedPlans, getAssetsByIds } from './storyStudioService';

/** 写真を差し込む矩形（キャンバス1080×1920px基準）。1テンプレートに複数個持てる */
export interface CollageStylePhotoArea {
  x: number;
  y: number;
  w: number;
  h: number;
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
  /** 行間の倍率（例: 1.25）。未指定は1.25 */
  lineHeight?: number;
  /** 文字間隔（px）。未指定は0 */
  letterSpacing?: number;
  /** これを超える行は省略記号で切り詰める。未指定は3 */
  maxLines?: number;
  /** 回転（度）。未指定は0 */
  rotation?: number;
  /** 描画順（昇順）。未指定は写真より前面のテキスト帯扱い */
  zIndex?: number;
}

export interface CollageStyle {
  id: string;
  name: string;
  plan: Plan;
  isActive: boolean;
  tags: string[];
  /** 管理者が作成した完成デザイン画像（写真の差し込み場所もこの画像内にデザイン済み） */
  backgroundAssetId?: string;
  backgroundUrl?: string;
  /** 写真を差し込む矩形（1つ以上） */
  photoAreas: CollageStylePhotoArea[];
  /** ユーザーが文言を編集できるテキストレイヤー（任意） */
  textLayers?: CollageStyleTextLayer[];
  thumbnailUrl: string | null;
}

interface CollageStyleDefaults {
  backgroundAssetId?: string;
  photoAreas?: CollageStylePhotoArea[];
  textLayers?: CollageStyleTextLayer[];
}

async function rowsToStyles(rows: any[]): Promise<CollageStyle[]> {
  const assetIds = new Set<string>();
  rows.forEach((r) => {
    const d = (r.layer_defaults ?? {}) as CollageStyleDefaults;
    if (d.backgroundAssetId) assetIds.add(d.backgroundAssetId);
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
      backgroundUrl: d.backgroundAssetId ? assetsById[d.backgroundAssetId]?.storageUrl : undefined,
      photoAreas: d.photoAreas ?? [],
      textLayers: d.textLayers,
      thumbnailUrl: r.thumbnail_url,
    };
  });
}

/** コラージュ編集画面向け: 有効かつ自分のプランで使えるテンプレートのみ */
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
  photoAreas: CollageStylePhotoArea[];
  textLayers?: CollageStyleTextLayer[];
}

function toLayerDefaults(params: CollageStyleParams): CollageStyleDefaults {
  return {
    backgroundAssetId: params.backgroundAssetId,
    photoAreas: params.photoAreas,
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

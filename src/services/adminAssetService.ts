// 管理者向け: 素材シートアップロード・素材一覧管理のデータアクセス層
import { supabase } from './supabaseClient';
import { Plan } from '../utils/plans';

export interface AssetSheet {
  id: string;
  categoryId: string;
  originalFilename: string;
  archiveStoragePath: string;
  gridCols: number | null;
  gridRows: number | null;
  status: 'uploaded' | 'processing' | 'done' | 'failed';
  detectedCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface AdminAsset {
  id: string;
  categoryId: string;
  name: string;
  storageUrl: string;
  thumbnailUrl: string | null;
  plan: Plan;
  width: number | null;
  height: number | null;
  isActive: boolean;
  createdAt: string;
}

const BUCKET = 'story-assets';

function rowToSheet(row: any): AssetSheet {
  return {
    id: row.id,
    categoryId: row.category_id,
    originalFilename: row.original_filename,
    archiveStoragePath: row.archive_storage_path,
    gridCols: row.grid_cols,
    gridRows: row.grid_rows,
    status: row.status,
    detectedCount: row.detected_count,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

function rowToAdminAsset(row: any): AdminAsset {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    storageUrl: row.storage_url,
    thumbnailUrl: row.thumbnail_url,
    plan: row.plan,
    width: row.width,
    height: row.height,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/** ログイン中ユーザーが管理者かどうか（profiles.is_admin）。通信失敗時はfalse扱い */
export async function checkIsAdmin(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data, error } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (error || !data) return false;
    return Boolean((data as any).is_admin);
  } catch {
    return false;
  }
}

/**
 * 素材シート（Sprite Sheet）をSupabase Storageのarchiveへアップロードし、
 * asset_sheetsにstatus='uploaded'で登録する。切り出し（Pillow）は開発者がローカルで実行する。
 */
export async function uploadAssetSheet(params: {
  categoryId: string;
  categorySlug: string;
  blob: Blob;
  filename: string;
  gridCols?: number;
  gridRows?: number;
}): Promise<AssetSheet> {
  const path = `sheets/${params.categorySlug}/${Date.now()}-${params.filename}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, params.blob, {
    contentType: 'image/png',
    upsert: false,
  });
  if (uploadError) throw new Error(`シートのアップロードに失敗しました: ${uploadError.message}`);

  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('asset_sheets')
    .insert({
      category_id: params.categoryId,
      original_filename: params.filename,
      archive_storage_path: path,
      grid_cols: params.gridCols ?? null,
      grid_rows: params.gridRows ?? null,
      uploaded_by: user?.id ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToSheet(data);
}

export async function listAssetSheets(): Promise<AssetSheet[]> {
  const { data, error } = await supabase.from('asset_sheets').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToSheet);
}

/** 管理用の素材一覧。planフィルタなし・非アクティブ素材も含む */
export async function listAllAssets(filters?: { categoryId?: string; isActive?: boolean }): Promise<AdminAsset[]> {
  let query = supabase
    .from('assets')
    .select('id, category_id, name, storage_url, thumbnail_url, plan, width, height, is_active, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (filters?.categoryId) query = query.eq('category_id', filters.categoryId);
  if (filters?.isActive !== undefined) query = query.eq('is_active', filters.isActive);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(rowToAdminAsset);
}

export async function toggleAssetActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('assets').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

/** 名前・カテゴリを修正する（シートアップロード時のカテゴリ選択ミスの訂正など） */
export async function updateAsset(id: string, updates: { name?: string; categoryId?: string; plan?: Plan }): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.categoryId !== undefined) payload.category_id = updates.categoryId;
  if (updates.plan !== undefined) payload.plan = updates.plan;
  const { error } = await supabase.from('assets').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteAsset(id: string): Promise<void> {
  const { error } = await supabase.from('assets').delete().eq('id', id);
  if (error) throw error;
}

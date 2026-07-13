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

/** ロゴ・スタンプ等、固定表示する装飾画像1件（キャンバス1080×1920px基準） */
export interface CollageStyleDecoration {
  /** ImagePickerで選んだ画像をuploadBlob等でStorageへ直接アップロードした公開URL */
  imageUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
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
  /** ロゴ・スタンプ等、固定表示する装飾画像（任意） */
  decorations?: CollageStyleDecoration[];
  thumbnailUrl: string | null;
  /** 設定時は、このユーザー本人だけが使える個人用テンプレート（他ユーザーには公開されない） */
  ownerUserId?: string;
}

interface CollageStyleDefaults {
  backgroundAssetId?: string;
  /** 個人用テンプレート向け: Storageへ直接アップロードした背景画像の公開URL */
  backgroundImageUrl?: string;
  photoAreas?: CollageStylePhotoArea[];
  textLayers?: CollageStyleTextLayer[];
  decorations?: CollageStyleDecoration[];
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
      backgroundUrl: d.backgroundAssetId ? assetsById[d.backgroundAssetId]?.storageUrl : d.backgroundImageUrl,
      photoAreas: d.photoAreas ?? [],
      textLayers: d.textLayers,
      decorations: d.decorations,
      thumbnailUrl: r.thumbnail_url,
      ownerUserId: r.owner_user_id ?? undefined,
    };
  });
}

const STYLE_COLUMNS = 'id, name, plan, is_active, layer_defaults, thumbnail_url, tags, owner_user_id';

/** コラージュ編集画面向け: 有効かつ自分のプランで使えるテンプレートのみ
 *  （RLSにより、管理者が作成した公開テンプレートに加え、呼び出し本人の個人用テンプレートも含まれる） */
export async function listCollageStyles(plan: Plan): Promise<CollageStyle[]> {
  const plans = allowedPlans(plan);
  const { data, error } = await supabase
    .from('templates')
    .select(STYLE_COLUMNS)
    .eq('type', 'collage')
    .eq('is_active', true)
    .in('plan', plans);
  if (error) throw error;
  return rowsToStyles(data ?? []);
}

/** 管理画面向け: 無効化済み・全プランを含む一覧（管理者が作成した公開テンプレートのみ） */
export async function listAllCollageStyles(): Promise<CollageStyle[]> {
  const { data, error } = await supabase
    .from('templates')
    .select(STYLE_COLUMNS)
    .eq('type', 'collage')
    .is('owner_user_id', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return rowsToStyles(data ?? []);
}

/** 自分が作成した個人用テンプレートの一覧（他ユーザーには公開されない） */
export async function listMyCollageTemplates(): Promise<CollageStyle[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('templates')
    .select(STYLE_COLUMNS)
    .eq('type', 'collage')
    .eq('owner_user_id', user.id)
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
  decorations?: CollageStyleDecoration[];
}

function toLayerDefaults(params: CollageStyleParams): CollageStyleDefaults {
  return {
    backgroundAssetId: params.backgroundAssetId,
    photoAreas: params.photoAreas,
    textLayers: params.textLayers,
    decorations: params.decorations,
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

interface CreateMyTemplateParams {
  name: string;
  tags?: string[];
  /** ImagePickerで選んだ画像をuploadBlob等でStorageへ直接アップロードした公開URL */
  backgroundImageUrl: string;
  photoAreas: CollageStylePhotoArea[];
  textLayers?: CollageStyleTextLayer[];
  decorations?: CollageStyleDecoration[];
}

/** 自分専用の個人用テンプレートを作成する（他ユーザーには公開されない） */
export async function createMyCollageTemplate(params: CreateMyTemplateParams): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です');
  const { error } = await supabase.from('templates').insert({
    type: 'collage',
    name: params.name,
    plan: 'free',
    tags: params.tags ?? [],
    owner_user_id: user.id,
    layer_defaults: {
      backgroundImageUrl: params.backgroundImageUrl,
      photoAreas: params.photoAreas,
      textLayers: params.textLayers,
      decorations: params.decorations,
    },
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

const POST_IMAGES_BUCKET = 'post-images';

/** uploadBlob()が返す公開URLから、Storage削除に使うオブジェクトパスを取り出す */
function extractStoragePath(publicUrl: string, bucket: string): string | null {
  const marker = `/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

/**
 * テンプレートを削除する。個人用テンプレート（backgroundImageUrl/decorationsを持つもの）の場合、
 * Storageへ直接アップロードした背景画像・装飾画像も一緒に削除し、Storage容量にゴミが
 * 溜まり続けるのを防ぐ（管理者テンプレートのbackgroundAssetIdはassetsテーブル側で
 * 管理される共有素材のため、ここでは削除しない）。
 */
export async function deleteCollageStyle(id: string): Promise<void> {
  const { data: row } = await supabase
    .from('templates')
    .select('layer_defaults')
    .eq('id', id)
    .maybeSingle();
  const defaults = row?.layer_defaults as CollageStyleDefaults | undefined;
  const imageUrls = [
    defaults?.backgroundImageUrl,
    ...(defaults?.decorations ?? []).map((d) => d.imageUrl),
  ].filter((u): u is string => !!u);

  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw error;

  const paths = imageUrls
    .map((u) => extractStoragePath(u, POST_IMAGES_BUCKET))
    .filter((p): p is string => !!p);
  if (paths.length > 0) {
    await supabase.storage.from(POST_IMAGES_BUCKET).remove(paths).catch(() => {});
  }
}

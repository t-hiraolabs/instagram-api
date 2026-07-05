import { supabase } from './supabaseClient';
import { BrandSettings, DEFAULT_BRAND_SETTINGS } from '../store/appStore';

interface DbRow {
  brand_name: string;
  industry: string;
  account_type: string;
  atmosphere: string;
  target_audience: string;
  location?: string;
  tone: string;
  use_top_posts_insight: boolean;
  api_key?: string;
}

function toDb(s: BrandSettings): DbRow {
  return {
    brand_name: s.brandName,
    industry: s.industry,
    account_type: s.accountType,
    atmosphere: s.atmosphere,
    target_audience: s.targetAudience,
    location: s.location,
    tone: s.tone,
    use_top_posts_insight: s.useTopPostsInsight,
  };
}

function fromDb(row: DbRow): BrandSettings {
  return {
    ...DEFAULT_BRAND_SETTINGS,
    brandName: row.brand_name ?? '',
    industry: row.industry ?? '',
    accountType: row.account_type ?? 'personal',
    atmosphere: row.atmosphere ?? '',
    targetAudience: row.target_audience ?? '',
    location: row.location ?? '',
    tone: row.tone ?? '明るい・ポジティブ',
    useTopPostsInsight: row.use_top_posts_insight ?? false,
  };
}

/** Instagramアカウント単位のローカル保存キー */
export function brandLocalKey(igUserId: string): string {
  return `brand_settings_acct_${igUserId}`;
}

/** 指定したInstagramアカウントのブランド設定をDBから読み込む */
export async function loadBrandSettingsFromDb(igUserId: string): Promise<BrandSettings | null> {
  if (!igUserId) return null;
  const { data, error } = await supabase
    .from('brand_settings')
    .select('*')
    .eq('ig_user_id', igUserId)
    .maybeSingle();
  if (error || !data) return null;
  return fromDb(data as DbRow);
}

/** 指定したInstagramアカウントのブランド設定をDBに保存する */
export async function saveBrandSettingsToDb(settings: BrandSettings, igUserId: string): Promise<void> {
  if (!igUserId) return; // 未連携時はDBに保存しない（ローカルのみ）
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('brand_settings').upsert({
    user_id: user.id,
    ig_user_id: igUserId,
    ...toDb(settings),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,ig_user_id' });
}

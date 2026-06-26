import { supabase } from './supabaseClient';
import { BrandSettings, DEFAULT_BRAND_SETTINGS } from '../store/appStore';

interface DbRow {
  brand_name: string;
  industry: string;
  account_type: string;
  atmosphere: string;
  target_audience: string;
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
    tone: row.tone ?? '明るい・ポジティブ',
    useTopPostsInsight: row.use_top_posts_insight ?? false,
  };
}

export async function loadBrandSettingsFromDb(slot: 1 | 2): Promise<BrandSettings | null> {
  const { data, error } = await supabase
    .from('brand_settings')
    .select('*')
    .eq('slot', slot)
    .maybeSingle();
  if (error || !data) return null;
  return fromDb(data as DbRow);
}

export async function saveBrandSettingsToDb(settings: BrandSettings, slot: 1 | 2): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('brand_settings').upsert({
    user_id: user.id,
    slot,
    ...toDb(settings),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,slot' });
}

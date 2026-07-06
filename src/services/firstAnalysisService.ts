import { supabase } from './supabaseClient';
import { InsightsResult } from './insightsService';

export interface FirstAnalysisSnapshot {
  igUserId: string;
  username: string | null;
  capturedAt: string;
  followersCount: number | null;
  mediaCount: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  engagementRate: number | null;
}

function fromRow(row: any): FirstAnalysisSnapshot {
  return {
    igUserId: row.ig_user_id,
    username: row.username,
    capturedAt: row.captured_at,
    followersCount: row.followers_count,
    mediaCount: row.media_count,
    avgLikes: row.avg_likes,
    avgComments: row.avg_comments,
    engagementRate: row.engagement_rate,
  };
}

/**
 * 連携直後の診断結果を「初回連携時の記録」として1回だけ保存する。
 * 既にレコードがある場合は何もしない（後から見返せる基準値を上書きしないため）。
 */
export async function saveFirstAnalysisSnapshot(igUserId: string, insights: InsightsResult): Promise<void> {
  if (!igUserId) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('ig_first_analysis').insert({
    ig_user_id: igUserId,
    user_id: user.id,
    username: insights.profile.username,
    followers_count: insights.profile.followers_count,
    media_count: insights.profile.media_count,
    avg_likes: insights.summary.avg_likes,
    avg_comments: insights.summary.avg_comments,
    engagement_rate: insights.summary.engagement_rate,
  }).select().maybeSingle();
  // 既に存在する場合はprimary key制約でエラーになるが、意図した挙動なので無視する
}

/** 指定Instagramアカウントの「初回連携時の記録」を取得する */
export async function getFirstAnalysisSnapshot(igUserId: string): Promise<FirstAnalysisSnapshot | null> {
  if (!igUserId) return null;
  const { data, error } = await supabase
    .from('ig_first_analysis')
    .select('*')
    .eq('ig_user_id', igUserId)
    .maybeSingle();
  if (error || !data) return null;
  return fromRow(data);
}

// インサイト（分析）: instagram-insights エッジ関数を呼んで集計データを取得する
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export interface InsightsMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  reach?: number | null;
}

export interface InsightsResult {
  profile: {
    username: string | null;
    account_type: string | null;
    media_count: number | null;
    followers_count: number;
    follows_count: number | null;
    profile_picture_url: string | null;
  };
  summary: {
    analyzed_count: number;
    total_likes: number;
    total_comments: number;
    avg_likes: number;
    avg_comments: number;
    engagement_rate: number | null;
    has_reach: boolean;
  };
  media: InsightsMedia[];
}

/** Instagramの分析データ（プロフィール＋直近投稿の集計）を取得 */
export async function getInsightsSummary(accessToken: string, limit = 12): Promise<InsightsResult> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/instagram-insights`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ access_token: accessToken, limit }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const detail = data.detail ? `\n${JSON.stringify(data.detail)}` : '';
    throw new Error((data.error ?? `分析データの取得に失敗しました (${res.status})`) + detail);
  }
  return data as InsightsResult;
}

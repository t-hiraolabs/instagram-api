// インサイト（分析）: instagram-insights エッジ関数を呼んで集計データを取得する
import { useAppStore } from '../store/appStore';
import { getMyPlan } from './scheduleService';
import { canAnalytics } from '../utils/plans';
import type { TopPost } from './aiService';

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

/**
 * ブランド設定の「過去の人気投稿を反映」がONで、ビジネスプラン＋IG連携済みのとき、
 * 連携アカウントのいいね数上位5投稿を返す。条件を満たさない・失敗時は undefined。
 * 生成系の各画面から呼び、AI生成に成功パターンを差し込むために使う。
 */
export async function getTopPostsForGeneration(): Promise<TopPost[] | undefined> {
  const { brandSettings, instagramCredentials } = useAppStore.getState();
  if (!brandSettings.useTopPostsInsight) return undefined;
  if (!instagramCredentials?.accessToken) return undefined;
  try {
    const plan = await getMyPlan();
    if (!canAnalytics(plan)) return undefined;
    const insights = await getInsightsSummary(instagramCredentials.accessToken, 24);
    const top = insights.media
      .filter((m) => (m.caption ?? '').trim().length > 0)
      .sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0))
      .slice(0, 5)
      .map((m) => ({
        caption: m.caption ?? '',
        likes: m.like_count ?? 0,
        comments: m.comments_count ?? 0,
      }));
    return top.length > 0 ? top : undefined;
  } catch {
    return undefined;
  }
}

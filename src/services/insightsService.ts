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
    name: string | null;
    biography: string | null;
    website: string | null;
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
  const { brandSettings, instagramCredentials, secondInstagramCredentials, activeAccountSlot } = useAppStore.getState();
  const activeCreds = activeAccountSlot === 2 ? secondInstagramCredentials : instagramCredentials;
  if (!brandSettings.useTopPostsInsight) return undefined;
  if (!activeCreds?.accessToken) return undefined;
  try {
    const plan = await getMyPlan();
    if (!canAnalytics(plan)) return undefined;
    const insights = await getInsightsSummary(activeCreds.accessToken, 24);
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

export type AnalysisFacts =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * チャットで「分析して」と言われたときに使う、プログラム側で計算した事実だけのサマリー。
 * AIには数値の説明・改善提案だけを任せ、集計自体はここで行う（AIコスト削減＋数値の正確性のため）。
 */
export async function getAutoAnalysisFacts(): Promise<AnalysisFacts> {
  const { instagramCredentials, secondInstagramCredentials, activeAccountSlot } = useAppStore.getState();
  const activeCreds = activeAccountSlot === 2 ? secondInstagramCredentials : instagramCredentials;
  if (!activeCreds?.accessToken) {
    return { ok: false, reason: 'Instagramアカウントが連携されていません。プロフィール画面から連携してください。' };
  }
  const plan = await getMyPlan().catch(() => 'free' as const);
  if (!canAnalytics(plan)) {
    return { ok: false, reason: '投稿データの自動分析はビジネスプラン限定の機能です。' };
  }

  let insights: InsightsResult;
  try {
    insights = await getInsightsSummary(activeCreds.accessToken, 24);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '分析データの取得に失敗しました。' };
  }

  const media = insights.media.filter((m) => m.timestamp);
  if (media.length === 0) {
    return { ok: false, reason: '分析できる投稿がまだありません。' };
  }

  // 投稿を新しい順に。前半（直近）と後半（それ以前）で比較して傾向を見る
  const sorted = [...media].sort(
    (a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime()
  );
  const engagement = (m: InsightsMedia) => (m.like_count ?? 0) + (m.comments_count ?? 0);
  const half = Math.ceil(sorted.length / 2);
  const recent = sorted.slice(0, half);
  const older = sorted.slice(half);
  const avg = (arr: InsightsMedia[], fn: (m: InsightsMedia) => number) =>
    arr.length ? arr.reduce((s, m) => s + fn(m), 0) / arr.length : 0;
  const recentAvgEng = avg(recent, engagement);
  const olderAvgEng = avg(older, engagement);
  const trendPct = olderAvgEng > 0 ? Math.round(((recentAvgEng - olderAvgEng) / olderAvgEng) * 1000) / 10 : null;

  // 投稿時間帯ごとの平均エンゲージメント（0-23時）
  const hourBuckets: Record<number, { total: number; count: number }> = {};
  for (const m of media) {
    const h = new Date(m.timestamp!).getHours();
    if (!hourBuckets[h]) hourBuckets[h] = { total: 0, count: 0 };
    hourBuckets[h].total += engagement(m);
    hourBuckets[h].count += 1;
  }
  const hourAverages = Object.entries(hourBuckets)
    .map(([h, v]) => ({ hour: Number(h), avg: v.total / v.count, count: v.count }))
    .sort((a, b) => b.avg - a.avg);
  const bestHour = hourAverages[0];

  const top = [...media].sort((a, b) => engagement(b) - engagement(a))[0];
  const bottom = [...media].sort((a, b) => engagement(a) - engagement(b))[0];

  const lines: string[] = [];
  const p = insights.profile;
  lines.push(
    `アカウント: @${p.username ?? '不明'}（${p.account_type ?? '種別不明'}）` +
      ` / フォロワー${p.followers_count}人・フォロー${p.follows_count ?? '不明'}人・投稿数${p.media_count ?? '不明'}件`
  );
  if (p.biography) lines.push(`自己紹介文: ${p.biography}`);
  if (p.website) lines.push(`プロフィールのリンク: ${p.website}`);
  lines.push(`分析対象: 直近${media.length}投稿`);
  lines.push(`平均いいね: ${insights.summary.avg_likes} / 平均コメント: ${insights.summary.avg_comments}`);
  if (insights.summary.engagement_rate != null) {
    lines.push(`エンゲージメント率: ${insights.summary.engagement_rate}%（フォロワー数: ${p.followers_count}）`);
  }
  if (trendPct != null) {
    lines.push(`直近${recent.length}投稿の平均反応(いいね+コメント)は、その前の${older.length}投稿と比べて${trendPct > 0 ? '+' : ''}${trendPct}%`);
  }
  if (bestHour) {
    lines.push(`最も反応が良い投稿時間帯: ${bestHour.hour}時台（平均反応${Math.round(bestHour.avg)}、該当${bestHour.count}件）`);
  }
  if (top) {
    lines.push(`最も反応が良かった投稿: 「${(top.caption ?? '').slice(0, 60) || '（キャプションなし）'}」（いいね${top.like_count ?? 0}・コメント${top.comments_count ?? 0}）`);
  }
  if (bottom && bottom.id !== top?.id) {
    lines.push(`最も反応が弱かった投稿: 「${(bottom.caption ?? '').slice(0, 60) || '（キャプションなし）'}」（いいね${bottom.like_count ?? 0}・コメント${bottom.comments_count ?? 0}）`);
  }

  return { ok: true, text: lines.join('\n') };
}

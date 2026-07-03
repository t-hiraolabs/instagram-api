// Instagramのインサイト（分析）を取得する関数。
// ブラウザから graph.instagram.com を直接叩くとCORSで失敗するため、ここで中継する。
// プロフィール（フォロワー数など）＋直近の投稿（いいね・コメント・リーチ）をまとめて返す。
const INSTAGRAM_API = 'https://graph.instagram.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

interface MediaItem {
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

// 1つの投稿のリーチを取得（権限が無い/対象外でも全体を止めないよう、失敗時は null）
async function fetchReach(mediaId: string, accessToken: string): Promise<number | null> {
  try {
    const r = await fetch(
      `${INSTAGRAM_API}/${mediaId}/insights?metric=reach&access_token=${encodeURIComponent(accessToken)}`,
    );
    const j = await r.json();
    if (!Array.isArray(j?.data)) return null;
    const reach = j.data.find((d: { name?: string }) => d.name === 'reach');
    return reach?.values?.[0]?.value ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { access_token, limit } = await req.json();
    if (!access_token) {
      return json({ error: 'Instagram未連携（トークンがありません）' }, 400);
    }
    const mediaLimit = Math.min(Math.max(Number(limit) || 12, 1), 25);

    // プロフィール（フォロワー数・投稿総数など）
    const profileRes = await fetch(
      `${INSTAGRAM_API}/me?fields=username,account_type,media_count,followers_count,follows_count,profile_picture_url,biography,name,website&access_token=${encodeURIComponent(
        access_token,
      )}`,
    );
    const profile = await profileRes.json();
    if (profile?.error) {
      return json({ error: 'プロフィール取得に失敗しました', detail: profile.error }, 400);
    }

    // 直近の投稿一覧（いいね・コメントはこのフィールドで取れる＝追加権限不要）
    const mediaRes = await fetch(
      `${INSTAGRAM_API}/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=${mediaLimit}&access_token=${encodeURIComponent(
        access_token,
      )}`,
    );
    const mediaJson = await mediaRes.json();
    if (mediaJson?.error) {
      return json({ error: '投稿一覧の取得に失敗しました', detail: mediaJson.error }, 400);
    }
    const media: MediaItem[] = Array.isArray(mediaJson?.data) ? mediaJson.data : [];

    // 各投稿のリーチをまとめて取得（best-effort・失敗は null）
    const reaches = await Promise.all(media.map((m) => fetchReach(m.id, access_token)));
    media.forEach((m, i) => {
      m.reach = reaches[i];
    });

    // 集計
    const totalLikes = media.reduce((s, m) => s + (m.like_count ?? 0), 0);
    const totalComments = media.reduce((s, m) => s + (m.comments_count ?? 0), 0);
    const count = media.length;
    const followers = profile?.followers_count ?? 0;
    const avgLikes = count ? Math.round(totalLikes / count) : 0;
    const avgComments = count ? Math.round((totalComments / count) * 10) / 10 : 0;
    // エンゲージメント率 = (平均いいね + 平均コメント) / フォロワー数
    const engagementRate =
      followers > 0 ? Math.round(((avgLikes + avgComments) / followers) * 1000) / 10 : null;

    return json({
      profile: {
        username: profile?.username ?? null,
        account_type: profile?.account_type ?? null,
        media_count: profile?.media_count ?? null,
        followers_count: followers,
        follows_count: profile?.follows_count ?? null,
        profile_picture_url: profile?.profile_picture_url ?? null,
        name: profile?.name ?? null,
        biography: profile?.biography ?? null,
        website: profile?.website ?? null,
      },
      summary: {
        analyzed_count: count,
        total_likes: totalLikes,
        total_comments: totalComments,
        avg_likes: avgLikes,
        avg_comments: avgComments,
        engagement_rate: engagementRate, // % または null（フォロワー不明時）
        has_reach: reaches.some((r) => r != null),
      },
      media,
    });
  } catch (e) {
    return json({ error: '分析データの取得に失敗しました', detail: String(e) }, 500);
  }
});

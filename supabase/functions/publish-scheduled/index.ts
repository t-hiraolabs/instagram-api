import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const INSTAGRAM_API = 'https://graph.instagram.com';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function sendPushToUser(userId: string | undefined, payload: { title: string; body: string }) {
  if (!userId) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ user_id: userId, ...payload }),
    });
  } catch {
    // 通知失敗は無視（投稿自体には影響させない）
  }
}

async function publishPost(post: {
  id: string;
  caption: string;
  hashtags: string[];
  image_url: string | null;
  type: string;
  instagram_user_id: string;
  access_token: string;
  user_tags?: string[] | null;
  product_tags?: string[] | null;
  location_id?: string | null;
}) {
  const fullCaption = [post.caption, (post.hashtags ?? []).join(' ')]
    .filter(Boolean)
    .join('\n\n');

  const userTagsStr = Array.isArray(post.user_tags) && post.user_tags.length > 0
    ? JSON.stringify(post.user_tags.map((u) => ({ username: u, x: 0.5, y: 0.5 })))
    : undefined;
  const productTagsStr = Array.isArray(post.product_tags) && post.product_tags.length > 0
    ? JSON.stringify(post.product_tags.map((id) => ({ product_id: id, x: 0.5, y: 0.5 })))
    : undefined;
  const locationId = post.location_id ? String(post.location_id) : undefined;

  const isReel = post.type === 'reel';
  // ストーリーで image_url が動画URL → 動画ストーリー
  const isStoryVideo =
    post.type === 'story' && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(post.image_url ?? '');
  // フィードで image_url が改行区切りの複数URL → カルーセル
  const urls = (post.image_url ?? '').split('\n').map((u) => u.trim()).filter(Boolean);
  const isCarousel = post.type === 'feed' && urls.length > 1;

  let container: { id?: string };
  if (isCarousel) {
    const childIds: string[] = [];
    for (let ci = 0; ci < urls.length; ci++) {
      const url = urls[ci];
      const cr = await fetch(`${INSTAGRAM_API}/${post.instagram_user_id}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: url,
          is_carousel_item: true,
          ...(ci === 0 && userTagsStr ? { user_tags: userTagsStr } : {}),
          ...(ci === 0 && productTagsStr ? { product_tags: productTagsStr } : {}),
          access_token: post.access_token,
        }),
      });
      const cj = await cr.json();
      if (!cj.id) throw new Error(`カルーセル子コンテナ作成失敗: ${JSON.stringify(cj)}`);
      childIds.push(cj.id);
    }
    const parentRes = await fetch(`${INSTAGRAM_API}/${post.instagram_user_id}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption: fullCaption,
        ...(locationId ? { location_id: locationId } : {}),
        access_token: post.access_token,
      }),
    });
    container = await parentRes.json();
  } else {
    const containerBody = isReel
      ? {
          media_type: 'REELS',
          video_url: post.image_url,
          caption: fullCaption,
          share_to_feed: true,
          access_token: post.access_token,
        }
      : isStoryVideo
      ? { media_type: 'STORIES', video_url: post.image_url, access_token: post.access_token }
      : {
          image_url: post.image_url,
          caption: fullCaption,
          ...(post.type === 'story' ? { media_type: 'STORIES' } : {}),
          ...(post.type !== 'story' && userTagsStr ? { user_tags: userTagsStr } : {}),
          ...(post.type !== 'story' && productTagsStr ? { product_tags: productTagsStr } : {}),
          ...(post.type !== 'story' && locationId ? { location_id: locationId } : {}),
          access_token: post.access_token,
        };
    const containerRes = await fetch(`${INSTAGRAM_API}/${post.instagram_user_id}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(containerBody),
    });
    container = await containerRes.json();
  }
  if (!container.id) throw new Error(`コンテナ作成失敗: ${JSON.stringify(container)}`);

  // Step 1.5: コンテナの処理完了を待つ（動画は時間がかかるので長めに待つ）
  const maxTries = isReel || isStoryVideo ? 45 : 15;
  let ready = false;
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(
      `${INSTAGRAM_API}/${container.id}?fields=status_code&access_token=${post.access_token}`
    );
    const status = await statusRes.json();
    if (status.status_code === 'FINISHED') {
      ready = true;
      break;
    }
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(`メディア処理エラー: ${JSON.stringify(status)}`);
    }
  }
  if (!ready) throw new Error('メディアの処理がタイムアウトしました');

  // Step 2: 公開
  const publishRes = await fetch(`${INSTAGRAM_API}/${post.instagram_user_id}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: container.id,
      access_token: post.access_token,
    }),
  });

  const published = await publishRes.json();
  if (!published.id) throw new Error(`公開失敗: ${JSON.stringify(published)}`);

  return published.id;
}

// くりかえし投稿の「次回の投稿日時」を計算する（日本時間ベース）
function nextOccurrence(current: Date, repeat: string): Date | null {
  const JST = 9 * 60 * 60 * 1000; // 日本は UTC+9（夏時間なし）
  const d = new Date(current);
  if (repeat === 'daily') {
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  if (repeat === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }
  if (repeat === 'monthly') {
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d;
  }
  if (repeat === 'weekdays') {
    // 翌日以降で、最初の平日（月〜金・日本時間）まで進める
    do {
      d.setUTCDate(d.getUTCDate() + 1);
    } while ([0, 6].includes(new Date(d.getTime() + JST).getUTCDay()));
    return d;
  }
  return null;
}

// 時間が来た予約を投稿する（重い処理。裏で実行する）
async function processDuePosts() {
  const now = new Date().toISOString();

  const { data: posts, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', now);

  if (error || !posts) return;

  for (const post of posts) {
    const isRecurring = post.repeat && post.repeat !== 'none';

    // Instagram未連携の投稿
    if (!post.instagram_user_id || !post.access_token) {
      if (isRecurring) {
        const next = nextOccurrence(new Date(post.scheduled_at), post.repeat);
        if (next) {
          await supabase
            .from('scheduled_posts')
            .update({ scheduled_at: next.toISOString() })
            .eq('id', post.id);
        }
      } else {
        await supabase.from('scheduled_posts').update({ status: 'failed' }).eq('id', post.id);
      }
      continue;
    }

    if (isRecurring) {
      // くりかえしは、先に次回の日時へ進めてから投稿（二重投稿を防ぐ・pendingのまま残す）
      const next = nextOccurrence(new Date(post.scheduled_at), post.repeat);
      if (next) {
        await supabase
          .from('scheduled_posts')
          .update({ scheduled_at: next.toISOString() })
          .eq('id', post.id);
      }
      try {
        await publishPost(post);
      } catch (_err) {
        // 1回失敗しても次回に続ける
      }
    } else {
      // 1回きりの予約
      try {
        await publishPost(post);
        await supabase.from('scheduled_posts').update({ status: 'published' }).eq('id', post.id);
        await sendPushToUser(post.user_id, {
          title: '投稿が完了しました ✅',
          body: post.caption ? post.caption.slice(0, 60) + (post.caption.length > 60 ? '…' : '') : 'Instagramへの投稿が完了しました',
        });
      } catch (_err) {
        await supabase.from('scheduled_posts').update({ status: 'failed' }).eq('id', post.id);
        await sendPushToUser(post.user_id, {
          title: '投稿に失敗しました ⚠️',
          body: '予約投稿の処理中にエラーが発生しました。投稿タブから確認してください。',
        });
      }
    }
  }
}

Deno.serve(() => {
  // 投稿処理は時間がかかる（画像変換待ちで最大30秒）。
  // cronのタイムアウト(5秒)に間に合うよう、すぐ応答を返し、処理は裏で継続する。
  const job = processDuePosts();
  // @ts-ignore Supabase Edge Runtime のバックグラウンド実行
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job);

  return new Response(JSON.stringify({ started: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

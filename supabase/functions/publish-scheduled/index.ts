import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const INSTAGRAM_API = 'https://graph.instagram.com';

async function publishPost(post: {
  id: string;
  caption: string;
  hashtags: string[];
  image_url: string | null;
  type: string;
  instagram_user_id: string;
  access_token: string;
}) {
  const fullCaption = [post.caption, (post.hashtags ?? []).join(' ')]
    .filter(Boolean)
    .join('\n\n');

  const isReel = post.type === 'reel';

  // Step 1: メディアコンテナ作成（リールは image_url に動画URLを保存している）
  const containerBody = isReel
    ? {
        media_type: 'REELS',
        video_url: post.image_url,
        caption: fullCaption,
        share_to_feed: true,
        access_token: post.access_token,
      }
    : {
        image_url: post.image_url,
        caption: fullCaption,
        ...(post.type === 'story' ? { media_type: 'STORIES' } : {}),
        access_token: post.access_token,
      };
  const containerRes = await fetch(`${INSTAGRAM_API}/${post.instagram_user_id}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(containerBody),
  });

  const container = await containerRes.json();
  if (!container.id) throw new Error(`コンテナ作成失敗: ${JSON.stringify(container)}`);

  // Step 1.5: コンテナの処理完了を待つ（動画は時間がかかるので長めに待つ）
  const maxTries = isReel ? 45 : 15;
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
      } catch (_err) {
        await supabase.from('scheduled_posts').update({ status: 'failed' }).eq('id', post.id);
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

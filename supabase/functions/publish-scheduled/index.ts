import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const INSTAGRAM_API = 'https://graph.instagram.com/v18.0';

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

  // Step 1: メディアコンテナ作成
  const containerRes = await fetch(`${INSTAGRAM_API}/${post.instagram_user_id}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: post.image_url,
      caption: fullCaption,
      ...(post.type === 'story' ? { media_type: 'STORIES' } : {}),
      access_token: post.access_token,
    }),
  });

  const container = await containerRes.json();
  if (!container.id) throw new Error(`コンテナ作成失敗: ${JSON.stringify(container)}`);

  // Step 1.5: コンテナの処理完了を待つ（画像のダウンロード・変換に数秒かかる）
  let ready = false;
  for (let i = 0; i < 15; i++) {
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

Deno.serve(async () => {
  const now = new Date().toISOString();

  const { data: posts, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', now);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const results = [];

  for (const post of posts ?? []) {
    // Instagram未連携の投稿はスキップ
    if (!post.instagram_user_id || !post.access_token) {
      await supabase
        .from('scheduled_posts')
        .update({ status: 'failed' })
        .eq('id', post.id);
      results.push({ id: post.id, status: 'failed', reason: 'Instagram未連携' });
      continue;
    }

    try {
      const postId = await publishPost(post);
      await supabase
        .from('scheduled_posts')
        .update({ status: 'published' })
        .eq('id', post.id);
      results.push({ id: post.id, status: 'published', instagram_post_id: postId });
    } catch (err) {
      await supabase
        .from('scheduled_posts')
        .update({ status: 'failed' })
        .eq('id', post.id);
      results.push({ id: post.id, status: 'failed', error: String(err) });
    }
  }

  return new Response(
    JSON.stringify({ processed: results.length, results }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});

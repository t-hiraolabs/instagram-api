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

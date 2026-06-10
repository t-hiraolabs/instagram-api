// 単一投稿を「今すぐ」Instagramに公開する関数（テスト/手動投稿用）
// graph.instagram.com（Instagramログイン）を使用。バージョン指定なし＝最新で安定。
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { caption, hashtags, image_url, type, instagram_user_id, access_token } = await req.json();

    if (!instagram_user_id || !access_token) {
      return json({ error: 'Instagram未連携（ユーザーID/トークンがありません）' }, 400);
    }
    if (!image_url) {
      return json({ error: '投稿には公開画像URLが必要です' }, 400);
    }

    const fullCaption = [caption, (hashtags ?? []).join(' ')].filter(Boolean).join('\n\n');

    // Step 1: メディアコンテナ作成
    const containerRes = await fetch(`${INSTAGRAM_API}/${instagram_user_id}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url,
        caption: fullCaption,
        ...(type === 'story' ? { media_type: 'STORIES' } : {}),
        access_token,
      }),
    });
    const container = await containerRes.json();
    if (!container.id) {
      return json({ error: 'コンテナ作成失敗', detail: container }, 400);
    }

    // Step 1.5: コンテナの処理完了を待つ（画像のダウンロード・変換に数秒かかる）
    let ready = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusRes = await fetch(
        `${INSTAGRAM_API}/${container.id}?fields=status_code,status&access_token=${access_token}`
      );
      const status = await statusRes.json();
      if (status.status_code === 'FINISHED') {
        ready = true;
        break;
      }
      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
        return json({ error: 'メディア処理エラー', detail: status }, 400);
      }
    }
    if (!ready) {
      return json(
        { error: 'メディアの処理がタイムアウトしました。もう一度お試しください' },
        400
      );
    }

    // Step 2: 公開
    const publishRes = await fetch(`${INSTAGRAM_API}/${instagram_user_id}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: container.id,
        access_token,
      }),
    });
    const published = await publishRes.json();
    if (!published.id) {
      return json({ error: '公開失敗', detail: published }, 400);
    }

    return json({ id: published.id, posted_type: type === 'story' ? 'story' : 'feed' });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

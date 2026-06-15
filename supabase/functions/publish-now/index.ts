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
    const { caption, hashtags, image_url, image_urls, video_url, type, instagram_user_id, access_token } = await req.json();

    if (!instagram_user_id || !access_token) {
      return json({ error: 'Instagram未連携（ユーザーID/トークンがありません）' }, 400);
    }
    const isReel = type === 'reel';
    const isStoryVideo = type === 'story' && !!video_url;
    const isVideo = isReel || isStoryVideo;
    // フィードで複数画像 → カルーセル
    const carousel: string[] = type === 'feed' && Array.isArray(image_urls) && image_urls.length > 1 ? image_urls : [];
    const isCarousel = carousel.length > 1;

    if (isReel && !video_url) {
      return json({ error: 'リール投稿には公開動画URLが必要です' }, 400);
    }
    if (!isVideo && !isCarousel && !image_url) {
      return json({ error: '投稿には公開画像URLが必要です' }, 400);
    }

    const fullCaption = [caption, (hashtags ?? []).join(' ')].filter(Boolean).join('\n\n');

    // Step 1: メディアコンテナ作成
    let container: { id?: string };
    if (isCarousel) {
      // 各画像の子コンテナを作成
      const childIds: string[] = [];
      for (const url of carousel) {
        const cr = await fetch(`${INSTAGRAM_API}/${instagram_user_id}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token }),
        });
        const cj = await cr.json();
        if (!cj.id) return json({ error: 'カルーセル子コンテナ作成失敗', detail: cj }, 400);
        childIds.push(cj.id);
      }
      const parentRes = await fetch(`${INSTAGRAM_API}/${instagram_user_id}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'CAROUSEL',
          children: childIds.join(','),
          caption: fullCaption,
          access_token,
        }),
      });
      container = await parentRes.json();
    } else {
      const containerBody = isReel
        ? { media_type: 'REELS', video_url, caption: fullCaption, share_to_feed: true, access_token }
        : isStoryVideo
        ? { media_type: 'STORIES', video_url, access_token }
        : {
            image_url,
            caption: fullCaption,
            ...(type === 'story' ? { media_type: 'STORIES' } : {}),
            access_token,
          };
      const containerRes = await fetch(`${INSTAGRAM_API}/${instagram_user_id}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(containerBody),
      });
      container = await containerRes.json();
    }
    if (!container.id) {
      return json({ error: 'コンテナ作成失敗', detail: container }, 400);
    }

    // Step 1.5: コンテナの処理完了を待つ（動画は時間がかかるので長めに待つ）
    const maxTries = isVideo ? 45 : 15;
    let ready = false;
    for (let i = 0; i < maxTries; i++) {
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

    return json({ id: published.id, posted_type: isReel ? 'reel' : type === 'story' ? 'story' : 'feed' });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

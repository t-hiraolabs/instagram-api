// 「今すぐ投稿」: publish-now エッジ関数を呼んでInstagramへ即時公開する
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export interface PublishNowInput {
  caption: string;
  hashtags: string[];
  image_url?: string;
  image_urls?: string[]; // フィードのカルーセル（複数画像）
  video_url?: string;
  type: 'feed' | 'story' | 'reel';
  instagram_user_id: string;
  access_token: string;
  user_tags?: string[];    // タグ付けするアカウント名（@なし）
  product_tags?: string[]; // 商品ID（Instagramショッピング）
  location_id?: string;    // 場所ID（Facebook Place ID）
}

export interface PublishNowResult {
  id: string;
  posted_type?: 'feed' | 'story' | 'reel';
}

/** Instagramに今すぐ投稿し、投稿IDと種別を返す。失敗時は分かりやすいエラーをthrow */
export async function publishNow(input: PublishNowInput): Promise<PublishNowResult> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/publish-now`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.error) {
    const detail = data.detail ? `\n${JSON.stringify(data.detail)}` : '';
    throw new Error((data.error ?? `投稿に失敗しました (${res.status})`) + detail);
  }

  return data as PublishNowResult;
}

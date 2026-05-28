import axios from 'axios';

// Instagram Graph API
// 必要: Facebookアプリ作成 → Instagram Business/Creator アカウント連携
const BASE_URL = 'https://graph.instagram.com/v18.0';

export interface InstagramPost {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export interface ScheduledPost {
  id: string;
  imageUri: string;
  caption: string;
  hashtags: string[];
  scheduledAt: Date;
  status: 'pending' | 'published' | 'failed';
}

// アクセストークンでメディア一覧を取得
export async function getMediaList(accessToken: string): Promise<InstagramPost[]> {
  const response = await axios.get(`${BASE_URL}/me/media`, {
    params: {
      fields: 'id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count',
      access_token: accessToken,
    },
  });
  return response.data.data;
}

// フィード投稿（画像）
// Step 1: メディアコンテナを作成
export async function createMediaContainer(
  accessToken: string,
  userId: string,
  imageUrl: string,
  caption: string
): Promise<string> {
  const response = await axios.post(`${BASE_URL}/${userId}/media`, {
    image_url: imageUrl,  // 公開URLが必要（S3等）
    caption,
    access_token: accessToken,
  });
  return response.data.id; // container_id
}

// Step 2: コンテナを公開
export async function publishMedia(
  accessToken: string,
  userId: string,
  containerId: string
): Promise<string> {
  const response = await axios.post(`${BASE_URL}/${userId}/media_publish`, {
    creation_id: containerId,
    access_token: accessToken,
  });
  return response.data.id; // post_id
}

// ストーリー投稿
export async function publishStory(
  accessToken: string,
  userId: string,
  imageUrl: string
): Promise<string> {
  // Step 1: ストーリーコンテナを作成
  const containerResponse = await axios.post(`${BASE_URL}/${userId}/media`, {
    image_url: imageUrl,
    media_type: 'STORIES',
    access_token: accessToken,
  });
  const containerId = containerResponse.data.id;

  // Step 2: 公開
  const publishResponse = await axios.post(`${BASE_URL}/${userId}/media_publish`, {
    creation_id: containerId,
    access_token: accessToken,
  });
  return publishResponse.data.id;
}

// インサイト取得
export async function getInsights(
  accessToken: string,
  mediaId: string
): Promise<{ impressions: number; reach: number; engagement: number }> {
  const response = await axios.get(`${BASE_URL}/${mediaId}/insights`, {
    params: {
      metric: 'impressions,reach,engagement',
      access_token: accessToken,
    },
  });
  const data = response.data.data;
  return {
    impressions: data.find((d: any) => d.name === 'impressions')?.values[0]?.value || 0,
    reach: data.find((d: any) => d.name === 'reach')?.values[0]?.value || 0,
    engagement: data.find((d: any) => d.name === 'engagement')?.values[0]?.value || 0,
  };
}

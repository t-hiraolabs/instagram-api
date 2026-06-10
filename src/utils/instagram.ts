import { Platform, Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { InstagramCredentials } from '../store/appStore';

const INSTAGRAM_APP_ID = process.env.EXPO_PUBLIC_INSTAGRAM_APP_ID ?? '';
const REDIRECT_URI = 'https://instagram-api-alpha.vercel.app/';
const SCOPES =
  'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights';

export const SK_USER_ID = 'instagram_user_id';
export const SK_TOKEN = 'instagram_access_token';
export const SK_USERNAME = 'instagram_username';
export const SK_PICTURE = 'instagram_profile_picture';

/** Instagramビジネスログインの認証画面へ遷移する */
export function connectInstagram() {
  const url =
    `https://www.instagram.com/oauth/authorize?` +
    `force_reauth=true` +
    `&client_id=${INSTAGRAM_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}`;
  if (Platform.OS === 'web') window.location.href = url;
  else Linking.openURL(url);
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

/** 保存済みのInstagram連携情報を読み込む（アプリ起動時に使う） */
export async function loadInstagramCredentials(): Promise<InstagramCredentials | null> {
  const userId = await getItem(SK_USER_ID);
  const accessToken = await getItem(SK_TOKEN);
  if (!userId || !accessToken) return null;
  const username = await getItem(SK_USERNAME);
  const profilePictureUrl = await getItem(SK_PICTURE);
  return {
    userId,
    accessToken,
    username: username ?? undefined,
    profilePictureUrl: profilePictureUrl ?? undefined,
  };
}

/** 保存されたInstagram連携情報を消す */
export async function clearInstagramStorage() {
  const remove = async (key: string) => {
    if (Platform.OS === 'web') localStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  };
  await remove(SK_USER_ID);
  await remove(SK_TOKEN);
  await remove(SK_USERNAME);
  await remove(SK_PICTURE);
}

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

export const SK_USER_ID_2 = 'instagram_user_id_2';
export const SK_TOKEN_2 = 'instagram_access_token_2';
export const SK_USERNAME_2 = 'instagram_username_2';
export const SK_PICTURE_2 = 'instagram_profile_picture_2';

/** Instagramビジネスログインの認証画面へ遷移する (slot: 1 or 2) */
export function connectInstagram(slot: 1 | 2 = 1) {
  // state パラメータにスロット番号を埋め込む（リダイレクト後に読み取る）
  const state = `slot${slot}`;
  const url =
    `https://www.instagram.com/oauth/authorize?` +
    `force_reauth=true` +
    `&client_id=${INSTAGRAM_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${encodeURIComponent(state)}`;
  if (Platform.OS === 'web') window.location.href = url;
  else Linking.openURL(url);
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function removeItem(key: string) {
  if (Platform.OS === 'web') localStorage.removeItem(key);
  else await SecureStore.deleteItemAsync(key);
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

/** 保存済みの2つ目のInstagram連携情報を読み込む */
export async function loadInstagramCredentials2(): Promise<InstagramCredentials | null> {
  const userId = await getItem(SK_USER_ID_2);
  const accessToken = await getItem(SK_TOKEN_2);
  if (!userId || !accessToken) return null;
  const username = await getItem(SK_USERNAME_2);
  const profilePictureUrl = await getItem(SK_PICTURE_2);
  return {
    userId,
    accessToken,
    username: username ?? undefined,
    profilePictureUrl: profilePictureUrl ?? undefined,
  };
}

/** 保存されたInstagram連携情報を消す */
export async function clearInstagramStorage() {
  await removeItem(SK_USER_ID);
  await removeItem(SK_TOKEN);
  await removeItem(SK_USERNAME);
  await removeItem(SK_PICTURE);
}

/** 保存された2つ目のInstagram連携情報を消す */
export async function clearInstagramStorage2() {
  await removeItem(SK_USER_ID_2);
  await removeItem(SK_TOKEN_2);
  await removeItem(SK_USERNAME_2);
  await removeItem(SK_PICTURE_2);
}

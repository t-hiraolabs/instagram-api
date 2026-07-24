import { Platform, Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { InstagramCredentials } from '../store/appStore';

const INSTAGRAM_APP_ID = process.env.EXPO_PUBLIC_INSTAGRAM_APP_ID ?? '';
// アプリ本体はルート(/)ではなく/app配下（scripts/build.sh参照。/にはLPを置いている）に
// あるため、ここも/appを指す。Metaアプリダッシュボードの「有効なOAuthリダイレクトURI」を
// この文字列と完全一致させておくこと（不一致だと連携時にredirect_uri_mismatchで失敗する）。
// 末尾のスラッシュ込みで登録済みのため、この形のまま維持する（vercel.jsonのrewritesで
// /app・/app/どちらでも/app/index.htmlへ確実に解決されるようにしている）
const REDIRECT_URI = 'https://aimark-es.com/app/';
// 実際にアプリで使う権限だけを要求する（未使用の権限はMeta審査で却下されるため要求しない）。
// basic: プロフィール/投稿の読み取り（いいね・コメント数を含む）/ content_publish: 投稿 / manage_insights: 分析・リーチ
// manage_messages（DM機能用）は、DM画面自体はコード上存在するもののまだ実運用できる状態では
// ないため、今回の審査では要求しない（今後DM機能を仕上げた段階で改めて審査申請する）
const SCOPES =
  'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights';

export const SK_USER_ID = 'instagram_user_id';
export const SK_TOKEN = 'instagram_access_token';
export const SK_USERNAME = 'instagram_username';
export const SK_PICTURE = 'instagram_profile_picture';

export const SK_USER_ID_2 = 'instagram_user_id_2';
export const SK_TOKEN_2 = 'instagram_access_token_2';
export const SK_USERNAME_2 = 'instagram_username_2';
export const SK_PICTURE_2 = 'instagram_profile_picture_2';

export const SK_USER_ID_3 = 'instagram_user_id_3';
export const SK_TOKEN_3 = 'instagram_access_token_3';
export const SK_USERNAME_3 = 'instagram_username_3';
export const SK_PICTURE_3 = 'instagram_profile_picture_3';

/** Instagramビジネスログインの認証画面へ遷移する (slot: 1〜3) */
export function connectInstagram(slot: 1 | 2 | 3 = 1) {
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
  if (Platform.OS === 'web') {
    // PWA(standalone)内で外部ドメイン(Instagram)へ同一ウィンドウのまま遷移すると、
    // 一部環境でviewport/レイアウトが崩れたまま戻ってこない不具合があるため、
    // PWA本体とは別タブ・別ウィンドウ（実質ブラウザ側）で開く。
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    Linking.openURL(url);
  }
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function removeItem(key: string) {
  if (Platform.OS === 'web') localStorage.removeItem(key);
  else await SecureStore.deleteItemAsync(key);
}

async function setItem(key: string, value: string) {
  if (Platform.OS === 'web') localStorage.setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}

const SLOT_KEYS: Record<1 | 2 | 3, { userId: string; token: string; username: string; picture: string }> = {
  1: { userId: SK_USER_ID, token: SK_TOKEN, username: SK_USERNAME, picture: SK_PICTURE },
  2: { userId: SK_USER_ID_2, token: SK_TOKEN_2, username: SK_USERNAME_2, picture: SK_PICTURE_2 },
  3: { userId: SK_USER_ID_3, token: SK_TOKEN_3, username: SK_USERNAME_3, picture: SK_PICTURE_3 },
};

/** 指定スロットにInstagram連携情報を書き込む */
export async function saveInstagramCredentialsToSlot(slot: 1 | 2 | 3, creds: InstagramCredentials): Promise<void> {
  const keys = SLOT_KEYS[slot];
  await setItem(keys.userId, creds.userId);
  await setItem(keys.token, creds.accessToken);
  if (creds.username) await setItem(keys.username, creds.username);
  if (creds.profilePictureUrl) await setItem(keys.picture, creds.profilePictureUrl);
}

/** 指定スロットの保存済みInstagram連携情報を消す */
export async function clearInstagramStorageForSlot(slot: 1 | 2 | 3): Promise<void> {
  const keys = SLOT_KEYS[slot];
  await removeItem(keys.userId);
  await removeItem(keys.token);
  await removeItem(keys.username);
  await removeItem(keys.picture);
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

/** 保存済みの3つ目のInstagram連携情報を読み込む */
export async function loadInstagramCredentials3(): Promise<InstagramCredentials | null> {
  const userId = await getItem(SK_USER_ID_3);
  const accessToken = await getItem(SK_TOKEN_3);
  if (!userId || !accessToken) return null;
  const username = await getItem(SK_USERNAME_3);
  const profilePictureUrl = await getItem(SK_PICTURE_3);
  return {
    userId,
    accessToken,
    username: username ?? undefined,
    profilePictureUrl: profilePictureUrl ?? undefined,
  };
}

/** 保存された3つ目のInstagram連携情報を消す */
export async function clearInstagramStorage3() {
  await removeItem(SK_USER_ID_3);
  await removeItem(SK_TOKEN_3);
  await removeItem(SK_USERNAME_3);
  await removeItem(SK_PICTURE_3);
}

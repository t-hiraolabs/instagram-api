import 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform, Alert, View, ActivityIndicator } from 'react-native';
import RootNavigator from './src/navigation/RootNavigator';
import AccountBadge from './src/components/AccountBadge';
import { supabase } from './src/services/supabaseClient';
import { useAppStore } from './src/store/appStore';
import { COLORS } from './src/utils/theme';
import {
  loadInstagramCredentials,
  loadInstagramCredentials2,
  SK_CONNECTING_SLOT,
} from './src/utils/instagram';
import axios from 'axios';

const queryClient = new QueryClient();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

function saveCredential(key: string, value: string) {
  if (Platform.OS === 'web') localStorage.setItem(key, value);
}

function OAuthHandler() {
  const setInstagramCredentials = useAppStore((s) => s.setInstagramCredentials);
  const setSecondInstagramCredentials = useAppStore((s) => s.setSecondInstagramCredentials);

  // アプリ起動時に保存済みのInstagram連携情報をストアへ読み込む（更新しても連携を維持）
  useEffect(() => {
    loadInstagramCredentials().then((creds) => {
      if (creds) setInstagramCredentials(creds);
    });
    loadInstagramCredentials2().then((creds) => {
      if (creds) setSecondInstagramCredentials(creds);
    });
  }, [setInstagramCredentials, setSecondInstagramCredentials]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;

    // URLからcodeを削除
    window.history.replaceState({}, '', window.location.pathname);

    // どのスロットに保存するか判定
    const slotRaw = localStorage.getItem(SK_CONNECTING_SLOT);
    const slot = slotRaw === '2' ? 2 : 1;
    localStorage.removeItem(SK_CONNECTING_SLOT);

    (async () => {
      try {
        const res = await axios.post(
          `${SUPABASE_URL}/functions/v1/exchange-instagram-token`,
          { code },
          { headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' } }
        );
        const { access_token, user_id, username, profile_picture_url } = res.data;

        if (slot === 2) {
          saveCredential('instagram_user_id_2', user_id);
          saveCredential('instagram_access_token_2', access_token);
          saveCredential('instagram_username_2', username);
          if (profile_picture_url) saveCredential('instagram_profile_picture_2', profile_picture_url);
          setSecondInstagramCredentials({
            userId: user_id,
            accessToken: access_token,
            username,
            profilePictureUrl: profile_picture_url || undefined,
          });
        } else {
          saveCredential('instagram_user_id', user_id);
          saveCredential('instagram_access_token', access_token);
          saveCredential('instagram_username', username);
          if (profile_picture_url) saveCredential('instagram_profile_picture', profile_picture_url);
          setInstagramCredentials({
            userId: user_id,
            accessToken: access_token,
            username,
            profilePictureUrl: profile_picture_url || undefined,
          });
        }
        Alert.alert('連携完了 ✅', `@${username} でログインしました`);
      } catch {
        Alert.alert('エラー', 'Instagram連携に失敗しました');
      }
    })();
  }, []);

  return null;
}

function AuthGate() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // セッションの読み込みが終わるまで待つ（右上の表示がチラつかないように）
    supabase.auth.getSession().then(() => {
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  // ログインしていなくてもアプリは開ける。ログインは右上のボタンから任意で行う
  return (
    <>
      <OAuthHandler />
      <RootNavigator />
      <AccountBadge />
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthGate />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

import 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform, Alert, View, ActivityIndicator } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import RootNavigator from './src/navigation/RootNavigator';
import AuthScreen from './src/screens/AuthScreen';
import AccountBadge from './src/components/AccountBadge';
import { supabase } from './src/services/supabaseClient';
import { useAppStore } from './src/store/appStore';
import { COLORS } from './src/utils/theme';
import axios from 'axios';

const queryClient = new QueryClient();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

function saveCredential(key: string, value: string) {
  if (Platform.OS === 'web') localStorage.setItem(key, value);
}

function OAuthHandler() {
  const setInstagramCredentials = useAppStore((s) => s.setInstagramCredentials);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;

    // URLからcodeを削除
    window.history.replaceState({}, '', window.location.pathname);

    (async () => {
      try {
        const res = await axios.post(
          `${SUPABASE_URL}/functions/v1/exchange-instagram-token`,
          { code },
          { headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' } }
        );
        const { access_token, user_id, username } = res.data;

        saveCredential('instagram_user_id', user_id);
        saveCredential('instagram_access_token', access_token);
        saveCredential('instagram_username', username);

        setInstagramCredentials({ userId: user_id, accessToken: access_token, username });
        Alert.alert('連携完了 ✅', `@${username} でログインしました`);
      } catch {
        Alert.alert('エラー', 'Instagram連携に失敗しました');
      }
    })();
  }, []);

  return null;
}

function AuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

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

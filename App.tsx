import 'react-native-gesture-handler';
import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform, Alert, View, ActivityIndicator } from 'react-native';
import RootNavigator from './src/navigation/RootNavigator';
import AccountBadge from './src/components/AccountBadge';
import { supabase } from './src/services/supabaseClient';
import { useAppStore, BrandSettings } from './src/store/appStore';
import { COLORS } from './src/utils/theme';
import {
  loadInstagramCredentials,
  loadInstagramCredentials2,
  loadInstagramCredentials3,
} from './src/utils/instagram';
import { loadBrandSettingsFromDb, brandLocalKey } from './src/services/brandSettingsService';
import { loadAssistantMemory } from './src/services/memoryService';
import { useCreativeFonts } from './src/utils/fontPresets';
import axios from 'axios';

const queryClient = new QueryClient();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

function saveCredential(key: string, value: string) {
  if (Platform.OS === 'web') localStorage.setItem(key, value);
}

/** 指定Instagramアカウントのブランド設定を読み込む（DB→ローカルの順） */
async function loadBrandForAccount(igUserId: string): Promise<BrandSettings | null> {
  if (!igUserId) return null;
  const db = await loadBrandSettingsFromDb(igUserId).catch(() => null);
  if (db) return db;
  if (Platform.OS === 'web') {
    try {
      const raw = localStorage.getItem(brandLocalKey(igUserId));
      if (raw) return JSON.parse(raw) as BrandSettings;
    } catch {}
  }
  return null;
}

function OAuthHandler() {
  const setInstagramCredentials = useAppStore((s) => s.setInstagramCredentials);
  const setSecondInstagramCredentials = useAppStore((s) => s.setSecondInstagramCredentials);
  const setThirdInstagramCredentials = useAppStore((s) => s.setThirdInstagramCredentials);
  const setActiveAccountSlot = useAppStore((s) => s.setActiveAccountSlot);
  const setBrandSettings = useAppStore((s) => s.setBrandSettings);
  const setBrandSettings2 = useAppStore((s) => s.setBrandSettings2);
  const setBrandSettings3 = useAppStore((s) => s.setBrandSettings3);

  // アプリ起動時に保存済みのInstagram連携情報・ブランド設定・アクティブスロットを読み込む。
  // ブランド設定は「Instagramアカウント(userId)単位」で読み込むので、
  // 各スロットに連携されているアカウントのIDをキーに取得する。
  useEffect(() => {
    loadInstagramCredentials().then((creds) => {
      if (creds) {
        setInstagramCredentials(creds);
        loadBrandForAccount(creds.userId).then((b) => { if (b) setBrandSettings(b); });
      }
    });
    loadInstagramCredentials2().then((creds) => {
      if (creds) {
        setSecondInstagramCredentials(creds);
        loadBrandForAccount(creds.userId).then((b) => { if (b) setBrandSettings2(b); });
      }
    });
    loadInstagramCredentials3().then((creds) => {
      if (creds) {
        setThirdInstagramCredentials(creds);
        loadBrandForAccount(creds.userId).then((b) => { if (b) setBrandSettings3(b); });
      }
    });
    if (Platform.OS === 'web') {
      const saved = localStorage.getItem('active_account_slot');
      if (saved === '2') setActiveAccountSlot(2);
      else if (saved === '3') setActiveAccountSlot(3);
    }
    // AIアシスタントのメモリを読み込む
    loadAssistantMemory().then((m) => useAppStore.getState().setAssistantMemory(m)).catch(() => {});
  }, [setInstagramCredentials, setSecondInstagramCredentials, setThirdInstagramCredentials, setActiveAccountSlot, setBrandSettings, setBrandSettings2, setBrandSettings3]);

  // Instagram連携が成功したときの反映処理。同一タブでの直接コールバックでも、
  // 別タブ（ポップアップ）から通知を受け取った場合でも、この処理を共通で使う。
  const applyIgAuthResult = useCallback(
    async (
      slot: 1 | 2 | 3,
      access_token: string,
      user_id: string,
      username: string,
      profile_picture_url?: string
    ) => {
      // 同じInstagramアカウントを他のスロットに重複連携させない
      const state0 = useAppStore.getState();
      const otherCredsList = [
        slot !== 1 ? state0.instagramCredentials : null,
        slot !== 2 ? state0.secondInstagramCredentials : null,
        slot !== 3 ? state0.thirdInstagramCredentials : null,
      ];
      if (otherCredsList.some((c) => c && c.userId === user_id)) {
        Alert.alert(
          '連携できません',
          `@${username} はすでに他のアカウント枠に連携されています。別のInstagramアカウントを連携してください。`
        );
        return;
      }

      if (slot === 3) {
        saveCredential('instagram_user_id_3', user_id);
        saveCredential('instagram_access_token_3', access_token);
        saveCredential('instagram_username_3', username);
        if (profile_picture_url) saveCredential('instagram_profile_picture_3', profile_picture_url);
        setThirdInstagramCredentials({
          userId: user_id, accessToken: access_token, username,
          profilePictureUrl: profile_picture_url || undefined,
        });
      } else if (slot === 2) {
        saveCredential('instagram_user_id_2', user_id);
        saveCredential('instagram_access_token_2', access_token);
        saveCredential('instagram_username_2', username);
        if (profile_picture_url) saveCredential('instagram_profile_picture_2', profile_picture_url);
        setSecondInstagramCredentials({
          userId: user_id, accessToken: access_token, username,
          profilePictureUrl: profile_picture_url || undefined,
        });
      } else {
        saveCredential('instagram_user_id', user_id);
        saveCredential('instagram_access_token', access_token);
        saveCredential('instagram_username', username);
        if (profile_picture_url) saveCredential('instagram_profile_picture', profile_picture_url);
        setInstagramCredentials({
          userId: user_id, accessToken: access_token, username,
          profilePictureUrl: profile_picture_url || undefined,
        });
      }

      // 連携したアカウントを使用中（アクティブ）に切り替える
      setActiveAccountSlot(slot);

      // このアカウントに既存のブランド設定があれば復元する。無ければ、プロフィール画面の
      // 「AIで投稿を分析して自動入力」から手動で分析してもらう（連携直後の自動分析は行わない）
      const existing = await loadBrandForAccount(user_id);
      if (existing) {
        if (slot === 3) setBrandSettings3(existing);
        else if (slot === 2) setBrandSettings2(existing);
        else setBrandSettings(existing);
      }
    },
    [setInstagramCredentials, setSecondInstagramCredentials, setThirdInstagramCredentials, setActiveAccountSlot, setBrandSettings, setBrandSettings2, setBrandSettings3]
  );

  // 別タブ（ポップアップ）でInstagram連携した場合、そちらから届く結果をここで受け取って反映する
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'ig_oauth_result' || !e.newValue) return;
      try {
        const data = JSON.parse(e.newValue);
        applyIgAuthResult(data.slot, data.access_token, data.user_id, data.username, data.profile_picture_url);
      } catch {}
      try { localStorage.removeItem('ig_oauth_result'); } catch {}
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [applyIgAuthResult]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;

    const state = params.get('state') ?? '';

    // Instagram連携とGoogleログインは同じ ?code= を使うため区別する。
    // Instagram連携は必ず state=slot1/slot2/slot3 を付けるので、それ以外はSupabase(Google)のOAuthとみなす。
    const isInstagramOAuth = state === 'slot1' || state === 'slot2' || state === 'slot3';
    if (!isInstagramOAuth) {
      // Supabase(Google)のOAuthコールバック。セッションを確立し、URLを掃除する。
      supabase.auth
        .exchangeCodeForSession(window.location.href)
        .catch(() => {})
        .finally(() => {
          window.history.replaceState({}, '', window.location.pathname);
        });
      return;
    }

    const slot: 1 | 2 | 3 = state === 'slot3' ? 3 : state === 'slot2' ? 2 : 1;

    window.history.replaceState({}, '', window.location.pathname);

    (async () => {
      try {
        const res = await axios.post(
          `${SUPABASE_URL}/functions/v1/exchange-instagram-token`,
          { code },
          { headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' } }
        );
        const { access_token, user_id, username, profile_picture_url } = res.data;

        // 別タブ・別ウィンドウ（noopenerのためwindow.opener自体は参照できない）で開いている
        // 元のPWA側のタブがあれば、そちらにも結果を伝える。同一originであればstorageイベントで届く。
        try {
          localStorage.setItem(
            'ig_oauth_result',
            JSON.stringify({ slot, access_token, user_id, username, profile_picture_url, ts: Date.now() })
          );
        } catch {}

        // このタブ自身でも連携完了として反映する
        await applyIgAuthResult(slot, access_token, user_id, username, profile_picture_url);
      } catch {
        Alert.alert('エラー', 'Instagram連携に失敗しました');
      }
    })();
  }, [applyIgAuthResult]);

  return null;
}

function AuthGate() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <>
      <OAuthHandler />
      <RootNavigator />
    </>
  );
}

export default function App() {
  // 「ストーリー作成」機能の共有フォントを起動時から先読みしておく（画面に到達する頃には
  // 読み込み済みになっているようにするための早期キック。アプリ全体の表示はブロックしない）。
  useCreativeFonts();
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthGate />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}


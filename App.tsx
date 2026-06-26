import 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Platform, Alert, View, ActivityIndicator, Modal, Text,
  ScrollView, TouchableOpacity, TextInput, StyleSheet,
} from 'react-native';
import RootNavigator from './src/navigation/RootNavigator';
import AccountBadge from './src/components/AccountBadge';
import { supabase } from './src/services/supabaseClient';
import { useAppStore, BrandSettings, DEFAULT_BRAND_SETTINGS } from './src/store/appStore';
import { COLORS, SPACING, RADIUS } from './src/utils/theme';
import {
  loadInstagramCredentials,
  loadInstagramCredentials2,
} from './src/utils/instagram';
import { getInsightsSummary } from './src/services/insightsService';
import { loadBrandSettingsFromDb, saveBrandSettingsToDb } from './src/services/brandSettingsService';
import { analyzeBrandFromPosts } from './src/services/aiService';
import axios from 'axios';

const queryClient = new QueryClient();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

function saveCredential(key: string, value: string) {
  if (Platform.OS === 'web') localStorage.setItem(key, value);
}

/** 連携後にブランド設定を自動分析してモーダルを出す */
async function fetchCaptionsFromInstagram(accessToken: string): Promise<string[]> {
  // まずinsightsエンドポイントを試し、失敗したら直接Graph APIにフォールバック
  try {
    const insights = await getInsightsSummary(accessToken, 20);
    const captions = insights.media.map((m) => m.caption ?? '').filter((c) => c.trim().length > 0);
    if (captions.length > 0) return captions;
  } catch {
    // ビジネスアカウント以外では失敗するため無視
  }
  // フォールバック: 基本メディアAPIで取得
  const res = await axios.get(
    `https://graph.instagram.com/me/media?fields=caption&limit=20&access_token=${accessToken}`
  );
  const items: Array<{ caption?: string }> = res.data?.data ?? [];
  return items.map((m) => m.caption ?? '').filter((c) => c.trim().length > 0);
}

async function runBrandAnalysis(
  accessToken: string,
  username: string,
  slot: 1 | 2,
  setBrandConfirmModal: (v: { slot: 1 | 2; draft: BrandSettings } | null) => void
) {
  try {
    const captions = await fetchCaptionsFromInstagram(accessToken);
    if (captions.length === 0) return;
    const suggested = await analyzeBrandFromPosts(captions, username);
    setBrandConfirmModal({
      slot,
      draft: {
        ...DEFAULT_BRAND_SETTINGS,
        brandName: suggested.brandName ?? '',
        industry: suggested.industry ?? '',
        atmosphere: suggested.atmosphere ?? '',
        targetAudience: suggested.targetAudience ?? '',
        tone: suggested.tone ?? '明るい・ポジティブ',
      },
    });
  } catch (e) {
    console.warn('[BrandAnalysis] failed:', e);
  }
}

/** ブランド設定確認モーダル */
function BrandConfirmModal() {
  const brandConfirmModal = useAppStore((s) => s.brandConfirmModal);
  const setBrandConfirmModal = useAppStore((s) => s.setBrandConfirmModal);
  const setBrandSettings = useAppStore((s) => s.setBrandSettings);
  const setBrandSettings2 = useAppStore((s) => s.setBrandSettings2);

  const [draft, setDraft] = useState<BrandSettings | null>(null);

  useEffect(() => {
    if (brandConfirmModal) setDraft({ ...brandConfirmModal.draft });
  }, [brandConfirmModal]);

  if (!brandConfirmModal || !draft) return null;

  const handleConfirm = () => {
    const SK = brandConfirmModal.slot === 2 ? 'brand_settings_v2' : 'brand_settings_v1';
    if (Platform.OS === 'web') localStorage.setItem(SK, JSON.stringify(draft));
    if (brandConfirmModal.slot === 2) setBrandSettings2(draft);
    else setBrandSettings(draft);
    saveBrandSettingsToDb(draft, brandConfirmModal.slot).catch(() => {});
    setBrandConfirmModal(null);
    Alert.alert('ブランド設定を保存しました ✅', 'プロフィール画面からいつでも編集できます');
  };

  const Field = ({ label, value, onChange, multiline }: {
    label: string; value: string; onChange: (v: string) => void; multiline?: boolean;
  }) => (
    <View style={ms.field}>
      <Text style={ms.fieldLabel}>{label}</Text>
      <TextInput
        style={[ms.input, multiline && { height: 64, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        placeholderTextColor={COLORS.textMuted}
      />
    </View>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <View style={ms.container}>
        <View style={ms.header}>
          <Text style={ms.title}>ブランド設定の確認</Text>
          <Text style={ms.subtitle}>
            投稿を分析して自動生成しました。内容を確認・修正してください。
          </Text>
        </View>
        <ScrollView style={ms.body} keyboardShouldPersistTaps="handled">
          <Field label="ブランド名・屋号" value={draft.brandName}
            onChange={(v) => setDraft((p) => p && ({ ...p, brandName: v }))} />
          <Field label="業種・ジャンル" value={draft.industry}
            onChange={(v) => setDraft((p) => p && ({ ...p, industry: v }))} />
          <Field label="雰囲気・こだわり" value={draft.atmosphere}
            onChange={(v) => setDraft((p) => p && ({ ...p, atmosphere: v }))} multiline />
          <Field label="ターゲット層" value={draft.targetAudience}
            onChange={(v) => setDraft((p) => p && ({ ...p, targetAudience: v }))} />
          <Field label="トーン" value={draft.tone}
            onChange={(v) => setDraft((p) => p && ({ ...p, tone: v }))} />

          <View style={ms.note}>
            <Text style={ms.noteText}>
              💡 この設定はAIが投稿内容から推測したものです。正確でない場合は修正してください。
            </Text>
          </View>
        </ScrollView>
        <View style={ms.footer}>
          <TouchableOpacity style={ms.skipBtn} onPress={() => setBrandConfirmModal(null)}>
            <Text style={ms.skipText}>スキップ</Text>
          </TouchableOpacity>
          <TouchableOpacity style={ms.confirmBtn} onPress={handleConfirm}>
            <Text style={ms.confirmText}>この内容で保存</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function OAuthHandler() {
  const setInstagramCredentials = useAppStore((s) => s.setInstagramCredentials);
  const setSecondInstagramCredentials = useAppStore((s) => s.setSecondInstagramCredentials);
  const setActiveAccountSlot = useAppStore((s) => s.setActiveAccountSlot);
  const setBrandConfirmModal = useAppStore((s) => s.setBrandConfirmModal);
  const setBrandSettings = useAppStore((s) => s.setBrandSettings);
  const setBrandSettings2 = useAppStore((s) => s.setBrandSettings2);

  // アプリ起動時に保存済みのInstagram連携情報・ブランド設定・アクティブスロットを読み込む
  useEffect(() => {
    loadInstagramCredentials().then((creds) => {
      if (creds) setInstagramCredentials(creds);
    });
    loadInstagramCredentials2().then((creds) => {
      if (creds) setSecondInstagramCredentials(creds);
    });
    if (Platform.OS === 'web') {
      const saved = localStorage.getItem('active_account_slot');
      if (saved === '2') setActiveAccountSlot(2);
    }
    // Supabaseからブランド設定を読み込み（デバイス間同期）
    Promise.all([
      loadBrandSettingsFromDb(1).catch(() => null),
      loadBrandSettingsFromDb(2).catch(() => null),
    ]).then(([b1, b2]) => {
      if (b1) setBrandSettings(b1);
      else if (Platform.OS === 'web') {
        try {
          const raw = localStorage.getItem('brand_settings_v1');
          if (raw) setBrandSettings(JSON.parse(raw) as BrandSettings);
        } catch {}
      }
      if (b2) setBrandSettings2(b2);
      else if (Platform.OS === 'web') {
        try {
          const raw = localStorage.getItem('brand_settings_v2');
          if (raw) setBrandSettings2(JSON.parse(raw) as BrandSettings);
        } catch {}
      }
    });
  }, [setInstagramCredentials, setSecondInstagramCredentials, setActiveAccountSlot, setBrandSettings, setBrandSettings2]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;

    const state = params.get('state') ?? '';
    const slot: 1 | 2 = state === 'slot2' ? 2 : 1;

    window.history.replaceState({}, '', window.location.pathname);

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

        Alert.alert('連携完了 ✅', `@${username} でログインしました\n投稿を分析してブランド設定を自動生成しています...`);
        // 連携後にブランド設定を自動分析
        await runBrandAnalysis(access_token, username, slot, setBrandConfirmModal);
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
      <AccountBadge />
      <BrandConfirmModal />
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

const ms = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: { color: COLORS.text, fontSize: 20, fontWeight: '800', marginBottom: SPACING.sm },
  subtitle: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  body: { flex: 1, paddingHorizontal: SPACING.lg },
  field: { marginTop: SPACING.md },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.text,
    fontSize: 15,
  },
  note: {
    backgroundColor: COLORS.secondary + '18',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.lg,
    marginBottom: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.secondary + '33',
  },
  noteText: { color: COLORS.secondary, fontSize: 13, lineHeight: 20 },
  footer: {
    flexDirection: 'row',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  skipBtn: {
    flex: 1,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  skipText: { color: COLORS.textMuted, fontSize: 15, fontWeight: '600' },
  confirmBtn: {
    flex: 2,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

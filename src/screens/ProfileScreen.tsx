import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Dimensions,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
  Linking,
  Switch,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore, InstagramCredentials, BrandSettings, DEFAULT_BRAND_SETTINGS } from '../store/appStore';
import { INDUSTRIES, analyzeBrandFromPosts } from '../services/aiService';
import { getInsightsSummary } from '../services/insightsService';
import axios from 'axios';
import { loadBrandSettingsFromDb, saveBrandSettingsToDb, brandLocalKey } from '../services/brandSettingsService';
import { supabase } from '../services/supabaseClient';
import { getMyPlan } from '../services/scheduleService';
import { ensureLoggedIn } from '../utils/requireLogin';
import { createCheckoutUrl } from '../services/billingService';
import { PLANS, Plan, PLAN_RANK, canAnalytics, maxInstagramAccounts } from '../utils/plans';
import { JP_PREFECTURES, JP_PREFECTURES_CITIES } from '../utils/jpLocations';
import { registerPush, unregisterPush, isPushSupported, isPushEnabled } from '../services/pushService';
import {
  connectInstagram,
  clearInstagramStorage,
  clearInstagramStorage2,
  clearInstagramStorage3,
  SK_USER_ID, SK_TOKEN, SK_USERNAME, SK_PICTURE,
  SK_USER_ID_2, SK_TOKEN_2, SK_USERNAME_2, SK_PICTURE_2,
  SK_USER_ID_3, SK_TOKEN_3, SK_USERNAME_3, SK_PICTURE_3,
} from '../utils/instagram';

const SK_BRAND_1 = 'brand_settings_v1';
const SK_BRAND_2 = 'brand_settings_v2';
const SK_BRAND_3 = 'brand_settings_v3';

async function save(key: string, value: string) {
  if (Platform.OS === 'web') localStorage.setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}

async function load(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function remove(key: string) {
  if (Platform.OS === 'web') localStorage.removeItem(key);
  else await SecureStore.deleteItemAsync(key);
}

const TONES = ['明るい・ポジティブ', 'プロフェッショナル', 'カジュアル', '感情的・共感', 'ユーモラス'];

const SCREEN_WIDTH = Dimensions.get('window').width;

function SlideScreen({ visible, onBack, title, children }: {
  visible: boolean;
  onBack: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const translateX = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(translateX, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(translateX, {
        toValue: SCREEN_WIDTH,
        duration: 250,
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
  }, [visible]);

  if (!mounted) return null;

  return (
    <Animated.View style={[slideStyles.container, { transform: [{ translateX }] }]}>
      <View style={slideStyles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={slideStyles.back}>‹ 戻る</Text>
        </TouchableOpacity>
        <Text style={slideStyles.title}>{title}</Text>
        <View style={{ width: 60 }} />
      </View>
      {children}
    </Animated.View>
  );
}

const slideStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.background,
    zIndex: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  back: { color: COLORS.primary, fontSize: 17, fontWeight: '700' },
  title: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
});

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const {
    instagramCredentials, setInstagramCredentials,
    secondInstagramCredentials, setSecondInstagramCredentials,
    thirdInstagramCredentials, setThirdInstagramCredentials,
    activeAccountSlot, setActiveAccountSlot,
    brandSettings, setBrandSettings, resetBrandSettings,
    brandSettings2, setBrandSettings2, resetBrandSettings2,
    brandSettings3, setBrandSettings3, resetBrandSettings3,
    setLoginPromptVisible,
  } = useAppStore();

  const activeBrandSettings = activeAccountSlot === 3 ? brandSettings3 : activeAccountSlot === 2 ? brandSettings2 : brandSettings;
  const setActiveBrandSettings = activeAccountSlot === 3 ? setBrandSettings3 : activeAccountSlot === 2 ? setBrandSettings2 : setBrandSettings;
  const resetActiveBrandSettings = activeAccountSlot === 3 ? resetBrandSettings3 : activeAccountSlot === 2 ? resetBrandSettings2 : resetBrandSettings;
  const SK_BRAND = activeAccountSlot === 3 ? SK_BRAND_3 : activeAccountSlot === 2 ? SK_BRAND_2 : SK_BRAND_1;

  const [brandModalVisible, setBrandModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<Plan>('free');
  const [upgrading, setUpgrading] = useState(false);

  // Brand form
  const [draftBrand, setDraftBrand] = useState<BrandSettings>({ ...activeBrandSettings });
  const [locationPicker, setLocationPicker] = useState<'pref' | 'city' | null>(null);
  const [locationSearch, setLocationSearch] = useState('');
  const draftPref = JP_PREFECTURES.find((p) => draftBrand.location.startsWith(p)) ?? '';
  const draftCity = draftPref ? draftBrand.location.slice(draftPref.length) : '';

  useEffect(() => {
    getMyPlan().then(setCurrentPlan).catch(() => {});
  }, []);

  // 決済から戻ってきたとき（?upgrade=success）の処理
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const params = new URLSearchParams(window.location.search);
    const u = params.get('upgrade');
    if (u === 'success') {
      window.alert('🎉 Proへのアップグレードが完了しました！反映に少し時間がかかる場合があります。');
      setTimeout(() => getMyPlan().then(setCurrentPlan).catch(() => {}), 1500);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (u === 'cancel') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // アップグレード（Stripe Checkoutへ遷移）。target で 'pro' / 'business' を指定
  const handleUpgrade = async (target: 'pro' | 'business') => {
    if (upgrading) return;
    setUpgrading(true);
    try {
      const url = await createCheckoutUrl(target);
      if (Platform.OS === 'web') window.location.href = url;
      else await Linking.openURL(url);
    } catch (e) {
      const msg = (e as { message?: string })?.message || '決済を開始できませんでした';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('エラー', msg);
      setUpgrading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const savedUserId = await load(SK_USER_ID);
      const savedToken = await load(SK_TOKEN);
      const savedUsername = await load(SK_USERNAME);
      const savedPicture = await load(SK_PICTURE);
      if (savedUserId && savedToken) {
        setInstagramCredentials({
          userId: savedUserId,
          accessToken: savedToken,
          username: savedUsername ?? undefined,
          profilePictureUrl: savedPicture ?? undefined,
        });
      }

      const savedUserId2 = await load(SK_USER_ID_2);
      const savedToken2 = await load(SK_TOKEN_2);
      const savedUsername2 = await load(SK_USERNAME_2);
      const savedPicture2 = await load(SK_PICTURE_2);
      if (savedUserId2 && savedToken2) {
        setSecondInstagramCredentials({
          userId: savedUserId2,
          accessToken: savedToken2,
          username: savedUsername2 ?? undefined,
          profilePictureUrl: savedPicture2 ?? undefined,
        });
      }

      const savedUserId3 = await load(SK_USER_ID_3);
      const savedToken3 = await load(SK_TOKEN_3);
      const savedUsername3 = await load(SK_USERNAME_3);
      const savedPicture3 = await load(SK_PICTURE_3);
      if (savedUserId3 && savedToken3) {
        setThirdInstagramCredentials({
          userId: savedUserId3,
          accessToken: savedToken3,
          username: savedUsername3 ?? undefined,
          profilePictureUrl: savedPicture3 ?? undefined,
        });
      }

      // ブランド設定はInstagramアカウント(userId)単位で読み込む。
      // DB→ローカルの順でフォールバック。未連携のスロットは読み込まない。
      const loadBrandFor = async (igUserId: string | null): Promise<BrandSettings | null> => {
        if (!igUserId) return null;
        const db = await loadBrandSettingsFromDb(igUserId).catch(() => null);
        if (db) return db;
        const raw = await load(brandLocalKey(igUserId));
        if (raw) { try { return JSON.parse(raw) as BrandSettings; } catch {} }
        return null;
      };
      const [b1, b2, b3] = await Promise.all([
        loadBrandFor(savedUserId),
        loadBrandFor(savedUserId2),
        loadBrandFor(savedUserId3),
      ]);
      if (b1) {
        setBrandSettings(b1);
        if (savedUserId && Platform.OS === 'web') localStorage.setItem(brandLocalKey(savedUserId), JSON.stringify(b1));
      }
      if (b2) {
        setBrandSettings2(b2);
        if (savedUserId2 && Platform.OS === 'web') localStorage.setItem(brandLocalKey(savedUserId2), JSON.stringify(b2));
      }
      if (b3) {
        setBrandSettings3(b3);
        if (savedUserId3 && Platform.OS === 'web') localStorage.setItem(brandLocalKey(savedUserId3), JSON.stringify(b3));
      }
    })();
  }, []);

  // window.open()はタップの同期処理内で呼ばないとポップアップブロックされるため、
  // 未ログイン確認のawaitを挟まず、既知のloggedIn状態で同期的に判定してから開く
  const handleInstagramLogin = () => {
    if (!loggedIn) { ensureLoggedIn('Instagram連携にはログインが必要です'); return; }
    connectInstagram(1);
  };
  // 2つ目・3つ目のアカウント連携は、フリープランでは使えない（連携数の上限チェック）
  const requireMultiAccountPlan = (): boolean => {
    if (maxInstagramAccounts(currentPlan) >= 2) return true;
    Alert.alert(
      '複数アカウント連携はPro以上の機能です',
      '2つ目以降のInstagramアカウントを連携するには、Pro（¥1,980/月）以上のプランへのアップグレードが必要です。'
    );
    return false;
  };
  const handleInstagramLogin2 = () => {
    if (!loggedIn) { ensureLoggedIn('Instagram連携にはログインが必要です'); return; }
    if (!requireMultiAccountPlan()) return;
    connectInstagram(2);
  };
  const handleInstagramLogin3 = () => {
    if (!loggedIn) { ensureLoggedIn('Instagram連携にはログインが必要です'); return; }
    if (!requireMultiAccountPlan()) return;
    connectInstagram(3);
  };

  const doDisconnect = async () => {
    await clearInstagramStorage();
    setInstagramCredentials(null);
    // 連携解除したら、このスロットのブランド設定（メモリ上）も初期化して混ざらないようにする
    resetBrandSettings();
  };

  const doDisconnect2 = async () => {
    await clearInstagramStorage2();
    setSecondInstagramCredentials(null);
    resetBrandSettings2();
  };

  const doDisconnect3 = async () => {
    await clearInstagramStorage3();
    setThirdInstagramCredentials(null);
    resetBrandSettings3();
  };

  const handleDisconnect = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Instagramアカウントの連携を解除しますか？')) {
        doDisconnect();
      }
      return;
    }
    Alert.alert('連携解除', 'Instagramアカウントの連携を解除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '解除', style: 'destructive', onPress: doDisconnect },
    ]);
  };

  const handleDisconnect2 = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('2つ目のInstagramアカウントの連携を解除しますか？')) {
        doDisconnect2();
      }
      return;
    }
    Alert.alert('連携解除', '2つ目のInstagramアカウントの連携を解除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '解除', style: 'destructive', onPress: doDisconnect2 },
    ]);
  };

  const handleDisconnect3 = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('3つ目のInstagramアカウントの連携を解除しますか？')) {
        doDisconnect3();
      }
      return;
    }
    Alert.alert('連携解除', '3つ目のInstagramアカウントの連携を解除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '解除', style: 'destructive', onPress: doDisconnect3 },
    ]);
  };

  const activeCredentials = activeAccountSlot === 3 ? thirdInstagramCredentials : activeAccountSlot === 2 ? secondInstagramCredentials : instagramCredentials;

  const openBrandModal = () => {
    if (!activeCredentials) {
      const promptConnect = () =>
        activeAccountSlot === 3 ? handleInstagramLogin3() : activeAccountSlot === 2 ? handleInstagramLogin2() : handleInstagramLogin();
      if (Platform.OS === 'web') {
        if (window.confirm('ブランド設定にはInstagram連携が必要です。連携画面を開きますか？')) promptConnect();
        return;
      }
      Alert.alert('Instagram連携が必要です', 'ブランド設定を行うには、先にInstagramアカウントを連携してください。', [
        { text: 'キャンセル', style: 'cancel' },
        { text: '連携する', onPress: promptConnect },
      ]);
      return;
    }
    setDraftBrand({ ...activeBrandSettings });
    setBrandModalVisible(true);
  };

  // Instagram投稿のキャプションを取得（インサイト→基本メディアの順でフォールバック）
  const fetchCaptions = async (token: string): Promise<string[]> => {
    try {
      const insights = await getInsightsSummary(token, 20);
      const caps = insights.media.map((m) => m.caption ?? '').filter((c) => c.trim().length > 0);
      if (caps.length > 0) return caps;
    } catch {
      // ビジネスアカウント以外では失敗するため無視
    }
    const res = await axios.get(
      `https://graph.instagram.com/me/media?fields=caption&limit=20&access_token=${token}`
    );
    const items: Array<{ caption?: string }> = res.data?.data ?? [];
    return items.map((m) => m.caption ?? '').filter((c) => c.trim().length > 0);
  };

  // 投稿が無い場合のフォールバック：プロフィールの自己紹介文・名前を取得する
  const fetchProfileText = async (token: string): Promise<string> => {
    try {
      const res = await axios.get(
        `https://graph.instagram.com/me?fields=name,username,biography&access_token=${token}`
      );
      const { name, username, biography } = res.data ?? {};
      return [name, username, biography].filter((v: string) => v && v.trim()).join(' / ');
    } catch {
      return '';
    }
  };

  // 連携済みアカウントの投稿を分析してブランド設定を自動生成する
  const handleAutoBrand = async () => {
    if (!activeCredentials?.accessToken) {
      Alert.alert('Instagram未連携', '先にこのアカウントでInstagramを連携してください');
      return;
    }
    setSaving(true);
    try {
      let captions = await fetchCaptions(activeCredentials.accessToken);
      // 投稿が無い場合：プロフィール情報→手入力の順でフォールバック
      if (captions.length === 0) {
        const profileText = await fetchProfileText(activeCredentials.accessToken);
        if (profileText.trim()) captions = [profileText];
      }
      if (captions.length === 0 && Platform.OS === 'web') {
        const desc = window.prompt(
          '投稿がまだ無いようです。お店・アカウントの内容を一言で入力してください（例：渋谷のまつ毛エクステサロン、30代向け）'
        );
        if (desc && desc.trim()) captions = [desc.trim()];
      }
      if (captions.length === 0) {
        Alert.alert(
          '分析できる情報がありません',
          '投稿・プロフィール情報が見つかりませんでした。ブランド設定は手動で入力してください。'
        );
        return;
      }
      const s = await analyzeBrandFromPosts(captions, activeCredentials.username);
      setDraftBrand((p) => ({
        ...p,
        brandName: s.brandName || p.brandName,
        industry: s.industry || p.industry,
        atmosphere: s.atmosphere || p.atmosphere,
        targetAudience: s.targetAudience || p.targetAudience,
        tone: s.tone || p.tone,
      }));
      Alert.alert('自動生成しました ✨', '内容を確認して「保存」を押してください');
    } catch {
      Alert.alert('エラー', 'ブランドの自動生成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBrand = async () => {
    const igUserId = activeCredentials?.userId ?? '';
    if (!igUserId) {
      Alert.alert('Instagram未連携', 'ブランド設定を保存するには、先にこのアカウントでInstagramを連携してください');
      return;
    }
    setSaving(true);
    try {
      setActiveBrandSettings(draftBrand);
      // ローカルとSupabase両方に、Instagramアカウント単位で保存（デバイス間同期）
      await save(brandLocalKey(igUserId), JSON.stringify(draftBrand));
      await saveBrandSettingsToDb(draftBrand, igUserId).catch(() => {});
      setBrandModalVisible(false);
      Alert.alert('保存しました ✅', 'ブランド設定を更新しました');
    } catch {
      Alert.alert('エラー', '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 表示中アカウントのブランド設定をすべて初期状態に戻す（ローカル・Supabaseの保存データも削除）
  const doResetBrand = async () => {
    const igUserId = activeCredentials?.userId ?? '';
    setSaving(true);
    try {
      resetActiveBrandSettings();
      setDraftBrand({ ...DEFAULT_BRAND_SETTINGS });
      if (igUserId) await remove(brandLocalKey(igUserId));
      // Supabaseも初期値で上書きしておく（次回読み込みで古い設定が復活しないように）
      await saveBrandSettingsToDb({ ...DEFAULT_BRAND_SETTINGS }, igUserId).catch(() => {});
      setBrandModalVisible(false);
      if (Platform.OS === 'web') window.alert('ブランド設定をリセットしました');
      else Alert.alert('リセットしました ✅', 'ブランド設定を初期状態に戻しました');
    } catch {
      if (Platform.OS === 'web') window.alert('リセットに失敗しました');
      else Alert.alert('エラー', 'リセットに失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleResetBrand = () => {
    const msg = 'ブランド設定をすべて初期状態に戻します。よろしいですか？（保存した内容は消えます）';
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) doResetBrand();
      return;
    }
    Alert.alert('ブランド設定をリセット', msg, [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'リセット', style: 'destructive', onPress: doResetBrand },
    ]);
  };

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [notifVisible, setNotifVisible] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [accountMenu, setAccountMenu] = useState<1 | 2 | 3 | null>(null);

  useEffect(() => {
    isPushEnabled().then(setPushEnabled);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setLoggedIn(!!data.session);
      setAccountEmail(data.session?.user?.email ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session);
      setAccountEmail(session?.user?.email ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleTogglePush = useCallback(async (value: boolean) => {
    setPushLoading(true);
    try {
      if (value) {
        const ok = await registerPush();
        if (!ok) {
          Alert.alert('通知を許可してください', 'ブラウザの設定から通知を許可してください。');
        }
        setPushEnabled(ok);
      } else {
        await unregisterPush();
        setPushEnabled(false);
      }
    } finally {
      setPushLoading(false);
    }
  }, []);

  const doLogout = async () => {
    // アカウント自体をログアウトするときは、連携中のInstagramアカウントもすべて解除する
    await Promise.all([clearInstagramStorage(), clearInstagramStorage2()]);
    setInstagramCredentials(null);
    setSecondInstagramCredentials(null);
    resetBrandSettings();
    resetBrandSettings2();
    await supabase.auth.signOut();
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('ログアウトしますか？（連携中のInstagramアカウントも解除されます）')) {
        doLogout();
      }
      return;
    }
    Alert.alert('ログアウト', 'ログアウトしますか？（連携中のInstagramアカウントも解除されます）', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: 'ログアウト',
        style: 'destructive',
        onPress: doLogout,
      },
    ]);
  };

  const isConnected = !!instagramCredentials;
  const isConnected2 = !!secondInstagramCredentials;
  const isConnected3 = !!thirdInstagramCredentials;
  const hasBrandSetup = !!(activeBrandSettings.brandName || activeBrandSettings.industry);
  const industryInfo = INDUSTRIES.find((i) => i.key === activeBrandSettings.industry);

  return (
    <View style={styles.wrapper}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 100 }}
      >
        <Text style={styles.title}>プロフィール</Text>

        {/* アカウント情報 */}
        {loggedIn && (
          <View style={styles.accountInfoCard}>
            <View style={[styles.accountInfoRow, styles.accountInfoRowDivided]}>
              <Text style={styles.accountInfoLabel}>メールアドレス</Text>
              <Text style={styles.accountInfoValue} numberOfLines={1}>{accountEmail ?? '—'}</Text>
            </View>
            <View style={styles.accountInfoRow}>
              <Text style={styles.accountInfoLabel}>プラン</Text>
              <Text style={styles.accountInfoValue}>{PLANS.find((p) => p.id === currentPlan)?.name ?? 'フリー'}</Text>
            </View>
          </View>
        )}

        {/* Instagram account card（タップで切り替え/解除メニュー） */}
        <TouchableOpacity
          style={[
            styles.accountCard,
            isConnected && styles.accountCardConnected,
            isConnected && activeAccountSlot === 1 && styles.accountCardActive,
          ]}
          onPress={isConnected ? () => setAccountMenu(1) : undefined}
          activeOpacity={isConnected ? 0.7 : 1}
        >
          <View style={styles.avatar}>
            {isConnected && instagramCredentials.profilePictureUrl ? (
              <Image source={{ uri: instagramCredentials.profilePictureUrl }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>{isConnected ? '📷' : '👤'}</Text>
            )}
          </View>
          <View style={styles.accountInfo}>
            {isConnected ? (
              <>
                <Text style={styles.accountName}>
                  {instagramCredentials.username ? `@${instagramCredentials.username}` : 'Instagram連携済み'}
                </Text>
                <Text style={styles.accountSub}>ID: {instagramCredentials.userId}</Text>
              </>
            ) : (
              <>
                <Text style={styles.accountName}>未連携</Text>
                <Text style={styles.accountSub}>Instagramアカウントを連携してください</Text>
              </>
            )}
          </View>
          {isConnected ? (
            activeAccountSlot === 1 ? (
              <Text style={styles.activeLabel}>使用中</Text>
            ) : (
              <Text style={styles.brandArrow}>›</Text>
            )
          ) : (
            <TouchableOpacity style={styles.connectBtn} onPress={handleInstagramLogin}>
              <Text style={styles.connectBtnText}>連携する</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        {/* 2つ目のInstagramアカウントカード: 1つ目が連携済みのときだけ表示（+で追加） */}
        {isConnected && (
          <TouchableOpacity
            style={[
              styles.accountCard,
              isConnected2 && styles.accountCardConnected,
              isConnected2 && activeAccountSlot === 2 && styles.accountCardActive,
            ]}
            onPress={isConnected2 ? () => setAccountMenu(2) : handleInstagramLogin2}
            activeOpacity={0.7}
          >
            <View style={styles.avatar}>
              {isConnected2 && secondInstagramCredentials!.profilePictureUrl ? (
                <Image source={{ uri: secondInstagramCredentials!.profilePictureUrl }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarText}>{isConnected2 ? '📷' : '➕'}</Text>
              )}
            </View>
            <View style={styles.accountInfo}>
              {isConnected2 ? (
                <>
                  <Text style={styles.accountName}>
                    {secondInstagramCredentials!.username ? `@${secondInstagramCredentials!.username}` : 'Instagram連携済み'}
                  </Text>
                  <Text style={styles.accountSub}>ID: {secondInstagramCredentials!.userId}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.accountName}>2つ目のアカウントを追加</Text>
                  <Text style={styles.accountSub}>もう1つのInstagramアカウントを連携</Text>
                </>
              )}
            </View>
            {isConnected2 && (
              activeAccountSlot === 2 ? (
                <Text style={styles.activeLabel}>使用中</Text>
              ) : (
                <Text style={styles.brandArrow}>›</Text>
              )
            )}
          </TouchableOpacity>
        )}

        {/* 3つ目のInstagramアカウントカード: 2つ目が連携済みのときだけ表示（+で追加） */}
        {isConnected2 && (
          <TouchableOpacity
            style={[
              styles.accountCard,
              isConnected3 && styles.accountCardConnected,
              isConnected3 && activeAccountSlot === 3 && styles.accountCardActive,
            ]}
            onPress={isConnected3 ? () => setAccountMenu(3) : handleInstagramLogin3}
            activeOpacity={0.7}
          >
            <View style={styles.avatar}>
              {isConnected3 && thirdInstagramCredentials!.profilePictureUrl ? (
                <Image source={{ uri: thirdInstagramCredentials!.profilePictureUrl }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarText}>{isConnected3 ? '📷' : '➕'}</Text>
              )}
            </View>
            <View style={styles.accountInfo}>
              {isConnected3 ? (
                <>
                  <Text style={styles.accountName}>
                    {thirdInstagramCredentials!.username ? `@${thirdInstagramCredentials!.username}` : 'Instagram連携済み'}
                  </Text>
                  <Text style={styles.accountSub}>ID: {thirdInstagramCredentials!.userId}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.accountName}>3つ目のアカウントを追加</Text>
                  <Text style={styles.accountSub}>もう1つのInstagramアカウントを連携</Text>
                </>
              )}
            </View>
            {isConnected3 && (
              activeAccountSlot === 3 ? (
                <Text style={styles.activeLabel}>使用中</Text>
              ) : (
                <Text style={styles.brandArrow}>›</Text>
              )
            )}
          </TouchableOpacity>
        )}

        {/* Brand Settings Card */}
        <Text style={styles.sectionTitle}>
          ブランド設定
          {activeAccountSlot === 3 ? '（アカウント③）' : activeAccountSlot === 2 ? '（アカウント②）' : '（アカウント①）'}
        </Text>
        <TouchableOpacity style={styles.brandCard} onPress={openBrandModal} activeOpacity={0.8}>
          <View style={styles.brandInfo}>
            <Text style={styles.brandEmoji}>
              {industryInfo ? industryInfo.emoji : '🏪'}
            </Text>
            <View style={styles.brandText}>
              <Text style={styles.brandName} numberOfLines={1} ellipsizeMode="tail">
                {activeBrandSettings.brandName || 'ブランド名を設定'}
              </Text>
              <Text style={styles.brandSub} numberOfLines={1} ellipsizeMode="tail">
                {activeBrandSettings.industry || '業種を設定するとAI精度が向上します'}
              </Text>
            </View>
            <Text style={styles.brandArrow}>›</Text>
          </View>
          {hasBrandSetup && (
            <View style={styles.brandTags}>
              {activeBrandSettings.tone && (
                <View style={styles.brandTag}>
                  <Text style={styles.brandTagText} numberOfLines={1} ellipsizeMode="tail">{activeBrandSettings.tone}</Text>
                </View>
              )}
              {activeBrandSettings.targetAudience && (
                <View style={[styles.brandTag, { flexShrink: 1 }]}>
                  <Text style={styles.brandTagText} numberOfLines={1} ellipsizeMode="tail">{activeBrandSettings.targetAudience}</Text>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>

        {/* Plan */}
        <Text style={styles.sectionTitle}>プラン</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.plansRow}>
          {PLANS.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            return (
            <View key={plan.id} style={[styles.planCard, isCurrent && styles.planCardCurrent, { borderColor: plan.color + '44' }]}>
              {isCurrent && <View style={[styles.planCurrentBadge, { backgroundColor: plan.color }]}>
                <Text style={styles.planCurrentBadgeText}>現在のプラン</Text>
              </View>}
              <Text style={[styles.planName, { color: plan.color }]}>{plan.name}</Text>
              <Text style={styles.planPrice}>{plan.price}</Text>
              {plan.features.map((f) => (
                <Text key={f} style={styles.planFeature}>✓ {f}</Text>
              ))}
              {plan.paid && PLAN_RANK[plan.id] > PLAN_RANK[currentPlan] && (
                <TouchableOpacity
                  style={[styles.planUpgradeBtn, { backgroundColor: plan.color }, upgrading && { opacity: 0.6 }]}
                  onPress={() => handleUpgrade(plan.id as 'pro' | 'business')}
                  disabled={upgrading}
                >
                  {upgrading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.planUpgradeBtnText}>アップグレード</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
            );
          })}
        </ScrollView>

        {/* Help */}
        <Text style={styles.sectionTitle}>ヘルプ</Text>
        {[
          { label: 'AIの使い方ガイド', emoji: '📖', action: () => Alert.alert('ガイド', 'AI生成タブで写真を選択するか、テーマを入力してAIに投稿を生成させましょう。業種を設定するとより精度が上がります。') },
          { label: 'ハッシュタグについて', emoji: '#️⃣', action: () => Alert.alert('ハッシュタグ', '日本のInstagramではハッシュタグ検索がグローバル平均の3倍！15〜20個のタグを使い、人気タグとニッチタグをバランスよく組み合わせましょう。') },
          { label: '最適な投稿時間', emoji: '⏰', action: () => Alert.alert('投稿時間', '平日: 12〜13時 / 18〜21時\n休日: 11〜13時 / 19〜21時\n\nこの時間帯は日本のInstagramユーザーのアクティブ率が最も高くなります。') },
          { label: 'お問い合わせ', emoji: '💬', action: () => Alert.alert('お問い合わせ', 'support@aimark.jp までご連絡ください') },
          { label: 'プライバシーポリシー', emoji: '🔒', action: () => { if (Platform.OS === 'web') { window.open('/privacy', '_blank'); } else { Alert.alert('プライバシーポリシー', 'https://instagram-api-alpha.vercel.app/privacy'); } } },
        ].map((item) => (
          <TouchableOpacity key={item.label} style={styles.helpRow} onPress={item.action} activeOpacity={0.7}>
            <Text style={styles.helpEmoji}>{item.emoji}</Text>
            <Text style={styles.helpLabel}>{item.label}</Text>
            <Text style={styles.helpArrow}>›</Text>
          </TouchableOpacity>
        ))}

        {/* 設定セクション */}
        <Text style={styles.sectionTitle}>設定</Text>
        <TouchableOpacity style={styles.helpRow} onPress={() => setSettingsVisible(true)} activeOpacity={0.7}>
          <Text style={styles.helpEmoji}>⚙️</Text>
          <Text style={styles.helpLabel}>設定</Text>
          <Text style={styles.helpArrow}>›</Text>
        </TouchableOpacity>

        {loggedIn ? (
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Text style={styles.logoutBtnText}>ログアウト</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.loginBtn}
            onPress={() => setLoginPromptVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.loginBtnText}>ログイン / 新規登録</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.version}>AImark v1.0.0 — 日本の個人事業主向け</Text>
      </ScrollView>

      {/* 設定画面（右スライド） */}
      <SlideScreen visible={settingsVisible} onBack={() => setSettingsVisible(false)} title="設定">
        <ScrollView>
          <Text style={[styles.sectionTitle, { marginTop: SPACING.md }]}>設定項目</Text>
          <TouchableOpacity style={styles.helpRow} onPress={() => setNotifVisible(true)} activeOpacity={0.7}>
            <Text style={styles.helpEmoji}>🔔</Text>
            <Text style={styles.helpLabel}>通知</Text>
            <Text style={styles.helpArrow}>›</Text>
          </TouchableOpacity>
        </ScrollView>
      </SlideScreen>

      {/* 通知設定画面（右スライド） */}
      <SlideScreen visible={notifVisible} onBack={() => setNotifVisible(false)} title="通知">
        <ScrollView contentContainerStyle={{ padding: SPACING.md }}>
          {isPushSupported() ? (
            <View style={styles.notifRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.notifLabel}>プッシュ通知</Text>
                <Text style={styles.notifDesc}>予約投稿の完了・失敗を通知します</Text>
              </View>
              {pushLoading ? (
                <ActivityIndicator color={COLORS.primary} />
              ) : (
                <Switch
                  value={pushEnabled}
                  onValueChange={handleTogglePush}
                  trackColor={{ false: COLORS.border, true: COLORS.primary }}
                  thumbColor="#fff"
                />
              )}
            </View>
          ) : (
            <View style={styles.notifRow}>
              <Text style={styles.notifDesc}>このブラウザはプッシュ通知に対応していません</Text>
            </View>
          )}
        </ScrollView>
      </SlideScreen>

            {/* Brand Settings Modal */}
      <Modal visible={brandModalVisible} animationType="slide" presentationStyle="pageSheet">
        <ScrollView style={styles.modal} keyboardShouldPersistTaps="handled">
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setBrandModalVisible(false)}>
              <Text style={styles.modalCancel}>キャンセル</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>ブランド設定</Text>
            <TouchableOpacity onPress={handleSaveBrand} disabled={saving}>
              {saving ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.modalSave}>保存</Text>}
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <Text style={styles.fieldLabel}>ブランド名・店舗名</Text>
            <TextInput
              style={styles.input}
              value={draftBrand.brandName}
              onChangeText={(v) => setDraftBrand((p) => ({ ...p, brandName: v }))}
              placeholder="例: My Shop、田中ネイルサロン"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={styles.fieldLabel}>業種・ジャンル</Text>
            <TextInput
              style={styles.input}
              value={draftBrand.industry}
              onChangeText={(v) => setDraftBrand((p) => ({ ...p, industry: v }))}
              placeholder="例: 美容・ネイル、飲食・カフェ、クラフトビール専門店 など"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={styles.fieldLabel}>お店の雰囲気・こだわり（任意）</Text>
            <TextInput
              style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
              value={draftBrand.atmosphere}
              onChangeText={(v) => setDraftBrand((p) => ({ ...p, atmosphere: v }))}
              placeholder="例: ジャズが流れる落ち着いた大人の隠れ家バー／賑やかでカジュアルな立ち飲み"
              placeholderTextColor={COLORS.textMuted}
              multiline
            />

            <Text style={styles.fieldLabel}>ターゲット層（任意）</Text>
            <TextInput
              style={styles.input}
              value={draftBrand.targetAudience}
              onChangeText={(v) => setDraftBrand((p) => ({ ...p, targetAudience: v }))}
              placeholder="例: 30代女性、子育て中のママ、20代ファッション好き"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={styles.fieldLabel}>所在地（任意・地域SEO対策に使用）</Text>
            <View style={styles.locationRow}>
              <TouchableOpacity
                style={styles.locationSelectBtn}
                onPress={() => { setLocationSearch(''); setLocationPicker('pref'); }}
              >
                <Text style={[styles.locationSelectText, !draftPref && styles.locationSelectPlaceholder]}>
                  {draftPref || '都道府県を選択'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locationSelectBtn, !draftPref && styles.locationSelectBtnDisabled]}
                disabled={!draftPref}
                onPress={() => { setLocationSearch(''); setLocationPicker('city'); }}
              >
                <Text style={[styles.locationSelectText, !draftCity && styles.locationSelectPlaceholder]}>
                  {draftCity || '市区町村を選択'}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>デフォルトトーン</Text>
            <View style={styles.toneGrid}>
              {TONES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.toneBtn, draftBrand.tone === t && styles.toneBtnActive]}
                  onPress={() => setDraftBrand((p) => ({ ...p, tone: t }))}
                >
                  <Text style={[styles.toneBtnText, draftBrand.tone === t && styles.toneBtnTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>
              過去の人気投稿を反映 {!canAnalytics(currentPlan) && '⭐ビジネス'}
            </Text>
            <View style={styles.insightToggleRow}>
              <View style={styles.insightToggleTextWrap}>
                <Text style={styles.insightToggleTitle}>反応が良かった投稿の傾向をAIに反映</Text>
                <Text style={styles.insightToggleDesc}>
                  ONにすると、テーマや写真からの生成時に、連携アカウントのいいね数が多い投稿の傾向を自動で分析して文章に反映します。
                </Text>
              </View>
              <Switch
                value={draftBrand.useTopPostsInsight}
                disabled={!canAnalytics(currentPlan)}
                onValueChange={(v) => setDraftBrand((p) => ({ ...p, useTopPostsInsight: v }))}
                trackColor={{ true: COLORS.primary, false: COLORS.border }}
              />
            </View>
            {!canAnalytics(currentPlan) && (
              <Text style={styles.insightToggleLocked}>
                この機能はビジネスプラン限定です。
              </Text>
            )}

            <View style={styles.brandTip}>
              <Text style={styles.brandTipText}>
                💡 ブランド設定を入力するとAIが自動的に業種やブランドに合わせた投稿を生成します
              </Text>
            </View>

            <TouchableOpacity
              style={styles.autoBrandBtn}
              onPress={handleAutoBrand}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={styles.autoBrandText}>
                {saving ? '生成中...' : '✨ AIで投稿を分析して自動入力'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.resetBrandHint}>
              ※ 連携中のInstagram投稿をAIが分析し、上の項目を自動入力します
            </Text>

            <TouchableOpacity
              style={styles.resetBrandBtn}
              onPress={handleResetBrand}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={styles.resetBrandText}>🗑 ブランド設定をリセット</Text>
            </TouchableOpacity>
            <Text style={styles.resetBrandHint}>
              ※ すべての項目を初期状態に戻します（この端末の保存データも削除されます）
            </Text>
          </View>
        </ScrollView>
      </Modal>

      {/* 所在地選択（都道府県／市区町村） */}
      <Modal visible={locationPicker !== null} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setLocationPicker(null)}>
              <Text style={styles.modalCancel}>閉じる</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{locationPicker === 'pref' ? '都道府県を選択' : '市区町村を選択'}</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={styles.modalBody}>
            <TextInput
              style={styles.input}
              value={locationSearch}
              onChangeText={setLocationSearch}
              placeholder="検索"
              placeholderTextColor={COLORS.textMuted}
            />
          </View>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {(locationPicker === 'pref' ? JP_PREFECTURES : JP_PREFECTURES_CITIES[draftPref] ?? [])
              .filter((item) => item.includes(locationSearch.trim()))
              .map((item) => (
                <TouchableOpacity
                  key={item}
                  style={styles.locationOptionRow}
                  onPress={() => {
                    if (locationPicker === 'pref') {
                      setDraftBrand((p) => ({ ...p, location: item }));
                      setLocationSearch('');
                      setLocationPicker('city');
                    } else {
                      setDraftBrand((p) => ({ ...p, location: draftPref + item }));
                      setLocationPicker(null);
                    }
                  }}
                >
                  <Text style={styles.locationOptionText}>{item}</Text>
                </TouchableOpacity>
              ))}
          </ScrollView>
        </View>
      </Modal>

      {/* アカウント切り替え/解除メニュー（Google風） */}
      <Modal visible={accountMenu !== null} transparent animationType="fade" onRequestClose={() => setAccountMenu(null)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setAccountMenu(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.menuSheet} onPress={(e) => e.stopPropagation?.()}>
            {(() => {
              const slot = accountMenu;
              if (!slot) return null;
              const creds = slot === 3 ? thirdInstagramCredentials : slot === 2 ? secondInstagramCredentials : instagramCredentials;
              const isActive = activeAccountSlot === slot;
              return (
                <>
                  <Text style={styles.menuTitle}>
                    {creds?.username ? `@${creds.username}` : `アカウント${slot}`}
                  </Text>
                  {!isActive && (
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => { setActiveAccountSlot(slot); setAccountMenu(null); }}
                    >
                      <Text style={styles.menuItemText}>✅ このアカウントに切り替える</Text>
                    </TouchableOpacity>
                  )}
                  {isActive && (
                    <Text style={styles.menuActiveNote}>使用中のアカウントです</Text>
                  )}
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => {
                      setAccountMenu(null);
                      if (slot === 3) handleDisconnect3();
                      else if (slot === 2) handleDisconnect2();
                      else handleDisconnect();
                    }}
                  >
                    <Text style={[styles.menuItemText, { color: COLORS.error }]}>🔌 連携を解除する</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuCancel} onPress={() => setAccountMenu(null)}>
                    <Text style={styles.menuCancelText}>キャンセル</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, paddingHorizontal: SPACING.md },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800', marginBottom: SPACING.lg },
  accountCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  accountCardConnected: { borderColor: COLORS.primary + '66' },
  accountCardActive: { borderColor: COLORS.primary, borderWidth: 3 },
  activeLabel: { color: COLORS.primary, fontSize: 12, fontWeight: '800' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 24 },
  avatarImg: { width: 48, height: 48, borderRadius: 24 },
  accountInfo: { flex: 1 },
  accountName: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  accountSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  connectedBtns: { flexDirection: 'row', gap: SPACING.sm },
  connectBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  connectBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  editBtn: {
    backgroundColor: COLORS.surfaceElevated,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  editBtnText: { color: COLORS.text, fontWeight: '600', fontSize: 12 },
  disconnectBtn: {
    borderWidth: 1,
    borderColor: COLORS.error,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  disconnectBtnText: { color: COLORS.error, fontWeight: '600', fontSize: 12 },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  menuTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  menuItem: {
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  menuItemText: { color: COLORS.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  menuActiveNote: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: SPACING.sm,
  },
  menuCancel: { paddingVertical: SPACING.md, marginTop: SPACING.sm },
  menuCancelText: { color: COLORS.textMuted, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  connectedBadge: {
    backgroundColor: COLORS.success + '22',
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  connectedBadgeText: { color: COLORS.success, fontSize: 13, fontWeight: '600' },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.sm,
    marginTop: SPACING.md,
  },
  brandCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  brandInfo: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  brandEmoji: { fontSize: 28 },
  brandText: { flex: 1 },
  brandName: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  brandSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  brandArrow: { color: COLORS.textMuted, fontSize: 20 },
  brandTags: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  brandTag: {
    backgroundColor: COLORS.primary + '22',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  brandTagText: { color: COLORS.primary, fontSize: 11, fontWeight: '600' },
  apiKeyCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  apiKeyIcon: { fontSize: 24 },
  apiKeyInfo: { flex: 1 },
  apiKeyTitle: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  apiKeyStatus: { fontSize: 12, marginTop: 2 },
  apiKeyArrow: { color: COLORS.textMuted, fontSize: 20 },
  plansRow: { marginBottom: SPACING.xl },
  planCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginRight: SPACING.sm,
    width: 180,
    borderWidth: 1.5,
  },
  planCardCurrent: { backgroundColor: COLORS.surfaceElevated },
  planCurrentBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    alignSelf: 'flex-start',
    marginBottom: SPACING.sm,
  },
  planCurrentBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  planName: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  planPrice: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: SPACING.sm },
  planFeature: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 },
  planUpgradeBtn: {
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  planUpgradeBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  helpRow: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    gap: SPACING.md,
  },
  helpEmoji: { fontSize: 20 },
  helpLabel: { flex: 1, color: COLORS.text, fontSize: 14 },
  helpArrow: { color: COLORS.textMuted, fontSize: 20 },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  notifLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  notifDesc: { color: COLORS.textSecondary, fontSize: 12 },
  accountInfoCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  accountInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm + 2,
  },
  accountInfoRowDivided: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  accountInfoLabel: { color: COLORS.textSecondary, fontSize: 13 },
  accountInfoValue: { color: COLORS.text, fontSize: 13, fontWeight: '700', marginLeft: SPACING.md, flexShrink: 1, textAlign: 'right' },
  logoutBtn: {
    marginTop: SPACING.xl,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.error + '55',
  },
  logoutBtnText: { color: COLORS.error, fontSize: 14, fontWeight: '700' },
  loginBtn: {
    marginTop: SPACING.xl,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  loginBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  version: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center', marginTop: SPACING.lg },
  modal: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  modalCancel: { color: COLORS.textMuted, fontSize: 16 },
  modalSave: { color: COLORS.primary, fontSize: 16, fontWeight: '700' },
  autoBrandBtn: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  autoBrandText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  resetBrandBtn: {
    marginTop: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.error,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  resetBrandText: { color: COLORS.error, fontSize: 15, fontWeight: '700' },
  resetBrandHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  modalBody: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.xxl },
  oauthBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  oauthBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { color: COLORS.textMuted, fontSize: 12 },
  fieldLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: SPACING.sm,
    marginTop: SPACING.md,
  },
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
  locationRow: { flexDirection: 'row', gap: SPACING.sm },
  locationSelectBtn: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  locationSelectBtnDisabled: { opacity: 0.5 },
  locationSelectText: { color: COLORS.text, fontSize: 15 },
  locationSelectPlaceholder: { color: COLORS.textMuted },
  locationOptionRow: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  locationOptionText: { color: COLORS.text, fontSize: 15 },
  industryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  industryBtn: {
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    gap: 4,
    minWidth: 70,
  },
  industryBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '18' },
  industryBtnEmoji: { fontSize: 22 },
  industryBtnLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  industryBtnLabelActive: { color: COLORS.primary },
  toneGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.sm },
  toneBtn: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  toneBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  toneBtnText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '500' },
  toneBtnTextActive: { color: '#fff' },
  insightToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  insightToggleTextWrap: { flex: 1 },
  insightToggleTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  insightToggleDesc: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  insightToggleLocked: { color: COLORS.textMuted, fontSize: 12, marginBottom: SPACING.sm },
  brandTip: {
    backgroundColor: COLORS.secondary + '18',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.secondary + '33',
  },
  brandTipText: { color: COLORS.secondary, fontSize: 13, lineHeight: 20 },
  apiInfoBox: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  apiInfoTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: SPACING.sm },
  apiInfoText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20 },
  apiKeyInputRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  apiKeyInput: { flex: 1 },
  apiKeyToggle: {
    backgroundColor: COLORS.surfaceElevated,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  apiKeyToggleText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  guideToggle: { marginTop: SPACING.xl, paddingVertical: SPACING.sm, alignItems: 'center' },
  guideToggleText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  guideBox: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  guideTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  guideStep: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20 },
  guideNote: { color: COLORS.warning, fontSize: 12, marginTop: SPACING.sm, lineHeight: 18 },
});

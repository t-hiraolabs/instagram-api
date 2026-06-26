import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
  Linking,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore, InstagramCredentials, BrandSettings } from '../store/appStore';
import { INDUSTRIES } from '../services/aiService';
import { loadBrandSettingsFromDb, saveBrandSettingsToDb } from '../services/brandSettingsService';
import { ACCOUNT_THEMES } from '../utils/accountThemes';
import { supabase } from '../services/supabaseClient';
import { getMyPlan } from '../services/scheduleService';
import { createCheckoutUrl } from '../services/billingService';
import { PLANS, Plan, PLAN_RANK, canAnalytics } from '../utils/plans';
import {
  connectInstagram,
  clearInstagramStorage,
  clearInstagramStorage2,
  SK_USER_ID, SK_TOKEN, SK_USERNAME, SK_PICTURE,
  SK_USER_ID_2, SK_TOKEN_2, SK_USERNAME_2, SK_PICTURE_2,
} from '../utils/instagram';

const SK_BRAND_1 = 'brand_settings_v1';
const SK_BRAND_2 = 'brand_settings_v2';

async function save(key: string, value: string) {
  if (Platform.OS === 'web') localStorage.setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}

async function load(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

const TONES = ['明るい・ポジティブ', 'プロフェッショナル', 'カジュアル', '感情的・共感', 'ユーモラス'];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const {
    instagramCredentials, setInstagramCredentials,
    secondInstagramCredentials, setSecondInstagramCredentials,
    activeAccountSlot,
    brandSettings, setBrandSettings,
    brandSettings2, setBrandSettings2,
  } = useAppStore();

  const activeBrandSettings = activeAccountSlot === 2 ? brandSettings2 : brandSettings;
  const setActiveBrandSettings = activeAccountSlot === 2 ? setBrandSettings2 : setBrandSettings;
  const SK_BRAND = activeAccountSlot === 2 ? SK_BRAND_2 : SK_BRAND_1;

  const [brandModalVisible, setBrandModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<Plan>('free');
  const [upgrading, setUpgrading] = useState(false);

  // Brand form
  const [draftBrand, setDraftBrand] = useState<BrandSettings>({ ...activeBrandSettings });

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

      // Supabaseから読み込み（デバイス間同期）、失敗時はlocalStorageにフォールバック
      const [db1, db2] = await Promise.all([
        loadBrandSettingsFromDb(1).catch(() => null),
        loadBrandSettingsFromDb(2).catch(() => null),
      ]);
      if (db1) {
        setBrandSettings(db1);
        if (Platform.OS === 'web') localStorage.setItem(SK_BRAND_1, JSON.stringify(db1));
      } else {
        const savedBrand1 = await load(SK_BRAND_1);
        if (savedBrand1) { try { setBrandSettings(JSON.parse(savedBrand1) as BrandSettings); } catch {} }
      }
      if (db2) {
        setBrandSettings2(db2);
        if (Platform.OS === 'web') localStorage.setItem(SK_BRAND_2, JSON.stringify(db2));
      } else {
        const savedBrand2 = await load(SK_BRAND_2);
        if (savedBrand2) { try { setBrandSettings2(JSON.parse(savedBrand2) as BrandSettings); } catch {} }
      }
    })();
  }, []);

  const handleInstagramLogin = () => connectInstagram(1);
  const handleInstagramLogin2 = () => connectInstagram(2);

  const doDisconnect = async () => {
    await clearInstagramStorage();
    setInstagramCredentials(null);
  };

  const doDisconnect2 = async () => {
    await clearInstagramStorage2();
    setSecondInstagramCredentials(null);
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

  const openBrandModal = () => {
    setDraftBrand({ ...activeBrandSettings });
    setBrandModalVisible(true);
  };

  const handleSaveBrand = async () => {
    setSaving(true);
    try {
      setActiveBrandSettings(draftBrand);
      // ローカルとSupabase両方に保存（デバイス間同期）
      await save(SK_BRAND, JSON.stringify(draftBrand));
      await saveBrandSettingsToDb(draftBrand, activeAccountSlot).catch(() => {});
      setBrandModalVisible(false);
      Alert.alert('保存しました ✅', 'ブランド設定を更新しました');
    } catch {
      Alert.alert('エラー', '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('ログアウトしますか？')) {
        supabase.auth.signOut();
      }
      return;
    }
    Alert.alert('ログアウト', 'ログアウトしますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: 'ログアウト',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  const isConnected = !!instagramCredentials;
  const isConnected2 = !!secondInstagramCredentials;
  const hasBrandSetup = !!(activeBrandSettings.brandName || activeBrandSettings.industry);
  const industryInfo = INDUSTRIES.find((i) => i.key === activeBrandSettings.industry);

  return (
    <View style={styles.wrapper}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 100 }}
      >
        <Text style={styles.title}>プロフィール</Text>

        {/* Instagram account card */}
        <View style={[styles.accountCard, isConnected && styles.accountCardConnected]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{isConnected ? '📷' : '🧑'}</Text>
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
            <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
              <Text style={styles.disconnectBtnText}>解除</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.connectBtn} onPress={handleInstagramLogin}>
              <Text style={styles.connectBtnText}>連携する</Text>
            </TouchableOpacity>
          )}
        </View>

        {isConnected && (
          <View style={styles.connectedBadge}>
            <Text style={styles.connectedBadgeText}>✅ 予約自動投稿が利用できます</Text>
          </View>
        )}

        {/* Second Instagram account card */}
        <Text style={styles.sectionTitle}>2つ目のアカウント</Text>
        <View style={[styles.accountCard, isConnected2 && styles.accountCardConnected]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{isConnected2 ? '📷' : '➕'}</Text>
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
                <Text style={styles.accountName}>未連携</Text>
                <Text style={styles.accountSub}>2つ目のInstagramアカウントを連携</Text>
              </>
            )}
          </View>
          {isConnected2 ? (
            <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect2}>
              <Text style={styles.disconnectBtnText}>解除</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.connectBtn} onPress={handleInstagramLogin2}>
              <Text style={styles.connectBtnText}>連携する</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Brand Settings Card */}
        <Text style={styles.sectionTitle}>
          ブランド設定{activeAccountSlot === 2 ? '（アカウント②）' : '（アカウント①）'}
        </Text>
        <TouchableOpacity style={styles.brandCard} onPress={openBrandModal} activeOpacity={0.8}>
          <View style={styles.brandInfo}>
            <Text style={styles.brandEmoji}>
              {industryInfo ? industryInfo.emoji : '🏪'}
            </Text>
            <View style={styles.brandText}>
              <Text style={styles.brandName}>
                {activeBrandSettings.brandName || 'ブランド名を設定'}
              </Text>
              <Text style={styles.brandSub}>
                {industryInfo ? industryInfo.label : '業種を設定するとAI精度が向上します'}
              </Text>
            </View>
            <Text style={styles.brandArrow}>›</Text>
          </View>
          {hasBrandSetup && (
            <View style={styles.brandTags}>
              {activeBrandSettings.tone && (
                <View style={styles.brandTag}>
                  <Text style={styles.brandTagText}>{activeBrandSettings.tone}</Text>
                </View>
              )}
              {activeBrandSettings.targetAudience && (
                <View style={styles.brandTag}>
                  <Text style={styles.brandTagText}>{activeBrandSettings.targetAudience}</Text>
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
          { label: 'お問い合わせ', emoji: '💬', action: () => Alert.alert('お問い合わせ', 'support@instaai.jp までご連絡ください') },
        ].map((item) => (
          <TouchableOpacity key={item.label} style={styles.helpRow} onPress={item.action} activeOpacity={0.7}>
            <Text style={styles.helpEmoji}>{item.emoji}</Text>
            <Text style={styles.helpLabel}>{item.label}</Text>
            <Text style={styles.helpArrow}>›</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutBtnText}>ログアウト</Text>
        </TouchableOpacity>

        <Text style={styles.version}>InstaAI v1.0.0 — 日本の個人事業主向け</Text>
      </ScrollView>

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
            <View style={styles.industryGrid}>
              {INDUSTRIES.filter((i) => i.key !== '').map((ind) => (
                <TouchableOpacity
                  key={ind.key}
                  style={[styles.industryBtn, draftBrand.industry === ind.key && styles.industryBtnActive]}
                  onPress={() => setDraftBrand((p) => ({ ...p, industry: ind.key }))}
                >
                  <Text style={styles.industryBtnEmoji}>{ind.emoji}</Text>
                  <Text style={[styles.industryBtnLabel, draftBrand.industry === ind.key && styles.industryBtnLabelActive]}>
                    {ind.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.fieldLabel, { marginTop: SPACING.sm }]}>
              または業種を自由に入力
            </Text>
            <TextInput
              style={styles.input}
              value={draftBrand.industry}
              onChangeText={(v) => setDraftBrand((p) => ({ ...p, industry: v }))}
              placeholder="例: クラフトビール専門店、出張カメラマン など"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={styles.fieldLabel}>アカウントタイプ（文字・デザインに反映）</Text>
            <View style={styles.industryGrid}>
              {ACCOUNT_THEMES.map((at) => (
                <TouchableOpacity
                  key={at.key}
                  style={[styles.industryBtn, draftBrand.accountType === at.key && styles.industryBtnActive]}
                  onPress={() => setDraftBrand((p) => ({ ...p, accountType: at.key }))}
                >
                  <Text style={styles.industryBtnEmoji}>{at.emoji}</Text>
                  <Text style={[styles.industryBtnLabel, draftBrand.accountType === at.key && styles.industryBtnLabelActive]}>
                    {at.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

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
          </View>
        </ScrollView>
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
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 24 },
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
  logoutBtn: {
    marginTop: SPACING.xl,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.error + '55',
  },
  logoutBtnText: { color: COLORS.error, fontSize: 14, fontWeight: '700' },
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

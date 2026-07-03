import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
  Platform,
  Image,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import { useAppStore } from '../store/appStore';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import AuthScreen from '../screens/AuthScreen';
import { connectInstagram, clearInstagramStorage, clearInstagramStorage2 } from '../utils/instagram';
import { getMyPlan } from '../services/scheduleService';
import { PLANS, Plan, PLAN_RANK } from '../utils/plans';
import { createCheckoutUrl } from '../services/billingService';

export default function AccountBadge({ hideBadge }: { hideBadge?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<Session | null>(null);
  const [visible, setVisible] = useState(false);
  const [igPrompt, setIgPrompt] = useState(false);
  const [plan, setPlan] = useState<Plan>('free');
  const [upgrading, setUpgrading] = useState(false);
  const instagramCredentials = useAppStore((s) => s.instagramCredentials);
  const setInstagramCredentials = useAppStore((s) => s.setInstagramCredentials);
  const secondInstagramCredentials = useAppStore((s) => s.secondInstagramCredentials);
  const setSecondInstagramCredentials = useAppStore((s) => s.setSecondInstagramCredentials);
  const activeAccountSlot = useAppStore((s) => s.activeAccountSlot);
  const setActiveAccountSlot = useAppStore((s) => s.setActiveAccountSlot);
  const activeCredentials = activeAccountSlot === 2 ? secondInstagramCredentials : instagramCredentials;
  const authVisible = useAppStore((s) => s.loginPromptVisible);
  const setAuthVisible = useAppStore((s) => s.setLoginPromptVisible);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      // ログインフォームから実際にログインした時だけページを更新する。
      // （Instagram連携からの戻りや初回読み込みでは更新しない＝自動ブランド分析を中断しない）
      const cameFromLoginForm = useAppStore.getState().loginPromptVisible;
      setSession(newSession);
      if (newSession) setAuthVisible(false); // ログイン成功したらログイン画面を閉じる
      if (event === 'SIGNED_IN' && newSession && cameFromLoginForm) {
        if (Platform.OS === 'web') window.location.reload();
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [setAuthVisible]);

  // 実際のプラン（free/pro）を読み込む。ログイン状態が変わったら取り直す
  useEffect(() => {
    if (session) getMyPlan().then(setPlan).catch(() => {});
    else setPlan('free');
  }, [session]);

  // ログイン済みでInstagram未連携なら、連携を促すモーダルを一度だけ表示する
  useEffect(() => {
    if (!session) return;
    if (instagramCredentials || secondInstagramCredentials) return;
    const SEEN_KEY = 'ig_connect_prompt_seen';
    if (Platform.OS === 'web' && localStorage.getItem(SEEN_KEY)) return;
    setIgPrompt(true);
  }, [session, instagramCredentials, secondInstagramCredentials]);

  const dismissIgPrompt = () => {
    if (Platform.OS === 'web') localStorage.setItem('ig_connect_prompt_seen', '1');
    setIgPrompt(false);
  };

  const handleConnectFromPrompt = () => {
    if (Platform.OS === 'web') localStorage.setItem('ig_connect_prompt_seen', '1');
    setIgPrompt(false);
    connectInstagram(1);
  };

  const email = session?.user?.email ?? '';
  const initial = (email.trim()[0] ?? '?').toUpperCase();
  const currentPlan = PLANS.find((p) => p.id === plan) ?? PLANS[0];

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

  const handleConnectIg = () => {
    setVisible(false);
    connectInstagram(1);
  };

  const handleConnectIg2 = () => {
    setVisible(false);
    connectInstagram(2);
  };

  const doDisconnectIg = async () => {
    await clearInstagramStorage();
    setInstagramCredentials(null);
  };

  const doDisconnectIg2 = async () => {
    await clearInstagramStorage2();
    setSecondInstagramCredentials(null);
  };

  const handleDisconnectIg = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Instagramアカウントの連携を解除しますか？')) {
        doDisconnectIg();
      }
      return;
    }
    Alert.alert('連携解除', 'Instagramアカウントの連携を解除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '解除', style: 'destructive', onPress: doDisconnectIg },
    ]);
  };

  const handleDisconnectIg2 = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('2つ目のInstagramアカウントの連携を解除しますか？')) {
        doDisconnectIg2();
      }
      return;
    }
    Alert.alert('連携解除', '2つ目のInstagramアカウントの連携を解除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '解除', style: 'destructive', onPress: doDisconnectIg2 },
    ]);
  };

  const handleLogout = () => {
    setVisible(false);
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

  // --- 未ログイン時：右上に「ログイン」ボタンを表示 ---
  if (!session) {
    return (
      <>
        {!hideBadge && (
          <TouchableOpacity
            style={[styles.loginPill, { top: insets.top + SPACING.sm, right: SPACING.md }]}
            onPress={() => setAuthVisible(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.loginPillText}>ログイン</Text>
          </TouchableOpacity>
        )}

        {/* ログイン / 新規登録モーダル */}
        <Modal visible={authVisible} animationType="slide" onRequestClose={() => setAuthVisible(false)}>
          <View style={styles.authWrap}>
            <TouchableOpacity
              style={[styles.authClose, { top: insets.top + SPACING.sm }]}
              onPress={() => setAuthVisible(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.authCloseText}>✕ 閉じる</Text>
            </TouchableOpacity>
            <AuthScreen />
          </View>
        </Modal>
      </>
    );
  }

  // --- ログイン時：右上にアカウントアイコンを表示 ---
  return (
    <>
      {/* 新規ログイン後：Instagram連携を促すモーダル */}
      <Modal visible={igPrompt} transparent animationType="fade" onRequestClose={dismissIgPrompt}>
        <View style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <Text style={styles.promptIcon}>📸</Text>
            <Text style={styles.promptTitle}>Instagramアカウントを連携しましょう</Text>
            <Text style={styles.promptDesc}>
              連携すると、AIによる投稿作成・予約投稿・分析・DM管理が使えるようになります。
            </Text>
            <TouchableOpacity style={styles.promptConnectBtn} onPress={handleConnectFromPrompt} activeOpacity={0.85}>
              <Text style={styles.promptConnectText}>Instagramを連携する</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.promptLaterBtn} onPress={dismissIgPrompt} activeOpacity={0.7}>
              <Text style={styles.promptLaterText}>あとで</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {!hideBadge && (
        <>
          {/* 連携済みなら、アカウントアイコンの左に隠れてInstagramのプロフィール写真を表示 */}
          {activeCredentials?.profilePictureUrl ? (
            <TouchableOpacity
              style={[styles.igBadge, { top: insets.top + SPACING.sm + 3, right: SPACING.md + 26 }]}
              onPress={() => setVisible(true)}
              activeOpacity={0.8}
            >
              <Image source={{ uri: activeCredentials!.profilePictureUrl }} style={styles.igBadgeImg} />
            </TouchableOpacity>
          ) : null}

          {/* 右上のアカウントアイコン */}
          <TouchableOpacity
            style={[styles.badge, { top: insets.top + SPACING.sm, right: SPACING.md }]}
            onPress={() => setVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.badgeText}>{initial}</Text>
          </TouchableOpacity>
        </>
      )}

      {/* アカウント情報モーダル */}
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setVisible(false)}>
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.sheet, { paddingTop: insets.top + SPACING.md }]}
            onPress={(e) => e.stopPropagation?.()}
          >
            <View style={styles.handleRow}>
              <Text style={styles.sheetTitle}>アカウント</Text>
              <TouchableOpacity onPress={() => setVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: SPACING.xl }}>
              {/* ユーザー情報 */}
              <View style={styles.userRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.email} numberOfLines={1}>{email || '読み込み中...'}</Text>
                  <Text style={styles.loggedIn}>✅ ログイン中</Text>
                </View>
              </View>

              {/* Instagram アカウント切り替え */}
              <Text style={styles.sectionTitle}>Instagramアカウント</Text>
              {([
                { slot: 1 as const, creds: instagramCredentials, onConnect: handleConnectIg, onDisconnect: handleDisconnectIg },
                { slot: 2 as const, creds: secondInstagramCredentials, onConnect: handleConnectIg2, onDisconnect: handleDisconnectIg2 },
              ]).map(({ slot, creds, onConnect, onDisconnect }) => {
                const isActive = activeAccountSlot === slot;
                return (
                  <View key={slot} style={[styles.igAccountRow, isActive && styles.igAccountRowActive]}>
                    <View style={styles.igAccountLeft}>
                      {isActive && <View style={styles.igActiveDot} />}
                      <View>
                        <Text style={[styles.igAccountName, { color: creds ? COLORS.text : COLORS.textMuted }]}>
                          {creds ? (creds.username ? `@${creds.username}` : '連携済み') : `アカウント${slot}（未連携）`}
                        </Text>
                        {isActive && creds && (
                          <Text style={styles.igActiveLabel}>投稿中のアカウント</Text>
                        )}
                      </View>
                    </View>
                    <View style={styles.igRight}>
                      {creds ? (
                        <>
                          {!isActive && (
                            <TouchableOpacity
                              style={styles.igSwitchBtn}
                              onPress={() => { setActiveAccountSlot(slot); setVisible(false); }}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.igSwitchText}>切り替え</Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity style={styles.igDisconnectBtn} onPress={onDisconnect} activeOpacity={0.8}>
                            <Text style={styles.igDisconnectText}>解除</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <TouchableOpacity style={styles.igConnectBtn} onPress={onConnect} activeOpacity={0.8}>
                          <Text style={styles.igConnectText}>連携する</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}

              {/* 現在のプラン */}
              <Text style={styles.sectionTitle}>現在のプラン</Text>
              <View style={styles.currentPlanCard}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.currentPlanName, { color: currentPlan?.color }]}>{currentPlan?.name}</Text>
                  <Text style={styles.currentPlanPrice}>{currentPlan?.price}</Text>
                </View>
                <View style={styles.currentBadge}>
                  <Text style={styles.currentBadgeText}>利用中</Text>
                </View>
              </View>
              {currentPlan?.features.map((f) => (
                <Text key={f} style={styles.feature}>✓ {f}</Text>
              ))}

              {/* アップグレード候補（今より上位のプランだけ表示） */}
              {PLANS.filter((p) => p.paid && PLAN_RANK[p.id] > PLAN_RANK[plan]).length > 0 && (
                <Text style={styles.sectionTitle}>アップグレード</Text>
              )}
              {PLANS.filter((p) => p.paid && PLAN_RANK[p.id] > PLAN_RANK[plan]).map((pl) => (
                <View key={pl.id} style={[styles.upgradeCard, { borderColor: pl.color + '44' }]}>
                  <View style={styles.upgradeHeader}>
                    <Text style={[styles.upgradeName, { color: pl.color }]}>{pl.name}</Text>
                    <Text style={styles.upgradePrice}>{pl.price}</Text>
                  </View>
                  {pl.features.map((f) => (
                    <Text key={f} style={styles.feature}>✓ {f}</Text>
                  ))}
                  <TouchableOpacity
                    style={[styles.upgradeBtn, { backgroundColor: pl.color }, upgrading && { opacity: 0.6 }]}
                    onPress={() => handleUpgrade(pl.id as 'pro' | 'business')}
                    disabled={upgrading}
                  >
                    <Text style={styles.upgradeBtnText}>
                      {upgrading ? '処理中…' : 'アップグレード'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
                <Text style={styles.logoutBtnText}>ログアウト</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    zIndex: 1000,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.surface,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : {}),
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  badgeText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  igBadge: {
    position: 'absolute',
    zIndex: 999,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.background,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : {}),
  },
  igBadgeImg: { width: '100%', height: '100%', borderRadius: 16 },
  loginPill: {
    position: 'absolute',
    zIndex: 1000,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : {}),
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  loginPillText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  promptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  promptCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  promptIcon: { fontSize: 44, marginBottom: SPACING.md },
  promptTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  promptDesc: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  promptConnectBtn: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : {}),
  },
  promptConnectText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  promptLaterBtn: {
    marginTop: SPACING.md,
    paddingVertical: SPACING.sm,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : {}),
  },
  promptLaterText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  authWrap: { flex: 1, backgroundColor: COLORS.background },
  authClose: {
    position: 'absolute',
    zIndex: 10,
    left: SPACING.md,
    paddingVertical: 6,
    paddingHorizontal: SPACING.sm,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : {}),
  },
  authCloseText: { color: COLORS.textMuted, fontSize: 15, fontWeight: '600' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    height: '100%',
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.lg,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
  },
  handleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  sheetTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  closeBtn: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  email: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  loggedIn: { color: COLORS.success, fontSize: 12, marginTop: 2 },
  igAccountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  igAccountRowActive: {
    borderColor: COLORS.primary + '88',
    backgroundColor: COLORS.primary + '10',
  },
  igAccountLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flex: 1 },
  igActiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  igAccountName: { fontSize: 14, fontWeight: '700' },
  igActiveLabel: { color: COLORS.primary, fontSize: 11, fontWeight: '600', marginTop: 2 },
  igRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  igSwitchBtn: {
    backgroundColor: COLORS.surfaceElevated,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : {}),
  },
  igSwitchText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
  igConnectBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : {}),
  },
  igConnectText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  igDisconnectBtn: {
    borderWidth: 1,
    borderColor: COLORS.error,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : {}),
  },
  igDisconnectText: { color: COLORS.error, fontSize: 13, fontWeight: '700' },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
  },
  currentPlanCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1.5,
    borderColor: COLORS.primary + '55',
    marginBottom: SPACING.sm,
  },
  currentPlanName: { fontSize: 18, fontWeight: '800' },
  currentPlanPrice: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginTop: 2 },
  currentBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
  },
  currentBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  feature: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 4, marginLeft: 4 },
  upgradeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1.5,
    marginBottom: SPACING.sm,
  },
  upgradeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  upgradeName: { fontSize: 17, fontWeight: '800' },
  upgradePrice: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  upgradeBtn: {
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  upgradeBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  logoutBtn: {
    marginTop: SPACING.xl,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.error + '55',
  },
  logoutBtnText: { color: COLORS.error, fontSize: 14, fontWeight: '700' },
});

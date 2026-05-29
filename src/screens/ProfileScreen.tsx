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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore, InstagramCredentials } from '../store/appStore';

const INSTAGRAM_APP_ID = process.env.EXPO_PUBLIC_INSTAGRAM_APP_ID ?? '';
const REDIRECT_URI = 'https://instaai-app.vercel.app/';
const SCOPES = 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_media';

const STORAGE_KEY_USER_ID = 'instagram_user_id';
const STORAGE_KEY_TOKEN = 'instagram_access_token';
const STORAGE_KEY_USERNAME = 'instagram_username';

async function saveToStorage(key: string, value: string) {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function loadFromStorage(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function removeFromStorage(key: string) {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { instagramCredentials, setInstagramCredentials } = useAppStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [username, setUsername] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  // Load saved credentials on mount
  useEffect(() => {
    (async () => {
      const savedUserId = await loadFromStorage(STORAGE_KEY_USER_ID);
      const savedToken = await loadFromStorage(STORAGE_KEY_TOKEN);
      const savedUsername = await loadFromStorage(STORAGE_KEY_USERNAME);
      if (savedUserId && savedToken) {
        setInstagramCredentials({
          userId: savedUserId,
          accessToken: savedToken,
          username: savedUsername ?? undefined,
        });
      }
    })();
  }, []);

  const handleInstagramLogin = () => {
    const url =
      `https://www.instagram.com/oauth/authorize?` +
      `client_id=${INSTAGRAM_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${SCOPES}` +
      `&response_type=code`;

    if (Platform.OS === 'web') {
      window.location.href = url;
    } else {
      Linking.openURL(url);
    }
  };

  const openConnectModal = () => {
    setUserId(instagramCredentials?.userId ?? '');
    setAccessToken(instagramCredentials?.accessToken ?? '');
    setUsername(instagramCredentials?.username ?? '');
    setShowGuide(false);
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!userId.trim() || !accessToken.trim()) {
      Alert.alert('エラー', 'ユーザーIDとアクセストークンを入力してください');
      return;
    }
    setSaving(true);
    try {
      await saveToStorage(STORAGE_KEY_USER_ID, userId.trim());
      await saveToStorage(STORAGE_KEY_TOKEN, accessToken.trim());
      await saveToStorage(STORAGE_KEY_USERNAME, username.trim());
      setInstagramCredentials({
        userId: userId.trim(),
        accessToken: accessToken.trim(),
        username: username.trim() || undefined,
      });
      setModalVisible(false);
      Alert.alert('連携完了 ✅', 'Instagramアカウントを連携しました');
    } catch {
      Alert.alert('エラー', '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert('連携解除', 'Instagramアカウントの連携を解除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '解除',
        style: 'destructive',
        onPress: async () => {
          await removeFromStorage(STORAGE_KEY_USER_ID);
          await removeFromStorage(STORAGE_KEY_TOKEN);
          await removeFromStorage(STORAGE_KEY_USERNAME);
          setInstagramCredentials(null);
        },
      },
    ]);
  };

  const isConnected = !!instagramCredentials;

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
                  {instagramCredentials.username
                    ? `@${instagramCredentials.username}`
                    : 'Instagram連携済み'}
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
            <View style={styles.connectedBtns}>
              <TouchableOpacity style={styles.editBtn} onPress={openConnectModal}>
                <Text style={styles.editBtnText}>編集</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
                <Text style={styles.disconnectBtnText}>解除</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.connectBtn} onPress={handleInstagramLogin}>
              <Text style={styles.connectBtnText}>ログイン</Text>
            </TouchableOpacity>
          )}
        </View>

        {isConnected && (
          <View style={styles.connectedBadge}>
            <Text style={styles.connectedBadgeText}>✅ 予約投稿機能が使えます</Text>
          </View>
        )}

        {/* Plan */}
        <View style={styles.planCard}>
          <View>
            <Text style={styles.planLabel}>現在のプラン</Text>
            <Text style={styles.planName}>Free プラン</Text>
            <Text style={styles.planDetail}>月10回のAI生成 / 予約投稿5件</Text>
          </View>
          <TouchableOpacity style={styles.upgradeBtn}>
            <Text style={styles.upgradeBtnText}>アップグレード 💎</Text>
          </TouchableOpacity>
        </View>

        {/* Settings */}
        <Text style={styles.sectionTitle}>設定</Text>
        {[
          { label: 'APIキー設定', emoji: '🔑' },
          { label: 'ブランドトーン設定', emoji: '🎨' },
          { label: '通知設定', emoji: '🔔' },
          { label: 'ヘルプ・サポート', emoji: '❓' },
        ].map((s) => (
          <TouchableOpacity
            key={s.label}
            style={styles.settingRow}
            onPress={() => Alert.alert(s.label, '準備中です')}
            activeOpacity={0.7}
          >
            <Text style={styles.settingEmoji}>{s.emoji}</Text>
            <Text style={styles.settingLabel}>{s.label}</Text>
            <Text style={styles.settingArrow}>›</Text>
          </TouchableOpacity>
        ))}

        <Text style={styles.version}>InstaAI v1.0.0</Text>
      </ScrollView>

      {/* Connect Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <ScrollView style={styles.modal} keyboardShouldPersistTaps="handled">
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCancel}>キャンセル</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Instagram連携</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator color={COLORS.primary} />
              ) : (
                <Text style={styles.modalSave}>保存</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <Text style={styles.fieldLabel}>Instagramユーザー名（任意）</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="your_instagram_username"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>Instagram ユーザーID *</Text>
            <TextInput
              style={styles.input}
              value={userId}
              onChangeText={setUserId}
              placeholder="例: 123456789012345"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              keyboardType="number-pad"
            />

            <Text style={styles.fieldLabel}>アクセストークン *</Text>
            <TextInput
              style={styles.input}
              value={accessToken}
              onChangeText={setAccessToken}
              placeholder="Instagram Graph API アクセストークン"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              secureTextEntry
            />

            {/* Guide toggle */}
            <TouchableOpacity
              style={styles.guideToggle}
              onPress={() => setShowGuide((v) => !v)}
            >
              <Text style={styles.guideToggleText}>
                {showGuide ? '▲' : '▼'} ユーザーIDとトークンの取得方法
              </Text>
            </TouchableOpacity>

            {showGuide && (
              <View style={styles.guideBox}>
                <Text style={styles.guideTitle}>取得手順</Text>
                <Text style={styles.guideStep}>
                  1. {'https://developers.facebook.com'} にアクセスし、Facebookアプリを作成
                </Text>
                <Text style={styles.guideStep}>
                  2. 「Instagram」製品を追加 → Instagram Businessアカウントを連携
                </Text>
                <Text style={styles.guideStep}>
                  3. Graph API Explorer で{' '}
                  <Text style={styles.guideCode}>GET /me?fields=id,username</Text> を実行
                </Text>
                <Text style={styles.guideStep}>
                  4. 返ってきた <Text style={styles.guideCode}>id</Text> がユーザーID
                </Text>
                <Text style={styles.guideStep}>
                  5. 「Generate Access Token」でアクセストークンを取得
                </Text>
                <Text style={styles.guideNote}>
                  ※ Instagramアカウントは「プロアカウント（ビジネスまたはクリエイター）」が必要です
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, paddingHorizontal: SPACING.md },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800', marginBottom: SPACING.xl },
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
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 28 },
  accountInfo: { flex: 1 },
  accountName: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  accountSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
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
    marginBottom: SPACING.md,
  },
  connectedBadgeText: { color: COLORS.success, fontSize: 13, fontWeight: '600' },
  planCard: {
    backgroundColor: COLORS.secondary + '22',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.secondary + '44',
  },
  planLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  planName: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  planDetail: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  upgradeBtn: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
  },
  upgradeBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.sm,
  },
  settingRow: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    gap: SPACING.md,
  },
  settingEmoji: { fontSize: 20 },
  settingLabel: { flex: 1, color: COLORS.text, fontSize: 15 },
  settingArrow: { color: COLORS.textMuted, fontSize: 20 },
  version: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: SPACING.xl },
  // Modal
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
  modalBody: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
  fieldLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: SPACING.xs,
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
  guideToggle: {
    marginTop: SPACING.xl,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
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
  guideCode: { color: COLORS.primary, fontFamily: 'monospace' },
  guideNote: {
    color: COLORS.warning,
    fontSize: 12,
    marginTop: SPACING.sm,
    lineHeight: 18,
  },
});

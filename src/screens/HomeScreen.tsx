import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore } from '../store/appStore';
import AccountBadge from '../components/AccountBadge';
import { getAiUsage, AiUsage } from '../services/scheduleService';

const QUICK_ACTIONS = [
  { label: '投稿する', emoji: '📸', tab: 'Post', color: COLORS.primary },
  { label: 'AIで画像を作る', emoji: '🎨', tab: 'Post', imageChat: true, color: COLORS.secondary },
  { label: '予約投稿', emoji: '📅', tab: 'Schedule', color: '#F77737' },
  { label: '設定', emoji: '⚙️', tab: 'Profile', color: '#4FC3F7' },
];

const JAPAN_TIPS = [
  { tip: '🕐 平日18〜21時・休日11〜13時が最もリーチが高い時間帯です', category: '投稿時間' },
  { tip: '#️⃣ 日本のInstagramはハッシュタグ検索がグローバル平均の3倍！15〜20個のタグを活用しましょう', category: 'ハッシュタグ' },
  { tip: '📱 ストーリーは毎日投稿するとフォロワーとの関係が深まります', category: 'ストーリー' },
  { tip: '🎯 フィード投稿は週3〜5回が最も効果的です', category: '投稿頻度' },
  { tip: '💬 コメントには24時間以内に返信するとアルゴリズム評価が上がります', category: 'エンゲージメント' },
  { tip: '🌸 季節イベントに合わせた投稿は平均2〜3倍のエンゲージメントを獲得できます', category: '季節活用' },
  { tip: '📊 リール（Reels）はフィードより約3倍の新規リーチが期待できます', category: 'リール' },
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return '深夜もお疲れさまです 🌙';
  if (h < 10) return 'おはようございます ☀️';
  if (h < 17) return 'こんにちは 👋';
  return 'こんばんは 🌆';
}

// 業種を問わず使える、季節・曜日で回転するおすすめネタ（AIを呼ばず無料で出せるもの）
const IDEA_POOL = [
  '新作・季節限定メニューの紹介',
  'お客様の声・ビフォーアフター',
  '期間限定キャンペーンの告知',
  'スタッフ紹介・お店の裏側',
  '本日のおすすめ・入荷情報',
  'よくある質問に答える投稿',
  'リピーター向けの感謝メッセージ',
];

function getTodaysIdeas(): string[] {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  return [0, 1, 2].map((i) => IDEA_POOL[(dayOfYear + i) % IDEA_POOL.length]);
}

function getTodoItems(hasInsightAlert: boolean): { key: string; label: string; done: boolean }[] {
  return [
    { key: 'post', label: '投稿する', done: false },
    { key: 'story', label: 'ストーリーを更新する', done: false },
    { key: 'dm', label: 'DMを確認する', done: false },
    { key: 'analytics', label: hasInsightAlert ? '分析を確認する（要チェック）' : '分析を確認する', done: false },
  ];
}

function getBestPostingTime(): { label: string; color: string; description: string } {
  const now = new Date();
  const h = now.getHours();
  const day = now.getDay();
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) {
    if (h >= 11 && h < 13) return { label: '今がベストタイム！', color: COLORS.success, description: '休日の11〜13時は最高のリーチタイムです' };
    if (h >= 19 && h < 22) return { label: '今がベストタイム！', color: COLORS.success, description: '夜のゴールデンタイムです' };
    if (h >= 10 && h < 11) return { label: 'もうすぐベストタイム', color: COLORS.warning, description: '11時から最高のリーチタイムが始まります' };
    return { label: '次は11:00〜13:00', color: COLORS.textMuted, description: '休日は11〜13時・19〜21時がおすすめ' };
  } else {
    if (h >= 18 && h < 21) return { label: '今がベストタイム！', color: COLORS.success, description: '平日の18〜21時は最高のリーチタイムです' };
    if (h >= 12 && h < 13) return { label: '今がベストタイム！', color: COLORS.success, description: 'ランチタイムは閲覧数が上がります' };
    if (h >= 17 && h < 18) return { label: 'もうすぐベストタイム', color: COLORS.warning, description: '18時から最高のリーチタイムが始まります' };
    return { label: '次は18:00〜21:00', color: COLORS.textMuted, description: '平日は18〜21時・12〜13時がおすすめ' };
  }
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { brandSettings, instagramCredentials: creds1, secondInstagramCredentials: creds2, activeAccountSlot, setOpenImageChat, setChatPrefillText, setChatAutoSend, setChatForceNew } = useAppStore();
  const instagramCredentials = activeAccountSlot === 2 ? creds2 : creds1;
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const bestTime = useMemo(() => getBestPostingTime(), []);
  const todaysIdeas = useMemo(() => getTodaysIdeas(), []);
  const todoItems = useMemo(() => getTodoItems(false), []);
  const [miniChatText, setMiniChatText] = useState('');

  const sendMiniChat = () => {
    const text = miniChatText.trim();
    if (!text) return;
    setMiniChatText('');
    setChatPrefillText(text);
    setChatAutoSend(true);
    setChatForceNew(true);
    setOpenImageChat(true);
    navigation.navigate('Post');
  };

  const startPostFromIdea = (idea: string) => {
    setChatPrefillText(`「${idea}」について投稿を作りたいです。`);
    setChatForceNew(true);
    setOpenImageChat(true);
    navigation.navigate('Post');
  };

  const goTodo = (key: string) => {
    if (key === 'dm') return navigation.navigate('DM');
    if (key === 'analytics') return navigation.navigate('Analytics');
    if (key === 'story') {
      setChatPrefillText('今日のストーリーを作りたいです。');
      setChatForceNew(true);
      setOpenImageChat(true);
      return navigation.navigate('Post');
    }
    setChatForceNew(true);
    setOpenImageChat(true);
    navigation.navigate('Post');
  };

  useEffect(() => {
    getAiUsage().then(setUsage).catch(() => {});
  }, []);

  const displayName = brandSettings.brandName || instagramCredentials?.username
    ? `@${instagramCredentials?.username ?? brandSettings.brandName}`
    : null;

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 100 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logoIcon}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.title}>AImark</Text>
            <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: -2, marginBottom: 2 }}>アイマーク</Text>
            {brandSettings.brandName ? (
              <Text style={styles.greeting}>{brandSettings.brandName}</Text>
            ) : null}
            {displayName && (
              <Text style={styles.username}>{displayName}</Text>
            )}
          </View>
        </View>
      </View>

      {/* ミニチャット */}
      <View style={styles.miniChatRow}>
        <TextInput
          style={styles.miniChatInput}
          placeholder="今日は何を投稿すればいい？"
          placeholderTextColor={COLORS.textMuted}
          value={miniChatText}
          onChangeText={setMiniChatText}
          onSubmitEditing={sendMiniChat}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.miniChatSend, !miniChatText.trim() && styles.miniChatSendDisabled]}
          onPress={sendMiniChat}
          disabled={!miniChatText.trim()}
        >
          <Text style={styles.miniChatSendText}>➤</Text>
        </TouchableOpacity>
      </View>

      {/* 今日のブリーフィング */}
      <View style={styles.briefCard}>
        <Text style={styles.briefGreeting}>{getGreeting()}</Text>
        <Text style={styles.briefMain}>{bestTime.description}</Text>
        <View style={styles.briefTimeRow}>
          <View style={[styles.briefTimeDot, { backgroundColor: bestTime.color }]} />
          <Text style={[styles.briefTimeLabel, { color: bestTime.color }]}>{bestTime.label}</Text>
        </View>
      </View>

      {/* おすすめ投稿ネタ */}
      <Text style={styles.sectionTitle}>今日のおすすめ投稿ネタ</Text>
      <View style={styles.ideaRow}>
        {todaysIdeas.map((idea) => (
          <TouchableOpacity key={idea} style={styles.ideaChip} onPress={() => startPostFromIdea(idea)} activeOpacity={0.8}>
            <Text style={styles.ideaChipText}>{idea}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 今日のTODO */}
      <Text style={styles.sectionTitle}>今日のTODO</Text>
      <View style={styles.todoCard}>
        {todoItems.map((item, i) => (
          <TouchableOpacity
            key={item.key}
            style={[styles.todoRow, i < todoItems.length - 1 && styles.todoRowBorder]}
            onPress={() => goTodo(item.key)}
            activeOpacity={0.7}
          >
            <Text style={styles.todoCheckbox}>☐</Text>
            <Text style={styles.todoLabel}>{item.label}</Text>
            <Text style={styles.todoArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: '今月の投稿', value: '—', icon: '📷' },
          { label: '予約中', value: '—', icon: '📅' },
          {
            label: 'AI残り回数',
            value: usage ? `${usage.remaining}/${usage.limit}` : '—',
            icon: '✨',
          },
        ].map((stat) => (
          <View key={stat.label} style={styles.statCard}>
            <Text style={styles.statIcon}>{stat.icon}</Text>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>クイックアクション</Text>
      <View style={styles.actionsGrid}>
        {QUICK_ACTIONS.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={[styles.actionCard, { borderColor: action.color + '44' }]}
            onPress={() => {
              if ((action as { imageChat?: boolean }).imageChat) setOpenImageChat(true);
              navigation.navigate(action.tab);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.actionEmoji}>{action.emoji}</Text>
            <Text style={styles.actionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Industry Setup Prompt */}
      {!brandSettings.industry && (
        <TouchableOpacity
          style={styles.setupCard}
          onPress={() => navigation.navigate('Profile')}
          activeOpacity={0.8}
        >
          <Text style={styles.setupIcon}>⚡</Text>
          <View style={styles.setupInfo}>
            <Text style={styles.setupTitle}>業種を設定するとAI精度が向上します</Text>
            <Text style={styles.setupSub}>プロフィール › ブランド設定から設定できます</Text>
          </View>
          <Text style={styles.setupArrow}>›</Text>
        </TouchableOpacity>
      )}

    </ScrollView>
    <AccountBadge />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.lg,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  logoIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  greeting: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginBottom: 2,
  },
  title: {
    color: COLORS.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  username: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  badge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
  },
  badgeInactive: {
    backgroundColor: COLORS.surfaceElevated,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  timeBanner: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
    borderWidth: 1.5,
  },
  timeBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
  },
  timeBannerIcon: { fontSize: 22 },
  timeBannerLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  timeBannerDesc: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  postNowBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
  },
  postNowBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  miniChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  miniChatInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  miniChatSend: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniChatSendDisabled: {
    opacity: 0.4,
  },
  miniChatSendText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  briefCard: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    gap: 6,
  },
  briefGreeting: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
  },
  briefMain: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 24,
  },
  briefTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  briefTimeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  briefTimeLabel: {
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    overflow: 'hidden',
  },
  ideaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  ideaChip: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  ideaChipText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  todoCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  todoRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  todoCheckbox: {
    fontSize: 16,
    color: COLORS.textMuted,
  },
  todoLabel: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  todoArrow: {
    color: COLORS.textMuted,
    fontSize: 18,
  },
  statsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    gap: 4,
  },
  statIcon: { fontSize: 18 },
  statValue: {
    color: COLORS.primary,
    fontSize: 22,
    fontWeight: '800',
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    textAlign: 'center',
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  actionCard: {
    width: '47%',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1.5,
    gap: 8,
  },
  actionEmoji: { fontSize: 30 },
  actionLabel: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  seasonCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  seasonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  seasonEmoji: { fontSize: 20, marginRight: SPACING.sm },
  seasonEvent: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: '700' },
  seasonArrow: { color: COLORS.textMuted, fontSize: 18 },
  themeChip: {
    backgroundColor: COLORS.primary + '22',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    marginRight: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.primary + '44',
  },
  themeChipText: { color: COLORS.primary, fontSize: 12, fontWeight: '500' },
  setupCard: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.warning + '44',
  },
  setupIcon: { fontSize: 22 },
  setupInfo: { flex: 1 },
  setupTitle: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  setupSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  setupArrow: { color: COLORS.textMuted, fontSize: 18 },
  tipCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  tipCategory: { color: COLORS.text, fontSize: 14, fontWeight: '700', flex: 1 },
  tipCategoryBadge: {
    backgroundColor: COLORS.primary + '22',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  tipCategoryText: { color: COLORS.primary, fontSize: 11, fontWeight: '600' },
  tipText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  apiCard: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.error + '44',
  },
  apiIcon: { fontSize: 22 },
  apiInfo: { flex: 1 },
  apiTitle: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  apiSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  apiArrow: { color: COLORS.textMuted, fontSize: 18 },
});

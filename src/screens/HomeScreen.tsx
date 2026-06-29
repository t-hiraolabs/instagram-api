import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore } from '../store/appStore';
import AccountBadge from '../components/AccountBadge';
import { getSeasonalThemes } from '../services/aiService';
import { getAiUsage, AiUsage } from '../services/scheduleService';

const QUICK_ACTIONS = [
  { label: '投稿する', emoji: '📸', tab: 'Post', color: COLORS.primary },
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
  const { brandSettings, instagramCredentials: creds1, secondInstagramCredentials: creds2, activeAccountSlot } = useAppStore();
  const instagramCredentials = activeAccountSlot === 2 ? creds2 : creds1;
  const greeting = useMemo(() => getGreeting(), []);
  const postingTime = useMemo(() => getBestPostingTime(), []);
  const month = new Date().getMonth() + 1;
  const seasonalEvents = useMemo(() => getSeasonalThemes(month), [month]);
  const tipIndex = useMemo(() => new Date().getDate() % JAPAN_TIPS.length, []);
  const todayTip = JAPAN_TIPS[tipIndex];

  const [usage, setUsage] = useState<AiUsage | null>(null);
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
        {!instagramCredentials && (
          <View style={[styles.badge, styles.badgeInactive]}>
            <Text style={styles.badgeText}>PRO</Text>
          </View>
        )}
      </View>

      {/* Best Posting Time Banner */}
      <View style={[styles.timeBanner, { borderColor: postingTime.color + '66' }]}>
        <View style={styles.timeBannerLeft}>
          <Text style={styles.timeBannerIcon}>⏰</Text>
          <View>
            <Text style={[styles.timeBannerLabel, { color: postingTime.color }]}>
              {postingTime.label}
            </Text>
            <Text style={styles.timeBannerDesc}>{postingTime.description}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.postNowBtn, { backgroundColor: postingTime.color }]}
          onPress={() => navigation.navigate('Post')}
        >
          <Text style={styles.postNowBtnText}>投稿作成</Text>
        </TouchableOpacity>
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
            onPress={() => navigation.navigate(action.tab)}
            activeOpacity={0.8}
          >
            <Text style={styles.actionEmoji}>{action.emoji}</Text>
            <Text style={styles.actionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Seasonal Events */}
      {seasonalEvents.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>🗓 今月のイベント活用</Text>
          {seasonalEvents.map((ev) => (
            <TouchableOpacity
              key={ev.event}
              style={styles.seasonCard}
              onPress={() => navigation.navigate('Post')}
              activeOpacity={0.8}
            >
              <View style={styles.seasonHeader}>
                <Text style={styles.seasonEmoji}>{ev.emoji}</Text>
                <Text style={styles.seasonEvent}>{ev.event}</Text>
                <Text style={styles.seasonArrow}>›</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {ev.themes.map((t) => (
                  <View key={t} style={styles.themeChip}>
                    <Text style={styles.themeChipText}>{t}</Text>
                  </View>
                ))}
              </ScrollView>
            </TouchableOpacity>
          ))}
        </>
      )}

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

      {/* Today's Tip */}
      <View style={styles.tipCard}>
        <View style={styles.tipHeader}>
          <Text style={styles.tipCategory}>💡 本日のヒント</Text>
          <View style={styles.tipCategoryBadge}>
            <Text style={styles.tipCategoryText}>{todayTip.category}</Text>
          </View>
        </View>
        <Text style={styles.tipText}>{todayTip.tip}</Text>
      </View>
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

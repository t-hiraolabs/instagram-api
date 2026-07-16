// 「はじめてガイド」を完了したユーザー向けに、実際のInstagramデータをもとに
// アカウントの段階（立ち上げ期／成長期／定着期）とS〜Eの総合評価を判定し、それに応じたAIアドバイスを表示する。
// 連携中のアカウントごとに評価・アドバイスを分けて保持し、週が変わったタイミングで自動的に再分析する
// （手動更新はなし。次にホームを開いたときに自動で最新化される）。
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore } from '../store/appStore';
import {
  getInsightsSummary,
  computeInsightFacts,
  computeAccountRank,
  computeAccountScore,
  getIsoWeekKey,
  ACCOUNT_RANK_LABEL,
  ACCOUNT_SCORE_COLOR,
  AccountRank,
  AccountScoreGrade,
} from '../services/insightsService';
import { generateMarketingGuide, MarketingGuide } from '../services/aiService';

const CACHE_KEY = 'aimark_marketing_guide_v2';

interface CacheEntry {
  rank: AccountRank;
  grade: AccountScoreGrade;
  guide: MarketingGuide;
  weekKey: string;
}

// アカウント（userId）ごとにエントリーを分けて保持する。複数のInstagramアカウントを
// 連携していても、それぞれ独立して週1回分析される
type CacheMap = Record<string, CacheEntry>;

function readCacheMap(): CacheMap {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheMap) : {};
  } catch {
    return {};
  }
}

function writeCacheEntry(userId: string, entry: CacheEntry) {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return;
  try {
    const map = readCacheMap();
    map[userId] = entry;
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    // 保存に失敗しても致命的ではないので無視
  }
}

export default function MarketingGuideCard() {
  const creds1 = useAppStore((s) => s.instagramCredentials);
  const creds2 = useAppStore((s) => s.secondInstagramCredentials);
  const creds3 = useAppStore((s) => s.thirdInstagramCredentials);
  const activeAccountSlot = useAppStore((s) => s.activeAccountSlot);
  const instagramCredentials = activeAccountSlot === 3 ? creds3 : activeAccountSlot === 2 ? creds2 : creds1;

  const [rank, setRank] = useState<AccountRank | null>(null);
  const [grade, setGrade] = useState<AccountScoreGrade | null>(null);
  const [guide, setGuide] = useState<MarketingGuide | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const userId = instagramCredentials?.userId;
    const accessToken = instagramCredentials?.accessToken;
    if (!userId || !accessToken) return;

    const thisWeek = getIsoWeekKey(new Date());
    const cached = readCacheMap()[userId];
    if (cached && cached.weekKey === thisWeek) {
      setRank(cached.rank);
      setGrade(cached.grade);
      setGuide(cached.guide);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        const insights = await getInsightsSummary(accessToken, 24);
        const facts = computeInsightFacts(insights);
        const followersCount = insights.profile.followers_count ?? 0;
        const mediaCount = insights.profile.media_count ?? insights.media.length;
        const nextRank = computeAccountRank(followersCount, mediaCount);
        const nextGrade = computeAccountScore(insights.summary.engagement_rate, facts?.details.trendPct ?? null);

        const nextGuide = await generateMarketingGuide({
          rankLabel: ACCOUNT_RANK_LABEL[nextRank],
          followersCount,
          mediaCount,
          avgLikes: insights.summary.avg_likes,
          avgComments: insights.summary.avg_comments,
          engagementRate: insights.summary.engagement_rate,
          bestHourLabel: facts?.details.bestHour ? `${facts.details.bestHour.hour}時台` : null,
          bestDowLabel: facts?.details.bestDow ? `${facts.details.bestDow.label}曜日` : null,
          topPostCaption: facts?.details.topPost?.caption ?? null,
        });

        if (cancelled) return;
        setRank(nextRank);
        setGrade(nextGrade);
        setGuide(nextGuide);
        writeCacheEntry(userId, { rank: nextRank, grade: nextGrade, guide: nextGuide, weekKey: thisWeek });
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [instagramCredentials?.userId, instagramCredentials?.accessToken]);

  if (!instagramCredentials || failed) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="trending-up-outline" size={16} color={COLORS.primary} />
          <Text style={styles.title}>Instagramマーケティングガイド</Text>
        </View>
        {grade && (
          <View style={[styles.gradeBadge, { backgroundColor: ACCOUNT_SCORE_COLOR[grade] }]}>
            <Text style={styles.gradeBadgeText}>{grade}</Text>
          </View>
        )}
      </View>

      {loading && !guide ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={COLORS.primary} size="small" />
          <Text style={styles.loadingText}>アカウントを分析しています...</Text>
        </View>
      ) : guide && rank ? (
        <>
          <View style={styles.rankBadge}>
            <Text style={styles.rankBadgeText}>{ACCOUNT_RANK_LABEL[rank]}</Text>
          </View>
          <Text style={styles.headline}>{guide.headline}</Text>
          {guide.tips.map((tip, i) => (
            <View key={i} style={styles.tipRow}>
              <Text style={styles.tipBullet}>・</Text>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  gradeBadge: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradeBadgeText: { color: '#0A0A0A', fontSize: 22, fontWeight: '900' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm },
  loadingText: { color: COLORS.textMuted, fontSize: 12.5 },
  rankBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary + '1a',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    marginBottom: SPACING.xs,
  },
  rankBadgeText: { color: COLORS.primary, fontSize: 11, fontWeight: '800' },
  headline: { color: COLORS.text, fontSize: 14.5, fontWeight: '800', marginBottom: SPACING.sm },
  tipRow: { flexDirection: 'row', marginBottom: 4 },
  tipBullet: { color: COLORS.textSecondary, fontSize: 13 },
  tipText: { flex: 1, color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
});

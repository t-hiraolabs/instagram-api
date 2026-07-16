// 「はじめてガイド」を完了したユーザー向けに、実際のInstagramデータをもとに
// アカウントの段階（立ち上げ期／成長期／定着期）を判定し、それに応じたAIアドバイスを表示する。
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore } from '../store/appStore';
import { getInsightsSummary, computeInsightFacts, computeAccountRank, ACCOUNT_RANK_LABEL, AccountRank } from '../services/insightsService';
import { generateMarketingGuide, MarketingGuide } from '../services/aiService';

// 一度生成したアドバイスは端末に保存し、同じ段階の間は再生成しない
// （ホームを開くたびにAIを呼ぶのは無駄なため。手動更新ボタンでいつでも作り直せる）
const CACHE_KEY = 'aimark_marketing_guide_v1';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7日

interface Cache {
  userId: string;
  rank: AccountRank;
  guide: MarketingGuide;
  generatedAt: number;
}

function readCache(): Cache | null {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cache) : null;
  } catch {
    return null;
  }
}

function writeCache(cache: Cache) {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 保存に失敗しても致命的ではないので無視
  }
}

export default function MarketingGuideCard() {
  const instagramCredentials = useAppStore((s) => s.instagramCredentials);
  const [rank, setRank] = useState<AccountRank | null>(null);
  const [guide, setGuide] = useState<MarketingGuide | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async (forceRefresh: boolean) => {
    if (!instagramCredentials?.accessToken) return;
    setLoading(true);
    setFailed(false);
    try {
      const insights = await getInsightsSummary(instagramCredentials.accessToken, 24);
      const facts = computeInsightFacts(insights);
      const followersCount = insights.profile.followers_count ?? 0;
      const mediaCount = insights.profile.media_count ?? insights.media.length;
      const nextRank = computeAccountRank(followersCount, mediaCount);
      setRank(nextRank);

      const cache = readCache();
      const cacheValid =
        !forceRefresh &&
        cache &&
        cache.userId === instagramCredentials.userId &&
        cache.rank === nextRank &&
        Date.now() - cache.generatedAt < CACHE_MAX_AGE_MS;

      if (cacheValid && cache) {
        setGuide(cache.guide);
        return;
      }

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
      setGuide(nextGuide);
      writeCache({ userId: instagramCredentials.userId, rank: nextRank, guide: nextGuide, generatedAt: Date.now() });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instagramCredentials?.userId]);

  if (!instagramCredentials || failed) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="trending-up-outline" size={16} color={COLORS.primary} />
          <Text style={styles.title}>Instagramマーケティングガイド</Text>
        </View>
        <TouchableOpacity onPress={() => load(true)} disabled={loading} hitSlop={8}>
          <Ionicons name="refresh-outline" size={16} color={loading ? COLORS.textMuted : COLORS.textSecondary} />
        </TouchableOpacity>
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

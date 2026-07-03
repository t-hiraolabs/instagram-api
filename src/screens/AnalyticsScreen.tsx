import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore } from '../store/appStore';
import { getInsightsSummary, InsightsResult, InsightsMedia } from '../services/insightsService';
import { getMyPlan } from '../services/scheduleService';
import { Plan, canAnalytics } from '../utils/plans';

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  return n.toLocaleString();
}

function mediaTypeLabel(t?: string): string {
  if (t === 'VIDEO') return '🎬 動画';
  if (t === 'CAROUSEL_ALBUM') return '🖼 複数枚';
  return '📷 写真';
}

function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const creds1 = useAppStore((s) => s.instagramCredentials);
  const creds2 = useAppStore((s) => s.secondInstagramCredentials);
  const activeAccountSlot = useAppStore((s) => s.activeAccountSlot);
  const instagramCredentials = activeAccountSlot === 2 ? creds2 : creds1;

  const [plan, setPlan] = useState<Plan>('free');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InsightsResult | null>(null);

  useEffect(() => {
    getMyPlan().then(setPlan).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!instagramCredentials?.accessToken) {
      setData(null);
      return;
    }
    setError(null);
    try {
      const res = await getInsightsSummary(instagramCredentials.accessToken, 12);
      setData(res);
    } catch (e) {
      setError((e as { message?: string })?.message || '分析データの取得に失敗しました');
    }
  }, [instagramCredentials?.accessToken]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // ビジネスプラン限定の機能
  if (!canAnalytics(plan)) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.bigEmoji}>📊</Text>
        <Text style={styles.emptyTitle}>インサイト分析は「ビジネス」プラン限定です</Text>
        <Text style={styles.emptyDesc}>
          フォロワー数や投稿の反応（いいね・コメント・リーチ）を分析し、{'\n'}
          反応の良い投稿の傾向をAI生成にも活かせます。{'\n\n'}
          「プロフィール」タブから ビジネスプラン（¥2,980/月）にアップグレードすると使えます。
        </Text>
      </View>
    );
  }

  // 未連携
  if (!instagramCredentials?.accessToken) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.bigEmoji}>📊</Text>
        <Text style={styles.emptyTitle}>分析を見るにはInstagram連携が必要です</Text>
        <Text style={styles.emptyDesc}>
          「プロフィール」タブからInstagramアカウントを連携すると、{'\n'}
          フォロワー数や投稿の反応を分析できます。
        </Text>
      </View>
    );
  }

  // 人気投稿ランキング（いいね順）
  const ranked: InsightsMedia[] = data
    ? [...data.media].sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0))
    : [];

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: 100 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>📊 分析</Text>
          {data?.profile?.username ? (
            <Text style={styles.subtitle}>@{data.profile.username}</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={onRefresh}
          disabled={refreshing || loading}
        >
          <Text style={[styles.refreshBtnText, (refreshing || loading) && { opacity: 0.4 }]}>
            {refreshing || loading ? '更新中...' : '↻ 更新'}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 80 }} />
      ) : error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>取得できませんでした</Text>
          <Text style={styles.errorMsg}>{error}</Text>
          <Text style={styles.errorHint}>
            ※ Instagramの分析データは、ビジネス／クリエイターアカウントで取得できます。{'\n'}
            個人アカウントの場合はプロアカウントへの切り替えが必要です。
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={onRefresh}>
            <Text style={styles.retryText}>再読み込み</Text>
          </TouchableOpacity>
        </View>
      ) : data ? (
        <>
          {/* サマリー */}
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{fmt(data.profile.followers_count)}</Text>
              <Text style={styles.statLabel}>フォロワー</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{fmt(data.profile.media_count)}</Text>
              <Text style={styles.statLabel}>投稿数</Text>
            </View>
          </View>

          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{fmt(data.summary.avg_likes)}</Text>
              <Text style={styles.statLabel}>平均いいね</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{fmt(data.summary.avg_comments)}</Text>
              <Text style={styles.statLabel}>平均コメント</Text>
            </View>
          </View>

          {data.summary.engagement_rate != null && (
            <View style={styles.engagementCard}>
              <Text style={styles.engagementValue}>{data.summary.engagement_rate}%</Text>
              <Text style={styles.engagementLabel}>エンゲージメント率（直近{data.summary.analyzed_count}投稿の平均）</Text>
              <Text style={styles.engagementHint}>
                {data.summary.engagement_rate >= 3
                  ? '🔥 とても良い反応です！'
                  : data.summary.engagement_rate >= 1
                  ? '👍 平均的な反応です'
                  : '💡 投稿時間やハッシュタグを見直してみましょう'}
              </Text>
            </View>
          )}

          {/* 人気投稿ランキング */}
          <Text style={styles.sectionTitle}>🏆 人気の投稿（いいね順）</Text>
          {ranked.length === 0 ? (
            <Text style={styles.emptyDesc}>まだ投稿がありません</Text>
          ) : (
            ranked.map((m, i) => (
              <View key={m.id} style={styles.postRow}>
                <Text style={styles.rank}>{i + 1}</Text>
                {m.thumbnail_url || m.media_url ? (
                  <Image
                    source={{ uri: m.thumbnail_url || m.media_url }}
                    style={styles.thumb}
                  />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]}>
                    <Text style={{ fontSize: 20 }}>📷</Text>
                  </View>
                )}
                <View style={styles.postInfo}>
                  <Text style={styles.postCaption} numberOfLines={2}>
                    {m.caption?.trim() || '（キャプションなし）'}
                  </Text>
                  <Text style={styles.postMeta}>
                    {mediaTypeLabel(m.media_type)} ・ {shortDate(m.timestamp)}
                  </Text>
                  <View style={styles.postStats}>
                    <Text style={styles.postStat}>❤️ {fmt(m.like_count ?? 0)}</Text>
                    <Text style={styles.postStat}>💬 {fmt(m.comments_count ?? 0)}</Text>
                    {m.reach != null && <Text style={styles.postStat}>👁 {fmt(m.reach)}</Text>}
                  </View>
                </View>
              </View>
            ))
          )}

          <Text style={styles.footnote}>
            {data.summary.has_reach
              ? '👁 = リーチ（見られた人数）'
              : '※ リーチは取得できる投稿のみ表示されます'}
            {'\n'}下に引っ張ると最新データに更新できます。
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  bigEmoji: { fontSize: 56, marginBottom: SPACING.md },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.sm,
  },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.primary, fontWeight: '700', marginTop: 2 },
  refreshBtn: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  refreshBtnText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },

  statRow: { flexDirection: 'row', paddingHorizontal: SPACING.md, gap: SPACING.sm, marginBottom: SPACING.sm },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statValue: { fontSize: 26, fontWeight: '900', color: COLORS.text },
  statLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },

  engagementCard: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.secondary,
  },
  engagementValue: { fontSize: 34, fontWeight: '900', color: COLORS.primaryLight },
  engagementLabel: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4, textAlign: 'center' },
  engagementHint: { fontSize: 13, color: COLORS.text, marginTop: SPACING.sm, fontWeight: '700' },

  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  postRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rank: { width: 26, textAlign: 'center', fontSize: 18, fontWeight: '900', color: COLORS.primary },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.sm, backgroundColor: COLORS.surfaceElevated },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  postInfo: { flex: 1, marginLeft: SPACING.sm },
  postCaption: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  postMeta: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  postStats: { flexDirection: 'row', gap: SPACING.md, marginTop: 4 },
  postStat: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '700' },

  emptyTitle: { fontSize: 17, fontWeight: '800', color: COLORS.text, textAlign: 'center', marginBottom: SPACING.sm },
  emptyDesc: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: SPACING.md },

  errorBox: { margin: SPACING.md, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  errorTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.xs },
  errorMsg: { fontSize: 13, color: COLORS.error, marginBottom: SPACING.sm },
  errorHint: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  retryBtn: { marginTop: SPACING.md, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.sm, alignItems: 'center' },
  retryText: { color: '#fff', fontWeight: '800' },

  footnote: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center', marginTop: SPACING.lg, paddingHorizontal: SPACING.md, lineHeight: 16 },
});

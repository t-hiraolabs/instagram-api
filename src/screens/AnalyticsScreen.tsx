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
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline, Circle, Line } from 'react-native-svg';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore } from '../store/appStore';
import { supabase } from '../services/supabaseClient';
import {
  getInsightsSummary,
  computeInsightFacts,
  recordFollowerSnapshot,
  getFollowerHistory,
  computeFollowerDeltas,
  InsightsResult,
  InsightsMedia,
  FollowerSnapshotPoint,
} from '../services/insightsService';

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  return n.toLocaleString();
}

function mediaTypeLabel(t?: string): string {
  if (t === 'VIDEO') return '動画';
  if (t === 'CAROUSEL_ALBUM') return '複数枚';
  return '写真';
}

function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const DOW_LABEL = ['日', '月', '火', '水', '木', '金', '土'];
function shortDateWithDow(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW_LABEL[d.getDay()]})`;
}

const CHART_H = 100;
const CHART_PAD = 10;
// growthCardのmarginHorizontal(md)*2 + padding(lg)*2 の分を画面幅から差し引いた実際の描画幅
const CHART_HORIZONTAL_INSET = (SPACING.md + SPACING.lg) * 2;

/** フォロワー推移の折れ線グラフ。記録が2日分未満だとまだ推移が描けないので案内文だけ出す */
function FollowerGrowthChart({ points }: { points: FollowerSnapshotPoint[] }) {
  const { width: windowWidth } = useWindowDimensions();
  const chartW = Math.max(160, windowWidth - CHART_HORIZONTAL_INSET);

  if (points.length < 2) {
    return (
      <Text style={styles.growthEmptyText}>
        フォロワー数を毎日記録していきます。数日後に推移グラフが表示されます。
      </Text>
    );
  }
  const values = points.map((p) => p.followers);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const stepX = (chartW - CHART_PAD * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = CHART_PAD + i * stepX;
    const y = CHART_PAD + (1 - (p.followers - min) / range) * (CHART_H - CHART_PAD * 2);
    return { x, y };
  });
  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const first = points[0].followers;
  const last = points[points.length - 1].followers;
  const diff = last - first;

  return (
    <View>
      <View style={styles.growthHeaderRow}>
        <Text style={styles.growthValue}>{fmt(last)}人</Text>
        <Text style={[styles.growthDiff, diff < 0 && styles.growthDiffNegative]}>
          {diff > 0 ? '+' : ''}
          {diff.toLocaleString()}人（{shortDate(points[0].date + 'T00:00:00')}〜{shortDate(points[points.length - 1].date + 'T00:00:00')}）
        </Text>
      </View>
      <Svg width={chartW} height={CHART_H}>
        <Line x1={CHART_PAD} y1={CHART_H - CHART_PAD} x2={chartW - CHART_PAD} y2={CHART_H - CHART_PAD} stroke={COLORS.border} strokeWidth={1} />
        <Polyline points={polylinePoints} fill="none" stroke={COLORS.primary} strokeWidth={2.5} />
        {coords.map((c, i) => (
          <Circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 4 : 2.5} fill={COLORS.primary} />
        ))}
      </Svg>
    </View>
  );
}

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const creds1 = useAppStore((s) => s.instagramCredentials);
  const creds2 = useAppStore((s) => s.secondInstagramCredentials);
  const creds3 = useAppStore((s) => s.thirdInstagramCredentials);
  const activeAccountSlot = useAppStore((s) => s.activeAccountSlot);
  const instagramCredentials = activeAccountSlot === 3 ? creds3 : activeAccountSlot === 2 ? creds2 : creds1;

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InsightsResult | null>(null);
  const [followerHistory, setFollowerHistory] = useState<FollowerSnapshotPoint[]>([]);
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: d }) => setAuthUserId(d.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    if (!instagramCredentials?.accessToken) {
      setData(null);
      return;
    }
    setError(null);
    try {
      const res = await getInsightsSummary(instagramCredentials.accessToken, 24);
      setData(res);
      const igUserId = instagramCredentials.userId;
      if (igUserId && authUserId) {
        // フォロワー推移の記録・取得はグラフ用のおまけ機能なので、失敗しても分析本体を壊さない
        try {
          await recordFollowerSnapshot(igUserId, authUserId, res.profile.followers_count, res.profile.media_count);
          setFollowerHistory(await getFollowerHistory(igUserId, 30));
        } catch {
          // ignore
        }
      }
    } catch (e) {
      setError((e as { message?: string })?.message || '分析データの取得に失敗しました');
    }
  }, [instagramCredentials?.accessToken, instagramCredentials?.userId, authUserId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // 未連携
  if (!instagramCredentials?.accessToken) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
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

  // 投稿タイプ別・曜日別・時間帯別・ハッシュタグ別の反応、トレンド、最弱投稿（すべてinsightsServiceの共通ロジックで算出）
  const facts = data ? computeInsightFacts(data) : null;
  const typeStats = facts?.details.typeBreakdown ?? [];
  const dowStats = facts?.details.dowBreakdown ?? [];
  const timeOfDayStats = facts?.details.timeOfDayBreakdown ?? [];
  const hashtagStats = facts?.details.hashtagBreakdown ?? [];
  const bottomPost = facts?.details.bottomPost ?? null;
  const trendPct = facts?.details.trendPct ?? null;
  const maxAvg = Math.max(
    1,
    ...typeStats.map((t) => t.avg),
    ...dowStats.map((d) => d.avg),
    ...timeOfDayStats.map((t) => t.avg)
  );
  const maxHashtagAvg = Math.max(1, ...hashtagStats.map((h) => h.avg));
  const followerDeltas = computeFollowerDeltas(followerHistory);

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
          <Text style={styles.title}>分析</Text>
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

          {/* フォロワー推移 */}
          <Text style={styles.sectionTitle}>フォロワー推移</Text>
          <View style={styles.growthCard}>
            <FollowerGrowthChart points={followerHistory} />
          </View>

          {/* 日ごとのフォロワー増減。Instagram公式APIでは「誰が」フォロー・解除したかは
              取得できないため、記録している合計フォロワー数から前日比の純増減のみを示す */}
          {followerDeltas.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>日ごとのフォロワー増減</Text>
              <View style={styles.breakdownCard}>
                {followerDeltas.map((d) => (
                  <View key={d.date} style={styles.deltaRow}>
                    <Text style={styles.deltaDate}>{shortDateWithDow(d.date)}</Text>
                    <Text style={[styles.deltaValue, d.change < 0 && styles.deltaValueNegative]}>
                      {d.change > 0 ? '+' : ''}
                      {d.change}人
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={styles.footnote}>
                ※ Instagramの仕様上、誰がフォロー・フォロー解除したかは分かりません。前回記録時からの合計フォロワー数の増減（純増減）のみ表示しています。
              </Text>
            </>
          )}

          {data.summary.engagement_rate != null && (
            <View style={styles.engagementCard}>
              <Text style={styles.engagementValue}>{data.summary.engagement_rate}%</Text>
              <Text style={styles.engagementLabel}>エンゲージメント率（直近{data.summary.analyzed_count}投稿の平均）</Text>
              <Text style={styles.engagementHint}>
                {data.summary.engagement_rate >= 3
                  ? 'とても良い反応です！'
                  : data.summary.engagement_rate >= 1
                  ? '平均的な反応です'
                  : '投稿時間やハッシュタグを見直してみましょう'}
              </Text>
              {trendPct != null && (
                <View style={styles.trendBadge}>
                  <Ionicons
                    name={trendPct >= 0 ? 'trending-up' : 'trending-down'}
                    size={14}
                    color={trendPct >= 0 ? COLORS.success : COLORS.error}
                  />
                  <Text style={[styles.trendBadgeText, { color: trendPct >= 0 ? COLORS.success : COLORS.error }]}>
                    直近投稿は{trendPct > 0 ? '+' : ''}{trendPct}%（それ以前の投稿と比較）
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* 過去投稿の傾向分析: 投稿タイプ別・曜日別・時間帯別 */}
          {(typeStats.length > 1 || dowStats.length > 1 || timeOfDayStats.length > 1) && (
            <>
              <Text style={styles.sectionTitle}>過去投稿の傾向</Text>
              <View style={styles.breakdownCard}>
                {typeStats.length > 1 && (
                  <>
                    <Text style={styles.breakdownLabel}>投稿タイプ別の平均反応</Text>
                    {typeStats.map((t) => (
                      <View key={t.label} style={styles.breakdownRow}>
                        <Text style={styles.breakdownRowLabel} numberOfLines={1}>{t.label}（{t.count}件）</Text>
                        <View style={styles.breakdownBarTrack}>
                          <View style={[styles.breakdownBarFill, { width: `${Math.max(4, (t.avg / maxAvg) * 100)}%` }]} />
                        </View>
                        <Text style={styles.breakdownRowValue}>{t.avg}</Text>
                      </View>
                    ))}
                  </>
                )}
                {dowStats.length > 1 && (
                  <>
                    <Text style={[styles.breakdownLabel, { marginTop: SPACING.md }]}>曜日別の平均反応</Text>
                    {dowStats.map((d) => (
                      <View key={d.label} style={styles.breakdownRow}>
                        <Text style={styles.breakdownRowLabel} numberOfLines={1}>{d.label}（{d.count}件）</Text>
                        <View style={styles.breakdownBarTrack}>
                          <View style={[styles.breakdownBarFill, { width: `${Math.max(4, (d.avg / maxAvg) * 100)}%` }]} />
                        </View>
                        <Text style={styles.breakdownRowValue}>{d.avg}</Text>
                      </View>
                    ))}
                  </>
                )}
                {timeOfDayStats.length > 1 && (
                  <>
                    <Text style={[styles.breakdownLabel, { marginTop: SPACING.md }]}>投稿時間帯別の平均反応</Text>
                    {timeOfDayStats.map((t) => (
                      <View key={t.label} style={styles.breakdownRow}>
                        <Text style={styles.breakdownRowLabel} numberOfLines={1}>{t.label}（{t.count}件）</Text>
                        <View style={styles.breakdownBarTrack}>
                          <View style={[styles.breakdownBarFill, { width: `${Math.max(4, (t.avg / maxAvg) * 100)}%` }]} />
                        </View>
                        <Text style={styles.breakdownRowValue}>{t.avg}</Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
              <Text style={styles.footnote}>
                チャットで「競合分析して」と聞くと、あなたの実績を基準に競合アカウントとの比較アドバイスももらえます。
              </Text>
            </>
          )}

          {/* ハッシュタグ別の反応 */}
          {hashtagStats.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>反応が良いハッシュタグ</Text>
              <View style={styles.breakdownCard}>
                {hashtagStats.map((h) => (
                  <View key={h.tag} style={styles.breakdownRow}>
                    <Text style={styles.breakdownRowLabel} numberOfLines={1}>{h.tag}（{h.count}件）</Text>
                    <View style={styles.breakdownBarTrack}>
                      <View style={[styles.breakdownBarFill, { width: `${Math.max(4, (h.avg / maxHashtagAvg) * 100)}%` }]} />
                    </View>
                    <Text style={styles.breakdownRowValue}>{h.avg}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* 反応が伸び悩んだ投稿 */}
          {bottomPost && (
            <>
              <Text style={styles.sectionTitle}>改善のヒント</Text>
              <View style={styles.hintCard}>
                <Text style={styles.hintLabel}>反応が伸び悩んだ投稿</Text>
                <Text style={styles.hintCaption} numberOfLines={2}>
                  「{bottomPost.caption || '（キャプションなし）'}」
                </Text>
                <Text style={styles.hintStats}>いいね {fmt(bottomPost.likes)} ・ コメント {fmt(bottomPost.comments)}</Text>
              </View>
            </>
          )}

          {/* 人気投稿ランキング */}
          <Text style={styles.sectionTitle}>人気の投稿（いいね順）</Text>
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
                    <Ionicons name="image-outline" size={20} color={COLORS.textMuted} />
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
                    <Text style={styles.postStat}>いいね {fmt(m.like_count ?? 0)}</Text>
                    <Text style={styles.postStat}>コメント {fmt(m.comments_count ?? 0)}</Text>
                    {m.reach != null && <Text style={styles.postStat}>リーチ {fmt(m.reach)}</Text>}
                  </View>
                </View>
              </View>
            ))
          )}

          <Text style={styles.footnote}>
            {data.summary.has_reach
              ? 'リーチ = 見られた人数'
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
  trendBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: SPACING.sm },
  trendBadgeText: { fontSize: 12, fontWeight: '700' },

  growthCard: {
    marginHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  growthEmptyText: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  growthHeaderRow: { flexDirection: 'row', alignItems: 'baseline', gap: SPACING.sm, marginBottom: SPACING.sm, alignSelf: 'flex-start' },
  growthValue: { fontSize: 22, fontWeight: '900', color: COLORS.text },
  growthDiff: { fontSize: 12, fontWeight: '700', color: COLORS.success },
  growthDiffNegative: { color: COLORS.error },

  hintCard: {
    marginHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  hintLabel: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '700', marginBottom: SPACING.xs },
  hintCaption: { fontSize: 13, color: COLORS.text, fontWeight: '600', marginBottom: SPACING.xs },
  hintStats: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '700' },

  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  breakdownCard: {
    marginHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  breakdownLabel: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '700', marginBottom: SPACING.sm },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm, gap: SPACING.sm },
  breakdownRowLabel: { width: 76, fontSize: 12, color: COLORS.text, fontWeight: '600' },
  breakdownBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: COLORS.surfaceElevated, overflow: 'hidden' },
  breakdownBarFill: { height: 8, borderRadius: 4, backgroundColor: COLORS.primary },
  breakdownRowValue: { width: 34, textAlign: 'right', fontSize: 12, color: COLORS.textSecondary, fontWeight: '700' },
  deltaRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: SPACING.xs,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  deltaDate: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  deltaValue: { fontSize: 14, color: COLORS.success, fontWeight: '800' },
  deltaValueNegative: { color: COLORS.error },
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

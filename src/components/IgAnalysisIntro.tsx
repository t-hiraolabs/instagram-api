// Instagram連携が完了した直後に表示する「アカウント分析→アプリへ」の入口画面。
// ここでのAI呼び出しはコストゼロ（プログラム側の集計のみ）にして、初回体験を軽くする。
// Instagramと連携しているからこそ得られる「このアカウント固有の実データ」を見せることが、
// 汎用チャットボットとの違い＝AImarkにしかできないことのアピールになる。
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../store/appStore';
import { getInsightsSummary, InsightsResult, computeInsightFacts, InsightDetails } from '../services/insightsService';
import { saveFirstAnalysisSnapshot } from '../services/firstAnalysisService';
import { COLORS, SPACING, RADIUS } from '../utils/theme';

function oneLineTakeaway(insights: InsightsResult): string {
  const rate = insights.summary.engagement_rate;
  if (rate == null) return 'これから投稿を重ねると、傾向が見えてきます。まずは今日の1枚から始めましょう。';
  if (rate >= 3) return 'エンゲージメント率は良好です。この調子を維持する投稿を続けましょう。';
  if (rate >= 1) return '平均的な水準です。投稿時間やハッシュタグを見直すと伸びる余地があります。';
  return '反応がやや控えめです。投稿頻度や内容を一緒に見直していきましょう。';
}

export default function IgAnalysisIntro() {
  const insets = useSafeAreaInsets();
  const intro = useAppStore((s) => s.analysisIntro);
  const setAnalysisIntro = useAppStore((s) => s.setAnalysisIntro);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<InsightsResult | null>(null);
  const [details, setDetails] = useState<InsightDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!intro) return;
    setLoading(true);
    setResult(null);
    setDetails(null);
    setError(null);
    getInsightsSummary(intro.accessToken, 30)
      .then((res) => {
        setResult(res);
        setDetails(computeInsightFacts(res)?.details ?? null);
        if (intro.igUserId) saveFirstAnalysisSnapshot(intro.igUserId, res).catch(() => {});
      })
      .catch((e) => setError(e instanceof Error ? e.message : '分析データの取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [intro]);

  if (!intro) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={() => {}}>
      <View style={[styles.container, { paddingTop: insets.top + SPACING.lg, paddingBottom: insets.bottom + SPACING.lg }]}>
        <Text style={styles.eyebrow}>連携完了</Text>
        <Text style={styles.title}>@{intro.username ?? 'あなたのアカウント'} を分析しています</Text>

        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: SPACING.md }} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={styles.loadingText}>投稿データを取得中...</Text>
              </View>
            ) : error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : result ? (
              <>
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{result.profile.followers_count}</Text>
                    <Text style={styles.statLabel}>フォロワー</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{result.summary.avg_likes}</Text>
                    <Text style={styles.statLabel}>平均いいね</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{result.summary.engagement_rate != null ? `${result.summary.engagement_rate}%` : '—'}</Text>
                    <Text style={styles.statLabel}>エンゲージメント率</Text>
                  </View>
                </View>
                <Text style={styles.takeaway}>{oneLineTakeaway(result)}</Text>
              </>
            ) : null}
          </View>

          {details && (
            <View style={styles.detailCard}>
              <Text style={styles.detailHeader}>🔎 Instagram連携だからわかること</Text>
              <Text style={styles.detailSub}>あなたのアカウントの実データだけを見て算出した、この場限りの分析です</Text>

              {details.trendPct != null && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailIcon}>{details.trendPct >= 0 ? '📈' : '📉'}</Text>
                  <Text style={styles.detailText}>
                    直近{details.recentCount}投稿の反応は、その前の{details.olderCount}投稿と比べて
                    <Text style={styles.detailStrong}>{details.trendPct > 0 ? '+' : ''}{details.trendPct}%</Text>
                  </Text>
                </View>
              )}

              {details.bestHour && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailIcon}>⏰</Text>
                  <Text style={styles.detailText}>
                    最も反応が良い投稿時間帯は<Text style={styles.detailStrong}>{details.bestHour.hour}時台</Text>です
                  </Text>
                </View>
              )}

              {details.bestDow && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailIcon}>📅</Text>
                  <Text style={styles.detailText}>
                    最も反応が良い曜日は<Text style={styles.detailStrong}>{details.bestDow.label}曜日</Text>です
                  </Text>
                </View>
              )}

              {details.typeBreakdown.length > 1 && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailIcon}>🗂</Text>
                  <Text style={styles.detailText}>
                    投稿タイプ別の反応: {details.typeBreakdown.map((t) => `${t.label} ${t.avg}`).join(' / ')}
                  </Text>
                </View>
              )}

              {details.topPost && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailIcon}>🏆</Text>
                  <Text style={styles.detailText}>
                    一番反応が良かった投稿:「{details.topPost.caption || '（キャプションなし）'}」
                    （❤️{details.topPost.likes}・💬{details.topPost.comments}）
                  </Text>
                </View>
              )}

              <View style={styles.detailRow}>
                <Text style={styles.detailIcon}>{details.bioSet ? '✅' : '⚠️'}</Text>
                <Text style={styles.detailText}>
                  自己紹介文は{details.bioSet ? '設定済みです' : '未設定です。設定するとプロフィールの説得力が上がります'}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailIcon}>{details.websiteSet ? '✅' : '⚠️'}</Text>
                <Text style={styles.detailText}>
                  プロフィールのリンクは{details.websiteSet ? '設定済みです' : '未設定です。予約・購入ページなどを設定すると導線が生まれます'}
                </Text>
              </View>

              <Text style={styles.detailFootnote}>
                これは他の誰でもない、あなたのアカウントを連携したからこそ出せた結果です。汎用的なAIチャットだけでは、ここまで具体的な話はできません。
              </Text>
            </View>
          )}
        </ScrollView>

        <Text style={styles.hint}>もっと詳しい分析や改善提案、競合との比較は、アプリ内でいつでも「分析して」と聞くだけでAIが答えます。</Text>

        <TouchableOpacity style={styles.cta} onPress={() => setAnalysisIntro(null)} activeOpacity={0.85}>
          <Text style={styles.ctaText}>アプリを始める →</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.lg },
  eyebrow: { color: COLORS.primary, fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  title: { color: COLORS.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: SPACING.md },
  scroll: { flex: 1 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
    padding: SPACING.lg, minHeight: 140, justifyContent: 'center', marginBottom: SPACING.md,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  loadingText: { color: COLORS.textMuted, fontSize: 13 },
  errorText: { color: COLORS.error, fontSize: 13, textAlign: 'center' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: SPACING.md },
  statItem: { alignItems: 'center', gap: 4 },
  statValue: { color: COLORS.primary, fontSize: 22, fontWeight: '800' },
  statLabel: { color: COLORS.textMuted, fontSize: 11 },
  takeaway: { color: COLORS.text, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  detailCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.secondary,
    padding: SPACING.lg, marginBottom: SPACING.md,
  },
  detailHeader: { color: COLORS.text, fontSize: 15, fontWeight: '800', marginBottom: 2 },
  detailSub: { color: COLORS.textMuted, fontSize: 11, marginBottom: SPACING.md, lineHeight: 16 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, marginBottom: SPACING.sm },
  detailIcon: { fontSize: 14, width: 20 },
  detailText: { flex: 1, color: COLORS.text, fontSize: 13, lineHeight: 19 },
  detailStrong: { color: COLORS.primary, fontWeight: '800' },
  detailFootnote: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: SPACING.xs },
  hint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: SPACING.md, marginBottom: SPACING.md, lineHeight: 18 },
  cta: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: SPACING.md, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

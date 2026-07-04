// Instagram連携が完了した直後に表示する「アカウント分析→アプリへ」の入口画面。
// ここでのAI呼び出しはコストゼロ（プログラム側の集計のみ）にして、初回体験を軽くする。
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../store/appStore';
import { getInsightsSummary, InsightsResult } from '../services/insightsService';
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!intro) return;
    setLoading(true);
    setResult(null);
    setError(null);
    getInsightsSummary(intro.accessToken, 12)
      .then(setResult)
      .catch((e) => setError(e instanceof Error ? e.message : '分析データの取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [intro]);

  if (!intro) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={() => {}}>
      <View style={[styles.container, { paddingTop: insets.top + SPACING.xl, paddingBottom: insets.bottom + SPACING.lg }]}>
        <Text style={styles.eyebrow}>連携完了</Text>
        <Text style={styles.title}>@{intro.username ?? 'あなたのアカウント'} を分析しています</Text>

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

        <Text style={styles.hint}>もっと詳しい分析や改善提案は、アプリ内でいつでも「分析して」と聞くだけでAIが答えます。</Text>

        <TouchableOpacity style={styles.cta} onPress={() => setAnalysisIntro(null)} activeOpacity={0.85}>
          <Text style={styles.ctaText}>アプリを始める →</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.lg, justifyContent: 'center' },
  eyebrow: { color: COLORS.primary, fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  title: { color: COLORS.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: SPACING.lg },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
    padding: SPACING.lg, minHeight: 140, justifyContent: 'center', marginBottom: SPACING.lg,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  loadingText: { color: COLORS.textMuted, fontSize: 13 },
  errorText: { color: COLORS.error, fontSize: 13, textAlign: 'center' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: SPACING.md },
  statItem: { alignItems: 'center', gap: 4 },
  statValue: { color: COLORS.primary, fontSize: 22, fontWeight: '800' },
  statLabel: { color: COLORS.textMuted, fontSize: 11 },
  takeaway: { color: COLORS.text, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  hint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginBottom: SPACING.xl, lineHeight: 18 },
  cta: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: SPACING.md, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

// Instagram連携が完了した直後に表示する「アカウント分析結果」ページ。
// 数値の集計はプログラム側で行いコストゼロ、その事実だけを根拠にAI（安価なHaikuモデル、
// 通常のAI生成回数は消費しない）が評論家として良い点・改善点・市場価値を厳しく評価する。
// MBTI診断のような「大きな結果発表→スクロールでカードごとに詳細」という見せ方にし、
// Instagramと連携しているからこそ得られる実データを見せることで、
// 汎用チャットボットとの違い＝AImarkにしかできないことをアピールする。
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../store/appStore';
import { getInsightsSummary, InsightsResult, computeInsightFacts, InsightDetails } from '../services/insightsService';
import { saveFirstAnalysisSnapshot } from '../services/firstAnalysisService';
import { critiqueAccountFacts, AccountCritique } from '../services/aiService';
import { COLORS, SPACING, RADIUS } from '../utils/theme';

const ACCENTS = [COLORS.secondary, COLORS.primary, COLORS.primaryLight];

function heroLabel(insights: InsightsResult): { emoji: string; label: string; desc: string } {
  const rate = insights.summary.engagement_rate;
  if (rate == null) return { emoji: '🌱', label: 'これから伸びるアカウント', desc: 'これから投稿を重ねると、傾向が見えてきます。まずは今日の1枚から始めましょう。' };
  if (rate >= 3) return { emoji: '🔥', label: '反応良好なアカウント', desc: 'エンゲージメント率は良好です。この調子を維持する投稿を続けましょう。' };
  if (rate >= 1) return { emoji: '👍', label: '平均的なアカウント', desc: '平均的な水準です。投稿時間やハッシュタグを見直すと伸びる余地があります。' };
  return { emoji: '💡', label: '伸びしろのあるアカウント', desc: '反応がやや控えめです。投稿頻度や内容を一緒に見直していきましょう。' };
}

interface ResultCard {
  emoji: string;
  title: string;
  body: string;
}

function buildCards(details: InsightDetails): ResultCard[] {
  const cards: ResultCard[] = [];
  if (details.trendPct != null) {
    cards.push({
      emoji: details.trendPct >= 0 ? '📈' : '📉',
      title: '投稿の勢い',
      body: `直近${details.recentCount}投稿の反応は、その前の${details.olderCount}投稿と比べて${details.trendPct > 0 ? '+' : ''}${details.trendPct}%`,
    });
  }
  if (details.bestHour) {
    cards.push({
      emoji: '⏰',
      title: 'ベストな投稿時間帯',
      body: `${details.bestHour.hour}時台の投稿が、最も反応を集めています`,
    });
  }
  if (details.bestDow) {
    cards.push({
      emoji: '📅',
      title: 'ベストな投稿曜日',
      body: `${details.bestDow.label}曜日の投稿が、最も反応を集めています`,
    });
  }
  if (details.typeBreakdown.length > 1) {
    cards.push({
      emoji: '🗂',
      title: '投稿タイプ別の反応',
      body: details.typeBreakdown.map((t) => `${t.label}: 平均反応${t.avg}`).join('\n'),
    });
  }
  if (details.topPost) {
    cards.push({
      emoji: '🏆',
      title: '一番反応が良かった投稿',
      body: `「${details.topPost.caption || '（キャプションなし）'}」\n❤️${details.topPost.likes}・💬${details.topPost.comments}`,
    });
  }
  cards.push({
    emoji: details.bioSet ? '✅' : '⚠️',
    title: '自己紹介文',
    body: details.bioSet ? '設定済みです' : '未設定です。設定するとプロフィールの説得力が上がります',
  });
  cards.push({
    emoji: details.websiteSet ? '✅' : '⚠️',
    title: 'プロフィールのリンク',
    body: details.websiteSet ? '設定済みです' : '未設定です。予約・購入ページなどを設定すると導線が生まれます',
  });
  return cards;
}

export default function IgAnalysisIntro() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const intro = useAppStore((s) => s.analysisIntro);
  const setAnalysisIntro = useAppStore((s) => s.setAnalysisIntro);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<InsightsResult | null>(null);
  const [details, setDetails] = useState<InsightDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [critique, setCritique] = useState<AccountCritique | null>(null);
  const [critiqueLoading, setCritiqueLoading] = useState(false);
  const [critiqueError, setCritiqueError] = useState<string | null>(null);

  const finish = () => {
    setAnalysisIntro(null);
    navigation.reset({ index: 0, routes: [{ name: 'Main' as never }] });
  };

  useEffect(() => {
    if (!intro) return;
    setLoading(true);
    setResult(null);
    setDetails(null);
    setError(null);
    setCritique(null);
    setCritiqueError(null);
    getInsightsSummary(intro.accessToken, 30)
      .then((res) => {
        setResult(res);
        const computed = computeInsightFacts(res);
        setDetails(computed?.details ?? null);
        if (intro.igUserId) saveFirstAnalysisSnapshot(intro.igUserId, res).catch(() => {});
        if (computed) {
          setCritiqueLoading(true);
          critiqueAccountFacts(computed.lines.join('\n'))
            .then(setCritique)
            .catch((e) => setCritiqueError(e instanceof Error ? e.message : 'AIの評論を取得できませんでした'))
            .finally(() => setCritiqueLoading(false));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : '分析データの取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [intro]);

  useEffect(() => {
    // 診断データがない状態でこの画面に直接来た場合（リロードなど）はホームへ戻す
    if (!intro) navigation.reset({ index: 0, routes: [{ name: 'Main' as never }] });
  }, [intro]);

  if (!intro) return null;

  const hero = result ? heroLabel(result) : null;
  const cards = details ? buildCards(details) : [];

  return (
      <View style={styles.page}>
        {loading ? (
          <View style={[styles.loadingScreen, { paddingTop: insets.top }]}>
            <ActivityIndicator color={COLORS.primary} size="large" />
            <Text style={styles.loadingText}>@{intro.username ?? 'あなたのアカウント'} を診断中...</Text>
          </View>
        ) : error ? (
          <View style={[styles.loadingScreen, { paddingTop: insets.top }]}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.cta} onPress={finish} activeOpacity={0.85}>
              <Text style={styles.ctaText}>アプリを始める →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xl }} showsVerticalScrollIndicator={false}>
            {/* ヒーロー: 診断結果の大きな発表エリア */}
            <View style={[styles.hero, { paddingTop: insets.top + SPACING.xl }]}>
              <Text style={styles.heroEyebrow}>連携完了・診断結果</Text>
              <Text style={styles.heroEmoji}>{hero?.emoji}</Text>
              <Text style={styles.heroLabel}>{hero?.label}</Text>
              <Text style={styles.heroAccount}>@{result?.profile.username ?? intro.username}</Text>

              <View style={styles.heroStatsRow}>
                <View style={styles.heroStatItem}>
                  <Text style={styles.heroStatValue}>{result?.profile.followers_count}</Text>
                  <Text style={styles.heroStatLabel}>フォロワー</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStatItem}>
                  <Text style={styles.heroStatValue}>{result?.summary.avg_likes}</Text>
                  <Text style={styles.heroStatLabel}>平均いいね</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStatItem}>
                  <Text style={styles.heroStatValue}>
                    {result?.summary.engagement_rate != null ? `${result.summary.engagement_rate}%` : '—'}
                  </Text>
                  <Text style={styles.heroStatLabel}>エンゲージメント率</Text>
                </View>
              </View>
              <Text style={styles.heroDesc}>{hero?.desc}</Text>
            </View>

            {/* 詳細カード群: MBTI診断ページのように、項目ごとにカードで見せる */}
            {cards.length > 0 && (
              <View style={styles.cardsSection}>
                <Text style={styles.sectionTitle}>🔎 Instagram連携だからわかること</Text>
                <Text style={styles.sectionSub}>あなたのアカウントの実データだけを見て算出した、この場限りの分析です</Text>

                {cards.map((c, i) => (
                  <View key={c.title} style={[styles.resultCard, { borderLeftColor: ACCENTS[i % ACCENTS.length] }]}>
                    <View style={[styles.resultBadge, { backgroundColor: ACCENTS[i % ACCENTS.length] + '22' }]}>
                      <Text style={styles.resultBadgeEmoji}>{c.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle}>{c.title}</Text>
                      <Text style={styles.resultBody}>{c.body}</Text>
                    </View>
                  </View>
                ))}

                <Text style={styles.footnote}>
                  これは他の誰でもない、あなたのアカウントを連携したからこそ出せた結果です。汎用的なAIチャットだけでは、ここまで具体的な話はできません。
                </Text>
              </View>
            )}

            {/* AIによる厳しい評論: 良い点・改善点・市場価値/競合との位置づけ */}
            <View style={styles.critiqueSection}>
              <Text style={styles.sectionTitle}>🧐 AIの評論</Text>
              <Text style={styles.sectionSub}>実データをもとに、良い点と改善点を厳しく評価します</Text>

              {critiqueLoading ? (
                <View style={styles.critiqueLoadingRow}>
                  <ActivityIndicator color={COLORS.primary} />
                  <Text style={styles.loadingText}>AIが評論中...</Text>
                </View>
              ) : critiqueError ? (
                <Text style={styles.errorText}>{critiqueError}</Text>
              ) : critique ? (
                <>
                  {critique.goodPoints.length > 0 && (
                    <View style={styles.critiqueCard}>
                      <Text style={styles.critiqueCardTitle}>👍 良い点</Text>
                      {critique.goodPoints.map((p, i) => (
                        <Text key={i} style={styles.critiqueLine}>・{p}</Text>
                      ))}
                    </View>
                  )}
                  {critique.improvementPoints.length > 0 && (
                    <View style={[styles.critiqueCard, styles.critiqueCardWarn]}>
                      <Text style={styles.critiqueCardTitle}>🔥 改善点（厳しめ）</Text>
                      {critique.improvementPoints.map((p, i) => (
                        <Text key={i} style={styles.critiqueLine}>・{p}</Text>
                      ))}
                    </View>
                  )}
                  {!!critique.marketComment && (
                    <View style={styles.critiqueCard}>
                      <Text style={styles.critiqueCardTitle}>📊 市場価値・競合との位置づけ</Text>
                      <Text style={styles.critiqueLine}>{critique.marketComment}</Text>
                    </View>
                  )}
                </>
              ) : null}
            </View>

            <Text style={styles.hint}>もっと詳しい分析や改善提案、競合との比較は、アプリ内でいつでも「分析して」と聞くだけでAIが答えます。</Text>

            <TouchableOpacity
              style={[styles.cta, critiqueLoading && styles.ctaDisabled]}
              onPress={finish}
              disabled={critiqueLoading}
              activeOpacity={0.85}
            >
              {critiqueLoading ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.ctaText}>AIの評論を待っています...</Text>
                </View>
              ) : (
                <Text style={styles.ctaText}>アプリを始める →</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.background },
  loadingScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACING.lg, gap: SPACING.md },
  loadingText: { color: COLORS.textMuted, fontSize: 13 },
  errorText: { color: COLORS.error, fontSize: 14, textAlign: 'center', marginBottom: SPACING.lg },

  hero: {
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: RADIUS.xl,
    borderBottomRightRadius: RADIUS.xl,
    alignItems: 'center',
    paddingBottom: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.xl,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.primary,
  },
  heroEyebrow: { color: COLORS.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: SPACING.md },
  heroEmoji: { fontSize: 56, marginBottom: SPACING.xs },
  heroLabel: { color: COLORS.text, fontSize: 24, fontWeight: '900', textAlign: 'center' },
  heroAccount: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600', marginTop: 4, marginBottom: SPACING.lg },
  heroStatsRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.lg, paddingVertical: SPACING.md, paddingHorizontal: SPACING.sm, width: '100%',
  },
  heroStatItem: { flex: 1, alignItems: 'center' },
  heroStatDivider: { width: 1, height: 32, backgroundColor: COLORS.border },
  heroStatValue: { color: COLORS.primary, fontSize: 20, fontWeight: '900' },
  heroStatLabel: { color: COLORS.textMuted, fontSize: 10, marginTop: 2 },
  heroDesc: { color: COLORS.text, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: SPACING.lg },

  cardsSection: { paddingHorizontal: SPACING.lg },
  sectionTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginBottom: 2 },
  sectionSub: { color: COLORS.textMuted, fontSize: 11, marginBottom: SPACING.md, lineHeight: 16 },
  resultCard: {
    flexDirection: 'row', gap: SPACING.md, alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderLeftWidth: 4,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  resultBadge: { width: 44, height: 44, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  resultBadgeEmoji: { fontSize: 20 },
  resultTitle: { color: COLORS.text, fontSize: 13, fontWeight: '800', marginBottom: 2 },
  resultBody: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18 },
  footnote: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: SPACING.sm, marginBottom: SPACING.md },

  critiqueSection: { paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  critiqueLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.md },
  critiqueCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  critiqueCardWarn: { borderColor: COLORS.error + '55' },
  critiqueCardTitle: { color: COLORS.text, fontSize: 13, fontWeight: '800', marginBottom: SPACING.xs },
  critiqueLine: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 2 },

  hint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginHorizontal: SPACING.lg, marginBottom: SPACING.md, lineHeight: 18 },
  cta: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: SPACING.md,
    alignItems: 'center', marginHorizontal: SPACING.lg,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

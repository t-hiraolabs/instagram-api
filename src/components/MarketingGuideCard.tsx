// 「はじめてガイド」を完了したユーザー向けに、実際のInstagramデータをもとに
// アカウントの段階（立ち上げ期／成長期／定着期）とS〜Eの総合評価を判定し、それに応じたAIアドバイスを表示する。
// 連携中のアカウントごとに評価・アドバイスを分けて保持する。Pro/ビジネスは毎週月曜0:00
// （端末のローカル時刻、getIsoWeekKeyが月曜始まりの週キーを使うことで判定）を境に自動的に
// 再分析するが、フリープランはAIコストを抑えるため初回の分析のみ行い、以降は自動更新しない
// （手動更新もなし）。
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform, TextInput, TouchableOpacity } from 'react-native';
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
import { generateMarketingGuide, MarketingGuide, askMarketingGuideQuestion, ChatTurn } from '../services/aiService';
import { getMyPlan } from '../services/scheduleService';
import { Plan } from '../utils/plans';

interface QaMsg { role: 'user' | 'assistant'; text: string }

interface Props {
  /** 質問チャットを送信するたびに呼ばれる（ホーム上部のチャット利用量表示を更新するため） */
  onChatUsed?: () => void;
}

/** チャットの文脈として渡す、このガイドの内容の要約（このやり取りはDBには保存しない） */
function buildGuideFacts(rank: AccountRank, grade: AccountScoreGrade, guide: MarketingGuide): string {
  return (
    `【Instagramマーケティングガイド（今週分析済み）】\n` +
    `段階: ${ACCOUNT_RANK_LABEL[rank]} / 総合評価: ${grade}ランク\n` +
    `一言: ${guide.headline}\n` +
    `具体的なアドバイス:\n${guide.tips.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
  );
}

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

export default function MarketingGuideCard({ onChatUsed }: Props) {
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
  const [plan, setPlan] = useState<Plan | null>(null);
  // 「再試行」を押すたびに増やし、下のuseEffectを再実行させる（userId/accessTokenは
  // 変わらないため、依存配列にこれを含めないと再試行のたびに同じ結果のまま止まってしまう）
  const [retryCount, setRetryCount] = useState(0);

  // ガイドに対する質問チャット。その場限りのやり取りなので保存はしない
  // （アカウント切り替え・再分析のたびにリセットする）
  const [qaMessages, setQaMessages] = useState<QaMsg[]>([]);
  const [qaInput, setQaInput] = useState('');
  const [qaSending, setQaSending] = useState(false);

  useEffect(() => {
    setQaMessages([]);
    setQaInput('');
  }, [instagramCredentials?.userId]);

  const askQuestion = async () => {
    const text = qaInput.trim();
    if (!text || qaSending || !rank || !grade || !guide) return;
    setQaInput('');
    const next = [...qaMessages, { role: 'user' as const, text }];
    setQaMessages(next);
    setQaSending(true);
    try {
      // ガイド自体の生成とは違い、ユーザーが自分で質問する行為なので「チャットの利用量」を消費する
      const history: ChatTurn[] = next.map((m) => ({ role: m.role, content: m.text }));
      const reply = await askMarketingGuideQuestion(buildGuideFacts(rank, grade, guide), history);
      setQaMessages((m) => [...m, { role: 'assistant', text: reply }]);
      onChatUsed?.();
    } catch (e) {
      setQaMessages((m) => [...m, { role: 'assistant', text: e instanceof Error ? e.message : '応答に失敗しました' }]);
    } finally {
      setQaSending(false);
    }
  };

  useEffect(() => {
    const userId = instagramCredentials?.userId;
    const accessToken = instagramCredentials?.accessToken;
    if (!userId || !accessToken) return;

    let cancelled = false;
    (async () => {
      const myPlan = await getMyPlan().catch(() => 'free' as Plan);
      if (cancelled) return;
      setPlan(myPlan);

      const thisWeek = getIsoWeekKey(new Date());
      const cached = readCacheMap()[userId];
      // フリープランは初回分析のみ（毎週の自動再分析は行わない）。一度分析済みなら
      // 週が変わってもそのまま使い続ける。Pro/ビジネスは従来通り週が変わったら再分析する
      const cacheValid = !!cached && (myPlan === 'free' || cached.weekKey === thisWeek);
      if (cacheValid && cached) {
        setRank(cached.rank);
        setGrade(cached.grade);
        setGuide(cached.guide);
        setFailed(false);
        return;
      }

      // 別アカウントに切り替えた直後など、そのアカウント用のキャッシュがまだ無い場合は
      // 前のアカウントの内容を表示し続けないよう、いったんクリアしてから分析し直す
      setRank(null);
      setGrade(null);
      setGuide(null);

      setLoading(true);
      setFailed(false);
      try {
        const insights = await getInsightsSummary(accessToken, 24);
        const facts = computeInsightFacts(insights);
        const followersCount = insights.profile.followers_count ?? 0;
        const mediaCount = insights.profile.media_count ?? insights.media.length;
        const nextRank = computeAccountRank(followersCount, mediaCount);
        const nextGrade = computeAccountScore(
          insights.summary.engagement_rate,
          facts?.details.trendPct ?? null,
          followersCount,
          insights.summary.avg_likes
        );

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
  }, [instagramCredentials?.userId, instagramCredentials?.accessToken, retryCount]);

  // 失敗時にカード自体を丸ごと消してしまうと、「分析中...」が一瞬出てすぐに何の説明も
  // なく消えたように見えてしまう（実際には裏で分析に失敗しているだけ）。連携さえ
  // されていればカード自体は出し続け、失敗時はその旨と再試行ボタンを表示する
  if (!instagramCredentials) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="trending-up-outline" size={16} color={COLORS.primary} />
          <View>
            <Text style={styles.title}>Instagramマーケティングガイド</Text>
            <Text style={styles.subtitle}>
              {plan === 'free' ? '初回分析のみ（Proで毎週自動更新）' : '毎週月曜 0:00に自動更新'}
            </Text>
          </View>
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
      ) : failed && !guide ? (
        <View style={styles.errorRow}>
          <Text style={styles.errorText}>分析に失敗しました。時間をおいて再度お試しください。</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => { setFailed(false); setRetryCount((c) => c + 1); }}
            activeOpacity={0.8}
          >
            <Text style={styles.retryBtnText}>再試行</Text>
          </TouchableOpacity>
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

          <View style={styles.qaDivider} />
          <Text style={styles.qaLabel}>気になることを質問できます</Text>

          {qaMessages.map((m, i) => (
            <View key={i} style={m.role === 'user' ? styles.qaUserRow : styles.qaAiRow}>
              <View style={m.role === 'user' ? styles.qaUserBubble : styles.qaAiBubble}>
                <Text style={m.role === 'user' ? styles.qaUserText : styles.qaAiText} selectable>{m.text}</Text>
              </View>
            </View>
          ))}
          {qaSending && (
            <View style={styles.qaAiRow}>
              <View style={styles.qaAiBubble}>
                <ActivityIndicator size="small" color={COLORS.primary} />
              </View>
            </View>
          )}

          <View style={styles.qaInputRow}>
            <TextInput
              style={styles.qaInput}
              value={qaInput}
              onChangeText={setQaInput}
              placeholder="具体的になにをしたらいい？ など"
              placeholderTextColor={COLORS.textMuted}
              onSubmitEditing={askQuestion}
              returnKeyType="send"
              editable={!qaSending}
            />
            <TouchableOpacity
              style={[styles.qaSendBtn, (qaSending || !qaInput.trim()) && styles.qaSendBtnDisabled]}
              onPress={askQuestion}
              disabled={qaSending || !qaInput.trim()}
            >
              <Ionicons name="arrow-up" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
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
  subtitle: { color: COLORS.textMuted, fontSize: 10.5, fontWeight: '600', marginTop: 1 },
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
  errorRow: { paddingVertical: SPACING.sm, gap: SPACING.sm },
  errorText: { color: COLORS.textMuted, fontSize: 12.5 },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  retryBtnText: { color: COLORS.primary, fontSize: 12.5, fontWeight: '700' },
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
  qaDivider: { height: 1, backgroundColor: COLORS.border, marginTop: SPACING.sm, marginBottom: SPACING.sm },
  qaLabel: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '700', marginBottom: SPACING.sm },
  qaUserRow: { alignItems: 'flex-end', marginBottom: SPACING.sm },
  qaUserBubble: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: 7, maxWidth: '85%' },
  qaUserText: { color: '#fff', fontSize: 13, lineHeight: 18 },
  qaAiRow: { alignItems: 'flex-start', marginBottom: SPACING.sm },
  qaAiBubble: { backgroundColor: COLORS.surfaceElevated, borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: 7, maxWidth: '90%', borderWidth: 1, borderColor: COLORS.border },
  qaAiText: { color: COLORS.text, fontSize: 13, lineHeight: 19 },
  qaInputRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  qaInput: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 8,
    color: COLORS.text,
    fontSize: 13.5,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  qaSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qaSendBtnDisabled: { opacity: 0.5 },
});

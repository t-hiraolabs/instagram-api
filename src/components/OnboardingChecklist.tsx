// 運用に自信がない・投稿がまだ少ないユーザー向けに、最初にやるべきことを順番に示す
// ハードル型のチェックリスト。全ユーザーに表示するが、4項目すべて達成したユーザーには
// 表示しない（もう不要なため）。
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore } from '../store/appStore';
import { getScheduledPosts, getAiUsage } from '../services/scheduleService';

interface ChecklistItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  done: boolean;
  onPress: () => void;
}

interface Props {
  /** 「AIに相談する」項目から、投稿ネタの相談チャットを新規で開く */
  onOpenAdviceChat: () => void;
  /** 4項目すべて達成したかどうかを親に伝える（完了後はMarketingGuideCardに差し替えるため） */
  onStatusChange?: (status: { loaded: boolean; allDone: boolean }) => void;
}

export default function OnboardingChecklist({ onOpenAdviceChat, onStatusChange }: Props) {
  const navigation = useNavigation<any>();
  const brandName = useAppStore((s) => s.brandSettings.brandName);
  const industry = useAppStore((s) => s.brandSettings.industry);
  const instagramCredentials = useAppStore((s) => s.instagramCredentials);
  const [postCount, setPostCount] = useState<number | null>(null);
  const [aiUsed, setAiUsed] = useState<number | null>(null);

  useEffect(() => {
    getScheduledPosts(instagramCredentials?.userId)
      .then((posts) => setPostCount(posts.length))
      .catch(() => setPostCount(0));
    getAiUsage()
      .then((u) => setAiUsed(u.used))
      .catch(() => setAiUsed(0));
  }, [instagramCredentials]);

  const items: ChecklistItem[] = [
    {
      key: 'connect',
      label: 'Instagramと連携する',
      icon: 'logo-instagram',
      done: !!instagramCredentials,
      onPress: () => navigation.navigate('Profile'),
    },
    {
      key: 'profile',
      label: 'ブランド設定を行う',
      icon: 'person-circle-outline',
      done: !!(brandName.trim() || industry.trim()),
      onPress: () => navigation.navigate('Profile'),
    },
    {
      key: 'advice',
      label: 'AIに投稿ネタを相談してみる',
      icon: 'sparkles-outline',
      done: (aiUsed ?? 0) > 0,
      onPress: onOpenAdviceChat,
    },
    {
      key: 'firstPost',
      label: '最初の投稿を予約する',
      icon: 'calendar-outline',
      done: (postCount ?? 0) > 0,
      onPress: () => navigation.navigate('Post'),
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  // データ取得前（null）は「未達成」扱いにして、一瞬だけ全達成の判定にならないようにする
  const loaded = postCount !== null && aiUsed !== null;
  const allDone = loaded && doneCount === items.length;

  useEffect(() => {
    onStatusChange?.({ loaded, allDone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, allDone]);

  // データ取得中（loaded前）は、達成済みユーザーにも一瞬チェックリストが見えてしまうため
  // 何も表示しない（読み込み完了後に、実際の状態に応じてチェックリスト/何も出さないが決まる）
  if (!loaded || allDone) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>はじめてガイド</Text>
        <Text style={styles.progress}>{doneCount}/{items.length} 完了</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(doneCount / items.length) * 100}%` }]} />
      </View>
      {items.map((item) => (
        <TouchableOpacity key={item.key} style={styles.row} onPress={item.onPress} activeOpacity={0.75}>
          <View style={[styles.checkCircle, item.done && styles.checkCircleDone]}>
            {item.done ? (
              <Ionicons name="checkmark" size={13} color="#fff" />
            ) : (
              <Ionicons name={item.icon} size={13} color={COLORS.textMuted} />
            )}
          </View>
          <Text style={[styles.rowLabel, item.done && styles.rowLabelDone]}>{item.label}</Text>
          {!item.done && <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />}
        </TouchableOpacity>
      ))}
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
  title: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  progress: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 9,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleDone: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  rowLabel: { flex: 1, color: COLORS.text, fontSize: 13.5, fontWeight: '600' },
  rowLabelDone: { color: COLORS.textMuted, textDecorationLine: 'line-through' },
});

import React, { useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore } from '../store/appStore';
import AccountBadge from '../components/AccountBadge';
import ImageGenChat, { ImageGenChatHandle } from '../components/ImageGenChat';

const QUICK_ACTIONS = [
  { label: '投稿', emoji: '📸', tab: 'Post' },
  { label: '予約', emoji: '📅', tab: 'Schedule' },
  { label: '分析', emoji: '📊', tab: 'Analytics' },
  { label: '設定', emoji: '⚙️', tab: 'Profile' },
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return '深夜もお疲れさまです 🌙';
  if (h < 10) return 'おはようございます ☀️';
  if (h < 17) return 'こんにちは 👋';
  return 'こんばんは 🌆';
}

// 業種を問わず使える、季節・曜日で回転するおすすめネタ（AIを呼ばず無料で出せるもの）
const IDEA_POOL = [
  '新作・季節限定メニューの紹介',
  'お客様の声・ビフォーアフター',
  '期間限定キャンペーンの告知',
  'スタッフ紹介・お店の裏側',
  '本日のおすすめ・入荷情報',
  'よくある質問に答える投稿',
  'リピーター向けの感謝メッセージ',
];

function getTodaysIdeas(): string[] {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  return [0, 1, 2].map((i) => IDEA_POOL[(dayOfYear + i) % IDEA_POOL.length]);
}

function getTodoItems(): { key: string; label: string; emoji: string }[] {
  return [
    { key: 'story', label: 'ストーリー', emoji: '📖' },
    { key: 'dm', label: 'DM返信', emoji: '💬' },
    { key: 'analytics', label: '分析', emoji: '📊' },
  ];
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
  const setPendingUseImage = useAppStore((s) => s.setPendingUseImage);
  const bestTime = useMemo(() => getBestPostingTime(), []);
  const todaysIdeas = useMemo(() => getTodaysIdeas(), []);
  const todoItems = useMemo(() => getTodoItems(), []);
  const chatRef = useRef<ImageGenChatHandle>(null);

  const handleUseImage = (dataUrl: string) => {
    setPendingUseImage(dataUrl);
    navigation.navigate('Post');
  };

  const goTodo = (key: string) => {
    if (key === 'dm') return navigation.navigate('DM');
    if (key === 'analytics') return navigation.navigate('Analytics');
    if (key === 'story') return chatRef.current?.sendMessage('今日のストーリーを作りたいです。');
  };

  const emptyState = (
    <View style={styles.briefing}>
      <Text style={styles.chatGreeting}>{getGreeting()}</Text>
      <Text style={styles.chatPrompt}>{bestTime.description}</Text>
      <View style={styles.timeRow}>
        <View style={[styles.timeDot, { backgroundColor: bestTime.color }]} />
        <Text style={[styles.timeLabel, { color: bestTime.color }]}>{bestTime.label}</Text>
      </View>

      <Text style={styles.groupLabel}>今日のおすすめ投稿ネタ</Text>
      <View style={styles.chipRow}>
        {todaysIdeas.map((idea) => (
          <TouchableOpacity
            key={idea}
            style={styles.ideaChip}
            onPress={() => chatRef.current?.sendMessage(`「${idea}」について投稿を作りたいです。`)}
            activeOpacity={0.8}
          >
            <Text style={styles.ideaChipText} numberOfLines={1}>{idea}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.groupLabel}>今日のTODO</Text>
      <View style={styles.chipRow}>
        {todoItems.map((item) => (
          <TouchableOpacity key={item.key} style={styles.todoChip} onPress={() => goTodo(item.key)} activeOpacity={0.8}>
            <Text style={styles.todoChipText}>{item.emoji} {item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + SPACING.sm }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerLeft} onPress={() => chatRef.current?.openMenu()} activeOpacity={0.7}>
          <Image source={require('../../assets/icon.png')} style={styles.logoIcon} resizeMode="contain" />
          <Text style={styles.title}>AImark</Text>
        </TouchableOpacity>
        <View style={styles.quickActions}>
          {QUICK_ACTIONS.map((a) => (
            <TouchableOpacity key={a.label} style={styles.quickBtn} onPress={() => navigation.navigate(a.tab)} activeOpacity={0.8}>
              <Text style={styles.quickEmoji}>{a.emoji}</Text>
              <Text style={styles.quickLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ホーム画面そのものがチャット */}
      <View style={{ flex: 1 }}>
        <ImageGenChat
          ref={chatRef}
          visible
          embedded
          onUseImage={handleUseImage}
          emptyState={emptyState}
        />
      </View>

      <AccountBadge hideBadge />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  logoIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  quickActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  quickBtn: {
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  quickEmoji: { fontSize: 18 },
  quickLabel: { color: COLORS.textMuted, fontSize: 10, fontWeight: '600', marginTop: 1 },
  briefing: {
    paddingTop: SPACING.xl,
  },
  chatGreeting: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  chatPrompt: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 27,
    marginTop: 2,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginBottom: SPACING.md,
  },
  timeDot: { width: 7, height: 7, borderRadius: 4 },
  timeLabel: { fontSize: 12, fontWeight: '700' },
  groupLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: SPACING.sm,
    marginTop: SPACING.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  ideaChip: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxWidth: '100%',
  },
  ideaChipText: {
    color: COLORS.text,
    fontSize: 12.5,
    fontWeight: '600',
  },
  todoChip: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  todoChipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
});

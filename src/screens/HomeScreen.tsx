import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS, SHADOWS } from '../utils/theme';
import { useAppStore } from '../store/appStore';
import AccountBadge from '../components/AccountBadge';
import ImageGenChat from '../components/ImageGenChat';
import { getPostIdeas, PostIdea } from '../utils/postIdeas';
import { Ionicons } from '@expo/vector-icons';

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return '深夜もお疲れさまです';
  if (h < 10) return 'おはようございます';
  if (h < 17) return 'こんにちは';
  return 'こんばんは';
}

// 業種に応じたネタ候補から、日替わりで指定件数を選ぶ（AIを呼ばず無料で出せるもの）
function getTodaysIdeas(pool: PostIdea[], count: number): PostIdea[] {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  return Array.from({ length: count }, (_, i) => pool[(dayOfYear + i) % pool.length]);
}

function getTodoItems(): { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] {
  return [
    { key: 'story', label: 'ストーリーを作る', icon: 'book' },
    { key: 'dm', label: 'DM返信', icon: 'chatbubble' },
    { key: 'analytics', label: '分析を見る', icon: 'stats-chart' },
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
  const setChatPrefillText = useAppStore((s) => s.setChatPrefillText);
  const setChatAutoSend = useAppStore((s) => s.setChatAutoSend);
  const setChatForceNew = useAppStore((s) => s.setChatForceNew);
  const industry = useAppStore((s) => s.brandSettings.industry);
  const bestTime = useMemo(() => getBestPostingTime(), []);
  const ideaPool = useMemo(() => getPostIdeas(industry), [industry]);
  const featuredIdeas = useMemo(() => getTodaysIdeas(ideaPool, 3), [ideaPool]);
  const moreIdeas = useMemo(() => getTodaysIdeas(ideaPool, ideaPool.length).slice(3), [ideaPool]);
  const todoItems = useMemo(() => getTodoItems(), []);
  const [chatVisible, setChatVisible] = useState(false);

  const handleUseImage = (dataUrl: string) => {
    setPendingUseImage(dataUrl);
    setChatVisible(false);
    navigation.navigate('Post');
  };

  const startIdeaChat = (idea: string) => {
    // ネタカードからは毎回新しい会話として送る（前の会話の続きにならないように）
    setChatForceNew(true);
    setChatPrefillText(`「${idea}」について投稿を作りたいです。`);
    setChatAutoSend(true);
    setChatVisible(true);
  };

  const goTodo = (key: string) => {
    if (key === 'dm') return navigation.navigate('DM');
    if (key === 'analytics') return navigation.navigate('Analytics');
    if (key === 'story') return navigation.navigate('Post');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + SPACING.sm }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={require('../../assets/icon.png')} style={styles.logoIcon} resizeMode="contain" />
          <Text style={styles.title}>AImark</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.prompt}>今日は何を投稿しますか？</Text>
        <View style={styles.timeRow}>
          <View style={[styles.timeDot, { backgroundColor: bestTime.color }]} />
          <Text style={[styles.timeLabel, { color: bestTime.color }]}>{bestTime.label}</Text>
          <Text style={styles.timeDesc} numberOfLines={1}>{bestTime.description}</Text>
        </View>

        <Text style={styles.groupLabel}>今日のおすすめ投稿ネタ</Text>
        {featuredIdeas.map((idea) => (
          <TouchableOpacity
            key={idea.text}
            style={styles.ideaCard}
            onPress={() => startIdeaChat(idea.text)}
            activeOpacity={0.85}
          >
            <View style={styles.ideaIconWrap}>
              <Ionicons name={idea.icon} size={20} color={COLORS.primary} />
            </View>
            <Text style={styles.ideaCardText}>{idea.text}</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        ))}

        <Text style={styles.groupLabel}>他にもこんなネタが</Text>
        <View style={styles.chipRow}>
          {moreIdeas.map((idea) => (
            <TouchableOpacity
              key={idea.text}
              style={styles.ideaChip}
              onPress={() => startIdeaChat(idea.text)}
              activeOpacity={0.8}
            >
              <Text style={styles.ideaChipText} numberOfLines={1}>{idea.text}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.groupLabel}>今日のTODO</Text>
        <View style={styles.chipRow}>
          {todoItems.map((item) => (
            <TouchableOpacity key={item.key} style={styles.todoChip} onPress={() => goTodo(item.key)} activeOpacity={0.8}>
              <Ionicons name={item.icon} size={13} color={COLORS.textSecondary} />
              <Text style={styles.todoChipText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* AIチャットは画面端のボタンから開く */}
      <TouchableOpacity
        testID="home-chat-fab"
        style={[styles.chatFab, { bottom: SPACING.lg }]}
        onPress={() => {
          // ボタンから開く際も毎回新しい会話にする（前回の続きを開かないように）
          setChatForceNew(true);
          setChatVisible(true);
        }}
        activeOpacity={0.85}
      >
        <Ionicons name="chatbubble-ellipses" size={26} color="#fff" />
      </TouchableOpacity>

      <ImageGenChat
        visible={chatVisible}
        onClose={() => setChatVisible(false)}
        onUseImage={handleUseImage}
      />

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
    gap: SPACING.xs,
    paddingVertical: 4,
    paddingHorizontal: 8,
    paddingRight: 10,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surfaceElevated,
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
  scrollContent: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl * 2,
  },
  greeting: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  prompt: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 29,
    marginTop: 2,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: SPACING.lg,
  },
  timeDot: { width: 7, height: 7, borderRadius: 4 },
  timeLabel: { fontSize: 12, fontWeight: '700' },
  timeDesc: { color: COLORS.textMuted, fontSize: 12, flexShrink: 1 },
  groupLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: SPACING.sm,
    marginTop: SPACING.lg,
  },
  ideaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  ideaIconWrap: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary + '1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ideaCardText: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14.5,
    fontWeight: '700',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  chatFab: {
    position: 'absolute',
    right: SPACING.lg,
    width: 56,
    height: 56,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.card,
  },
});

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { useAppStore } from '../store/appStore';
import {
  getConversations, getMessages, sendMessage,
  DMConversation, DMMessage,
} from '../services/dmService';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

const PERMISSION_REQUIRED_MSG =
  'DM機能を使うには Meta Developer Console で\n' +
  '「instagram_business_manage_messages」権限の審査が必要です。\n\n' +
  '審査が完了したら再連携するとご利用いただけます。';

export default function DMScreen() {
  const insets = useSafeAreaInsets();
  const creds1 = useAppStore((s) => s.instagramCredentials);
  const creds2 = useAppStore((s) => s.secondInstagramCredentials);
  const creds3 = useAppStore((s) => s.thirdInstagramCredentials);
  const activeAccountSlot = useAppStore((s) => s.activeAccountSlot);
  const creds = activeAccountSlot === 3 ? creds3 : activeAccountSlot === 2 ? creds2 : creds1;

  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState(false);

  const [selectedConv, setSelectedConv] = useState<DMConversation | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const loadConversations = useCallback(async () => {
    if (!creds?.accessToken || !creds?.userId) return;
    setLoading(true);
    setError(null);
    setPermissionError(false);
    try {
      const data = await getConversations(creds.accessToken, creds.userId);
      setConversations(data);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (msg.includes('permission') || msg.includes('OAuthException') || msg.includes('200')) {
        setPermissionError(true);
      } else {
        setError(msg || 'DMの取得に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  }, [creds?.accessToken, creds?.userId]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const openConversation = async (conv: DMConversation) => {
    setSelectedConv(conv);
    setMessages([]);
    setMsgLoading(true);
    try {
      const data = await getMessages(creds!.accessToken, conv.id);
      setMessages(data);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
    } catch (e) {
      setMessages([]);
    } finally {
      setMsgLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() || !selectedConv || !creds?.accessToken || !creds?.userId) return;
    const text = inputText.trim();
    const otherParticipant = selectedConv.participants.find((p) => p.id !== creds.userId);
    if (!otherParticipant) return;
    setInputText('');
    setSending(true);
    try {
      await sendMessage(creds.accessToken, creds.userId, otherParticipant.id, text);
      // 楽観的更新
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          message: text,
          from: { id: creds.userId, username: creds.username },
          created_time: new Date().toISOString(),
        },
      ]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      setInputText(text);
    } finally {
      setSending(false);
    }
  };

  // 未連携
  if (!creds?.accessToken) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.bigEmoji}>💬</Text>
        <Text style={styles.emptyTitle}>Instagram連携が必要です</Text>
        <Text style={styles.emptyDesc}>「プロフィール」タブからInstagramアカウントを連携してください。</Text>
      </View>
    );
  }

  // 権限エラー
  if (permissionError) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.bigEmoji}>🔒</Text>
        <Text style={styles.emptyTitle}>権限の審査が必要です</Text>
        <Text style={styles.emptyDesc}>{PERMISSION_REQUIRED_MSG}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadConversations}>
          <Text style={styles.retryText}>再読み込み</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // スレッド画面
  if (selectedConv) {
    const otherParticipant = selectedConv.participants.find((p) => p.id !== creds.userId);
    const displayName = otherParticipant?.username
      ? `@${otherParticipant.username}`
      : otherParticipant?.name ?? 'ユーザー';

    return (
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.bottom + 20}
      >
        {/* ヘッダー */}
        <View style={styles.threadHeader}>
          <TouchableOpacity onPress={() => setSelectedConv(null)} hitSlop={8}>
            <Text style={styles.backBtn}>‹ 戻る</Text>
          </TouchableOpacity>
          <View style={styles.threadHeaderInfo}>
            {otherParticipant?.profile_picture ? (
              <Image source={{ uri: otherParticipant.profile_picture }} style={styles.threadAvatar} />
            ) : (
              <View style={[styles.threadAvatar, styles.avatarFallback]}>
                <Text style={{ fontSize: 16 }}>👤</Text>
              </View>
            )}
            <Text style={styles.threadName}>{displayName}</Text>
          </View>
          <View style={{ width: 48 }} />
        </View>

        {/* メッセージ一覧 */}
        <ScrollView
          ref={scrollRef}
          style={styles.messageList}
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: 8 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {msgLoading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
          ) : messages.length === 0 ? (
            <Text style={styles.noMessages}>まだメッセージがありません</Text>
          ) : (
            messages.map((msg) => {
              const isMine = msg.from.id === creds.userId;
              return (
                <View key={msg.id} style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{msg.message}</Text>
                  <Text style={[styles.bubbleTime, isMine && { color: 'rgba(255,255,255,0.6)' }]}>
                    {timeAgo(msg.created_time)}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* 入力欄 */}
        <View style={[styles.inputRow, { paddingBottom: insets.bottom + SPACING.sm }]}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="メッセージを入力..."
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendBtnText}>送信</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // 会話一覧
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>💬 DM</Text>
        {creds.username && <Text style={styles.subtitle}>@{creds.username}</Text>}
        <TouchableOpacity onPress={loadConversations} disabled={loading}>
          <Text style={[styles.refreshText, loading && { opacity: 0.4 }]}>
            {loading ? '更新中...' : '↻ 更新'}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 80 }} />
      ) : error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadConversations}>
            <Text style={styles.retryText}>再読み込み</Text>
          </TouchableOpacity>
        </View>
      ) : conversations.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.bigEmoji}>💬</Text>
          <Text style={styles.emptyTitle}>DMはありません</Text>
          <Text style={styles.emptyDesc}>Instagramから届いたDMがここに表示されます。</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
          {conversations.map((conv) => {
            const other = conv.participants.find((p) => p.id !== creds.userId);
            const name = other?.username ? `@${other.username}` : other?.name ?? 'ユーザー';
            return (
              <TouchableOpacity
                key={conv.id}
                style={styles.convRow}
                onPress={() => openConversation(conv)}
                activeOpacity={0.75}
              >
                {other?.profile_picture ? (
                  <Image source={{ uri: other.profile_picture }} style={styles.convAvatar} />
                ) : (
                  <View style={[styles.convAvatar, styles.avatarFallback]}>
                    <Text style={{ fontSize: 22 }}>👤</Text>
                  </View>
                )}
                <View style={styles.convInfo}>
                  <View style={styles.convTopRow}>
                    <Text style={styles.convName}>{name}</Text>
                    <Text style={styles.convTime}>{timeAgo(conv.updated_time)}</Text>
                  </View>
                  {conv.snippet ? (
                    <Text style={styles.convSnippet} numberOfLines={1}>{conv.snippet}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.sm,
  },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.primary, fontWeight: '700' },
  refreshText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },

  bigEmoji: { fontSize: 56, marginBottom: SPACING.md },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: COLORS.text, textAlign: 'center', marginBottom: SPACING.sm },
  emptyDesc: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },

  errorBox: { margin: SPACING.md, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  errorText: { color: COLORS.error, fontSize: 13, marginBottom: SPACING.md },
  retryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.sm, alignItems: 'center', marginTop: SPACING.md },
  retryText: { color: '#fff', fontWeight: '800' },

  convRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  convAvatar: { width: 50, height: 50, borderRadius: 25, marginRight: SPACING.md, backgroundColor: COLORS.surface },
  avatarFallback: { justifyContent: 'center', alignItems: 'center' },
  convInfo: { flex: 1 },
  convTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  convName: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  convTime: { color: COLORS.textMuted, fontSize: 12 },
  convSnippet: { color: COLORS.textSecondary, fontSize: 13 },

  // スレッド
  threadHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { color: COLORS.primary, fontSize: 17, fontWeight: '700' },
  threadHeaderInfo: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  threadAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface },
  threadName: { color: COLORS.text, fontSize: 15, fontWeight: '700' },

  messageList: { flex: 1 },
  noMessages: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40 },

  bubble: {
    maxWidth: '75%', borderRadius: RADIUS.lg, padding: SPACING.sm,
    marginBottom: SPACING.sm, backgroundColor: COLORS.surface,
  },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: COLORS.primary },
  bubbleTheirs: { alignSelf: 'flex-start' },
  bubbleText: { color: COLORS.text, fontSize: 15, lineHeight: 21 },
  bubbleTextMine: { color: '#fff' },
  bubbleTime: { color: COLORS.textMuted, fontSize: 11, marginTop: 4, textAlign: 'right' },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingTop: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  input: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    color: COLORS.text, fontSize: 15, maxHeight: 100,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sendBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md, paddingVertical: 10, justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  // フィールドラベル（詳細画面流用）
  fieldLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 4 },
});

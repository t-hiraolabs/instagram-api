import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { generateImages, getImageUsage, ImageSize } from '../services/imageGenService';
import { chatWithAssistant, buildImagePrompt, ChatTurn } from '../services/aiService';

interface Props {
  visible: boolean;
  onClose: () => void;
  onUseImage: (dataUrl: string) => void;
}

type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { role: 'image'; uri: string }
  | { role: 'error'; text: string };

const SIZES: { key: ImageSize; label: string }[] = [
  { key: '1024x1024', label: '正方形' },
  { key: '1024x1536', label: '縦長' },
  { key: '1536x1024', label: '横長' },
];
const COUNTS = [1, 2, 4];

export default function ImageGenChat({ visible, onClose, onUseImage }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [size, setSize] = useState<ImageSize>('1024x1024');
  const [count, setCount] = useState(1);
  const [chatting, setChatting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) {
      getImageUsage().then((u) => setRemaining(u.remaining)).catch(() => {});
    }
  }, [visible]);

  const toEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

  // 会話履歴（テキストのみ）をClaudeに渡す形に
  const history = (): ChatTurn[] =>
    messages
      .filter((m): m is { role: 'user' | 'assistant'; text: string } => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.text }));

  const send = async () => {
    const text = input.trim();
    if (!text || chatting) return;
    setInput('');
    const next = [...messages, { role: 'user' as const, text }];
    setMessages(next);
    setChatting(true);
    toEnd();
    try {
      const reply = await chatWithAssistant(
        next.filter((m): m is { role: 'user' | 'assistant'; text: string } => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.text }))
      );
      setMessages((m) => [...m, { role: 'assistant', text: reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', text: e instanceof Error ? e.message : '応答に失敗しました' }]);
    } finally {
      setChatting(false);
      toEnd();
    }
  };

  const generate = async () => {
    if (generating) return;
    const h = history();
    if (h.length === 0) {
      setMessages((m) => [...m, { role: 'error', text: 'まず作りたい画像について話しかけてください（例：夏の新作パフェの写真がほしい）' }]);
      toEnd();
      return;
    }
    setGenerating(true);
    toEnd();
    try {
      const prompt = await buildImagePrompt(h);
      setMessages((m) => [...m, { role: 'assistant', text: `この内容で${count}枚生成します：\n「${prompt}」` }]);
      toEnd();
      const { images, remaining: rem } = await generateImages(prompt, count, size);
      setRemaining(rem);
      setMessages((m) => [...m, ...images.map((uri) => ({ role: 'image' as const, uri }))]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', text: e instanceof Error ? e.message : '画像生成に失敗しました' }]);
    } finally {
      setGenerating(false);
      toEnd();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}><Text style={styles.cancel}>閉じる</Text></TouchableOpacity>
          <Text style={styles.title}>🎨 AIアシスタント</Text>
          <Text style={styles.remain}>{remaining == null ? '' : `残り${remaining}枚`}</Text>
        </View>

        <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xl }}>
          {messages.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyText}>
                作りたい画像や投稿について相談できます。{'\n'}
                内容が決まったら「画像を生成」を押すと、会話をもとに生成します。
              </Text>
            </View>
          )}
          {messages.map((m, i) => {
            if (m.role === 'user') return (
              <View key={i} style={styles.userRow}><View style={styles.userBubble}><Text style={styles.userText}>{m.text}</Text></View></View>
            );
            if (m.role === 'assistant') return (
              <View key={i} style={styles.aiRow}><View style={styles.aiBubble}><Text style={styles.aiText}>{m.text}</Text></View></View>
            );
            if (m.role === 'error') return (
              <View key={i} style={styles.aiRow}><View style={styles.errorBubble}><Text style={styles.errorText}>{m.text}</Text></View></View>
            );
            return (
              <View key={i} style={styles.aiRow}>
                <View style={styles.imageBubble}>
                  <Image source={{ uri: m.uri }} style={styles.genImage} resizeMode="cover" />
                  <TouchableOpacity style={styles.useBtn} onPress={() => onUseImage(m.uri)} activeOpacity={0.85}>
                    <Text style={styles.useBtnText}>この画像で投稿を作る ›</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
          {(chatting || generating) && (
            <View style={styles.aiRow}>
              <View style={styles.loadingBubble}>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={styles.loadingText}>{generating ? '生成中...' : '考え中...'}</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* 生成オプション */}
        <View style={styles.optRow}>
          <Text style={styles.optLabel}>枚数</Text>
          {COUNTS.map((c) => (
            <TouchableOpacity key={c} style={[styles.optBtn, count === c && styles.optBtnActive]} onPress={() => setCount(c)}>
              <Text style={[styles.optText, count === c && styles.optTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ width: SPACING.md }} />
          {SIZES.map((s) => (
            <TouchableOpacity key={s.key} style={[styles.optBtn, size === s.key && styles.optBtnActive]} onPress={() => setSize(s.key)}>
              <Text style={[styles.optText, size === s.key && styles.optTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.genBtn, (generating || (remaining ?? 1) <= 0) && styles.genBtnDisabled]}
          onPress={generate}
          disabled={generating || (remaining ?? 1) <= 0}
        >
          <Text style={styles.genBtnText}>🎨 会話をもとに画像を生成（{count}枚）</Text>
        </TouchableOpacity>

        {/* 入力欄 */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="相談・指示を入力..."
            placeholderTextColor={COLORS.textMuted}
            onSubmitEditing={send}
            returnKeyType="send"
            editable={!chatting}
          />
          <TouchableOpacity style={[styles.sendBtn, (chatting || !input.trim()) && styles.sendBtnDisabled]} onPress={send} disabled={chatting || !input.trim()}>
            <Text style={styles.sendBtnText}>送信</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  cancel: { color: COLORS.textMuted, fontSize: 15, fontWeight: '600' },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  remain: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', minWidth: 56, textAlign: 'right' },
  body: { flex: 1 },
  empty: { alignItems: 'center', marginTop: SPACING.xxl, paddingHorizontal: SPACING.lg },
  emptyIcon: { fontSize: 40, marginBottom: SPACING.md },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  userRow: { alignItems: 'flex-end', marginBottom: SPACING.md },
  userBubble: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, maxWidth: '85%' },
  userText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  aiRow: { alignItems: 'flex-start', marginBottom: SPACING.md },
  aiBubble: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, maxWidth: '90%', borderWidth: 1, borderColor: COLORS.border },
  aiText: { color: COLORS.text, fontSize: 14, lineHeight: 21 },
  imageBubble: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.sm, maxWidth: '85%', borderWidth: 1, borderColor: COLORS.border },
  genImage: { width: 240, height: 240, borderRadius: RADIUS.md, marginBottom: SPACING.sm },
  useBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: SPACING.sm, alignItems: 'center' },
  useBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  errorBubble: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.error, maxWidth: '90%' },
  errorText: { color: COLORS.error, fontSize: 13 },
  loadingBubble: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md },
  loadingText: { color: COLORS.textSecondary, fontSize: 13 },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },
  optLabel: { color: COLORS.textMuted, fontSize: 12, marginRight: 4 },
  optBtn: { paddingHorizontal: SPACING.md, paddingVertical: 5, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, marginRight: 4 },
  optBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  optText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  optTextActive: { color: '#fff' },
  genBtn: { backgroundColor: COLORS.secondary, marginHorizontal: SPACING.md, marginTop: SPACING.sm, borderRadius: RADIUS.full, paddingVertical: SPACING.md, alignItems: 'center' },
  genBtnDisabled: { opacity: 0.5 },
  genBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  inputRow: {
    flexDirection: 'row', gap: SPACING.sm, alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  input: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    color: COLORS.text, fontSize: 15, borderWidth: 1, borderColor: COLORS.border,
  },
  sendBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

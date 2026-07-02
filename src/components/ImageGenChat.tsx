import React, { useRef, useState } from 'react';
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
import { generateImage, ImageSize } from '../services/imageGenService';

interface Props {
  visible: boolean;
  onClose: () => void;
  onUseImage: (dataUrl: string) => void;
}

type Msg =
  | { role: 'user'; text: string }
  | { role: 'image'; uri: string; prompt: string }
  | { role: 'error'; text: string };

const SIZES: { key: ImageSize; label: string }[] = [
  { key: '1024x1024', label: '正方形' },
  { key: '1024x1536', label: '縦長' },
  { key: '1536x1024', label: '横長' },
];

export default function ImageGenChat({ visible, onClose, onUseImage }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [size, setSize] = useState<ImageSize>('1024x1024');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: prompt }]);
    setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const uri = await generateImage(prompt, size);
      setMessages((m) => [...m, { role: 'image', uri, prompt }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', text: e instanceof Error ? e.message : '画像生成に失敗しました' }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}><Text style={styles.cancel}>閉じる</Text></TouchableOpacity>
          <Text style={styles.title}>🎨 AIで画像を作る</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xl }}>
          {messages.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🎨</Text>
              <Text style={styles.emptyText}>作りたい画像を文章で入力してください{'\n'}例：夏の新作パフェ、明るいカフェの店内、写実的に</Text>
            </View>
          )}
          {messages.map((m, i) => {
            if (m.role === 'user') {
              return (
                <View key={i} style={styles.userRow}>
                  <View style={styles.userBubble}><Text style={styles.userText}>{m.text}</Text></View>
                </View>
              );
            }
            if (m.role === 'error') {
              return (
                <View key={i} style={styles.aiRow}>
                  <View style={styles.errorBubble}><Text style={styles.errorText}>{m.text}</Text></View>
                </View>
              );
            }
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
          {loading && (
            <View style={styles.aiRow}>
              <View style={styles.loadingBubble}>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={styles.loadingText}>生成中...</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* サイズ選択 */}
        <View style={styles.sizeRow}>
          {SIZES.map((s) => (
            <TouchableOpacity key={s.key} style={[styles.sizeBtn, size === s.key && styles.sizeBtnActive]} onPress={() => setSize(s.key)}>
              <Text style={[styles.sizeText, size === s.key && styles.sizeTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 入力欄 */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="作りたい画像を入力..."
            placeholderTextColor={COLORS.textMuted}
            onSubmitEditing={send}
            returnKeyType="send"
            editable={!loading}
          />
          <TouchableOpacity style={[styles.sendBtn, (loading || !input.trim()) && styles.sendBtnDisabled]} onPress={send} disabled={loading || !input.trim()}>
            <Text style={styles.sendBtnText}>生成</Text>
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
  body: { flex: 1 },
  empty: { alignItems: 'center', marginTop: SPACING.xxl, paddingHorizontal: SPACING.lg },
  emptyIcon: { fontSize: 40, marginBottom: SPACING.md },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  userRow: { alignItems: 'flex-end', marginBottom: SPACING.md },
  userBubble: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, maxWidth: '85%' },
  userText: { color: '#fff', fontSize: 14 },
  aiRow: { alignItems: 'flex-start', marginBottom: SPACING.md },
  imageBubble: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.sm, maxWidth: '85%', borderWidth: 1, borderColor: COLORS.border },
  genImage: { width: 240, height: 240, borderRadius: RADIUS.md, marginBottom: SPACING.sm },
  useBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: SPACING.sm, alignItems: 'center' },
  useBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  errorBubble: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.error, maxWidth: '85%' },
  errorText: { color: COLORS.error, fontSize: 13 },
  loadingBubble: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md },
  loadingText: { color: COLORS.textSecondary, fontSize: 13 },
  sizeRow: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm },
  sizeBtn: { paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  sizeBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  sizeText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  sizeTextActive: { color: '#fff' },
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

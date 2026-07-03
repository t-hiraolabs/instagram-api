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
import { chatWithAssistant, planImageGeneration, planStoryDesign, getChatUsagePercent, ChatTurn } from '../services/aiService';
import { composeStoryImage } from '../utils/composeStory';
import {
  listConversations, createConversation, renameConversation, deleteConversation,
  loadMessages, saveMessage, Conversation,
} from '../services/chatHistoryService';
import { uploadBlob } from '../services/storage';
import { saveAssistantMemory } from '../services/memoryService';
import { useAppStore } from '../store/appStore';
import * as ImagePicker from 'expo-image-picker';

interface Props {
  visible: boolean;
  onClose: () => void;
  onUseImage: (dataUrl: string) => void;
}

type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; options?: string[] }
  | { role: 'image'; uri: string }
  | { role: 'user_image'; uri: string }
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
  const [optVisible, setOptVisible] = useState(false);
  // 選択肢ボタンをタップしたときに、どちらの生成フローを再開するか
  const [awaitingMode, setAwaitingMode] = useState<'image' | 'story' | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [listVisible, setListVisible] = useState(false);
  const assistantMemory = useAppStore((s) => s.assistantMemory);
  const setAssistantMemoryStore = useAppStore((s) => s.setAssistantMemory);
  const [memoryDraft, setMemoryDraft] = useState('');
  useEffect(() => { setMemoryDraft(assistantMemory); }, [assistantMemory, listVisible]);
  const [pendingImage, setPendingImage] = useState<{ base64: string; mime: string; uri: string } | null>(null);

  const attachPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });
    if (res.canceled) return;
    const a = res.assets[0];
    if (a.base64) setPendingImage({ base64: a.base64, mime: a.mimeType ?? 'image/jpeg', uri: a.uri });
  };
  const [remaining, setRemaining] = useState<number | null>(null);
  const [chatRemainPct, setChatRemainPct] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const refreshUsage = () => {
    getImageUsage().then((u) => setRemaining(u.remaining)).catch(() => {});
    getChatUsagePercent().then((c) => setChatRemainPct(c.remainingPct)).catch(() => {});
  };

  useEffect(() => {
    if (visible) {
      refreshUsage();
      (async () => {
        const convs = await listConversations();
        setConversations(convs);
        // 直近の会話を開く。無ければ新規作成
        const id = convs[0]?.id ?? (await createConversation());
        if (id) {
          setConvId(id);
          if (!convs[0]) setConversations(await listConversations());
          await openConversation(id);
        }
      })().catch(() => {});
    }
  }, [visible]);

  const openConversation = async (id: string) => {
    setConvId(id);
    setListVisible(false);
    const rows = await loadMessages(id);
    setMessages(rows.map((r) =>
      r.role === 'image' ? { role: 'image', uri: r.content }
        : r.role === 'user_image' ? { role: 'user_image', uri: r.content }
        : { role: r.role as 'user' | 'assistant', text: r.content }
    ));
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
  };

  const newConversation = async () => {
    const id = await createConversation();
    if (!id) return;
    setConvId(id);
    setMessages([]);
    setListVisible(false);
    setConversations(await listConversations());
  };

  const removeConversation = async (id: string) => {
    await deleteConversation(id);
    const convs = await listConversations();
    setConversations(convs);
    if (id === convId) {
      const nextId = convs[0]?.id ?? (await createConversation());
      if (nextId) await openConversation(nextId);
    }
  };

  const toEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

  // 会話履歴（テキストのみ）をClaudeに渡す形に
  const history = (): ChatTurn[] =>
    messages
      .filter((m): m is { role: 'user' | 'assistant'; text: string } => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.text }));

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    const attach = pendingImage;
    if ((!text && !attach) || chatting) return;
    setInput('');
    setPendingImage(null);
    let id = convId;
    if (!id) { id = await createConversation(); setConvId(id); }
    const isFirst = messages.length === 0;

    // 添付画像があれば先にアップして履歴に残し、チャットにも表示
    let attachUrl = '';
    if (attach) {
      try { attachUrl = await uploadBlob(await (await fetch(attach.uri)).blob()); } catch { attachUrl = attach.uri; }
      setMessages((m) => [...m, { role: 'user_image', uri: attachUrl }]);
      if (id) saveMessage(id, 'user_image', attachUrl).catch(() => {});
    }

    const next = [...messages, ...(attach ? [{ role: 'user_image' as const, uri: attachUrl }] : []), { role: 'user' as const, text: text || '（画像について）' }];
    setMessages((m) => [...m, { role: 'user', text: text || '（画像について）' }]);
    if (id) {
      saveMessage(id, 'user', text || '（画像について）').catch(() => {});
      if (isFirst) {
        const title = (text || '画像について').slice(0, 30);
        renameConversation(id, title).catch(() => {});
        setConversations((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));
      }
    }
    setChatting(true);
    toEnd();
    try {
      const reply = await chatWithAssistant(
        next.filter((m): m is { role: 'user' | 'assistant'; text: string } => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.text })),
        attach ? { base64: attach.base64, mime: attach.mime } : undefined
      );
      setMessages((m) => [...m, { role: 'assistant', text: reply }]);
      if (id) saveMessage(id, 'assistant', reply).catch(() => {});
      getChatUsagePercent().then((c) => setChatRemainPct(c.remainingPct)).catch(() => {});
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', text: e instanceof Error ? e.message : '応答に失敗しました' }]);
    } finally {
      setChatting(false);
      toEnd();
    }
  };

  // 生成ボタン押下 → 枚数/サイズ指定オーバーレイを開く
  const openGenOptions = () => {
    const h = history();
    if (h.length === 0) {
      setMessages((m) => [...m, { role: 'error', text: 'まず作りたい画像について話しかけてください（例：夏の新作パフェの写真がほしい）' }]);
      toEnd();
      return;
    }
    setOptVisible(true);
  };

  const answerOption = async (opt: string) => {
    if (chatting || generating) return;
    await send(opt);
    if (awaitingMode === 'story') await generateStoryFromChat();
    else await generate();
  };

  // 会話中でユーザーが添付した最後の写真（ストーリーの土台にする）
  const lastUserPhoto = (): string | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'user_image') return m.uri;
    }
    return null;
  };

  /** 手持ち写真＋AIが考えた文字・配色でストーリーを作る（画像生成AIを使わないのでコストが安い） */
  const generateStoryFromChat = async () => {
    if (generating) return;
    const photo = lastUserPhoto();
    if (!photo) {
      setMessages((m) => [...m, { role: 'error', text: 'まず写真をチャットに添付してください（📎から選択）。' }]);
      toEnd();
      return;
    }
    const h = history();
    if (h.length === 0) return;
    setGenerating(true);
    setAwaitingMode(null);
    toEnd();
    try {
      const plan = await planStoryDesign(h);
      if (!plan.ready || !plan.overlay) {
        const q = plan.question ?? 'どんな内容のストーリーにしたいか、もう少し教えてください。';
        setAwaitingMode('story');
        setMessages((m) => [...m, { role: 'assistant', text: q, options: plan.options }]);
        if (convId) saveMessage(convId, 'assistant', q).catch(() => {});
        getChatUsagePercent().then((c) => setChatRemainPct(c.remainingPct)).catch(() => {});
        return;
      }
      const { blob, previewUrl } = await composeStoryImage(photo, plan.overlay);
      let stored = previewUrl;
      try { stored = await uploadBlob(blob); } catch { /* アップ失敗時はプレビューのまま表示 */ }
      const listText = `この写真でストーリーを作りました：\n「${plan.overlay.title}」`;
      setMessages((m) => [...m, { role: 'assistant', text: listText }, { role: 'image', uri: stored }]);
      if (convId) {
        saveMessage(convId, 'assistant', listText).catch(() => {});
        saveMessage(convId, 'image', stored).catch(() => {});
      }
      toEnd();
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', text: e instanceof Error ? e.message : 'ストーリー作成に失敗しました' }]);
    } finally {
      setGenerating(false);
      toEnd();
    }
  };

  const generate = async () => {
    if (generating) return;
    setOptVisible(false);
    const h = history();
    if (h.length === 0) return;
    setGenerating(true);
    setAwaitingMode(null);
    toEnd();
    try {
      const plan = await planImageGeneration(h, count);
      // 情報が足りない場合は生成せず質問する
      if (!plan.ready || !plan.prompts || plan.prompts.length === 0) {
        const q = plan.question ?? 'どんな画像にしたいか、もう少し教えてください（用途・雰囲気・入れたい要素など）。';
        setAwaitingMode('image');
        setMessages((m) => [...m, { role: 'assistant', text: q, options: plan.options }]);
        if (convId) saveMessage(convId, 'assistant', q).catch(() => {});
        getChatUsagePercent().then((c) => setChatRemainPct(c.remainingPct)).catch(() => {});
        return;
      }
      const prompts = plan.prompts;
      const listText = count > 1
        ? `以下の内容で${count}枚生成します：\n` + prompts.map((p, i) => `${i + 1}. ${p}`).join('\n')
        : `この内容で生成します：\n「${prompts[0]}」`;
      setMessages((m) => [...m, { role: 'assistant', text: listText }]);
      if (convId) saveMessage(convId, 'assistant', listText).catch(() => {});
      toEnd();
      // 各プロンプトを1枚ずつ生成（枚数=プロンプト数）
      let rem = 0;
      for (const p of prompts) {
        const r = await generateImages(p, 1, size);
        rem = r.remaining;
        setRemaining(rem);
        for (const dataUrl of r.images) {
          // data URL をStorageにアップして永続化（履歴に残す）
          let stored = dataUrl;
          try {
            const blob = await (await fetch(dataUrl)).blob();
            stored = await uploadBlob(blob);
          } catch { /* アップ失敗時はdata URLのまま表示 */ }
          setMessages((m) => [...m, { role: 'image', uri: stored }]);
          if (convId) saveMessage(convId, 'image', stored).catch(() => {});
        }
        toEnd();
      }
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
            <TouchableOpacity onPress={onClose}><Text style={styles.cancel}>閉じる</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setListVisible(true)}><Text style={styles.menuBtn}>☰</Text></TouchableOpacity>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.remain}>{chatRemainPct == null ? '' : `会話 残り${chatRemainPct}%`}</Text>
            <Text style={styles.remainSub}>{remaining == null ? '' : `画像 残り${remaining}枚`}</Text>
          </View>
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
              <View key={i} style={styles.aiRow}>
                <View style={styles.aiBubble}>
                  <Text style={styles.aiText}>{m.text}</Text>
                  {!!m.options?.length && i === messages.length - 1 && (
                    <View style={styles.optionsWrap}>
                      {m.options.map((opt, oi) => (
                        <TouchableOpacity
                          key={oi}
                          style={styles.optionChip}
                          onPress={() => answerOption(opt)}
                          disabled={chatting || generating}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.optionChipText}>{opt}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            );
            if (m.role === 'error') return (
              <View key={i} style={styles.aiRow}><View style={styles.errorBubble}><Text style={styles.errorText}>{m.text}</Text></View></View>
            );
            if (m.role === 'user_image') return (
              <View key={i} style={styles.userRow}>
                <Image source={{ uri: m.uri }} style={styles.attachThumb} resizeMode="cover" />
              </View>
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

        <TouchableOpacity
          style={[styles.genBtn, styles.storyBtn, generating && styles.genBtnDisabled]}
          onPress={generateStoryFromChat}
          disabled={generating}
        >
          <Text style={styles.genBtnText}>📖 添付した写真でストーリーを作る</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.genBtn, (generating || (remaining ?? 1) <= 0) && styles.genBtnDisabled]}
          onPress={openGenOptions}
          disabled={generating || (remaining ?? 1) <= 0}
        >
          <Text style={styles.genBtnText}>
            {(remaining ?? 1) <= 0 ? '🎨 画像生成はビジネスプラン限定' : '🎨 会話をもとに画像を生成'}
          </Text>
        </TouchableOpacity>

        {/* 枚数・サイズ指定オーバーレイ */}
        {optVisible && (
          <View style={styles.optOverlay}>
            <View style={styles.optCard}>
              <Text style={styles.optTitle}>生成する枚数とサイズ</Text>
              <Text style={styles.optSub}>枚数</Text>
              <View style={styles.optChips}>
                {COUNTS.map((c) => (
                  <TouchableOpacity key={c} style={[styles.optBtn, count === c && styles.optBtnActive]} onPress={() => setCount(c)}>
                    <Text style={[styles.optText, count === c && styles.optTextActive]}>{c}枚</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.optSub}>サイズ</Text>
              <View style={styles.optChips}>
                {SIZES.map((s) => (
                  <TouchableOpacity key={s.key} style={[styles.optBtn, size === s.key && styles.optBtnActive]} onPress={() => setSize(s.key)}>
                    <Text style={[styles.optText, size === s.key && styles.optTextActive]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {remaining != null && <Text style={styles.optRemain}>画像 残り{remaining}枚</Text>}
              <TouchableOpacity style={styles.optGenBtn} onPress={generate} activeOpacity={0.85}>
                <Text style={styles.optGenText}>この設定で生成（{count}枚）</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.optCancel} onPress={() => setOptVisible(false)}>
                <Text style={styles.optCancelText}>キャンセル</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 添付プレビュー */}
        {pendingImage && (
          <View style={styles.attachPreviewRow}>
            <Image source={{ uri: pendingImage.uri }} style={styles.attachPreview} resizeMode="cover" />
            <Text style={styles.attachPreviewText}>写真を添付中</Text>
            <TouchableOpacity onPress={() => setPendingImage(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.attachRemove}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* 入力欄 */}
        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.attachBtn} onPress={attachPhoto} disabled={chatting}>
            <Text style={styles.attachBtnText}>📎</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="相談・指示を入力..."
            placeholderTextColor={COLORS.textMuted}
            onSubmitEditing={() => send()}
            returnKeyType="send"
            editable={!chatting}
          />
          <TouchableOpacity style={[styles.sendBtn, (chatting || (!input.trim() && !pendingImage)) && styles.sendBtnDisabled]} onPress={() => send()} disabled={chatting || (!input.trim() && !pendingImage)}>
            <Text style={styles.sendBtnText}>送信</Text>
          </TouchableOpacity>
        </View>

        {/* 会話一覧（Claude風） */}
        {listVisible && (
          <View style={styles.listOverlay}>
            <TouchableOpacity style={styles.listBackdrop} activeOpacity={1} onPress={() => setListVisible(false)} />
            <View style={styles.listPanel}>
              <View style={styles.listHeader}>
                <Text style={styles.listTitle}>会話</Text>
                <TouchableOpacity onPress={() => setListVisible(false)}><Text style={styles.listClose}>✕</Text></TouchableOpacity>
              </View>
              {/* AIに覚えさせる説明（常に参照される） */}
              <View style={styles.memoryBox}>
                <Text style={styles.memoryLabel}>🧠 AIに覚えさせる説明</Text>
                <TextInput
                  style={styles.memoryInput}
                  value={memoryDraft}
                  onChangeText={setMemoryDraft}
                  placeholder="例: AImarkはAIでInstagram運用を自動化する個人事業主向けアプリ。投稿作成・予約・分析ができる。"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                />
                <TouchableOpacity
                  style={styles.memorySave}
                  onPress={async () => {
                    try {
                      await saveAssistantMemory(memoryDraft);
                      setAssistantMemoryStore(memoryDraft);
                      if (Platform.OS === 'web') window.alert('保存しました');
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : '保存に失敗しました';
                      if (Platform.OS === 'web') window.alert('保存に失敗しました\n' + msg);
                    }
                  }}
                >
                  <Text style={styles.memorySaveText}>保存</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.newBtn} onPress={newConversation}>
                <Text style={styles.newBtnText}>＋ 新しい会話</Text>
              </TouchableOpacity>
              <ScrollView style={{ flex: 1 }}>
                {conversations.map((c) => (
                  <View key={c.id} style={[styles.convRow, c.id === convId && styles.convRowActive]}>
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => openConversation(c.id)}>
                      <Text style={styles.convTitle} numberOfLines={1}>{c.title || '新しい会話'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        const run = () => removeConversation(c.id);
                        if (Platform.OS === 'web') { if (window.confirm('この会話を削除しますか？')) run(); }
                        else run();
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.convDelete}>🗑</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {conversations.length === 0 && <Text style={styles.convEmpty}>会話はまだありません</Text>}
              </ScrollView>
            </View>
          </View>
        )}
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
  remain: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  remainSub: { color: COLORS.textMuted, fontSize: 10, textAlign: 'right', marginTop: 1 },
  body: { flex: 1 },
  menuBtn: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  listOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
  listBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  listPanel: { width: '78%', maxWidth: 320, backgroundColor: COLORS.background, borderRightWidth: 1, borderRightColor: COLORS.border, paddingTop: SPACING.lg },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  listTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  listClose: { color: COLORS.textMuted, fontSize: 16 },
  memoryBox: { marginHorizontal: SPACING.md, marginTop: SPACING.sm, padding: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  memoryLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  memoryInput: { color: COLORS.text, fontSize: 13, minHeight: 70, textAlignVertical: 'top', backgroundColor: COLORS.background, borderRadius: RADIUS.sm, padding: SPACING.sm },
  memorySave: { alignSelf: 'flex-end', marginTop: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 5 },
  memorySaveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  newBtn: { margin: SPACING.md, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: SPACING.sm, alignItems: 'center' },
  newBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  convRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border, gap: SPACING.sm },
  convRowActive: { backgroundColor: COLORS.surface },
  convTitle: { color: COLORS.text, fontSize: 14 },
  convDelete: { fontSize: 15 },
  convEmpty: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginTop: SPACING.xl },
  empty: { alignItems: 'center', marginTop: SPACING.xxl, paddingHorizontal: SPACING.lg },
  emptyIcon: { fontSize: 40, marginBottom: SPACING.md },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  userRow: { alignItems: 'flex-end', marginBottom: SPACING.md },
  userBubble: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, maxWidth: '85%' },
  userText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  aiRow: { alignItems: 'flex-start', marginBottom: SPACING.md },
  aiBubble: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, maxWidth: '90%', borderWidth: 1, borderColor: COLORS.border },
  aiText: { color: COLORS.text, fontSize: 14, lineHeight: 21 },
  optionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm },
  optionChip: { borderWidth: 1, borderColor: COLORS.primaryLight, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.sm, paddingVertical: 6, backgroundColor: COLORS.background },
  optionChipText: { color: COLORS.primaryLight, fontSize: 13, fontWeight: '600' },
  imageBubble: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.sm, maxWidth: '85%', borderWidth: 1, borderColor: COLORS.border },
  genImage: { width: 240, height: 240, borderRadius: RADIUS.md, marginBottom: SPACING.sm },
  useBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: SPACING.sm, alignItems: 'center' },
  useBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  errorBubble: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.error, maxWidth: '90%' },
  errorText: { color: COLORS.error, fontSize: 13 },
  loadingBubble: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md },
  loadingText: { color: COLORS.textSecondary, fontSize: 13 },
  optOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  optCard: { width: '100%', maxWidth: 360, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border },
  optTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', textAlign: 'center', marginBottom: SPACING.md },
  optSub: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: SPACING.sm, marginTop: SPACING.sm },
  optChips: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap' },
  optRemain: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: SPACING.md },
  optGenBtn: { backgroundColor: COLORS.secondary, borderRadius: RADIUS.full, paddingVertical: SPACING.md, alignItems: 'center', marginTop: SPACING.md },
  optGenText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  optCancel: { paddingVertical: SPACING.md, alignItems: 'center', marginTop: 4 },
  optCancelText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  optBtn: { paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  optBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  optText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  optTextActive: { color: '#fff' },
  genBtn: { backgroundColor: COLORS.secondary, marginHorizontal: SPACING.md, marginTop: SPACING.sm, borderRadius: RADIUS.full, paddingVertical: SPACING.md, alignItems: 'center' },
  storyBtn: { backgroundColor: COLORS.primary },
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
  attachThumb: { width: 160, height: 160, borderRadius: RADIUS.md },
  attachPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },
  attachPreview: { width: 40, height: 40, borderRadius: RADIUS.sm },
  attachPreviewText: { flex: 1, color: COLORS.textSecondary, fontSize: 13 },
  attachRemove: { color: COLORS.textMuted, fontSize: 16, fontWeight: '700' },
  attachBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  attachBtnText: { fontSize: 18 },
  sendBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

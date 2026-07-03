import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
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
import { chatWithAssistant, planDesign, getChatUsagePercent, ChatTurn } from '../services/aiService';
import { getAutoAnalysisFacts } from '../services/insightsService';
import { composeStoryImage } from '../utils/composeStory';
import { composeFlyerImage } from '../utils/composeFlyer';
import {
  listConversations, createConversation, renameConversation, deleteConversation,
  loadMessages, saveMessage, purgeOldConversations, Conversation,
} from '../services/chatHistoryService';
import { uploadBlob } from '../services/storage';
import { useAppStore } from '../store/appStore';
import * as ImagePicker from 'expo-image-picker';

interface Props {
  visible: boolean;
  onClose?: () => void;
  onUseImage: (dataUrl: string) => void;
  /** trueの場合、Modalで包まずその場に埋め込む（ホーム画面のインラインチャット用） */
  embedded?: boolean;
  /** embedded時、ホームのブリーフィング表示に戻るためのコールバック */
  onBack?: () => void;
  /** メッセージが1件もないときに、デフォルトの案内文の代わりに表示する内容（ホームのおすすめ表示用） */
  emptyState?: React.ReactNode;
  /** 会話履歴メニューの開閉状態が変わるたびに呼ばれる（ホーム側のロゴの見た目を切り替えるため） */
  onMenuVisibleChange?: (visible: boolean) => void;
}

export interface ImageGenChatHandle {
  /** 外部（ホーム画面のおすすめチップなど）からメッセージを送信する */
  sendMessage: (text: string) => void;
  /** 外部（ホーム画面のロゴタップなど）から会話履歴メニューの開閉を切り替える */
  toggleMenu: () => void;
}

type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; options?: string[] }
  | { role: 'image'; uri: string }
  | { role: 'user_image'; uri: string }
  | { role: 'error'; text: string };

function ImageGenChat(
  { visible, onClose, onUseImage, embedded, onBack, emptyState, onMenuVisibleChange }: Props,
  ref: React.Ref<ImageGenChatHandle>
) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const [generating, setGenerating] = useState(false);
  // 選択肢ボタンをタップしたときに、デザイン生成フローを再開するためのフラグ
  const [awaitingDesign, setAwaitingDesign] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [listVisible, setListVisible] = useState(false);
  useEffect(() => { onMenuVisibleChange?.(listVisible); }, [listVisible]);
  const [pendingImage, setPendingImage] = useState<{ base64: string; mime: string; uri: string } | null>(null);

  // 会話を切り替える前に、メッセージが1件も無い会話は保存せず消す
  const convIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => { convIdRef.current = convId; }, [convId]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const cleanupIfEmpty = async (id: string | null) => {
    if (id && messagesRef.current.length === 0) {
      await deleteConversation(id).catch(() => {});
      setConversations((cs) => cs.filter((c) => c.id !== id));
    }
  };

  // 過去に空のまま保存された会話（このアプリでは今後作られなくなる）を掃除する
  const purgeEmptyConversations = async (convs: Conversation[]): Promise<Conversation[]> => {
    const kept: Conversation[] = [];
    for (const c of convs) {
      const rows = await loadMessages(c.id).catch(() => null);
      if (rows && rows.length === 0) {
        await deleteConversation(c.id).catch(() => {});
      } else {
        kept.push(c);
      }
    }
    return kept;
  };

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
  const [chatRemainPct, setChatRemainPct] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const refreshUsage = () => {
    getChatUsagePercent().then((c) => setChatRemainPct(c.remainingPct)).catch(() => {});
  };

  const chatPrefillText = useAppStore((s) => s.chatPrefillText);
  const setChatPrefillText = useAppStore((s) => s.setChatPrefillText);
  const chatAutoSend = useAppStore((s) => s.chatAutoSend);
  const setChatAutoSend = useAppStore((s) => s.setChatAutoSend);
  const chatForceNew = useAppStore((s) => s.chatForceNew);
  const setChatForceNew = useAppStore((s) => s.setChatForceNew);
  // convIdの準備ができてから自動送信するために、送るべき文言をここに一時保持する
  const [pendingAutoSend, setPendingAutoSend] = useState<string | null>(null);

  useEffect(() => {
    // モーダルを閉じるとき（visibleがfalseになったとき）、空の会話が残っていれば消す
    if (!visible) {
      cleanupIfEmpty(convIdRef.current);
      return;
    }
    {
      refreshUsage();
      const prefill = chatPrefillText;
      const autoSend = chatAutoSend;
      // 埋め込み表示（ホーム画面）は起動のたびに必ず新規チャットで始める
      const forceNew = chatForceNew || embedded;
      setChatPrefillText(null);
      setChatAutoSend(false);
      setChatForceNew(false);
      (async () => {
        await purgeOldConversations(30).catch(() => {});
        const rawConvs = await listConversations();
        const convs = await purgeEmptyConversations(rawConvs);
        setConversations(convs);
        if (forceNew) {
          // メッセージを送るまで会話は作らない（空の会話を保存しないため）
          setConvId(null);
          setMessages([]);
          setListVisible(false);
        } else if (convs[0]) {
          await openConversation(convs[0].id);
        } else {
          setConvId(null);
          setMessages([]);
        }
        // ホームのミニチャットから送信済みの場合は、convIdの準備が整ってから自動送信する
        if (prefill && autoSend) {
          setPendingAutoSend(prefill);
        } else if (prefill) {
          setInput(prefill);
        }
      })().catch(() => {});
    }
  }, [visible]);

  useEffect(() => {
    if (pendingAutoSend) {
      const text = pendingAutoSend;
      setPendingAutoSend(null);
      send(text);
    }
  }, [pendingAutoSend]);

  const openConversation = async (id: string) => {
    if (convIdRef.current !== id) await cleanupIfEmpty(convIdRef.current);
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
    // メッセージを送るまで会話は作らない（空の会話を保存しないため）
    await cleanupIfEmpty(convIdRef.current);
    setConvId(null);
    setMessages([]);
    setListVisible(false);
  };

  const removeConversation = async (id: string) => {
    await deleteConversation(id);
    const convs = await listConversations();
    setConversations(convs);
    if (id === convId) {
      if (convs[0]) await openConversation(convs[0].id);
      else { setConvId(null); setMessages([]); }
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
      // 「分析して」「インサイト見せて」などは、プログラム側で集計した実データをAIに渡して説明させる
      let analysisFacts: string | undefined;
      if (/分析|インサイト|振り返り|保存率|いいね率|エンゲージメント|反応(は|が|の).{0,6}(良|悪|どう)/.test(text)) {
        const facts = await getAutoAnalysisFacts();
        if ('text' in facts) {
          analysisFacts = facts.text;
        } else {
          const reason = facts.reason;
          setMessages((m) => [...m, { role: 'error', text: reason }]);
        }
      }
      const reply = await chatWithAssistant(
        next.filter((m): m is { role: 'user' | 'assistant'; text: string } => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.text })),
        attach ? { base64: attach.base64, mime: attach.mime } : undefined,
        analysisFacts
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

  useImperativeHandle(ref, () => ({
    sendMessage: (text: string) => { send(text); },
    toggleMenu: () => setListVisible((v) => !v),
  }));

  const answerOption = async (opt: string) => {
    if (chatting || generating) return;
    await send(opt);
    if (awaitingDesign) await runDesign();
  };

  // 会話中でユーザーが添付した最後の写真（デザインの土台にする）
  const lastUserPhoto = (): string | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'user_image') return m.uri;
    }
    return null;
  };

  /**
   * 手持ち写真をもとにデザインを作る（画像生成AIは使わない）。
   * 会話の内容から、ストーリー（写真に文字だけ）かパンフレット/チラシ（見出し・詳細・価格など）かをAIが判断する。
   */
  const runDesign = async (photoOverride?: string) => {
    if (generating) return;
    const photo = photoOverride ?? lastUserPhoto();
    if (!photo) {
      setMessages((m) => [...m, { role: 'error', text: 'まず写真を選んでください。' }]);
      toEnd();
      return;
    }
    setGenerating(true);
    setAwaitingDesign(false);
    toEnd();
    try {
      const plan = await planDesign(history());
      if (!plan.ready || (!plan.storyOverlay && !plan.flyer)) {
        const q = plan.question ?? 'どんな内容のデザインにしたいか、もう少し教えてください。';
        setAwaitingDesign(true);
        setMessages((m) => [...m, { role: 'assistant', text: q, options: plan.options }]);
        if (convId) saveMessage(convId, 'assistant', q).catch(() => {});
        getChatUsagePercent().then((c) => setChatRemainPct(c.remainingPct)).catch(() => {});
        return;
      }
      const { blob, previewUrl, label } =
        plan.designType === 'flyer' && plan.flyer
          ? { ...(await composeFlyerImage(photo, plan.flyer)), label: `パンフレットを作りました：\n「${plan.flyer.headline}」` }
          : { ...(await composeStoryImage(photo, plan.storyOverlay!)), label: `この写真でデザインを作りました：\n「${plan.storyOverlay!.title}」` };
      let stored = previewUrl;
      try { stored = await uploadBlob(blob); } catch { /* アップ失敗時はプレビューのまま表示 */ }
      setMessages((m) => [...m, { role: 'assistant', text: label }, { role: 'image', uri: stored }]);
      if (convId) {
        saveMessage(convId, 'assistant', label).catch(() => {});
        saveMessage(convId, 'image', stored).catch(() => {});
      }
      toEnd();
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', text: e instanceof Error ? e.message : 'デザイン作成に失敗しました' }]);
    } finally {
      setGenerating(false);
      toEnd();
    }
  };

  /** 「生成する」ボタン → その場で写真を選んでもらい、選んだ写真にAIがデザインを加える */
  const startGenerate = async () => {
    if (generating) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    let stored = asset.uri;
    try { stored = await uploadBlob(await (await fetch(asset.uri)).blob()); } catch { /* アップ失敗時は元のURIのまま */ }
    setMessages((m) => [...m, { role: 'user_image', uri: stored }]);
    if (convId) saveMessage(convId, 'user_image', stored).catch(() => {});
    toEnd();
    await runDesign(stored);
  };

  if (embedded && !visible) return null;

  const content = (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {!embedded && (
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
              <TouchableOpacity onPress={() => setListVisible(true)}><Text style={styles.menuBtn}>☰</Text></TouchableOpacity>
              <TouchableOpacity onPress={onClose}><Text style={styles.cancel}>閉じる</Text></TouchableOpacity>
            </View>
          </View>
        )}

        <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xl }}>
          {messages.length === 0 && (
            emptyState ?? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>💬</Text>
                <Text style={styles.emptyText}>
                  作りたい投稿について相談できます。{'\n'}
                  「生成する」を押すと、写真を選んでその写真にデザインを加えます。
                </Text>
              </View>
            )
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
          style={[styles.genBtn, generating && styles.genBtnDisabled]}
          onPress={startGenerate}
          disabled={generating}
        >
          <Text style={styles.genBtnText}>🎨 生成する</Text>
        </TouchableOpacity>

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
              </View>
              {chatRemainPct != null && (
                <Text style={styles.usageText}>会話の利用量　残り{chatRemainPct}%</Text>
              )}

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
  );

  if (embedded) return content;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {content}
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
  body: { flex: 1 },
  menuBtn: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  listOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
  listBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  listPanel: { width: '78%', maxWidth: 320, backgroundColor: COLORS.background, borderRightWidth: 1, borderRightColor: COLORS.border, paddingTop: SPACING.lg },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  listTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  usageText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600', paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
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
  genBtn: { backgroundColor: COLORS.primary, marginHorizontal: SPACING.md, marginTop: SPACING.sm, borderRadius: RADIUS.full, paddingVertical: SPACING.md, alignItems: 'center' },
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

export default React.forwardRef(ImageGenChat);

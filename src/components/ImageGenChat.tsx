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
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { chatWithAssistant, getChatUsagePercent, ChatTurn } from '../services/aiService';
import { getAutoAnalysisFacts } from '../services/insightsService';
import { getAiUsage, AiUsage } from '../services/scheduleService';
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
  | { role: 'assistant'; text: string }
  | { role: 'image'; uri: string }
  | { role: 'user_image'; uri: string }
  | { role: 'error'; text: string };

/** Claudeデスクトップの使用量パネル風の、割合を色付きバーで見せるだけの表示用パーツ */
function UsageBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped >= 90 ? COLORS.error : clamped >= 70 ? COLORS.secondary : COLORS.primary;
  return (
    <View style={styles.usageBarTrack}>
      <View style={[styles.usageBarFill, { width: `${clamped}%`, backgroundColor: color }]} />
    </View>
  );
}

function ImageGenChat(
  { visible, onClose, onUseImage, embedded, onBack, emptyState, onMenuVisibleChange }: Props,
  ref: React.Ref<ImageGenChatHandle>
) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [listVisible, setListVisible] = useState(false);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  useEffect(() => { onMenuVisibleChange?.(listVisible); }, [listVisible]);
  const [pendingImage, setPendingImage] = useState<{ base64: string; mime: string; uri: string } | null>(null);
  // 一度取得した分析データはこの会話の間ずっと使い回す（フォローアップの質問でも参照できるように）
  const [lastAnalysisFacts, setLastAnalysisFacts] = useState<string | null>(null);
  useEffect(() => { setLastAnalysisFacts(null); }, [convId]);

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

  // アカウント切り替え（チャットもアカウントごとに保存・表示する）
  const instagramCredentials = useAppStore((s) => s.instagramCredentials);
  const secondInstagramCredentials = useAppStore((s) => s.secondInstagramCredentials);
  const thirdInstagramCredentials = useAppStore((s) => s.thirdInstagramCredentials);
  const activeAccountSlot = useAppStore((s) => s.activeAccountSlot);
  const setActiveAccountSlot = useAppStore((s) => s.setActiveAccountSlot);
  // 会話はスロット番号ではなくアカウント本体（ig_user_id）に紐づくため、
  // 連携解除でスロットが繰り上がりスロット番号が変わらないまま中身のアカウントだけ
  // 変わるケースも検知できるよう、実際のアカウントIDで比較する。
  const activeIgUserId = activeAccountSlot === 3 ? thirdInstagramCredentials?.userId : activeAccountSlot === 2 ? secondInstagramCredentials?.userId : instagramCredentials?.userId;
  const accountKeyRef = useRef(`${activeAccountSlot}:${activeIgUserId ?? ''}`);

  const reloadForAccount = async () => {
    await cleanupIfEmpty(convIdRef.current);
    setConvId(null);
    setMessages([]);
    setOpenActionsId(null);
    const convs = await purgeEmptyConversations(await listConversations());
    setConversations(convs);
    // アカウント切り替え時にメニュー（会話一覧）を開いたまま操作を続けられるよう、閉じない
    if (convs[0]) await openConversation(convs[0].id, false);
  };

  const switchAccount = async (slot: 1 | 2 | 3) => {
    if (slot === activeAccountSlot) return;
    setActiveAccountSlot(slot);
  };

  // アクティブなアカウント（スロット×ig_user_id）が変わったら、そのアカウントの会話に切り替える
  useEffect(() => {
    const key = `${activeAccountSlot}:${activeIgUserId ?? ''}`;
    const prevKey = accountKeyRef.current;
    accountKeyRef.current = key;
    if (prevKey === key) return;
    const prevIgUserId = prevKey.slice(prevKey.indexOf(':') + 1);
    const nextIgUserId = key.slice(key.indexOf(':') + 1);
    // 起動直後は、永続化されたInstagram連携情報が非同期で読み込まれる過程で
    // 「未確定→確定」に変わるだけでもこの効果が発火してしまい、embeddedの
    // 「毎回新規チャットで始める」を上書きして直近の会話を開いてしまっていた。
    // 前回が未確定（空）から確定した場合は、起動時の初期解決とみなして無視する。
    if (prevIgUserId === '' && nextIgUserId !== '') return;
    reloadForAccount().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountSlot, activeIgUserId]);

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
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const refreshUsage = () => {
    getChatUsagePercent().then((c) => setChatRemainPct(c.remainingPct)).catch(() => {});
    getAiUsage().then(setAiUsage).catch(() => {});
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

  const openConversation = async (id: string, closeMenu = true) => {
    if (convIdRef.current !== id) await cleanupIfEmpty(convIdRef.current);
    setConvId(id);
    if (closeMenu) setListVisible(false);
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

  const renameConversationPrompt = async (c: Conversation) => {
    setOpenActionsId(null);
    if (Platform.OS !== 'web') return;
    const input = window.prompt('会話の名前を変更', c.title || '');
    if (input === null) return;
    const title = input.trim();
    if (!title) return;
    await renameConversation(c.id, title);
    setConversations((cs) => cs.map((x) => (x.id === c.id ? { ...x, title } : x)));
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
      // 「分析して」「インサイト見せて」などは、プログラム側で集計した実データをAIに渡して説明させる。
      // 一度取得したら、同じ会話内のフォローアップ質問でも引き続き参照できるようにする。
      let analysisFacts: string | undefined = lastAnalysisFacts ?? undefined;
      if (/分析|インサイト|振り返り|保存率|いいね率|エンゲージメント|フォロワー|プロフィール|自己紹介|アカウント(の|を)|改善|伸ば|反応(は|が|の).{0,6}(良|悪|どう)|競合|ライバル|過去(の)?投稿|曜日|時間帯|投稿タイプ/.test(text)) {
        const facts = await getAutoAnalysisFacts();
        if ('text' in facts) {
          analysisFacts = facts.text;
          setLastAnalysisFacts(facts.text);
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
      refreshUsage();
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
                <Ionicons name="chatbubble-outline" size={40} color={COLORS.textMuted} style={styles.emptyIcon} />
                <Text style={styles.emptyText}>
                  投稿したい写真やキャプションを送ってください。{'\n'}
                  Instagramマーケティングの視点で、厳しく分析・アドバイスします。
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
          {chatting && (
            <View style={styles.aiRow}>
              <View style={styles.loadingBubble}>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={styles.loadingText}>考え中...</Text>
              </View>
            </View>
          )}
        </ScrollView>

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
            <Ionicons name="attach" size={20} color={COLORS.text} />
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

              {(chatRemainPct != null || aiUsage) && (
                <View style={styles.usageBox}>
                  {chatRemainPct != null && (
                    <View style={styles.usageItem}>
                      <View style={styles.usageRow}>
                        <Text style={styles.usageLabel}>会話の利用量</Text>
                        <Text style={styles.usageValue}>{100 - chatRemainPct}% 使用済み</Text>
                      </View>
                      <UsageBar pct={100 - chatRemainPct} />
                    </View>
                  )}
                  {aiUsage && (
                    <View style={styles.usageItem}>
                      <View style={styles.usageRow}>
                        <Text style={styles.usageLabel}>{aiUsage.plan === 'free' ? 'AI生成（無料・累計）' : '今月のAI生成'}</Text>
                        <Text style={styles.usageValue}>{aiUsage.used}/{aiUsage.limit}回</Text>
                      </View>
                      <UsageBar pct={aiUsage.limit > 0 ? (aiUsage.used / aiUsage.limit) * 100 : 0} />
                    </View>
                  )}
                </View>
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
                      onPress={() => setOpenActionsId(c.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.convMore}>⋮</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {conversations.length === 0 && <Text style={styles.convEmpty}>会話はまだありません</Text>}
              </ScrollView>

              {/* アカウント切り替え：メニュー最下部 */}
              {(instagramCredentials || secondInstagramCredentials || thirdInstagramCredentials) && (
                <View style={styles.accountSwitchRow}>
                  {([
                    { slot: 1 as const, creds: instagramCredentials },
                    { slot: 2 as const, creds: secondInstagramCredentials },
                    { slot: 3 as const, creds: thirdInstagramCredentials },
                  ]).filter((a) => a.creds).map((a) => (
                    <TouchableOpacity
                      key={a.slot}
                      style={[styles.accountChip, a.slot === activeAccountSlot && styles.accountChipActive]}
                      onPress={() => switchAccount(a.slot)}
                      activeOpacity={0.8}
                    >
                      {a.creds!.profilePictureUrl ? (
                        <Image source={{ uri: a.creds!.profilePictureUrl }} style={styles.accountChipImg} />
                      ) : (
                        <View style={styles.accountChipImgPlaceholder} />
                      )}
                      <Text
                        style={[styles.accountChipText, a.slot === activeAccountSlot && styles.accountChipTextActive]}
                        numberOfLines={1}
                      >
                        @{a.creds!.username ?? `アカウント${a.slot}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {/* 会話ごとのアクションメニュー（名前の変更・削除） */}
        {listVisible && openActionsId && (() => {
          const target = conversations.find((c) => c.id === openActionsId);
          if (!target) return null;
          return (
            <View style={styles.convActionsOverlay}>
              <TouchableOpacity
                style={styles.convActionsBackdrop}
                activeOpacity={1}
                onPress={() => setOpenActionsId(null)}
              />
              <View style={styles.convActionsSheet}>
                <Text style={styles.convActionsTitle} numberOfLines={1}>{target.title || '新しい会話'}</Text>
                <TouchableOpacity style={styles.convActionItem} onPress={() => renameConversationPrompt(target)}>
                  <Text style={styles.convActionText}>名前の変更</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.convActionItem}
                  onPress={() => {
                    setOpenActionsId(null);
                    const run = () => removeConversation(target.id);
                    if (Platform.OS === 'web') { if (window.confirm('この会話を削除しますか？')) run(); }
                    else run();
                  }}
                >
                  <Text style={[styles.convActionText, styles.convActionDanger]}>削除</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.convActionItem} onPress={() => setOpenActionsId(null)}>
                  <Text style={styles.convActionText}>キャンセル</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })()}
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
  listPanel: { width: '78%', maxWidth: 320, backgroundColor: COLORS.background, borderRightWidth: 1, borderRightColor: COLORS.border, paddingTop: SPACING.lg, position: 'relative' },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  listTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  usageBox: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    gap: SPACING.md,
  },
  usageItem: { gap: 6 },
  usageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  usageLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  usageValue: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  usageBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.border,
    overflow: 'hidden',
  },
  usageBarFill: { height: '100%', borderRadius: 3 },
  accountSwitchRow: {
    flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm, paddingBottom: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  accountChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1,
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.full,
    paddingVertical: 6, paddingHorizontal: 10, backgroundColor: COLORS.surface,
  },
  accountChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '15' },
  accountChipImg: { width: 20, height: 20, borderRadius: 10 },
  accountChipImgPlaceholder: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.border },
  accountChipText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  accountChipTextActive: { color: COLORS.primary },
  newBtn: { margin: SPACING.md, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: SPACING.sm, alignItems: 'center' },
  newBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  convRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border, gap: SPACING.sm, position: 'relative' },
  convRowActive: { backgroundColor: COLORS.surface },
  convTitle: { color: COLORS.text, fontSize: 14 },
  convMore: { fontSize: 18, color: COLORS.textMuted, fontWeight: '700', paddingHorizontal: 4 },
  convActionsOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', padding: SPACING.lg,
  },
  convActionsBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  convActionsSheet: {
    width: '100%', maxWidth: 280,
    backgroundColor: COLORS.surfaceElevated, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
    paddingVertical: 8, overflow: 'hidden',
  },
  convActionsTitle: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', paddingHorizontal: SPACING.md, paddingVertical: 10 },
  convActionItem: { paddingVertical: 14, paddingHorizontal: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border },
  convActionText: { color: COLORS.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  convActionDanger: { color: COLORS.error },
  convEmpty: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginTop: SPACING.xl },
  empty: { alignItems: 'center', marginTop: SPACING.xxl, paddingHorizontal: SPACING.lg },
  emptyIcon: { marginBottom: SPACING.md },
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

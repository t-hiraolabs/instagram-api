import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { uploadPostImage, uploadBlob } from '../services/storage';
import { composeStoryImage } from '../utils/composeStory';
import { generateStory } from '../services/aiService';
import {
  getScheduledPosts,
  createScheduledPost,
  deleteScheduledPost,
  ScheduledPost,
} from '../services/scheduleService';
import { ensureLoggedIn } from '../utils/requireLogin';
import { useAppStore } from '../store/appStore';
import { publishNow } from '../services/publishNow';

type Filter = 'all' | 'pending' | 'published' | 'failed';

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseDate(str: string): Date | null {
  const normalized = str.replace(/\//g, '-').replace(' ', 'T');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function getQuickDates(): { label: string; value: string; isOptimal: boolean }[] {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date, h: number) => {
    d.setHours(h, 0, 0, 0);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:00`;
  };

  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(now);
  dayAfter.setDate(dayAfter.getDate() + 2);

  const currentHour = now.getHours();
  const todayBestHour = currentHour < 12 ? 12 : currentHour < 18 ? 18 : 20;
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  return [
    { label: `今日 ${todayBestHour}:00`, value: fmt(new Date(today), todayBestHour), isOptimal: true },
    { label: '明日 18:00', value: fmt(new Date(tomorrow), 18), isOptimal: true },
    { label: '明日 12:00', value: fmt(new Date(tomorrow), 12), isOptimal: false },
    { label: isWeekend ? '月曜 18:00' : '土曜 11:00', value: (() => {
      const d = new Date(now);
      const daysUntil = isWeekend ? (1 + 7 - now.getDay()) % 7 || 7 : (6 - now.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntil);
      return fmt(d, isWeekend ? 18 : 11);
    })(), isOptimal: false },
  ];
}

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const draft = useAppStore((s) => s.draft);
  const clearDraft = useAppStore((s) => s.clearDraft);
  const instagramCredentials = useAppStore((s) => s.instagramCredentials);

  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [caption, setCaption] = useState('');
  const [hashtagsText, setHashtagsText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [dateText, setDateText] = useState('');
  const [type, setType] = useState<'feed' | 'story'>('feed');

  // ストーリー用：合成前の元写真と、画像に載せる文字
  const [storyRawUri, setStoryRawUri] = useState('');
  const [storyTheme, setStoryTheme] = useState('');
  const [storyDetails, setStoryDetails] = useState('');
  const [storyTitle, setStoryTitle] = useState('');
  const [storyBody, setStoryBody] = useState('');
  const [storyCta, setStoryCta] = useState('');
  const [storyTextColor, setStoryTextColor] = useState('#FFFFFF');
  const [aiLoading, setAiLoading] = useState(false);
  const [composing, setComposing] = useState(false);

  const quickDates = getQuickDates();

  const fetchPosts = useCallback(async () => {
    try {
      const data = await getScheduledPosts();
      setPosts(data);
    } catch {
      Alert.alert('エラー', 'Supabaseの設定を確認してください。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const openModal = () => {
    setCaption(draft.caption || '');
    setHashtagsText(draft.hashtags.join(' ') || '');
    setType(draft.type || 'feed');
    setImageUrl('');
    setImagePreview('');
    setDateText('');
    setStoryRawUri('');
    setStoryTheme('');
    setStoryDetails('');
    setStoryTitle('');
    setStoryBody('');
    setStoryCta('');
    setStoryTextColor('#FFFFFF');
    setModalVisible(true);
  };

  const alertMsg = (msg: string, title = 'エラー') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  // 写真を選ぶ。フィードはそのままアップロード、ストーリーは合成用に元写真として保持
  const pickAndUploadImage = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('権限エラー', '写真へのアクセスを許可してください');
        return;
      }
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      // フィードは正方形、ストーリーは縦長(9:16)で切り抜く
      allowsEditing: true,
      aspect: type === 'story' ? [9, 16] : [1, 1],
      quality: 0.9,
    });
    if (res.canceled) return;
    const asset = res.assets[0];

    if (type === 'story') {
      // ストーリーは文字を合成してから投稿するので、ここではアップロードしない
      setStoryRawUri(asset.uri);
      setImagePreview(asset.uri);
      setImageUrl('');
      return;
    }

    setImagePreview(asset.uri);
    setImageUploading(true);
    try {
      const publicUrl = await uploadPostImage(asset.uri);
      setImageUrl(publicUrl);
    } catch (e) {
      setImagePreview('');
      alertMsg(e instanceof Error ? e.message : '画像アップロードに失敗しました');
    } finally {
      setImageUploading(false);
    }
  };

  // AIでストーリーの文言（タイトル・本文・CTA）を生成
  const handleGenerateStoryText = async () => {
    if (!storyTheme.trim() && !storyDetails.trim()) {
      alertMsg('テーマか内容を入力してください');
      return;
    }
    if (!(await ensureLoggedIn('AI生成を使うにはログインが必要です'))) return;
    setAiLoading(true);
    try {
      const g = await generateStory({
        theme: storyTheme.trim() || storyDetails.trim().slice(0, 20),
        type: 'announcement',
        details: storyDetails.trim() || storyTheme.trim(),
      });
      setStoryTitle(g.title);
      setStoryBody(g.bodyText);
      setStoryCta(g.cta);
      if (g.textColor) setStoryTextColor(g.textColor);
      // 文字が変わったので合成済み画像は作り直しが必要
      setImageUrl('');
    } catch {
      alertMsg('AI生成に失敗しました。プロフィール画面でAPIキーを設定してください。');
    } finally {
      setAiLoading(false);
    }
  };

  // 元写真＋文字を合成してプレビューを作り、アップロードまで行う
  const handleComposeStory = async () => {
    if (!storyRawUri) {
      alertMsg('先に写真を選んでください');
      return;
    }
    if (!storyTitle.trim() && !storyBody.trim() && !storyCta.trim()) {
      alertMsg('画像に載せる文字（タイトル・本文・CTAのいずれか）を入力してください');
      return;
    }
    setComposing(true);
    try {
      const { blob, previewUrl } = await composeStoryImage(storyRawUri, {
        title: storyTitle.trim(),
        bodyText: storyBody.trim(),
        cta: storyCta.trim(),
        textColor: storyTextColor,
      });
      setImagePreview(previewUrl);
      const publicUrl = await uploadBlob(blob);
      setImageUrl(publicUrl);
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '合成に失敗しました');
    } finally {
      setComposing(false);
    }
  };

  const buildHashtags = () =>
    hashtagsText
      .split(/[\s,　]+/)
      .map((h) => h.trim())
      .filter(Boolean);

  // 今すぐInstagramに投稿（テスト/手動投稿）
  const handlePublishNow = async () => {
    if (type === 'feed' && !caption.trim()) {
      Alert.alert('エラー', 'キャプションを入力してください');
      return;
    }
    if (!imageUrl.trim()) {
      Alert.alert(
        '画像が必要です',
        type === 'story'
          ? '写真を選び「プレビューを作成」を押してください'
          : '写真を選んでください'
      );
      return;
    }
    if (!instagramCredentials?.userId || !instagramCredentials?.accessToken) {
      Alert.alert('未連携', '右上のアイコンからInstagramを連携してください');
      return;
    }
    if (!(await ensureLoggedIn('投稿するにはログインが必要です'))) return;

    const confirmMsg = `@${instagramCredentials.username ?? ''} に今すぐ投稿します。よろしいですか？`;
    if (Platform.OS === 'web' && !window.confirm(confirmMsg)) return;

    setPublishing(true);
    try {
      const result = await publishNow({
        caption: caption.trim(),
        hashtags: buildHashtags(),
        image_url: imageUrl.trim(),
        type,
        instagram_user_id: instagramCredentials.userId,
        access_token: instagramCredentials.accessToken,
      });
      clearDraft();
      setModalVisible(false);
      const kind = result.posted_type === 'story' ? 'ストーリー' : 'フィード';
      const ok = `投稿しました ✅（${kind}として投稿）\nInstagramアプリで確認してください`;
      if (Platform.OS === 'web') window.alert(ok);
      else Alert.alert('投稿完了 ✅', `${kind}として投稿しました。Instagramで確認してください`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '投稿に失敗しました';
      if (Platform.OS === 'web') window.alert('投稿失敗\n' + msg);
      else Alert.alert('投稿失敗', msg);
    } finally {
      setPublishing(false);
    }
  };

  const handleSave = async () => {
    if (type === 'feed' && !caption.trim()) {
      Alert.alert('エラー', 'キャプションを入力してください');
      return;
    }
    if (!imageUrl.trim()) {
      Alert.alert(
        '画像が必要です',
        type === 'story'
          ? '写真を選び「プレビューを作成」を押してください'
          : '写真を選んでください'
      );
      return;
    }
    const scheduledDate = parseDate(dateText);
    if (!scheduledDate) {
      Alert.alert('エラー', '日時の形式が正しくありません\n例: 2026-06-15T18:00');
      return;
    }
    if (scheduledDate <= new Date()) {
      Alert.alert('エラー', '予約日時は未来の日時を指定してください');
      return;
    }
    if (!(await ensureLoggedIn('予約投稿を保存するにはログインが必要です'))) return;

    setSaving(true);
    try {
      await createScheduledPost({
        caption: caption.trim(),
        hashtags: buildHashtags(),
        image_url: imageUrl.trim() || undefined,
        scheduled_at: scheduledDate,
        type,
        instagram_user_id: instagramCredentials?.userId || undefined,
        access_token: instagramCredentials?.accessToken || undefined,
      });
      clearDraft();
      setModalVisible(false);
      await fetchPosts();
    } catch {
      Alert.alert('エラー', '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert('削除', '予約を削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteScheduledPost(id);
            setPosts((prev) => prev.filter((p) => p.id !== id));
          } catch {
            Alert.alert('エラー', '削除に失敗しました');
          }
        },
      },
    ]);
  };

  const filtered = posts.filter((p) => filter === 'all' || p.status === filter);

  return (
    <View style={styles.wrapper}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 100 }}
      >
        <View style={styles.header}>
          <Text style={styles.title}>予約投稿</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openModal}>
            <Text style={styles.addBtnText}>＋ 追加</Text>
          </TouchableOpacity>
        </View>

        {/* Japan best time hint */}
        <View style={styles.hintCard}>
          <Text style={styles.hintText}>
            💡 最適な投稿時間: 平日18〜21時・12〜13時 ／ 休日11〜13時・19〜21時
          </Text>
        </View>

        <View style={styles.filterRow}>
          {(['all', 'pending', 'published', 'failed'] as Filter[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterTab, filter === f && styles.filterTabActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f === 'all' ? 'すべて' : f === 'pending' ? '予約中' : f === 'published' ? '投稿済' : '失敗'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>予約投稿はありません</Text>
            <Text style={styles.emptyDesc}>AI生成した投稿を最適な時間に自動投稿できます</Text>
            <TouchableOpacity style={styles.emptyAddBtn} onPress={openModal}>
              <Text style={styles.emptyAddBtnText}>＋ 最初の予約を追加する</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((post) => (
            <View key={post.id} style={styles.postCard}>
              <View style={styles.postHeader}>
                <View style={styles.postMeta}>
                  <View style={[styles.typeBadge, post.type === 'story' && styles.typeBadgeStory]}>
                    <Text style={styles.typeBadgeText}>
                      {post.type === 'feed' ? '📷 フィード' : '📖 ストーリー'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      post.status === 'published' && styles.statusPublished,
                      post.status === 'failed' && styles.statusFailed,
                    ]}
                  >
                    <Text style={styles.statusText}>
                      {post.status === 'pending' ? '⏳ 予約中' : post.status === 'published' ? '✅ 投稿済' : '❌ 失敗'}
                    </Text>
                  </View>
                </View>
                {post.status === 'pending' && (
                  <TouchableOpacity onPress={() => handleDelete(post.id)}>
                    <Text style={styles.deleteBtn}>🗑</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.postCaption} numberOfLines={2}>
                {post.caption}
              </Text>
              {post.hashtags?.length > 0 && (
                <Text style={styles.postHashtags} numberOfLines={1}>
                  {post.hashtags.join(' ')}
                </Text>
              )}

              <View style={styles.postFooter}>
                <Text style={styles.scheduleTime}>🕐 {formatDate(post.scheduled_at)}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView
          style={styles.modal}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCancel}>キャンセル</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>予約投稿を追加</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator color={COLORS.primary} />
              ) : (
                <Text style={styles.modalSave}>保存</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>投稿タイプ</Text>
            <View style={styles.typeRow}>
              {(['feed', 'story'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeBtn, type === t && styles.typeBtnActive]}
                  onPress={() => setType(t)}
                >
                  <Text style={[styles.typeBtnText, type === t && styles.typeBtnTextActive]}>
                    {t === 'feed' ? '📷 フィード' : '📖 ストーリー'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* 写真（フィード=正方形 / ストーリー=縦長） */}
            <Text style={styles.fieldLabel}>
              {type === 'story' ? '背景写真（縦長 9:16）' : '投稿画像（正方形）'}
            </Text>
            <TouchableOpacity
              style={styles.imagePickerBox}
              onPress={pickAndUploadImage}
              activeOpacity={0.85}
              disabled={imageUploading || composing}
            >
              {imagePreview ? (
                <Image
                  source={{ uri: imagePreview }}
                  style={[
                    styles.imagePreview,
                    { aspectRatio: type === 'story' ? 9 / 16 : 1 },
                  ]}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Text style={styles.imagePlaceholderIcon}>🖼</Text>
                  <Text style={styles.imagePlaceholderText}>タップして写真を選ぶ</Text>
                </View>
              )}
              {(imageUploading || composing) && (
                <View style={styles.imageUploadingOverlay}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.imageUploadingText}>
                    {composing ? '合成中...' : 'アップロード中...'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            {type === 'feed' ? (
              <>
                <Text style={styles.fieldLabel}>キャプション</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={caption}
                  onChangeText={setCaption}
                  placeholder="投稿のキャプションを入力"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  numberOfLines={4}
                />
                <Text style={styles.fieldLabel}>ハッシュタグ（スペース区切り）</Text>
                <TextInput
                  style={styles.input}
                  value={hashtagsText}
                  onChangeText={setHashtagsText}
                  placeholder="#春コーデ #新作 #ファッション"
                  placeholderTextColor={COLORS.textMuted}
                />
                {imageUrl && !imageUploading ? (
                  <Text style={styles.imageReadyText}>✅ 画像の準備ができました</Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.sectionDivider}>画像に載せる文字</Text>

                <Text style={styles.fieldLabel}>テーマ</Text>
                <TextInput
                  style={styles.input}
                  value={storyTheme}
                  onChangeText={setStoryTheme}
                  placeholder="例: 夏セールのお知らせ"
                  placeholderTextColor={COLORS.textMuted}
                />
                <Text style={styles.fieldLabel}>内容・詳細</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={storyDetails}
                  onChangeText={setStoryDetails}
                  placeholder="例: 7/20〜31限定で全品20%OFF"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  numberOfLines={2}
                />
                <TouchableOpacity
                  style={[styles.aiBtn, aiLoading && styles.publishNowBtnDisabled]}
                  onPress={handleGenerateStoryText}
                  disabled={aiLoading}
                  activeOpacity={0.85}
                >
                  {aiLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.aiBtnText}>✨ AIで文章を作る</Text>
                  )}
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>タイトル（大きく表示）</Text>
                <TextInput
                  style={styles.input}
                  value={storyTitle}
                  onChangeText={(t) => {
                    setStoryTitle(t);
                    setImageUrl('');
                  }}
                  placeholder="見出し"
                  placeholderTextColor={COLORS.textMuted}
                />
                <Text style={styles.fieldLabel}>本文</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={storyBody}
                  onChangeText={(t) => {
                    setStoryBody(t);
                    setImageUrl('');
                  }}
                  placeholder="補足の文章"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  numberOfLines={2}
                />
                <Text style={styles.fieldLabel}>ボタン文言（CTA）</Text>
                <TextInput
                  style={styles.input}
                  value={storyCta}
                  onChangeText={(t) => {
                    setStoryCta(t);
                    setImageUrl('');
                  }}
                  placeholder="例: 今すぐチェック"
                  placeholderTextColor={COLORS.textMuted}
                />

                <TouchableOpacity
                  style={[styles.composeBtn, composing && styles.publishNowBtnDisabled]}
                  onPress={handleComposeStory}
                  disabled={composing}
                  activeOpacity={0.85}
                >
                  {composing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.composeBtnText}>🎨 プレビューを作成</Text>
                  )}
                </TouchableOpacity>
                {imageUrl && !composing ? (
                  <Text style={styles.imageReadyText}>✅ ストーリー画像の準備ができました</Text>
                ) : null}
              </>
            )}

            <Text style={styles.fieldLabel}>予約日時</Text>

            {/* Quick date buttons */}
            <Text style={styles.quickLabel}>おすすめ時間帯</Text>
            <View style={styles.quickDatesGrid}>
              {quickDates.map((qd) => (
                <TouchableOpacity
                  key={qd.value}
                  style={[styles.quickDateBtn, dateText === qd.value && styles.quickDateBtnActive, qd.isOptimal && styles.quickDateBtnOptimal]}
                  onPress={() => setDateText(qd.value)}
                >
                  {qd.isOptimal && <Text style={styles.quickDateOptimalDot}>●</Text>}
                  <Text style={[styles.quickDateText, dateText === qd.value && styles.quickDateTextActive]}>
                    {qd.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[styles.input, { marginTop: SPACING.sm }]}
              value={dateText}
              onChangeText={setDateText}
              placeholder="例: 2026-06-15T18:00"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
            />

            <Text style={styles.sectionDivider}>Instagram</Text>
            {instagramCredentials ? (
              <View style={styles.igConnectedBox}>
                <Text style={styles.igConnectedText}>
                  ✅ {instagramCredentials.username ? `@${instagramCredentials.username}` : '連携済み'} に投稿します
                </Text>
              </View>
            ) : (
              <View style={styles.igWarnBox}>
                <Text style={styles.igWarnText}>
                  ⚠️ 未連携です。右上のアイコンからInstagramを連携してください
                </Text>
              </View>
            )}

            {/* 今すぐ投稿（テスト/手動） */}
            <TouchableOpacity
              style={[styles.publishNowBtn, (publishing || !instagramCredentials) && styles.publishNowBtnDisabled]}
              onPress={handlePublishNow}
              disabled={publishing || !instagramCredentials}
              activeOpacity={0.85}
            >
              {publishing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.publishNowText}>🚀 今すぐ投稿する</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.publishNowHint}>
              ※ 予約せずにすぐInstagramへ投稿します（画像URLが必須）
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, paddingHorizontal: SPACING.md },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
    paddingRight: 52, // 右上のアカウントアイコンと重ならないように
  },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800' },
  addBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  hintCard: {
    backgroundColor: COLORS.secondary + '18',
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.secondary + '33',
  },
  hintText: { color: COLORS.secondary, fontSize: 12, lineHeight: 18 },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: 4,
    marginBottom: SPACING.lg,
  },
  filterTab: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    borderRadius: RADIUS.sm,
  },
  filterTabActive: { backgroundColor: COLORS.primary },
  filterText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  postCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  postMeta: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap' },
  typeBadge: {
    backgroundColor: COLORS.primary + '33',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  typeBadgeStory: { backgroundColor: COLORS.secondary + '33' },
  typeBadgeText: { color: COLORS.text, fontSize: 11, fontWeight: '600' },
  statusBadge: {
    backgroundColor: COLORS.warning + '33',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  statusPublished: { backgroundColor: COLORS.success + '33' },
  statusFailed: { backgroundColor: COLORS.error + '33' },
  statusText: { color: COLORS.text, fontSize: 11, fontWeight: '600' },
  deleteBtn: { fontSize: 18 },
  postCaption: { color: COLORS.text, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  postHashtags: { color: '#4FC3F7', fontSize: 12, marginBottom: SPACING.sm },
  postFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.sm,
    marginTop: SPACING.sm,
  },
  scheduleTime: { color: COLORS.textMuted, fontSize: 12 },
  empty: { alignItems: 'center', paddingTop: 60, gap: SPACING.sm },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  emptyDesc: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
  emptyAddBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    marginTop: SPACING.md,
  },
  emptyAddBtnText: { color: '#fff', fontWeight: '700' },
  modal: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  modalCancel: { color: COLORS.textMuted, fontSize: 16 },
  modalSave: { color: COLORS.primary, fontSize: 16, fontWeight: '700' },
  modalBody: { flex: 1, paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
  fieldLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: SPACING.xs,
    marginTop: SPACING.md,
  },
  quickLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  quickDatesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  quickDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 7,
    gap: 4,
  },
  quickDateBtnActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '22',
  },
  quickDateBtnOptimal: {
    borderColor: COLORS.success + '66',
  },
  quickDateOptimalDot: { color: COLORS.success, fontSize: 8 },
  quickDateText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  quickDateTextActive: { color: COLORS.primary },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.text,
    fontSize: 15,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top', paddingTop: SPACING.sm },
  typeRow: { flexDirection: 'row', gap: SPACING.sm },
  typeBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
  },
  typeBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '22' },
  typeBtnText: { color: COLORS.textMuted, fontWeight: '600' },
  typeBtnTextActive: { color: COLORS.primary },
  sectionDivider: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: SPACING.xl,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  imagePickerBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    minHeight: 160,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreview: { width: '100%', maxHeight: 360, alignSelf: 'center' },
  imagePlaceholder: { alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xl },
  imagePlaceholderIcon: { fontSize: 36 },
  imagePlaceholderText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  imageUploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  imageUploadingText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  imageReadyText: { color: COLORS.success, fontSize: 12, fontWeight: '600', marginTop: SPACING.xs },
  igConnectedBox: {
    backgroundColor: COLORS.success + '18',
    borderWidth: 1,
    borderColor: COLORS.success + '44',
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginTop: SPACING.xs,
  },
  igConnectedText: { color: COLORS.success, fontSize: 13, fontWeight: '700' },
  igWarnBox: {
    backgroundColor: COLORS.warning + '18',
    borderWidth: 1,
    borderColor: COLORS.warning + '44',
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginTop: SPACING.xs,
  },
  igWarnText: { color: COLORS.warning, fontSize: 13, fontWeight: '600' },
  publishNowBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  publishNowBtnDisabled: { opacity: 0.5 },
  publishNowText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  aiBtn: {
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  aiBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  composeBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  composeBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  publishNowHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
  },
});

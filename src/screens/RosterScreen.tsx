// 「本日の出勤」：メンバーを登録 → 今日いる人をタップ選択 → その写真で自動レイアウトして投稿/予約
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { composeRoster, todayLabel, RosterMember } from '../utils/composeRoster';
import { getAccountTheme } from '../utils/accountThemes';
import { useAppStore } from '../store/appStore';
import { ensureLoggedIn } from '../utils/requireLogin';
import { uploadBlob } from '../services/storage';
import { publishNow } from '../services/publishNow';
import { createScheduledPost } from '../services/scheduleService';
import { listMembers, addMember, deleteMember, Member } from '../services/memberService';

function parseDate(str: string): Date | null {
  const d = new Date(str.replace(/\//g, '-').replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

export default function RosterScreen({ onBack }: { onBack?: () => void } = {}) {
  const insets = useSafeAreaInsets();
  const brandSettings = useAppStore((s) => s.brandSettings);
  const instagramCredentials = useAppStore((s) => s.instagramCredentials);

  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [editMode, setEditMode] = useState(false);

  // メンバー追加フォーム
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPhoto, setAddPhoto] = useState('');
  const [adding, setAdding] = useState(false);

  const [title, setTitle] = useState('本日の出勤');
  const [composing, setComposing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [dateText, setDateText] = useState('');
  const [posting, setPosting] = useState(false);
  const [status, setStatus] = useState('');

  const alertMsg = (msg: string, t = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(t, msg);
  };

  const loadMembers = async () => {
    setLoadingMembers(true);
    try {
      setMembers(await listMembers());
    } catch {
      alertMsg('メンバーの読み込みに失敗しました（先にmembersテーブルのSQLを実行してください）', 'エラー');
    } finally {
      setLoadingMembers(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, []);

  const toggle = (id: string) => {
    setSelected((p) => ({ ...p, [id]: !p[id] }));
    setPreviewUrl('');
  };

  const pickAddPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.9,
    });
    if (!result.canceled) setAddPhoto(result.assets[0].uri);
  };

  const submitAdd = async () => {
    if (!addPhoto) {
      alertMsg('写真を選んでください');
      return;
    }
    if (!addName.trim()) {
      alertMsg('名前を入力してください');
      return;
    }
    if (!(await ensureLoggedIn('メンバー登録にはログインが必要です'))) return;
    setAdding(true);
    try {
      await addMember(addName, addPhoto);
      setAddName('');
      setAddPhoto('');
      setAddOpen(false);
      await loadMembers();
    } catch (e) {
      alertMsg((e as { message?: string })?.message || '登録に失敗しました', 'エラー');
    } finally {
      setAdding(false);
    }
  };

  const removeMember = (m: Member) => {
    const go = async () => {
      try {
        await deleteMember(m.id);
        setMembers((prev) => prev.filter((x) => x.id !== m.id));
      } catch {
        alertMsg('削除に失敗しました');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`「${m.name}」を削除しますか？`)) go();
    } else {
      Alert.alert('削除', `「${m.name}」を削除しますか？`, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: go },
      ]);
    }
  };

  const selectedMembers = members.filter((m) => selected[m.id] && m.photo_url);

  const handleCompose = async () => {
    if (selectedMembers.length === 0) {
      alertMsg('今日の出勤メンバーを1人以上選んでください');
      return;
    }
    setComposing(true);
    try {
      const accent = getAccountTheme(brandSettings.accountType).accent;
      const list: RosterMember[] = selectedMembers.map((m) => ({
        imageUri: m.photo_url as string,
        name: m.name,
      }));
      const { blob: b, previewUrl: url } = await composeRoster(list, { title, accent });
      setBlob(b);
      setPreviewUrl(url);
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '画像の作成に失敗しました', 'エラー');
    } finally {
      setComposing(false);
    }
  };

  const ensureReady = async () => {
    if (!blob) {
      alertMsg('先に「プレビューを作成」を押してください');
      return false;
    }
    if (!instagramCredentials?.userId || !instagramCredentials?.accessToken) {
      alertMsg('右上のアイコンからInstagramを連携してください', '未連携です');
      return false;
    }
    return ensureLoggedIn('投稿にはログインが必要です');
  };

  const handlePublish = async () => {
    if (!(await ensureReady())) return;
    if (Platform.OS === 'web' && !window.confirm('このストーリーを今すぐ投稿します。よろしいですか？')) {
      return;
    }
    setPosting(true);
    try {
      setStatus('画像をアップロード中...');
      const imageUrl = await uploadBlob(blob!);
      setStatus('Instagramに投稿中...');
      await publishNow({
        caption: '',
        hashtags: [],
        image_url: imageUrl,
        type: 'story',
        instagram_user_id: instagramCredentials!.userId,
        access_token: instagramCredentials!.accessToken,
      });
      alertMsg('ストーリーを投稿しました', '投稿完了');
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '投稿に失敗しました', 'エラー');
    } finally {
      setPosting(false);
      setStatus('');
    }
  };

  const handleSchedule = async () => {
    if (!(await ensureReady())) return;
    const date = parseDate(dateText);
    if (!date) {
      alertMsg('日時の形式が正しくありません\n例: 2026-06-15T18:00', '日時を確認してください');
      return;
    }
    if (date <= new Date()) {
      alertMsg('予約日時は未来の日時を指定してください');
      return;
    }
    setPosting(true);
    try {
      setStatus('画像をアップロード中...');
      const imageUrl = await uploadBlob(blob!);
      await createScheduledPost({
        caption: '',
        hashtags: [],
        image_url: imageUrl,
        scheduled_at: date,
        type: 'story',
        instagram_user_id: instagramCredentials!.userId,
        access_token: instagramCredentials!.accessToken,
      });
      alertMsg('予約しました\n指定の日時に自動投稿されます', '予約完了');
      setDateText('');
    } catch (e) {
      alertMsg((e as { message?: string })?.message || '予約に失敗しました', 'エラー');
    } finally {
      setPosting(false);
      setStatus('');
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + SPACING.md, paddingBottom: 100 }}
    >
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} hitSlop={8} style={{ marginBottom: SPACING.xs }}>
            <Text style={styles.backText}>← 投稿の選択に戻る</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>本日の出勤</Text>
      </View>
      <Text style={styles.desc}>
        メンバーを登録して、今日いる人をタップで選ぶだけ。日付入りの出勤ストーリーを自動で作ります（{todayLabel()}）。
      </Text>

      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>メンバー（タップで今日の出勤を選択）</Text>
        {members.length > 0 && (
          <TouchableOpacity onPress={() => setEditMode((v) => !v)}>
            <Text style={styles.manageText}>{editMode ? '完了' : '編集'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {loadingMembers ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginVertical: SPACING.lg }} />
      ) : (
        <View style={styles.grid}>
          {members.map((m) => {
            const on = !!selected[m.id];
            return (
              <TouchableOpacity
                key={m.id}
                style={styles.chip}
                onPress={() => (editMode ? removeMember(m) : toggle(m.id))}
                activeOpacity={0.85}
              >
                <Image
                  source={{ uri: m.photo_url ?? undefined }}
                  style={[styles.avatar, on && !editMode && styles.avatarOn]}
                />
                {on && !editMode && <Text style={styles.check}>✓</Text>}
                {editMode && <Text style={styles.del}>✕</Text>}
                <Text style={styles.chipName} numberOfLines={1}>
                  {m.name}
                </Text>
              </TouchableOpacity>
            );
          })}

          {/* 追加ボタン */}
          <TouchableOpacity
            style={[styles.chip, styles.addChip]}
            onPress={() => setAddOpen((v) => !v)}
            activeOpacity={0.85}
          >
            <Text style={styles.addPlus}>＋</Text>
            <Text style={styles.chipName}>追加</Text>
          </TouchableOpacity>
        </View>
      )}

      {addOpen && (
        <View style={styles.addPanel}>
          <Text style={styles.addPanelTitle}>メンバーを登録</Text>
          <TouchableOpacity style={styles.addPhotoBox} onPress={pickAddPhoto} activeOpacity={0.85}>
            {addPhoto ? (
              <Image source={{ uri: addPhoto }} style={styles.addPhotoPreview} resizeMode="cover" />
            ) : (
              <Text style={styles.pickBoxText}>＋ 写真を選ぶ</Text>
            )}
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={addName}
            onChangeText={setAddName}
            placeholder="名前（例: あい）"
            placeholderTextColor={COLORS.textMuted}
          />
          <TouchableOpacity
            style={[styles.composeBtn, adding && styles.disabled, { marginTop: SPACING.sm }]}
            onPress={submitAdd}
            disabled={adding}
            activeOpacity={0.85}
          >
            {adding ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.composeBtnText}>登録する</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.label}>見出し</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={(t) => {
          setTitle(t);
          setPreviewUrl('');
        }}
        placeholder="本日の出勤"
        placeholderTextColor={COLORS.textMuted}
      />

      <TouchableOpacity
        style={[styles.composeBtn, composing && styles.disabled]}
        onPress={handleCompose}
        disabled={composing}
        activeOpacity={0.85}
      >
        {composing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.composeBtnText}>
            プレビューを作成（{selectedMembers.length}人）
          </Text>
        )}
      </TouchableOpacity>

      {previewUrl ? (
        <View style={styles.previewWrap}>
          <Image source={{ uri: previewUrl }} style={styles.preview} resizeMode="cover" />

          {instagramCredentials ? (
            <Text style={styles.igOk}>
              {instagramCredentials.username ? `@${instagramCredentials.username}` : '連携済み'} に投稿します
            </Text>
          ) : (
            <Text style={styles.igWarn}>右上のアイコンからInstagramを連携してください</Text>
          )}

          <TouchableOpacity
            style={[styles.postBtn, posting && styles.disabled]}
            onPress={handlePublish}
            disabled={posting}
            activeOpacity={0.85}
          >
            {posting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.postBtnText}>今すぐストーリー投稿</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.label}>または予約</Text>
          <TextInput
            style={styles.input}
            value={dateText}
            onChangeText={setDateText}
            placeholder="例: 2026-06-15T18:00"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.scheduleBtn, posting && styles.disabled]}
            onPress={handleSchedule}
            disabled={posting}
            activeOpacity={0.85}
          >
            <Text style={styles.postBtnText}>この日時に予約する</Text>
          </TouchableOpacity>

          {posting && status ? <Text style={styles.status}>{status}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const AV = 92;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.lg },
  header: { marginBottom: SPACING.sm },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  backText: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
  desc: { color: COLORS.textSecondary, fontSize: 13, marginBottom: SPACING.md },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  sectionTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  manageText: { color: COLORS.primary, fontSize: 13, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md, marginTop: SPACING.sm },
  chip: { width: AV, alignItems: 'center' },
  avatar: {
    width: AV,
    height: AV,
    borderRadius: RADIUS.md,
    backgroundColor: '#222',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  avatarOn: { borderColor: COLORS.primary },
  check: {
    position: 'absolute',
    top: 4,
    right: 4,
    color: '#fff',
    backgroundColor: COLORS.primary,
    width: 24,
    height: 24,
    borderRadius: 12,
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 14,
    fontWeight: '800',
    overflow: 'hidden',
  },
  del: {
    position: 'absolute',
    top: 4,
    right: 4,
    color: '#fff',
    backgroundColor: COLORS.error ?? '#E5484D',
    width: 24,
    height: 24,
    borderRadius: 12,
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 13,
    fontWeight: '800',
    overflow: 'hidden',
  },
  chipName: { color: COLORS.text, fontSize: 12, marginTop: 4, maxWidth: AV },
  addChip: {
    height: AV,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary + '66',
    borderRadius: RADIUS.md,
    borderStyle: 'dashed',
  },
  addPlus: { color: COLORS.primary, fontSize: 28, fontWeight: '800' },
  addPanel: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  addPanelTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800', marginBottom: SPACING.sm },
  addPhotoBox: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.sm,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },
  addPhotoPreview: { width: '100%', height: 150 },
  pickBoxText: { color: COLORS.primary, fontSize: 15, fontWeight: '700' },
  label: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.md, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
    color: COLORS.text,
    fontSize: 14,
  },
  composeBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  composeBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  previewWrap: { marginTop: SPACING.xl, alignItems: 'center' },
  preview: { width: 240, height: 427, borderRadius: 14, backgroundColor: '#000' },
  igOk: { color: COLORS.success ?? '#4CAF50', fontSize: 13, fontWeight: '600', marginTop: SPACING.md },
  igWarn: { color: COLORS.warning ?? '#FF9800', fontSize: 13, fontWeight: '600', marginTop: SPACING.md },
  postBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
    alignSelf: 'stretch',
  },
  scheduleBtn: {
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
    alignSelf: 'stretch',
  },
  postBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  status: { color: COLORS.textMuted, fontSize: 12, marginTop: SPACING.sm, textAlign: 'center' },
});

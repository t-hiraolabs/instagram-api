// 「本日の出勤」ストーリー作成：その日のグループ写真1枚＋メンバー名 → ストーリー画像を作って投稿/予約
import React, { useState } from 'react';
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
import { composeRoster, todayLabel } from '../utils/composeRoster';
import { getAccountTheme } from '../utils/accountThemes';
import { useAppStore } from '../store/appStore';
import { ensureLoggedIn } from '../utils/requireLogin';
import { uploadBlob } from '../services/storage';
import { publishNow } from '../services/publishNow';
import { createScheduledPost } from '../services/scheduleService';

function parseDate(str: string): Date | null {
  const d = new Date(str.replace(/\//g, '-').replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

export default function RosterScreen({ onBack }: { onBack?: () => void } = {}) {
  const insets = useSafeAreaInsets();
  const brandSettings = useAppStore((s) => s.brandSettings);
  const instagramCredentials = useAppStore((s) => s.instagramCredentials);

  const [photoUri, setPhotoUri] = useState('');
  const [title, setTitle] = useState('本日の出勤');
  const [namesText, setNamesText] = useState('');
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

  const splitNames = (s: string) =>
    s.split(/[\n、,，・\s]+/).map((x) => x.trim()).filter(Boolean);

  const pickPhoto = async () => {
    const { status: perm } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm !== 'granted') {
      alertMsg('写真へのアクセスを許可してください', '権限エラー');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (result.canceled) return;
    setPhotoUri(result.assets[0].uri);
    setPreviewUrl('');
    setBlob(null);
  };

  const handleCompose = async () => {
    if (!photoUri) {
      alertMsg('今日の写真を選んでください');
      return;
    }
    setComposing(true);
    try {
      const accent = getAccountTheme(brandSettings.accountType).accent;
      const { blob: b, previewUrl: url } = await composeRoster(photoUri, splitNames(namesText), {
        title,
        accent,
      });
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
      alertMsg('ストーリーを投稿しました ✅', '投稿完了');
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
      alertMsg('予約しました ✅\n指定の日時に自動投稿されます', '予約完了');
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
        今日の写真（みんなで写ったものでOK）を1枚選んで、メンバー名を入れると、日付入りの「本日の出勤」ストーリーを作ります（{todayLabel()}）。
      </Text>

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

      <Text style={styles.label}>今日の写真</Text>
      <TouchableOpacity style={styles.pickBox} onPress={pickPhoto} activeOpacity={0.85}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.pickPreview} resizeMode="cover" />
        ) : (
          <Text style={styles.pickBoxText}>＋ 写真を選ぶ（みんなで写ったもの）</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.label}>メンバー名（改行や「、」で区切る・任意）</Text>
      <TextInput
        style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
        value={namesText}
        onChangeText={(t) => {
          setNamesText(t);
          setPreviewUrl('');
        }}
        placeholder={'例:\nあい、ゆな、れな'}
        placeholderTextColor={COLORS.textMuted}
        multiline
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
          <Text style={styles.composeBtnText}>🎨 プレビューを作成</Text>
        )}
      </TouchableOpacity>

      {previewUrl ? (
        <View style={styles.previewWrap}>
          <Image source={{ uri: previewUrl }} style={styles.preview} resizeMode="cover" />

          {instagramCredentials ? (
            <Text style={styles.igOk}>
              ✅ {instagramCredentials.username ? `@${instagramCredentials.username}` : '連携済み'} に投稿します
            </Text>
          ) : (
            <Text style={styles.igWarn}>⚠️ 右上のアイコンからInstagramを連携してください</Text>
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
              <Text style={styles.postBtnText}>🚀 今すぐストーリー投稿</Text>
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
            <Text style={styles.postBtnText}>📅 この日時に予約する</Text>
          </TouchableOpacity>

          {posting && status ? <Text style={styles.status}>{status}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.lg },
  header: { marginBottom: SPACING.sm },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  backText: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
  desc: { color: COLORS.textSecondary, fontSize: 13, marginBottom: SPACING.md },
  label: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.md, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
    color: COLORS.text,
    fontSize: 14,
  },
  pickBox: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.primary + '55',
    borderRadius: RADIUS.md,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pickBoxText: { color: COLORS.primary, fontSize: 15, fontWeight: '700', padding: SPACING.lg },
  pickPreview: { width: '100%', height: 220 },
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

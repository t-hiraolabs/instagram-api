// 管理者向け: コラージュ完成テンプレートの作成・編集画面。
// is_admin=falseのユーザーはナビゲーション上に導線を出さない前提だが、直接URLアクセス等に
// 備えてこの画面自身もcheckIsAdmin()で二重にガードする。
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert, Platform, Switch, ActivityIndicator, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { Plan } from '../utils/plans';
import {
  checkIsAdmin,
  listAllCollageStyles, createCollageStyle, updateCollageStyle, toggleCollageStyleActive, deleteCollageStyle, CollageStyle,
} from '../services/collageStyleService';
import {
  COLLAGE_FONT_PRESETS, composeTemplatePreview,
  COLLAGE_Z_BANDS,
  CollageTemplateAssets, CollageTextLayer, CollageDecoration,
} from '../utils/collageCompositor';
import { uploadBlob } from '../services/storage';
import TemplatePositionEditor, {
  PhotoAreaDraft, TextLayerDraft, DecorationDraft,
} from '../components/TemplatePositionEditor';

const PLAN_OPTIONS: Plan[] = ['free', 'pro', 'business'];

let draftKeySeq = 0;
const nextDraftKey = () => `draft-${draftKeySeq++}`;

export default function AdminAssetsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  const [collageStyles, setCollageStyles] = useState<CollageStyle[]>([]);
  const [styleFormVisible, setStyleFormVisible] = useState(false);
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null);
  const [styleName, setStyleName] = useState('');
  const [stylePlan, setStylePlan] = useState<Plan>('free');
  const [styleTags, setStyleTags] = useState('');
  // 写真エリア・テキストレイヤー・装飾画像の配置編集は、フォーム全体のScrollViewと
  // ドラッグ操作が競合して画面がスクロールしてしまう不具合を避けるため、
  // 専用の全画面モーダル（TemplatePositionEditor）で行う
  const [positionEditorOpen, setPositionEditorOpen] = useState(false);
  const [styleBackgroundImageUrl, setStyleBackgroundImageUrl] = useState<string | null>(null);
  const [styleBackgroundUploading, setStyleBackgroundUploading] = useState(false);
  const [savingStyle, setSavingStyle] = useState(false);

  const [stylePhotoAreas, setStylePhotoAreas] = useState<PhotoAreaDraft[]>([]);
  const [styleTextLayers, setStyleTextLayers] = useState<TextLayerDraft[]>([]);
  const [styleDecorations, setStyleDecorations] = useState<DecorationDraft[]>([]);
  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null);
  const [livePreviewLoading, setLivePreviewLoading] = useState(false);

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  useEffect(() => {
    checkIsAdmin().then((ok) => {
      setIsAdmin(ok);
      setChecking(false);
    });
  }, []);

  // この画面はナビゲーションのURL連携（linking）がないSPA上で、通常のpush遷移ではなく
  // navigationRef.navigate()で開かれるため、ブラウザの実際の履歴エントリが1つも増えない。
  // そのままだとブラウザの「戻る」ボタンを押した時にアプリの画面遷移が一切効かず、
  // このSPAより前のページ（無関係な画面）に飛んでしまう。マウント時にダミーの履歴を1つ
  // 積んでおき、popstate（戻るボタン）を検知したらアプリ内のgoBack()を呼ぶことで、
  // ブラウザの戻るボタンでも正しくこの画面の前の画面に戻れるようにする。
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    window.history.pushState({ adminAssets: true }, '');
    const onPopState = () => {
      navigation?.goBack?.();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadStyles = useCallback(async () => {
    setLoading(true);
    try {
      setCollageStyles(await listAllCollageStyles());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, loadStyles]);

  // フォームの内容が変わるたびにプレビューを再生成する。
  // キー入力のたびに毎回生成するとカクつくため、400ms操作が止まってから生成する（デバウンス）。
  useEffect(() => {
    if (!isAdmin) {
      setLivePreviewUrl(null);
      return;
    }
    let alive = true;
    setLivePreviewLoading(true);
    const timer = setTimeout(() => {
      const template: CollageTemplateAssets = {
        backgroundUrl: styleBackgroundImageUrl ?? undefined,
        photoAreas: stylePhotoAreas.map((p) => ({
          x: Number(p.x) || 0, y: Number(p.y) || 0, w: Number(p.w) || 100, h: Number(p.h) || 100,
        })),
        textLayers: styleTextLayers.map((t): CollageTextLayer => ({
          id: t.id, label: t.label || undefined, sampleText: t.sampleText,
          x: Number(t.x) || 0, y: Number(t.y) || 0, maxWidth: Number(t.maxWidth) || 900,
          align: t.align, fontSize: Number(t.fontSize) || 40, font: t.font, color: t.color,
          lineHeight: Number(t.lineHeight) || 1.25,
          letterSpacing: Number(t.letterSpacing) || 0,
          maxLines: Number(t.maxLines) || 3,
          rotation: Number(t.rotation) || 0,
          zIndex: Number(t.zIndex) || COLLAGE_Z_BANDS.text,
        })),
        decorations: styleDecorations
          .filter((d) => !!d.imageUrl)
          .map((d): CollageDecoration => ({
            imageUrl: d.imageUrl as string,
            x: Number(d.x) || 0, y: Number(d.y) || 0, w: Number(d.w) || 100, h: Number(d.h) || 100,
          })),
      };
      composeTemplatePreview(template)
        .then((url) => { if (alive) setLivePreviewUrl(url); })
        .catch(() => { if (alive) setLivePreviewUrl(null); })
        .finally(() => { if (alive) setLivePreviewLoading(false); });
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAdmin, styleBackgroundImageUrl, stylePhotoAreas, styleTextLayers, styleDecorations,
  ]);

  const resetStyleForm = () => {
    setEditingStyleId(null);
    setStyleName('');
    setStylePlan('free');
    setStyleTags('');
    setStyleBackgroundImageUrl(null);
    setStylePhotoAreas([]);
    setStyleTextLayers([]);
    setStyleDecorations([]);
  };

  const pickBackgroundImage = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { alertMsg('写真へのアクセスを許可してください', '権限エラー'); return; }
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.95,
    });
    if (res.canceled) return;
    setStyleBackgroundUploading(true);
    try {
      const blob = await (await fetch(res.assets[0].uri)).blob();
      const url = await uploadBlob(blob);
      setStyleBackgroundImageUrl(url);
      setPositionEditorOpen(true);
    } catch (e) {
      alertMsg((e as { message?: string })?.message || '画像のアップロードに失敗しました', 'エラー');
    } finally {
      setStyleBackgroundUploading(false);
    }
  };

  const startEditStyle = (s: CollageStyle) => {
    setEditingStyleId(s.id);
    setStyleName(s.name);
    setStylePlan(s.plan);
    setStyleTags(s.tags.join(', '));
    setStyleBackgroundImageUrl(s.backgroundUrl ?? null);
    setStylePhotoAreas(
      (s.photoAreas ?? []).map((p) => ({
        key: nextDraftKey(),
        x: String(p.x), y: String(p.y), w: String(p.w), h: String(p.h),
      }))
    );
    setStyleTextLayers(
      (s.textLayers ?? []).map((t) => ({
        key: nextDraftKey(),
        id: t.id,
        label: t.label ?? '',
        sampleText: t.sampleText,
        x: String(t.x), y: String(t.y), maxWidth: String(t.maxWidth), fontSize: String(t.fontSize ?? 40),
        color: t.color ?? '#FFFFFF',
        font: t.font ?? COLLAGE_FONT_PRESETS[0].id,
        align: t.align ?? 'left',
        lineHeight: String(t.lineHeight ?? 1.25),
        letterSpacing: String(t.letterSpacing ?? 0),
        maxLines: String(t.maxLines ?? 3),
        rotation: String(t.rotation ?? 0),
        zIndex: String(t.zIndex ?? COLLAGE_Z_BANDS.text),
      }))
    );
    setStyleDecorations(
      (s.decorations ?? []).map((d) => ({
        key: nextDraftKey(), imageUrl: d.imageUrl, uploading: false,
        x: String(d.x), y: String(d.y), w: String(d.w), h: String(d.h),
      }))
    );
    setStyleFormVisible(true);
  };

  const parseTags = (raw: string): string[] =>
    raw.split(',').map((s) => s.trim()).filter(Boolean);

  const handleSaveStyle = async () => {
    if (!styleName.trim()) {
      alertMsg('テンプレート名を入力してください');
      return;
    }
    if (!styleBackgroundImageUrl) {
      alertMsg('背景画像（完成デザイン）を選んでください');
      return;
    }
    if (stylePhotoAreas.length === 0) {
      alertMsg('写真エリアを1つ以上追加してください');
      return;
    }
    setSavingStyle(true);
    try {
      const params = {
        name: styleName.trim(),
        plan: stylePlan,
        tags: parseTags(styleTags),
        backgroundImageUrl: styleBackgroundImageUrl,
        photoAreas: stylePhotoAreas.map((p) => ({
          x: Number(p.x) || 0, y: Number(p.y) || 0, w: Number(p.w) || 100, h: Number(p.h) || 100,
        })),
        textLayers: styleTextLayers.map((t) => ({
          id: t.id, label: t.label || undefined, sampleText: t.sampleText,
          x: Number(t.x) || 0, y: Number(t.y) || 0, maxWidth: Number(t.maxWidth) || 900,
          align: t.align, fontSize: Number(t.fontSize) || 40, font: t.font, color: t.color,
          lineHeight: Number(t.lineHeight) || 1.25,
          letterSpacing: Number(t.letterSpacing) || 0,
          maxLines: Number(t.maxLines) || 3,
          rotation: Number(t.rotation) || 0,
          zIndex: Number(t.zIndex) || COLLAGE_Z_BANDS.text,
        })),
        decorations: styleDecorations
          .filter((d) => !!d.imageUrl)
          .map((d) => ({
            imageUrl: d.imageUrl as string,
            x: Number(d.x) || 0, y: Number(d.y) || 0, w: Number(d.w) || 100, h: Number(d.h) || 100,
          })),
      };
      if (editingStyleId) {
        await updateCollageStyle(editingStyleId, params);
      } else {
        await createCollageStyle(params);
      }
      resetStyleForm();
      setStyleFormVisible(false);
      await loadStyles();
    } catch (e) {
      alertMsg((e as { message?: string })?.message || '保存に失敗しました', 'エラー');
    } finally {
      setSavingStyle(false);
    }
  };

  const handleToggleStyleActive = async (s: CollageStyle) => {
    setCollageStyles((prev) => prev.map((x) => (x.id === s.id ? { ...x, isActive: !x.isActive } : x)));
    try {
      await toggleCollageStyleActive(s.id, !s.isActive);
    } catch (e) {
      setCollageStyles((prev) => prev.map((x) => (x.id === s.id ? { ...x, isActive: s.isActive } : x)));
      alertMsg('更新に失敗しました', 'エラー');
    }
  };

  const handleDeleteStyle = async (s: CollageStyle) => {
    const doDelete = async () => {
      try {
        await deleteCollageStyle(s.id);
        setCollageStyles((prev) => prev.filter((x) => x.id !== s.id));
      } catch (e) {
        alertMsg('削除に失敗しました', 'エラー');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`「${s.name}」を削除しますか？`)) doDelete();
    } else {
      Alert.alert('削除の確認', `「${s.name}」を削除しますか？`, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  if (checking) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.primary} />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation?.goBack?.()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>コラージュテンプレート管理</Text>
          <View style={{ width: 26 }} />
        </View>
        <Text style={styles.deniedText}>この画面へのアクセス権限がありません</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>コラージュテンプレート管理</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
        <TouchableOpacity
          style={styles.uploadBtn}
          onPress={() => { setStyleFormVisible((v) => !v); if (styleFormVisible) resetStyleForm(); }}
        >
          <Ionicons name={styleFormVisible ? 'close' : 'add'} size={20} color="#fff" />
          <Text style={styles.uploadBtnText}>{styleFormVisible ? '閉じる' : '新規テンプレートを作成'}</Text>
        </TouchableOpacity>

        {styleFormVisible && (
          <View style={{ marginTop: SPACING.md }}>
            {editingStyleId && <Text style={styles.sheetMeta}>「{styleName}」を編集中</Text>}

            <Text style={styles.sectionLabel}>名前</Text>
            <TextInput
              style={styles.input}
              value={styleName}
              onChangeText={setStyleName}
              placeholder="例: シネマ"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={styles.sectionLabel}>プラン</Text>
            <View style={styles.chipRow}>
              {PLAN_OPTIONS.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.chip, stylePlan === p && styles.chipActive]}
                  onPress={() => setStylePlan(p)}
                >
                  <Text style={[styles.chipText, stylePlan === p && styles.chipTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>タグ（検索用・カンマ区切り）</Text>
            <TextInput
              style={styles.input}
              value={styleTags}
              onChangeText={setStyleTags}
              placeholder="例: ベージュ, シンプル, 大人っぽい"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={styles.sectionLabel}>背景画像（写真ライブラリから選んだ完成デザイン。写真の差し込み場所もこの画像内にデザインしてください）</Text>
            <TouchableOpacity style={styles.bgPickBtn} onPress={pickBackgroundImage} disabled={styleBackgroundUploading} activeOpacity={0.85}>
              {styleBackgroundUploading ? (
                <ActivityIndicator color={COLORS.primary} />
              ) : styleBackgroundImageUrl ? (
                <Image source={{ uri: styleBackgroundImageUrl }} style={styles.bgPickImg} resizeMode="cover" />
              ) : (
                <>
                  <Ionicons name="image-outline" size={22} color={COLORS.textSecondary} />
                  <Text style={styles.bgPickText}>画像を選ぶ</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.uploadBtn, !styleBackgroundImageUrl && { opacity: 0.6 }]}
              onPress={() => setPositionEditorOpen(true)}
              disabled={!styleBackgroundImageUrl}
            >
              <Ionicons name="move-outline" size={18} color="#fff" />
              <Text style={styles.uploadBtnText}>
                配置を編集（写真エリア{stylePhotoAreas.length}件・テキスト{styleTextLayers.length}件・写真{styleDecorations.length}件）
              </Text>
            </TouchableOpacity>

            <TemplatePositionEditor
              visible={positionEditorOpen}
              onClose={() => setPositionEditorOpen(false)}
              backgroundUri={styleBackgroundImageUrl}
              photoAreas={stylePhotoAreas}
              onPhotoAreasChange={setStylePhotoAreas}
              textLayers={styleTextLayers}
              onTextLayersChange={setStyleTextLayers}
              decorations={styleDecorations}
              onDecorationsChange={setStyleDecorations}
            />

                <Text style={styles.sectionLabel}>プレビュー</Text>
                <View style={styles.livePreviewWrap}>
                  {livePreviewLoading ? (
                    <ActivityIndicator color={COLORS.primary} />
                  ) : livePreviewUrl ? (
                    <Image source={{ uri: livePreviewUrl }} style={styles.livePreviewImg} resizeMode="contain" />
                  ) : (
                    <Text style={styles.emptyText}>レイアウトを選ぶとプレビューが表示されます</Text>
                  )}
                </View>

            <TouchableOpacity
              style={[styles.uploadBtn, savingStyle && { opacity: 0.6 }]}
              onPress={handleSaveStyle}
              disabled={savingStyle}
            >
              {savingStyle ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadBtnText}>{editingStyleId ? '更新' : '保存'}</Text>}
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionLabel}>登録済みテンプレート</Text>
        {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.md }} />}
        {collageStyles.map((s) => (
          <View key={s.id} style={[styles.sheetRow, !s.isActive && { opacity: 0.5 }]}>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: SPACING.sm }} onPress={() => startEditStyle(s)} activeOpacity={0.7}>
              {s.backgroundUrl && <Image source={{ uri: s.backgroundUrl }} style={styles.styleThumb} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetName} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.sheetMeta}>{s.plan}{s.tags.length > 0 ? ` ・ ${s.tags.join(', ')}` : ''}</Text>
              </View>
            </TouchableOpacity>
            <Switch value={s.isActive} onValueChange={() => handleToggleStyleActive(s)} />
            <TouchableOpacity onPress={() => handleDeleteStyle(s)} style={{ marginLeft: SPACING.sm }}>
              <Ionicons name="trash-outline" size={20} color={COLORS.error} />
            </TouchableOpacity>
          </View>
        ))}
        {!loading && collageStyles.length === 0 && <Text style={styles.emptyText}>まだテンプレートがありません</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  backBtn: { padding: SPACING.xs },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  deniedText: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 40 },
  body: { flex: 1, paddingHorizontal: SPACING.md },
  sectionLabel: { color: COLORS.textSecondary, fontWeight: '700', fontSize: 12, marginTop: SPACING.md, marginBottom: SPACING.xs },
  chipRow: { flexDirection: 'row', marginBottom: SPACING.sm },
  chip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface, marginRight: SPACING.xs, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md, marginTop: SPACING.sm,
  },
  uploadBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    padding: SPACING.sm, marginBottom: SPACING.xs, gap: SPACING.sm,
  },
  sheetName: { color: COLORS.text, fontWeight: '700', fontSize: 13 },
  sheetMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: SPACING.lg },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, color: COLORS.text, backgroundColor: COLORS.surface,
  },
  styleThumb: { width: 40, height: 40, borderRadius: RADIUS.sm, marginRight: SPACING.sm },
  bgPickBtn: {
    width: 140, height: (140 * 1920) / 1080, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', gap: SPACING.xs,
  },
  bgPickImg: { width: '100%', height: '100%' },
  bgPickText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  livePreviewWrap: {
    width: 180, height: (180 * 1920) / 1080, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: SPACING.sm,
  },
  livePreviewImg: { width: '100%', height: '100%' },
});

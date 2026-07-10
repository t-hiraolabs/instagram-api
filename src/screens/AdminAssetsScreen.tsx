// 管理者向け: 素材シート（Sprite Sheet）アップロード・登録済み素材の一覧管理画面。
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
import { getCategories, Category } from '../services/storyStudioService';
import {
  checkIsAdmin, uploadAssetSheet, listAssetSheets, listAllAssets,
  toggleAssetActive, deleteAsset, updateAsset, AssetSheet, AdminAsset,
} from '../services/adminAssetService';
import {
  listAllCollageStyles, createCollageStyle, toggleCollageStyleActive, deleteCollageStyle, CollageStyle,
} from '../services/collageStyleService';

type Tab = 'sheets' | 'assets' | 'styles';
const PLAN_OPTIONS: Plan[] = ['free', 'pro', 'business'];

const STATUS_LABEL: Record<AssetSheet['status'], string> = {
  uploaded: 'アップロード済み',
  processing: '処理中',
  done: '完了',
  failed: '失敗',
};
const STATUS_COLOR: Record<AssetSheet['status'], string> = {
  uploaded: COLORS.textMuted,
  processing: COLORS.warning,
  done: COLORS.success,
  failed: COLORS.error,
};

export default function AdminAssetsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<Tab>('sheets');
  const [categories, setCategories] = useState<Category[]>([]);
  const [uploadCategoryId, setUploadCategoryId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sheets, setSheets] = useState<AssetSheet[]>([]);
  const [filterCategoryId, setFilterCategoryId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AdminAsset[]>([]);
  const [loading, setLoading] = useState(false);

  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [collageStyles, setCollageStyles] = useState<CollageStyle[]>([]);
  const [styleFormVisible, setStyleFormVisible] = useState(false);
  const [styleName, setStyleName] = useState('');
  const [stylePlan, setStylePlan] = useState<Plan>('free');
  const [styleAccentColor, setStyleAccentColor] = useState('#FFFFFF');
  const [styleBackgroundAssetId, setStyleBackgroundAssetId] = useState<string | null>(null);
  const [styleFrameAssetId, setStyleFrameAssetId] = useState<string | null>(null);
  const [backgroundAssets, setBackgroundAssets] = useState<AdminAsset[]>([]);
  const [frameAssets, setFrameAssets] = useState<AdminAsset[]>([]);
  const [savingStyle, setSavingStyle] = useState(false);

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

  const loadCategories = useCallback(async () => {
    const cats = await getCategories();
    setCategories(cats);
    if (!uploadCategoryId && cats.length > 0) setUploadCategoryId(cats[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSheets = useCallback(async () => {
    setLoading(true);
    try {
      setSheets(await listAssetSheets());
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAssets = useCallback(async (categoryId: string | null) => {
    setLoading(true);
    try {
      setAssets(await listAllAssets({ categoryId: categoryId ?? undefined }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadCategories();
    loadSheets();
  }, [isAdmin, loadCategories, loadSheets]);

  useEffect(() => {
    if (!isAdmin || tab !== 'assets') return;
    loadAssets(filterCategoryId);
  }, [isAdmin, tab, filterCategoryId, loadAssets]);

  const loadStyles = useCallback(async () => {
    setLoading(true);
    try {
      setCollageStyles(await listAllCollageStyles());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin || tab !== 'styles' || categories.length === 0) return;
    loadStyles();
    const backgroundCategoryId = categories.find((c) => c.name === '背景')?.id;
    const frameCategoryId = categories.find((c) => c.name === 'フレーム')?.id;
    if (backgroundCategoryId) listAllAssets({ categoryId: backgroundCategoryId, isActive: true }).then(setBackgroundAssets).catch(() => {});
    if (frameCategoryId) listAllAssets({ categoryId: frameCategoryId, isActive: true }).then(setFrameAssets).catch(() => {});
  }, [isAdmin, tab, categories, loadStyles]);

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;
  const categorySlug = (id: string): string => {
    // categoriesにはslugを持たせているが一覧APIはname/idのみ返すため、既知の対応表で引く
    // (adminAssetServiceのuploadAssetSheetはslugを直接必要とするための簡易マップ)
    const map: Record<string, string> = {
      '花': 'flowers', '葉': 'leaves', 'フレーム': 'frames', '背景': 'backgrounds',
      'ワンポイント': 'one_points', '線': 'lines', 'リボン': 'ribbons', 'アイコン': 'icons',
      'スタンプ': 'stamps', '図形': 'shapes',
    };
    return map[categoryName(id)] ?? 'misc';
  };

  const pickAndUploadSheet = async () => {
    if (!uploadCategoryId) return;
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { alertMsg('写真へのアクセスを許可してください', '権限エラー'); return; }
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (res.canceled || res.assets.length === 0) return;
    const asset = res.assets[0];
    setUploading(true);
    try {
      const blob = await (await fetch(asset.uri)).blob();
      const filename = asset.fileName ?? `sheet-${Date.now()}.png`;
      await uploadAssetSheet({
        categoryId: uploadCategoryId,
        categorySlug: categorySlug(uploadCategoryId),
        blob,
        filename,
      });
      await loadSheets();
      alertMsg('素材シートをアップロードしました。切り出しスクリプトの実行をお願いします。');
    } catch (e) {
      alertMsg((e as { message?: string })?.message || 'アップロードに失敗しました', 'エラー');
    } finally {
      setUploading(false);
    }
  };

  const handleToggleActive = async (a: AdminAsset) => {
    setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, isActive: !x.isActive } : x)));
    try {
      await toggleAssetActive(a.id, !a.isActive);
    } catch (e) {
      setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, isActive: a.isActive } : x)));
      alertMsg('更新に失敗しました', 'エラー');
    }
  };

  const handleDelete = async (a: AdminAsset) => {
    const doDelete = async () => {
      try {
        await deleteAsset(a.id);
        setAssets((prev) => prev.filter((x) => x.id !== a.id));
      } catch (e) {
        alertMsg('削除に失敗しました', 'エラー');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`「${a.name}」を削除しますか？`)) doDelete();
    } else {
      Alert.alert('削除の確認', `「${a.name}」を削除しますか？`, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const startEditAsset = (a: AdminAsset) => {
    setEditingAssetId(a.id);
    setEditName(a.name);
    setEditCategoryId(a.categoryId);
  };

  const cancelEditAsset = () => {
    setEditingAssetId(null);
    setEditName('');
    setEditCategoryId(null);
  };

  const handleSaveEditAsset = async () => {
    if (!editingAssetId || !editName.trim() || !editCategoryId) return;
    setSavingEdit(true);
    try {
      await updateAsset(editingAssetId, { name: editName.trim(), categoryId: editCategoryId });
      const movedOutOfFilter = filterCategoryId && editCategoryId !== filterCategoryId;
      if (movedOutOfFilter) {
        setAssets((prev) => prev.filter((x) => x.id !== editingAssetId));
      } else {
        setAssets((prev) => prev.map((x) => (x.id === editingAssetId ? { ...x, name: editName.trim(), categoryId: editCategoryId } : x)));
      }
      cancelEditAsset();
    } catch (e) {
      alertMsg((e as { message?: string })?.message || '更新に失敗しました', 'エラー');
    } finally {
      setSavingEdit(false);
    }
  };

  const resetStyleForm = () => {
    setStyleName('');
    setStylePlan('free');
    setStyleAccentColor('#FFFFFF');
    setStyleBackgroundAssetId(null);
    setStyleFrameAssetId(null);
  };

  const handleCreateStyle = async () => {
    if (!styleName.trim() || !styleBackgroundAssetId) {
      alertMsg('スタイル名と背景画像を選んでください');
      return;
    }
    setSavingStyle(true);
    try {
      await createCollageStyle({
        name: styleName.trim(),
        plan: stylePlan,
        backgroundAssetId: styleBackgroundAssetId,
        frameAssetId: styleFrameAssetId ?? undefined,
        accentColor: styleAccentColor,
      });
      resetStyleForm();
      setStyleFormVisible(false);
      await loadStyles();
    } catch (e) {
      alertMsg((e as { message?: string })?.message || '作成に失敗しました', 'エラー');
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
          <Text style={styles.headerTitle}>素材シート管理</Text>
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
        <Text style={styles.headerTitle}>素材シート管理</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'sheets' && styles.tabBtnActive]} onPress={() => setTab('sheets')}>
          <Text style={[styles.tabBtnText, tab === 'sheets' && styles.tabBtnTextActive]}>シートアップロード</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'assets' && styles.tabBtnActive]} onPress={() => setTab('assets')}>
          <Text style={[styles.tabBtnText, tab === 'assets' && styles.tabBtnTextActive]}>素材一覧</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'styles' && styles.tabBtnActive]} onPress={() => setTab('styles')}>
          <Text style={[styles.tabBtnText, tab === 'styles' && styles.tabBtnTextActive]}>コラージュスタイル</Text>
        </TouchableOpacity>
      </View>

      {tab === 'sheets' ? (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
          <Text style={styles.sectionLabel}>カテゴリ</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {categories.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, uploadCategoryId === c.id && styles.chipActive]}
                onPress={() => setUploadCategoryId(c.id)}
              >
                <Text style={[styles.chipText, uploadCategoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={[styles.uploadBtn, (uploading || !uploadCategoryId) && { opacity: 0.6 }]}
            onPress={pickAndUploadSheet}
            disabled={uploading || !uploadCategoryId}
          >
            {uploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                <Text style={styles.uploadBtnText}>素材シート（PNG）をアップロード</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>アップロード済みシート</Text>
          {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.md }} />}
          {sheets.map((s) => (
            <View key={s.id} style={styles.sheetRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetName} numberOfLines={1}>{s.originalFilename}</Text>
                <Text style={styles.sheetMeta}>{categoryName(s.categoryId)} ・ {new Date(s.createdAt).toLocaleString()}</Text>
                {s.errorMessage && <Text style={styles.sheetError} numberOfLines={2}>{s.errorMessage}</Text>}
              </View>
              <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[s.status] + '33' }]}>
                <Text style={[styles.statusBadgeText, { color: STATUS_COLOR[s.status] }]}>
                  {STATUS_LABEL[s.status]}{s.detectedCount != null ? ` (${s.detectedCount})` : ''}
                </Text>
              </View>
            </View>
          ))}
          {!loading && sheets.length === 0 && <Text style={styles.emptyText}>まだ素材シートがありません</Text>}
        </ScrollView>
      ) : tab === 'assets' ? (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            <TouchableOpacity style={[styles.chip, !filterCategoryId && styles.chipActive]} onPress={() => setFilterCategoryId(null)}>
              <Text style={[styles.chipText, !filterCategoryId && styles.chipTextActive]}>すべて</Text>
            </TouchableOpacity>
            {categories.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, filterCategoryId === c.id && styles.chipActive]}
                onPress={() => setFilterCategoryId(c.id)}
              >
                <Text style={[styles.chipText, filterCategoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {editingAssetId && (
            <View style={styles.editPanel}>
              <Text style={styles.sectionLabel}>素材名</Text>
              <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholderTextColor={COLORS.textMuted} />
              <Text style={styles.sectionLabel}>カテゴリ</Text>
              <View style={styles.chipRow}>
                {categories.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.chip, editCategoryId === c.id && styles.chipActive]}
                    onPress={() => setEditCategoryId(c.id)}
                  >
                    <Text style={[styles.chipText, editCategoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
                <TouchableOpacity style={[styles.uploadBtn, { flex: 1 }, savingEdit && { opacity: 0.6 }]} onPress={handleSaveEditAsset} disabled={savingEdit}>
                  {savingEdit ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadBtnText}>保存</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[styles.uploadBtn, { flex: 1, backgroundColor: COLORS.surface }]} onPress={cancelEditAsset} disabled={savingEdit}>
                  <Text style={[styles.uploadBtnText, { color: COLORS.text }]}>キャンセル</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.md }} />}
          <View style={styles.grid}>
            {assets.map((a) => (
              <View key={a.id} style={[styles.assetCard, !a.isActive && { opacity: 0.5 }]}>
                <Image source={{ uri: a.thumbnailUrl ?? a.storageUrl }} style={styles.assetImg} resizeMode="contain" />
                <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
                <Text style={styles.assetCategoryLabel} numberOfLines={1}>{categoryName(a.categoryId)}</Text>
                <View style={styles.assetActionsRow}>
                  <Switch value={a.isActive} onValueChange={() => handleToggleActive(a)} />
                  <TouchableOpacity onPress={() => startEditAsset(a)}>
                    <Ionicons name="create-outline" size={20} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(a)}>
                    <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
          {!loading && assets.length === 0 && <Text style={styles.emptyText}>該当する素材がありません</Text>}
        </ScrollView>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
          <TouchableOpacity
            style={styles.uploadBtn}
            onPress={() => { setStyleFormVisible((v) => !v); if (styleFormVisible) resetStyleForm(); }}
          >
            <Ionicons name={styleFormVisible ? 'close' : 'add'} size={20} color="#fff" />
            <Text style={styles.uploadBtnText}>{styleFormVisible ? '閉じる' : '新規スタイルを作成'}</Text>
          </TouchableOpacity>

          {styleFormVisible && (
            <View style={{ marginTop: SPACING.md }}>
              <Text style={styles.sectionLabel}>スタイル名</Text>
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

              <Text style={styles.sectionLabel}>アクセントカラー（テキスト色・hex）</Text>
              <View style={styles.colorRow}>
                <View style={[styles.colorSwatch, { backgroundColor: styleAccentColor }]} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={styleAccentColor}
                  onChangeText={setStyleAccentColor}
                  placeholder="#FFFFFF"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <Text style={styles.sectionLabel}>背景画像</Text>
              <View style={styles.grid}>
                {backgroundAssets.map((a) => (
                  <TouchableOpacity key={a.id} onPress={() => setStyleBackgroundAssetId(a.id)}>
                    <View style={[styles.assetCard, styleBackgroundAssetId === a.id && styles.assetCardSelected]}>
                      <Image source={{ uri: a.thumbnailUrl ?? a.storageUrl }} style={styles.assetImg} resizeMode="cover" />
                      <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {backgroundAssets.length === 0 && (
                  <Text style={styles.emptyText}>「背景」カテゴリの素材がありません（先にシートアップロードから登録してください）</Text>
                )}
              </View>

              <Text style={styles.sectionLabel}>フレーム画像（任意）</Text>
              <View style={styles.grid}>
                <TouchableOpacity onPress={() => setStyleFrameAssetId(null)}>
                  <View style={[styles.assetCard, !styleFrameAssetId && styles.assetCardSelected]}>
                    <View style={[styles.assetImg, styles.assetImgEmpty]}>
                      <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>なし</Text>
                    </View>
                  </View>
                </TouchableOpacity>
                {frameAssets.map((a) => (
                  <TouchableOpacity key={a.id} onPress={() => setStyleFrameAssetId(a.id)}>
                    <View style={[styles.assetCard, styleFrameAssetId === a.id && styles.assetCardSelected]}>
                      <Image source={{ uri: a.thumbnailUrl ?? a.storageUrl }} style={styles.assetImg} resizeMode="cover" />
                      <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.uploadBtn, savingStyle && { opacity: 0.6 }]}
                onPress={handleCreateStyle}
                disabled={savingStyle}
              >
                {savingStyle ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadBtnText}>保存</Text>}
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.sectionLabel}>登録済みスタイル</Text>
          {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.md }} />}
          {collageStyles.map((s) => (
            <View key={s.id} style={[styles.sheetRow, !s.isActive && { opacity: 0.5 }]}>
              {s.backgroundUrl && <Image source={{ uri: s.backgroundUrl }} style={styles.styleThumb} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetName} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.sheetMeta}>{s.plan}</Text>
              </View>
              <Switch value={s.isActive} onValueChange={() => handleToggleStyleActive(s)} />
              <TouchableOpacity onPress={() => handleDeleteStyle(s)} style={{ marginLeft: SPACING.sm }}>
                <Ionicons name="trash-outline" size={20} color={COLORS.error} />
              </TouchableOpacity>
            </View>
          ))}
          {!loading && collageStyles.length === 0 && <Text style={styles.emptyText}>まだスタイルがありません</Text>}
        </ScrollView>
      )}
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
  tabRow: { flexDirection: 'row', paddingHorizontal: SPACING.md, gap: SPACING.sm, marginBottom: SPACING.sm },
  tabBtn: { flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, alignItems: 'center' },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabBtnText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: 13 },
  tabBtnTextActive: { color: '#fff' },
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
  sheetError: { color: COLORS.error, fontSize: 11, marginTop: 2 },
  statusBadge: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.full },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: SPACING.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  assetCard: {
    width: 100, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.xs, alignItems: 'center',
  },
  assetImg: { width: 84, height: 84, marginBottom: SPACING.xs },
  assetImgEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background, borderRadius: RADIUS.sm },
  assetName: { color: COLORS.text, fontSize: 11, fontWeight: '600', maxWidth: 90 },
  assetCategoryLabel: { color: COLORS.textMuted, fontSize: 10, maxWidth: 90 },
  assetActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: SPACING.xs },
  assetCardSelected: { borderWidth: 2, borderColor: COLORS.primary },
  editPanel: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md,
    borderWidth: 1, borderColor: COLORS.primary,
  },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, color: COLORS.text, backgroundColor: COLORS.surface,
  },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border },
  styleThumb: { width: 40, height: 40, borderRadius: RADIUS.sm, marginRight: SPACING.sm },
});

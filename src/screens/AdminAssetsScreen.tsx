// 管理者向け: 素材シート（Sprite Sheet）アップロード・登録済み素材の一覧管理画面。
// is_admin=falseのユーザーはナビゲーション上に導線を出さない前提だが、直接URLアクセス等に
// 備えてこの画面自身もcheckIsAdmin()で二重にガードする。
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert, Platform, Switch, ActivityIndicator, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { getCategories, Category } from '../services/storyStudioService';
import {
  checkIsAdmin, uploadAssetSheet, listAssetSheets, listAllAssets,
  toggleAssetActive, deleteAsset, AssetSheet, AdminAsset,
} from '../services/adminAssetService';

type Tab = 'sheets' | 'assets';

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
  const [detailAsset, setDetailAsset] = useState<AdminAsset | null>(null);

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
    setDetailAsset((prev) => (prev && prev.id === a.id ? { ...prev, isActive: !prev.isActive } : prev));
    try {
      await toggleAssetActive(a.id, !a.isActive);
    } catch (e) {
      setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, isActive: a.isActive } : x)));
      setDetailAsset((prev) => (prev && prev.id === a.id ? { ...prev, isActive: a.isActive } : prev));
      alertMsg('更新に失敗しました', 'エラー');
    }
  };

  const handleDelete = async (a: AdminAsset) => {
    const doDelete = async () => {
      try {
        await deleteAsset(a.id);
        setAssets((prev) => prev.filter((x) => x.id !== a.id));
        setDetailAsset((prev) => (prev && prev.id === a.id ? null : prev));
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
      ) : (
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

          {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.md }} />}
          <View style={styles.grid}>
            {assets.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[styles.assetCard, !a.isActive && { opacity: 0.5 }]}
                onPress={() => setDetailAsset(a)}
                activeOpacity={0.8}
              >
                <Image source={{ uri: a.thumbnailUrl ?? a.storageUrl }} style={styles.assetImg} resizeMode="contain" />
                <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
                <View style={styles.assetActionsRow}>
                  <Switch value={a.isActive} onValueChange={() => handleToggleActive(a)} />
                  <TouchableOpacity onPress={() => handleDelete(a)}>
                    <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))}
          </View>
          {!loading && assets.length === 0 && <Text style={styles.emptyText}>該当する素材がありません</Text>}
        </ScrollView>
      )}

      <Modal
        visible={!!detailAsset}
        animationType="slide"
        transparent
        onRequestClose={() => setDetailAsset(null)}
      >
        <View style={styles.detailOverlay}>
          <View style={styles.detailCard}>
            {detailAsset && (
              <>
                <TouchableOpacity style={styles.detailCloseBtn} onPress={() => setDetailAsset(null)}>
                  <Ionicons name="close" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
                <Image
                  source={{ uri: detailAsset.thumbnailUrl ?? detailAsset.storageUrl }}
                  style={styles.detailImg}
                  resizeMode="contain"
                />
                <Text style={styles.detailName}>{detailAsset.name}</Text>
                <Text style={styles.detailMeta}>{categoryName(detailAsset.categoryId)} ・ {detailAsset.plan}</Text>
                {detailAsset.width != null && detailAsset.height != null && (
                  <Text style={styles.detailMeta}>{detailAsset.width} × {detailAsset.height}px</Text>
                )}
                <View style={styles.detailActiveRow}>
                  <Text style={styles.detailActiveLabel}>公開する</Text>
                  <Switch value={detailAsset.isActive} onValueChange={() => handleToggleActive(detailAsset)} />
                </View>
                <TouchableOpacity style={styles.detailDeleteBtn} onPress={() => handleDelete(detailAsset)} activeOpacity={0.85}>
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                  <Text style={styles.detailDeleteBtnText}>この素材を削除</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  assetName: { color: COLORS.text, fontSize: 11, fontWeight: '600', maxWidth: 90 },
  assetActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: SPACING.xs },
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  detailCard: {
    width: '100%', maxWidth: 360, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, alignItems: 'center',
  },
  detailCloseBtn: { position: 'absolute', top: SPACING.sm, right: SPACING.sm, padding: SPACING.xs, zIndex: 1 },
  detailImg: { width: 160, height: 160, marginBottom: SPACING.md },
  detailName: { color: COLORS.text, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  detailMeta: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, textAlign: 'center' },
  detailActiveRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%',
    marginTop: SPACING.lg, paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  detailActiveLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  detailDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs,
    backgroundColor: COLORS.error, borderRadius: RADIUS.md, paddingVertical: SPACING.md, width: '100%', marginTop: SPACING.md,
  },
  detailDeleteBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

// 管理者向け: 素材シート（Sprite Sheet）アップロード・登録済み素材の一覧管理画面。
// is_admin=falseのユーザーはナビゲーション上に導線を出さない前提だが、直接URLアクセス等に
// 備えてこの画面自身もcheckIsAdmin()で二重にガードする。
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert, Platform, Switch, ActivityIndicator, TextInput, Modal,
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
  listAllCollageStyles, createCollageStyle, updateCollageStyle, toggleCollageStyleActive, deleteCollageStyle, CollageStyle,
} from '../services/collageStyleService';
import {
  COLLAGE_FONT_PRESETS, COLLAGE_LAYOUTS, COLLAGE_THEMES, composeLayoutPreview,
  COLLAGE_W, COLLAGE_H, COLLAGE_Z_BANDS, COLLAGE_TEMPLATE_SCHEMA_VERSION,
  CollageStyleAssets, CollageDecoration, CollageTextLayer,
} from '../utils/collageCompositor';

type Tab = 'sheets' | 'assets' | 'styles';
const PLAN_OPTIONS: Plan[] = ['free', 'pro', 'business'];
const ALIGN_OPTIONS: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right'];

/** 装飾1件のフォーム入力（数値は文字列で保持し、保存時にNumberへ変換する） */
interface DecorationDraft {
  key: string;
  assetId: string | null;
  assetUrl: string | null;
  assetName: string;
  x: string; y: string; w: string; h: string; rotate: string; zIndex: string;
}
/** テキストレイヤー1件のフォーム入力 */
interface TextLayerDraft {
  key: string;
  id: string;
  label: string;
  sampleText: string;
  x: string; y: string; maxWidth: string; fontSize: string;
  color: string;
  font: string;
  align: 'left' | 'center' | 'right';
  lineHeight: string; letterSpacing: string; maxLines: string; rotation: string; zIndex: string;
}

let draftKeySeq = 0;
const nextDraftKey = () => `draft-${draftKeySeq++}`;

/** 10px単位の移動・端寄せ・複製ボタンの共通行 */
function PositionToolRow({ onNudge, onAlign, onDuplicate }: {
  onNudge: (dx: number, dy: number) => void;
  onAlign: (where: 'centerX' | 'left' | 'right' | 'top' | 'bottom') => void;
  onDuplicate: () => void;
}) {
  return (
    <View style={styles.posToolRow}>
      <TouchableOpacity style={styles.posBtn} onPress={() => onNudge(0, -10)}><Ionicons name="chevron-up" size={16} color={COLORS.text} /></TouchableOpacity>
      <TouchableOpacity style={styles.posBtn} onPress={() => onNudge(0, 10)}><Ionicons name="chevron-down" size={16} color={COLORS.text} /></TouchableOpacity>
      <TouchableOpacity style={styles.posBtn} onPress={() => onNudge(-10, 0)}><Ionicons name="chevron-back" size={16} color={COLORS.text} /></TouchableOpacity>
      <TouchableOpacity style={styles.posBtn} onPress={() => onNudge(10, 0)}><Ionicons name="chevron-forward" size={16} color={COLORS.text} /></TouchableOpacity>
      <TouchableOpacity style={styles.posTextBtn} onPress={() => onAlign('centerX')}><Text style={styles.posTextBtnText}>中央</Text></TouchableOpacity>
      <TouchableOpacity style={styles.posTextBtn} onPress={() => onAlign('left')}><Text style={styles.posTextBtnText}>左端</Text></TouchableOpacity>
      <TouchableOpacity style={styles.posTextBtn} onPress={() => onAlign('right')}><Text style={styles.posTextBtnText}>右端</Text></TouchableOpacity>
      <TouchableOpacity style={styles.posTextBtn} onPress={() => onAlign('top')}><Text style={styles.posTextBtnText}>上端</Text></TouchableOpacity>
      <TouchableOpacity style={styles.posTextBtn} onPress={() => onAlign('bottom')}><Text style={styles.posTextBtnText}>下端</Text></TouchableOpacity>
      <TouchableOpacity style={styles.posTextBtn} onPress={onDuplicate}><Text style={styles.posTextBtnText}>複製</Text></TouchableOpacity>
    </View>
  );
}

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
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null);
  const [styleName, setStyleName] = useState('');
  const [stylePlan, setStylePlan] = useState<Plan>('free');
  const [styleTags, setStyleTags] = useState('');
  const [styleAccentColor, setStyleAccentColor] = useState('#FFFFFF');
  const [styleAccentFont, setStyleAccentFont] = useState<string>(COLLAGE_FONT_PRESETS[0].id);
  const [styleAccentYOffset, setStyleAccentYOffset] = useState('0');
  const [styleCaptionColor, setStyleCaptionColor] = useState('#FFFFFF');
  const [styleCaptionFont, setStyleCaptionFont] = useState<string>(COLLAGE_FONT_PRESETS[0].id);
  const [styleCaptionYOffset, setStyleCaptionYOffset] = useState('0');
  const [styleBackgroundAssetId, setStyleBackgroundAssetId] = useState<string | null>(null);
  const [styleFrameAssetId, setStyleFrameAssetId] = useState<string | null>(null);
  const [backgroundAssets, setBackgroundAssets] = useState<AdminAsset[]>([]);
  const [frameAssets, setFrameAssets] = useState<AdminAsset[]>([]);
  const [savingStyle, setSavingStyle] = useState(false);

  // 完成テンプレートモード用
  const [styleLayoutId, setStyleLayoutId] = useState<string | null>(null);
  const [layoutPreviews, setLayoutPreviews] = useState<Record<string, string | null>>({});
  const [styleDecorations, setStyleDecorations] = useState<DecorationDraft[]>([]);
  const [styleTextLayers, setStyleTextLayers] = useState<TextLayerDraft[]>([]);
  const [decorationCategoryId, setDecorationCategoryId] = useState<string | null>(null);
  const [decorationAssets, setDecorationAssets] = useState<AdminAsset[]>([]);
  const [decorationPickerFor, setDecorationPickerFor] = useState<string | null>(null);
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
    if (!decorationCategoryId) {
      const stampCategoryId = categories.find((c) => c.name === 'スタンプ' || c.name === 'ワンポイント')?.id;
      if (stampCategoryId) setDecorationCategoryId(stampCategoryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, tab, categories, loadStyles]);

  // レイアウト選択用のサムネイルを1回だけ生成する
  useEffect(() => {
    if (!isAdmin || tab !== 'styles') return;
    let alive = true;
    COLLAGE_LAYOUTS.forEach((l) => {
      if (layoutPreviews[l.id] !== undefined) return;
      setLayoutPreviews((p) => ({ ...p, [l.id]: null }));
      composeLayoutPreview(l, COLLAGE_THEMES[0])
        .then((url) => { if (alive) setLayoutPreviews((p) => ({ ...p, [l.id]: url })); })
        .catch(() => {});
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, tab]);

  useEffect(() => {
    if (!isAdmin || tab !== 'styles' || !decorationCategoryId) return;
    listAllAssets({ categoryId: decorationCategoryId, isActive: true }).then(setDecorationAssets).catch(() => {});
  }, [isAdmin, tab, decorationCategoryId]);

  // フォームの内容が変わるたびにプレビューを再生成する。
  // キー入力のたびに毎回生成するとカクつくため、400ms操作が止まってから生成する（デバウンス）。
  useEffect(() => {
    if (!isAdmin || tab !== 'styles' || !styleLayoutId) {
      setLivePreviewUrl(null);
      return;
    }
    const layout = COLLAGE_LAYOUTS.find((l) => l.id === styleLayoutId);
    if (!layout) return;
    let alive = true;
    setLivePreviewLoading(true);
    const timer = setTimeout(() => {
      const bg = backgroundAssets.find((a) => a.id === styleBackgroundAssetId);
      const fr = frameAssets.find((a) => a.id === styleFrameAssetId);
      const styleAssets: CollageStyleAssets = {
        backgroundUrl: bg?.storageUrl,
        frameUrl: fr?.storageUrl,
        accentColor: styleAccentColor,
        version: COLLAGE_TEMPLATE_SCHEMA_VERSION,
        decorations: styleDecorations
          .filter((d) => d.assetUrl)
          .map((d): CollageDecoration => ({
            assetId: d.assetId ?? '',
            url: d.assetUrl ?? undefined,
            x: Number(d.x) || 0, y: Number(d.y) || 0, w: Number(d.w) || 100, h: Number(d.h) || 100,
            rotate: Number(d.rotate) || 0,
            zIndex: Number(d.zIndex) || COLLAGE_Z_BANDS.decorationFrontPhotos,
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
      };
      const dummyTheme = { name: 'preview', background: '#F5F5F5', background2: '#E2E2E2', accent: styleAccentColor };
      composeLayoutPreview(layout, dummyTheme, styleAssets)
        .then((url) => { if (alive) setLivePreviewUrl(url); })
        .catch(() => { if (alive) setLivePreviewUrl(null); })
        .finally(() => { if (alive) setLivePreviewLoading(false); });
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAdmin, tab, styleLayoutId, styleBackgroundAssetId, styleFrameAssetId, styleAccentColor,
    backgroundAssets, frameAssets, styleDecorations, styleTextLayers,
  ]);

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
        if (editingAssetId === a.id) cancelEditAsset();
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
    setEditingStyleId(null);
    setStyleName('');
    setStylePlan('free');
    setStyleTags('');
    setStyleAccentColor('#FFFFFF');
    setStyleAccentFont(COLLAGE_FONT_PRESETS[0].id);
    setStyleAccentYOffset('0');
    setStyleCaptionColor('#FFFFFF');
    setStyleCaptionFont(COLLAGE_FONT_PRESETS[0].id);
    setStyleCaptionYOffset('0');
    setStyleBackgroundAssetId(null);
    setStyleFrameAssetId(null);
    setStyleLayoutId(null);
    setStyleDecorations([]);
    setStyleTextLayers([]);
  };

  const startEditStyle = (s: CollageStyle) => {
    setEditingStyleId(s.id);
    setStyleName(s.name);
    setStylePlan(s.plan);
    setStyleTags(s.tags.join(', '));
    setStyleAccentColor(s.accentColor ?? '#FFFFFF');
    setStyleAccentFont(s.accentFont ?? COLLAGE_FONT_PRESETS[0].id);
    setStyleAccentYOffset(String(s.accentYOffset ?? 0));
    setStyleCaptionColor(s.captionColor ?? '#FFFFFF');
    setStyleCaptionFont(s.captionFont ?? COLLAGE_FONT_PRESETS[0].id);
    setStyleCaptionYOffset(String(s.captionYOffset ?? 0));
    setStyleBackgroundAssetId(s.backgroundAssetId ?? null);
    setStyleFrameAssetId(s.frameAssetId ?? null);
    setStyleLayoutId(s.layoutId ?? null);
    setStyleDecorations(
      (s.decorations ?? []).map((d) => ({
        key: nextDraftKey(),
        assetId: d.assetId,
        assetUrl: d.url ?? null,
        assetName: '',
        x: String(d.x), y: String(d.y), w: String(d.w), h: String(d.h), rotate: String(d.rotate ?? 0),
        zIndex: String(d.zIndex ?? COLLAGE_Z_BANDS.decorationFrontPhotos),
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
    setStyleFormVisible(true);
  };

  const addDecoration = () => {
    setStyleDecorations((p) => [...p, {
      key: nextDraftKey(), assetId: null, assetUrl: null, assetName: '',
      x: '100', y: '100', w: '150', h: '150', rotate: '0', zIndex: String(COLLAGE_Z_BANDS.decorationFrontPhotos),
    }]);
  };
  const updateDecoration = (key: string, patch: Partial<DecorationDraft>) => {
    setStyleDecorations((p) => p.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };
  const removeDecoration = (key: string) => setStyleDecorations((p) => p.filter((d) => d.key !== key));
  const nudgeDecoration = (key: string, dx: number, dy: number) => {
    setStyleDecorations((p) => p.map((d) => (d.key === key
      ? { ...d, x: String((Number(d.x) || 0) + dx), y: String((Number(d.y) || 0) + dy) }
      : d)));
  };
  const alignDecoration = (key: string, where: 'centerX' | 'left' | 'right' | 'top' | 'bottom') => {
    setStyleDecorations((p) => p.map((d) => {
      if (d.key !== key) return d;
      const w = Number(d.w) || 0;
      const h = Number(d.h) || 0;
      if (where === 'centerX') return { ...d, x: String(Math.round((COLLAGE_W - w) / 2)) };
      if (where === 'left') return { ...d, x: '0' };
      if (where === 'right') return { ...d, x: String(COLLAGE_W - w) };
      if (where === 'top') return { ...d, y: '0' };
      return { ...d, y: String(COLLAGE_H - h) };
    }));
  };
  const duplicateDecoration = (key: string) => {
    setStyleDecorations((p) => {
      const idx = p.findIndex((d) => d.key === key);
      if (idx === -1) return p;
      const src = p[idx];
      const copy: DecorationDraft = { ...src, key: nextDraftKey(), x: String((Number(src.x) || 0) + 20), y: String((Number(src.y) || 0) + 20) };
      return [...p.slice(0, idx + 1), copy, ...p.slice(idx + 1)];
    });
  };

  const addTextLayer = () => {
    setStyleTextLayers((p) => [...p, {
      key: nextDraftKey(), id: `text_${p.length + 1}`, label: '', sampleText: '',
      x: '100', y: '200', maxWidth: '600', fontSize: '40', color: '#FFFFFF',
      font: COLLAGE_FONT_PRESETS[0].id, align: 'left',
      lineHeight: '1.25', letterSpacing: '0', maxLines: '3', rotation: '0', zIndex: String(COLLAGE_Z_BANDS.text),
    }]);
  };
  const updateTextLayer = (key: string, patch: Partial<TextLayerDraft>) => {
    setStyleTextLayers((p) => p.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  };
  const removeTextLayer = (key: string) => setStyleTextLayers((p) => p.filter((t) => t.key !== key));
  const nudgeTextLayer = (key: string, dx: number, dy: number) => {
    setStyleTextLayers((p) => p.map((t) => (t.key === key
      ? { ...t, x: String((Number(t.x) || 0) + dx), y: String((Number(t.y) || 0) + dy) }
      : t)));
  };
  const alignTextLayer = (key: string, where: 'centerX' | 'left' | 'right' | 'top' | 'bottom') => {
    setStyleTextLayers((p) => p.map((t) => {
      if (t.key !== key) return t;
      if (where === 'centerX') return { ...t, x: String(Math.round(COLLAGE_W / 2)) };
      if (where === 'left') return { ...t, x: '0' };
      if (where === 'right') return { ...t, x: String(COLLAGE_W) };
      if (where === 'top') return { ...t, y: '80' };
      return { ...t, y: String(COLLAGE_H - 80) };
    }));
  };
  const duplicateTextLayer = (key: string) => {
    setStyleTextLayers((p) => {
      const idx = p.findIndex((t) => t.key === key);
      if (idx === -1) return p;
      const src = p[idx];
      const copy: TextLayerDraft = {
        ...src, key: nextDraftKey(), id: `${src.id}_copy${draftKeySeq}`,
        y: String((Number(src.y) || 0) + 40),
      };
      return [...p.slice(0, idx + 1), copy, ...p.slice(idx + 1)];
    });
  };

  const parseTags = (raw: string): string[] =>
    raw.split(',').map((s) => s.trim()).filter(Boolean);

  const handleSaveStyle = async () => {
    if (!styleName.trim()) {
      alertMsg('スタイル名を入力してください');
      return;
    }
    if (!styleLayoutId) {
      alertMsg('レイアウトを選んでください');
      return;
    }
    setSavingStyle(true);
    try {
      const params = {
        name: styleName.trim(),
        plan: stylePlan,
        tags: parseTags(styleTags),
        backgroundAssetId: styleBackgroundAssetId ?? undefined,
        frameAssetId: styleFrameAssetId ?? undefined,
        accentColor: styleAccentColor,
        accentFont: styleAccentFont,
        accentYOffset: Number(styleAccentYOffset) || 0,
        captionColor: styleCaptionColor,
        captionFont: styleCaptionFont,
        captionYOffset: Number(styleCaptionYOffset) || 0,
        layoutId: styleLayoutId,
        decorations: styleDecorations.filter((d) => d.assetId).map((d) => ({
          assetId: d.assetId as string,
          x: Number(d.x) || 0, y: Number(d.y) || 0, w: Number(d.w) || 100, h: Number(d.h) || 100,
          rotate: Number(d.rotate) || 0,
          zIndex: Number(d.zIndex) || COLLAGE_Z_BANDS.decorationFrontPhotos,
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
          <Text style={styles.headerTitle}>素材シート管理</Text>
          <View style={{ width: 26 }} />
        </View>
        <Text style={styles.deniedText}>この画面へのアクセス権限がありません</Text>
      </View>
    );
  }

  const editingAsset = assets.find((x) => x.id === editingAssetId) ?? null;

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
          <Text style={[styles.tabBtnText, tab === 'styles' && styles.tabBtnTextActive]}>コラージュテンプレート</Text>
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

          {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.md }} />}
          <View style={styles.grid}>
            {assets.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[styles.assetCard, !a.isActive && { opacity: 0.5 }]}
                onPress={() => startEditAsset(a)}
                activeOpacity={0.8}
              >
                <Image source={{ uri: a.thumbnailUrl ?? a.storageUrl }} style={styles.assetImg} resizeMode="contain" />
                <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
                <Text style={styles.assetCategoryLabel} numberOfLines={1}>{categoryName(a.categoryId)}</Text>
              </TouchableOpacity>
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

              <Text style={styles.sectionLabel}>レイアウト（写真の配置）</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {COLLAGE_LAYOUTS.map((l) => (
                  <TouchableOpacity key={l.id} onPress={() => setStyleLayoutId(l.id)}>
                    <View style={[styles.assetCard, styleLayoutId === l.id && styles.assetCardSelected]}>
                      {layoutPreviews[l.id] ? (
                        <Image source={{ uri: layoutPreviews[l.id]! }} style={styles.layoutThumb} resizeMode="cover" />
                      ) : (
                        <View style={[styles.layoutThumb, styles.assetImgEmpty]}>
                          <ActivityIndicator color={COLORS.textMuted} size="small" />
                        </View>
                      )}
                      <Text style={styles.assetName} numberOfLines={1}>{l.name}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.sectionLabel}>あしらい文字（年号など）の色・フォント・位置</Text>
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {COLLAGE_FONT_PRESETS.map((f) => (
                  <TouchableOpacity
                    key={f.id}
                    style={[styles.chip, styleAccentFont === f.id && styles.chipActive]}
                    onPress={() => setStyleAccentFont(f.id)}
                  >
                    <Text style={[styles.chipText, styleAccentFont === f.id && styles.chipTextActive]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TextInput
                style={styles.input}
                value={styleAccentYOffset}
                onChangeText={setStyleAccentYOffset}
                placeholder="縦位置の微調整（px・+で下へ、0で標準）"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
              />

              <Text style={styles.sectionLabel}>キャプション（下部の説明文）の色・フォント・位置</Text>
              <View style={styles.colorRow}>
                <View style={[styles.colorSwatch, { backgroundColor: styleCaptionColor }]} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={styleCaptionColor}
                  onChangeText={setStyleCaptionColor}
                  placeholder="#FFFFFF"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {COLLAGE_FONT_PRESETS.map((f) => (
                  <TouchableOpacity
                    key={f.id}
                    style={[styles.chip, styleCaptionFont === f.id && styles.chipActive]}
                    onPress={() => setStyleCaptionFont(f.id)}
                  >
                    <Text style={[styles.chipText, styleCaptionFont === f.id && styles.chipTextActive]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TextInput
                style={styles.input}
                value={styleCaptionYOffset}
                onChangeText={setStyleCaptionYOffset}
                placeholder="縦位置の微調整（px・+で下へ、0で標準）"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
              />

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

              <Text style={styles.sectionLabel}>装飾画像（矢印・キラキラ等。キャンバスは1080×1920pxです）</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                    {categories.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.chip, decorationCategoryId === c.id && styles.chipActive]}
                        onPress={() => setDecorationCategoryId(c.id)}
                      >
                        <Text style={[styles.chipText, decorationCategoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  {styleDecorations.map((d) => (
                    <View key={d.key} style={styles.draftRow}>
                      <TouchableOpacity onPress={() => setDecorationPickerFor(decorationPickerFor === d.key ? null : d.key)}>
                        <View style={styles.decorationPickBtn}>
                          {d.assetUrl ? (
                            <Image source={{ uri: d.assetUrl }} style={styles.decorationPickImg} resizeMode="contain" />
                          ) : (
                            <Text style={styles.chipText}>素材を選ぶ</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                      {decorationPickerFor === d.key && (
                        <View style={styles.grid}>
                          {decorationAssets.map((a) => (
                            <TouchableOpacity
                              key={a.id}
                              onPress={() => {
                                updateDecoration(d.key, { assetId: a.id, assetUrl: a.thumbnailUrl ?? a.storageUrl, assetName: a.name });
                                setDecorationPickerFor(null);
                              }}
                            >
                              <View style={styles.assetCard}>
                                <Image source={{ uri: a.thumbnailUrl ?? a.storageUrl }} style={styles.assetImg} resizeMode="contain" />
                                <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                          {decorationAssets.length === 0 && <Text style={styles.emptyText}>このカテゴリに素材がありません</Text>}
                        </View>
                      )}
                      <View style={styles.numRow}>
                        <TextInput style={styles.numInput} value={d.x} onChangeText={(v) => updateDecoration(d.key, { x: v })} placeholder="x" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <TextInput style={styles.numInput} value={d.y} onChangeText={(v) => updateDecoration(d.key, { y: v })} placeholder="y" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <TextInput style={styles.numInput} value={d.w} onChangeText={(v) => updateDecoration(d.key, { w: v })} placeholder="幅" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <TextInput style={styles.numInput} value={d.h} onChangeText={(v) => updateDecoration(d.key, { h: v })} placeholder="高さ" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <TextInput style={styles.numInput} value={d.rotate} onChangeText={(v) => updateDecoration(d.key, { rotate: v })} placeholder="回転°" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <TouchableOpacity onPress={() => removeDecoration(d.key)}>
                          <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.numRow}>
                        <Text style={styles.posTextBtnText}>重なり順</Text>
                        <TextInput style={styles.numInput} value={d.zIndex} onChangeText={(v) => updateDecoration(d.key, { zIndex: v })} placeholder="zIndex" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <TouchableOpacity style={styles.posTextBtn} onPress={() => updateDecoration(d.key, { zIndex: String(COLLAGE_Z_BANDS.decorationBehindPhotos) })}>
                          <Text style={styles.posTextBtnText}>写真背面(15)</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.posTextBtn} onPress={() => updateDecoration(d.key, { zIndex: String(COLLAGE_Z_BANDS.decorationFrontPhotos) })}>
                          <Text style={styles.posTextBtnText}>写真前面(35)</Text>
                        </TouchableOpacity>
                      </View>
                      <PositionToolRow
                        onNudge={(dx, dy) => nudgeDecoration(d.key, dx, dy)}
                        onAlign={(where) => alignDecoration(d.key, where)}
                        onDuplicate={() => duplicateDecoration(d.key)}
                      />
                    </View>
                  ))}
                  <TouchableOpacity style={styles.addRowBtn} onPress={addDecoration}>
                    <Ionicons name="add" size={16} color={COLORS.primary} />
                    <Text style={styles.addRowBtnText}>装飾を追加</Text>
                  </TouchableOpacity>

                  <Text style={styles.sectionLabel}>テキストレイヤー（あしらい文字・キャプションの代わりに使う）</Text>
                  {styleTextLayers.map((t) => (
                    <View key={t.key} style={styles.draftRow}>
                      <TextInput style={styles.input} value={t.label} onChangeText={(v) => updateTextLayer(t.key, { label: v })} placeholder="ラベル（例: 見出し）" placeholderTextColor={COLORS.textMuted} />
                      <TextInput style={styles.input} value={t.sampleText} onChangeText={(v) => updateTextLayer(t.key, { sampleText: v })} placeholder="サンプル文言（例: 家で咲いた花）" placeholderTextColor={COLORS.textMuted} />
                      <View style={styles.numRow}>
                        <TextInput style={styles.numInput} value={t.x} onChangeText={(v) => updateTextLayer(t.key, { x: v })} placeholder="x" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <TextInput style={styles.numInput} value={t.y} onChangeText={(v) => updateTextLayer(t.key, { y: v })} placeholder="y" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <TextInput style={styles.numInput} value={t.maxWidth} onChangeText={(v) => updateTextLayer(t.key, { maxWidth: v })} placeholder="最大幅" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <TextInput style={styles.numInput} value={t.fontSize} onChangeText={(v) => updateTextLayer(t.key, { fontSize: v })} placeholder="文字サイズ" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <TouchableOpacity onPress={() => removeTextLayer(t.key)}>
                          <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.colorRow}>
                        <View style={[styles.colorSwatch, { backgroundColor: t.color }]} />
                        <TextInput style={[styles.input, { flex: 1 }]} value={t.color} onChangeText={(v) => updateTextLayer(t.key, { color: v })} placeholder="#FFFFFF" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" autoCorrect={false} />
                      </View>
                      <View style={styles.chipRow}>
                        {COLLAGE_FONT_PRESETS.map((f) => (
                          <TouchableOpacity key={f.id} style={[styles.chip, t.font === f.id && styles.chipActive]} onPress={() => updateTextLayer(t.key, { font: f.id })}>
                            <Text style={[styles.chipText, t.font === f.id && styles.chipTextActive]}>{f.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={styles.chipRow}>
                        {ALIGN_OPTIONS.map((al) => (
                          <TouchableOpacity key={al} style={[styles.chip, t.align === al && styles.chipActive]} onPress={() => updateTextLayer(t.key, { align: al })}>
                            <Text style={[styles.chipText, t.align === al && styles.chipTextActive]}>{al === 'left' ? '左揃え' : al === 'center' ? '中央揃え' : '右揃え'}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={styles.numRow}>
                        <Text style={styles.posTextBtnText}>行間</Text>
                        <TextInput style={styles.numInput} value={t.lineHeight} onChangeText={(v) => updateTextLayer(t.key, { lineHeight: v })} placeholder="1.25" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <Text style={styles.posTextBtnText}>字間</Text>
                        <TextInput style={styles.numInput} value={t.letterSpacing} onChangeText={(v) => updateTextLayer(t.key, { letterSpacing: v })} placeholder="0" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <Text style={styles.posTextBtnText}>最大行数</Text>
                        <TextInput style={styles.numInput} value={t.maxLines} onChangeText={(v) => updateTextLayer(t.key, { maxLines: v })} placeholder="3" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                      </View>
                      <View style={styles.numRow}>
                        <Text style={styles.posTextBtnText}>回転°</Text>
                        <TextInput style={styles.numInput} value={t.rotation} onChangeText={(v) => updateTextLayer(t.key, { rotation: v })} placeholder="0" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                        <Text style={styles.posTextBtnText}>重なり順</Text>
                        <TextInput style={styles.numInput} value={t.zIndex} onChangeText={(v) => updateTextLayer(t.key, { zIndex: v })} placeholder="zIndex" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                      </View>
                      <PositionToolRow
                        onNudge={(dx, dy) => nudgeTextLayer(t.key, dx, dy)}
                        onAlign={(where) => alignTextLayer(t.key, where)}
                        onDuplicate={() => duplicateTextLayer(t.key)}
                      />
                    </View>
                  ))}
                  <TouchableOpacity style={styles.addRowBtn} onPress={addTextLayer}>
                    <Ionicons name="add" size={16} color={COLORS.primary} />
                    <Text style={styles.addRowBtnText}>テキストを追加</Text>
                  </TouchableOpacity>

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
                  <Text style={styles.sheetName} numberOfLines={1}>{s.name}{s.layoutId ? '（完成テンプレート）' : ''}</Text>
                  <Text style={styles.sheetMeta}>{s.plan}{s.tags.length > 0 ? ` ・ ${s.tags.join(', ')}` : ''}</Text>
                </View>
              </TouchableOpacity>
              <Switch value={s.isActive} onValueChange={() => handleToggleStyleActive(s)} />
              <TouchableOpacity onPress={() => handleDeleteStyle(s)} style={{ marginLeft: SPACING.sm }}>
                <Ionicons name="trash-outline" size={20} color={COLORS.error} />
              </TouchableOpacity>
            </View>
          ))}
          {!loading && collageStyles.length === 0 && <Text style={styles.emptyText}>まだスタイルがありません</Text>}
        </ScrollView>
      )}

      <Modal
        visible={!!editingAsset}
        animationType="slide"
        transparent
        onRequestClose={cancelEditAsset}
      >
        <View style={styles.detailOverlay}>
          <View style={styles.detailCard}>
            {editingAsset && (
              <ScrollView contentContainerStyle={{ alignItems: 'center' }}>
                <TouchableOpacity style={styles.detailCloseBtn} onPress={cancelEditAsset}>
                  <Ionicons name="close" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
                <Image
                  source={{ uri: editingAsset.thumbnailUrl ?? editingAsset.storageUrl }}
                  style={styles.detailImg}
                  resizeMode="contain"
                />

                <View style={styles.detailActiveRow}>
                  <Text style={styles.detailActiveLabel}>表示する</Text>
                  <Switch value={editingAsset.isActive} onValueChange={() => handleToggleActive(editingAsset)} />
                </View>

                <Text style={styles.sectionLabel}>素材名</Text>
                <TextInput
                  style={[styles.input, { width: '100%' }]}
                  value={editName}
                  onChangeText={setEditName}
                  placeholderTextColor={COLORS.textMuted}
                />
                <Text style={styles.sectionLabel}>カテゴリ</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                  {categories.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.chip, editCategoryId === c.id && styles.chipActive]}
                      onPress={() => setEditCategoryId(c.id)}
                    >
                      <Text style={[styles.chipText, editCategoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <TouchableOpacity
                  style={[styles.uploadBtn, { width: '100%' }, savingEdit && { opacity: 0.6 }]}
                  onPress={handleSaveEditAsset}
                  disabled={savingEdit}
                >
                  {savingEdit ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadBtnText}>保存</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.detailDeleteBtn}
                  onPress={() => handleDelete(editingAsset)}
                  disabled={savingEdit}
                  activeOpacity={0.85}
                >
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                  <Text style={styles.uploadBtnText}>この素材を削除</Text>
                </TouchableOpacity>
              </ScrollView>
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
  assetImgEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background, borderRadius: RADIUS.sm },
  assetName: { color: COLORS.text, fontSize: 11, fontWeight: '600', maxWidth: 90 },
  assetCategoryLabel: { color: COLORS.textMuted, fontSize: 10, maxWidth: 90 },
  assetCardSelected: { borderWidth: 2, borderColor: COLORS.primary },
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  detailCard: {
    width: '100%', maxWidth: 360, maxHeight: '85%', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg,
  },
  detailCloseBtn: { position: 'absolute', top: 0, right: 0, padding: SPACING.xs, zIndex: 1 },
  detailImg: { width: 160, height: 160, marginBottom: SPACING.sm },
  detailActiveRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%',
    paddingVertical: SPACING.sm, marginBottom: SPACING.xs,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.border,
  },
  detailActiveLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  detailDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs,
    backgroundColor: COLORS.error, borderRadius: RADIUS.md, paddingVertical: SPACING.md, width: '100%', marginTop: SPACING.sm,
  },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, color: COLORS.text, backgroundColor: COLORS.surface,
  },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border },
  styleThumb: { width: 40, height: 40, borderRadius: RADIUS.sm, marginRight: SPACING.sm },
  layoutThumb: { width: 84, height: (84 * 1920) / 1080, borderRadius: RADIUS.sm, marginBottom: SPACING.xs },
  draftRow: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.sm, marginBottom: SPACING.sm, gap: SPACING.xs,
  },
  decorationPickBtn: {
    width: 72, height: 72, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background,
  },
  decorationPickImg: { width: '100%', height: '100%' },
  numRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexWrap: 'wrap' },
  numInput: {
    width: 64, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.xs, paddingVertical: 6, color: COLORS.text, backgroundColor: COLORS.surface, fontSize: 12,
  },
  addRowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    paddingVertical: SPACING.xs, marginBottom: SPACING.sm,
  },
  addRowBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  livePreviewWrap: {
    width: 180, height: (180 * 1920) / 1080, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: SPACING.sm,
  },
  livePreviewImg: { width: '100%', height: '100%' },
  posToolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  posBtn: {
    width: 28, height: 28, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center',
  },
  posTextBtn: {
    paddingHorizontal: SPACING.xs, paddingVertical: 4, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background,
  },
  posTextBtnText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
});

// コラージュ型ストーリー（web専用）: 管理者が作成した完成テンプレート、または自分専用に
// 保存したテンプレートを1つ選び、写真とテキストを入れて仕上げる。
// 自分のテンプレートは他ユーザーには公開されない（著作権上のリスクを避けるため）。
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, TextInput, ActivityIndicator, Platform, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import { Plan } from '../utils/plans';
import { getMyPlan } from '../services/scheduleService';
import {
  listCollageStyles, createMyCollageTemplate, deleteCollageStyle, CollageStyle,
} from '../services/collageStyleService';
import {
  composeCollage, composeTemplatePreview, CollageTemplateAssets, CollageTextLayer,
  COLLAGE_FONT_PRESETS, COLLAGE_W, COLLAGE_H, COLLAGE_Z_BANDS,
} from '../utils/collageCompositor';
import { uploadBlob } from '../services/storage';
import ColorPickerModal from './ColorPickerModal';
import PositionToolRow from './PositionToolRow';
import PositionCanvas from './PositionCanvas';

interface Props {
  onDone: (dataUrl: string) => void;
}

type Step = 'gallery' | 'edit' | 'create';

/** ギャラリーに並ぶ1タイル。管理者の完成テンプレート、または自分専用テンプレートのいずれか */
interface GalleryTile {
  key: string;
  id: string;
  name: string;
  tags: string[];
  template: CollageTemplateAssets;
  photoCount: number;
  /** trueの場合、自分が作成した個人用テンプレート（他ユーザーには見えない） */
  isMine: boolean;
}

/** 写真エリア1件のフォーム入力（自分のテンプレート作成用） */
interface PhotoAreaDraft {
  key: string;
  x: string; y: string; w: string; h: string;
}
/** テキストレイヤー1件のフォーム入力（自分のテンプレート作成用。管理画面より項目を絞った簡易版） */
interface MyTextLayerDraft {
  key: string;
  id: string;
  label: string;
  sampleText: string;
  x: string; y: string; maxWidth: string; fontSize: string;
  color: string;
  font: string;
  align: 'left' | 'center' | 'right';
}

let draftKeySeq = 0;
const nextDraftKey = () => `mydraft-${draftKeySeq++}`;

export default function CollageEditor({ onDone }: Props) {
  const [step, setStep] = useState<Step>('gallery');
  const [plan, setPlan] = useState<Plan>('free');
  const [dbStyles, setDbStyles] = useState<CollageStyle[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});

  const [selectedTile, setSelectedTile] = useState<GalleryTile | null>(null);
  const [photos, setPhotos] = useState<(string | null)[]>([]);
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [finalPreview, setFinalPreview] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  // 自分専用テンプレートの作成フォーム
  const [createName, setCreateName] = useState('');
  const [createTags, setCreateTags] = useState('');
  const [createBackgroundUrl, setCreateBackgroundUrl] = useState<string | null>(null);
  const [createUploading, setCreateUploading] = useState(false);
  const [createPhotoAreas, setCreatePhotoAreas] = useState<PhotoAreaDraft[]>([]);
  const [createTextLayers, setCreateTextLayers] = useState<MyTextLayerDraft[]>([]);
  const [createLivePreviewUrl, setCreateLivePreviewUrl] = useState<string | null>(null);
  const [createLivePreviewLoading, setCreateLivePreviewLoading] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [colorPickerTargetKey, setColorPickerTargetKey] = useState<string | null>(null);

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  const loadStyles = () => {
    listCollageStyles(plan).then(setDbStyles).catch(() => {});
  };

  useEffect(() => {
    getMyPlan().then(setPlan).catch(() => {});
  }, []);

  useEffect(() => {
    loadStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  // 管理者の完成テンプレート・自分専用テンプレート（背景デザイン画像＋写真差し込み窓が揃っているもの）を並べる
  const tiles: GalleryTile[] = useMemo(() => {
    const list: GalleryTile[] = [];
    dbStyles.forEach((s) => {
      if (!s.backgroundUrl || !s.photoAreas?.length) return;
      list.push({
        key: `tmpl::${s.id}`,
        id: s.id,
        name: s.name,
        tags: s.tags,
        template: { backgroundUrl: s.backgroundUrl, photoAreas: s.photoAreas, textLayers: s.textLayers },
        photoCount: s.photoAreas.length,
        isMine: !!s.ownerUserId,
      });
    });
    return list;
  }, [dbStyles]);

  const myTiles = useMemo(() => tiles.filter((t) => t.isMine), [tiles]);
  const publicTiles = useMemo(() => tiles.filter((t) => !t.isMine), [tiles]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    tiles.forEach((t) => t.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return counts;
  }, [tiles]);
  const topTags = useMemo(
    () => Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([tag]) => tag),
    [tagCounts]
  );

  const q = searchQuery.trim().toLowerCase();
  // タイルの新しい配列参照を毎レンダー作ると、下のプレビュー生成useEffectが
  // レンダーのたびに再実行され続けてしまうため、useMemoで確定させる。
  const visibleMyTiles = useMemo(
    () => myTiles.filter((t) => (!activeTag || t.tags.includes(activeTag)) && (!q || t.name.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q)))),
    [myTiles, activeTag, q]
  );
  const visiblePublicTiles = useMemo(
    () => publicTiles.filter((t) => (!activeTag || t.tags.includes(activeTag)) && (!q || t.name.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q)))),
    [publicTiles, activeTag, q]
  );

  // 表示中のタイルのプレビューを順次生成する（生成済み・生成中のものは再実行しない）
  useEffect(() => {
    let alive = true;
    [...visibleMyTiles, ...visiblePublicTiles].forEach((t) => {
      if (previews[t.key] !== undefined) return;
      setPreviews((p) => ({ ...p, [t.key]: null }));
      composeTemplatePreview(t.template)
        .then((url) => {
          if (!alive) return;
          setPreviews((p) => ({ ...p, [t.key]: url }));
        })
        .catch(() => {
          if (!alive) return;
          setPreviews((p) => ({ ...p, [t.key]: null }));
        });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMyTiles, visiblePublicTiles]);

  const selectTile = (tile: GalleryTile) => {
    setSelectedTile(tile);
    setPhotos(Array.from({ length: tile.photoCount }, () => null));
    const initial: Record<string, string> = {};
    (tile.template.textLayers ?? []).forEach((l) => { initial[l.id] = l.sampleText; });
    setTextValues(initial);
    setFinalPreview(null);
    setStep('edit');
  };

  const pickPhoto = async (slot: number) => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        alertMsg('写真へのアクセスを許可してください', '権限エラー');
        return;
      }
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (res.canceled) return;
    setPhotos((p) => {
      const next = [...p];
      next[slot] = res.assets[0].uri;
      return next;
    });
  };

  const filledCount = photos.filter(Boolean).length;
  const ready = !!selectedTile && filledCount === selectedTile.photoCount;

  const generatePreview = async () => {
    if (!ready || !selectedTile) return;
    setComposing(true);
    try {
      const { previewUrl } = await composeCollage(
        photos as string[],
        selectedTile.template,
        textValues
      );
      setFinalPreview(previewUrl);
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : 'コラージュの作成に失敗しました');
    } finally {
      setComposing(false);
    }
  };

  const useThis = () => {
    if (finalPreview) onDone(finalPreview);
  };

  // ==== 自分専用テンプレートの作成 ====
  const resetCreateForm = () => {
    setCreateName('');
    setCreateTags('');
    setCreateBackgroundUrl(null);
    setCreatePhotoAreas([]);
    setCreateTextLayers([]);
  };

  const openCreate = () => {
    resetCreateForm();
    setStep('create');
  };

  const pickBackgroundImage = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        alertMsg('写真へのアクセスを許可してください', '権限エラー');
        return;
      }
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.95,
    });
    if (res.canceled) return;
    setCreateUploading(true);
    try {
      const blob = await (await fetch(res.assets[0].uri)).blob();
      const url = await uploadBlob(blob);
      setCreateBackgroundUrl(url);
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '画像のアップロードに失敗しました');
    } finally {
      setCreateUploading(false);
    }
  };

  const addPhotoArea = () => {
    setCreatePhotoAreas((p) => [...p, { key: nextDraftKey(), x: '48', y: '200', w: '984', h: '760' }]);
  };
  const updatePhotoArea = (key: string, patch: Partial<PhotoAreaDraft>) => {
    setCreatePhotoAreas((p) => p.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  };
  const removePhotoArea = (key: string) => setCreatePhotoAreas((p) => p.filter((a) => a.key !== key));
  const movePhotoArea = (key: string, x: number, y: number) => {
    setCreatePhotoAreas((p) => p.map((a) => (a.key === key ? { ...a, x: String(Math.round(x)), y: String(Math.round(y)) } : a)));
  };
  const resizePhotoArea = (key: string, w: number, h: number) => {
    setCreatePhotoAreas((p) => p.map((a) => (a.key === key ? { ...a, w: String(Math.round(w)), h: String(Math.round(h)) } : a)));
  };
  const alignPhotoArea = (key: string, where: 'centerX' | 'left' | 'right' | 'top' | 'bottom') => {
    setCreatePhotoAreas((p) => p.map((a) => {
      if (a.key !== key) return a;
      const w = Number(a.w) || 0;
      const h = Number(a.h) || 0;
      if (where === 'centerX') return { ...a, x: String(Math.round((COLLAGE_W - w) / 2)) };
      if (where === 'left') return { ...a, x: '0' };
      if (where === 'right') return { ...a, x: String(COLLAGE_W - w) };
      if (where === 'top') return { ...a, y: '0' };
      return { ...a, y: String(COLLAGE_H - h) };
    }));
  };
  const duplicatePhotoArea = (key: string) => {
    setCreatePhotoAreas((p) => {
      const idx = p.findIndex((a) => a.key === key);
      if (idx === -1) return p;
      const src = p[idx];
      const copy: PhotoAreaDraft = { ...src, key: nextDraftKey(), x: String((Number(src.x) || 0) + 20), y: String((Number(src.y) || 0) + 20) };
      return [...p.slice(0, idx + 1), copy, ...p.slice(idx + 1)];
    });
  };

  const addTextLayer = () => {
    setCreateTextLayers((p) => [...p, {
      key: nextDraftKey(), id: `text_${p.length + 1}`, label: '', sampleText: '',
      x: '100', y: '200', maxWidth: '600', fontSize: '40', color: '#FFFFFF',
      font: COLLAGE_FONT_PRESETS[0].id, align: 'left',
    }]);
  };
  const updateTextLayer = (key: string, patch: Partial<MyTextLayerDraft>) => {
    setCreateTextLayers((p) => p.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  };
  const removeTextLayer = (key: string) => setCreateTextLayers((p) => p.filter((t) => t.key !== key));
  const moveTextLayer = (key: string, x: number, y: number) => {
    setCreateTextLayers((p) => p.map((t) => (t.key === key ? { ...t, x: String(Math.round(x)), y: String(Math.round(y)) } : t)));
  };
  const alignTextLayer = (key: string, where: 'centerX' | 'left' | 'right' | 'top' | 'bottom') => {
    setCreateTextLayers((p) => p.map((t) => {
      if (t.key !== key) return t;
      if (where === 'centerX') return { ...t, x: String(Math.round(COLLAGE_W / 2)) };
      if (where === 'left') return { ...t, x: '0' };
      if (where === 'right') return { ...t, x: String(COLLAGE_W) };
      if (where === 'top') return { ...t, y: '80' };
      return { ...t, y: String(COLLAGE_H - 80) };
    }));
  };

  const colorPickerValue = colorPickerTargetKey
    ? (createTextLayers.find((t) => t.key === colorPickerTargetKey)?.color ?? '#FFFFFF')
    : '#FFFFFF';

  // 作成フォームのライブプレビュー（400msデバウンス）
  useEffect(() => {
    if (step !== 'create') return;
    let alive = true;
    setCreateLivePreviewLoading(true);
    const timer = setTimeout(() => {
      const template: CollageTemplateAssets = {
        backgroundUrl: createBackgroundUrl ?? undefined,
        photoAreas: createPhotoAreas.map((a) => ({
          x: Number(a.x) || 0, y: Number(a.y) || 0, w: Number(a.w) || 100, h: Number(a.h) || 100,
        })),
        textLayers: createTextLayers.map((t): CollageTextLayer => ({
          id: t.id, label: t.label || undefined, sampleText: t.sampleText,
          x: Number(t.x) || 0, y: Number(t.y) || 0, maxWidth: Number(t.maxWidth) || 900,
          align: t.align, fontSize: Number(t.fontSize) || 40, font: t.font, color: t.color,
          zIndex: COLLAGE_Z_BANDS.text,
        })),
      };
      composeTemplatePreview(template)
        .then((url) => { if (alive) setCreateLivePreviewUrl(url); })
        .catch(() => { if (alive) setCreateLivePreviewUrl(null); })
        .finally(() => { if (alive) setCreateLivePreviewLoading(false); });
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [step, createBackgroundUrl, createPhotoAreas, createTextLayers]);

  const handleSaveMyTemplate = async () => {
    if (!createName.trim()) { alertMsg('テンプレート名を入力してください'); return; }
    if (!createBackgroundUrl) { alertMsg('背景画像を選んでください'); return; }
    if (createPhotoAreas.length === 0) { alertMsg('写真エリアを1つ以上追加してください'); return; }
    setCreateSaving(true);
    try {
      await createMyCollageTemplate({
        name: createName.trim(),
        tags: createTags.split(',').map((s) => s.trim()).filter(Boolean),
        backgroundImageUrl: createBackgroundUrl,
        photoAreas: createPhotoAreas.map((a) => ({
          x: Number(a.x) || 0, y: Number(a.y) || 0, w: Number(a.w) || 100, h: Number(a.h) || 100,
        })),
        textLayers: createTextLayers.map((t) => ({
          id: t.id, label: t.label || undefined, sampleText: t.sampleText,
          x: Number(t.x) || 0, y: Number(t.y) || 0, maxWidth: Number(t.maxWidth) || 900,
          align: t.align, fontSize: Number(t.fontSize) || 40, font: t.font, color: t.color,
        })),
      });
      resetCreateForm();
      setStep('gallery');
      loadStyles();
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setCreateSaving(false);
    }
  };

  const handleDeleteMyTemplate = (tile: GalleryTile) => {
    const doDelete = async () => {
      try {
        await deleteCollageStyle(tile.id);
        loadStyles();
      } catch (e) {
        alertMsg('削除に失敗しました');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`「${tile.name}」を削除しますか？`)) doDelete();
    } else {
      Alert.alert('削除の確認', `「${tile.name}」を削除しますか？`, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const BackRow = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.backRow} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name="chevron-back" size={16} color={COLORS.textMuted} />
      <Text style={styles.backText}>{label}</Text>
    </TouchableOpacity>
  );

  const renderTileGrid = (tileList: GalleryTile[], options?: { onDelete?: (t: GalleryTile) => void }) => (
    <View style={styles.templateGrid}>
      {tileList.map((t) => (
        <View key={t.key} style={styles.templateCard}>
          <TouchableOpacity onPress={() => selectTile(t)} activeOpacity={0.85}>
            <View style={styles.templateThumbWrap}>
              {previews[t.key] ? (
                <Image source={{ uri: previews[t.key]! }} style={styles.templateThumb} resizeMode="cover" />
              ) : (
                <ActivityIndicator color={COLORS.textMuted} />
              )}
            </View>
          </TouchableOpacity>
          {options?.onDelete && (
            <TouchableOpacity style={styles.tileDeleteBtn} onPress={() => options.onDelete!(t)}>
              <Ionicons name="trash-outline" size={14} color="#fff" />
            </TouchableOpacity>
          )}
          <Text style={styles.templateName} numberOfLines={1}>{t.name}</Text>
        </View>
      ))}
    </View>
  );

  if (step === 'create') {
    return (
      <View style={styles.wrap}>
        <BackRow label="テンプレートを選び直す" onPress={() => setStep('gallery')} />
        <Text style={styles.templateTitle}>自分のテンプレートを作る</Text>

        <Text style={styles.label}>名前</Text>
        <TextInput
          style={styles.input}
          value={createName}
          onChangeText={setCreateName}
          placeholder="例: 自分用サンクス投稿"
          placeholderTextColor={COLORS.textMuted}
        />

        <Text style={styles.label}>タグ（検索用・カンマ区切り・任意）</Text>
        <TextInput
          style={styles.input}
          value={createTags}
          onChangeText={setCreateTags}
          placeholder="例: サンクス, 記念日"
          placeholderTextColor={COLORS.textMuted}
        />

        <Text style={styles.label}>背景画像（デザイン全体の完成画像。写真を差し込む場所もこの画像内に含めてください）</Text>
        <TouchableOpacity style={styles.bgPickBtn} onPress={pickBackgroundImage} disabled={createUploading} activeOpacity={0.85}>
          {createUploading ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : createBackgroundUrl ? (
            <Image source={{ uri: createBackgroundUrl }} style={styles.bgPickImg} resizeMode="cover" />
          ) : (
            <>
              <Ionicons name="image-outline" size={22} color={COLORS.textSecondary} />
              <Text style={styles.bgPickText}>画像を選ぶ</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.label}>写真エリア（写真を差し込む透明な窓。キャンバスは1080×1920pxです。ドラッグで移動、右下の丸をドラッグでサイズ変更できます）</Text>
        {createPhotoAreas.length > 0 && (
          <PositionCanvas
            backgroundUri={createBackgroundUrl}
            boxes={createPhotoAreas.map((a) => ({
              key: a.key, x: Number(a.x) || 0, y: Number(a.y) || 0, w: Number(a.w) || 100, h: Number(a.h) || 100,
            }))}
            onMove={movePhotoArea}
            onResize={resizePhotoArea}
          />
        )}
        {createPhotoAreas.map((a) => (
          <View key={a.key} style={styles.draftRow}>
            <View style={styles.numRow}>
              <TextInput style={styles.numInput} value={a.x} onChangeText={(v) => updatePhotoArea(a.key, { x: v })} placeholder="x" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
              <TextInput style={styles.numInput} value={a.y} onChangeText={(v) => updatePhotoArea(a.key, { y: v })} placeholder="y" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
              <TextInput style={styles.numInput} value={a.w} onChangeText={(v) => updatePhotoArea(a.key, { w: v })} placeholder="幅" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
              <TextInput style={styles.numInput} value={a.h} onChangeText={(v) => updatePhotoArea(a.key, { h: v })} placeholder="高さ" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
              <TouchableOpacity onPress={() => removePhotoArea(a.key)}>
                <Ionicons name="trash-outline" size={20} color={COLORS.error} />
              </TouchableOpacity>
            </View>
            <PositionToolRow
              onAlign={(where) => alignPhotoArea(a.key, where)}
              onDuplicate={() => duplicatePhotoArea(a.key)}
            />
          </View>
        ))}
        <TouchableOpacity style={styles.addRowBtn} onPress={addPhotoArea}>
          <Ionicons name="add" size={16} color={COLORS.primary} />
          <Text style={styles.addRowBtnText}>写真エリアを追加</Text>
        </TouchableOpacity>

        <Text style={styles.label}>テキストレイヤー（あとで編集したい文言。任意。ドラッグで移動できます）</Text>
        {createTextLayers.length > 0 && (
          <PositionCanvas
            backgroundUri={createBackgroundUrl}
            boxes={createTextLayers.map((t) => {
              const fontSize = Number(t.fontSize) || 40;
              return {
                key: t.key, x: Number(t.x) || 0, y: (Number(t.y) || 0) - fontSize,
                w: Number(t.maxWidth) || 300, h: fontSize * 1.4, color: '#3E8E6E',
              };
            })}
            onMove={(key, x, y) => {
              const fontSize = Number(createTextLayers.find((t) => t.key === key)?.fontSize) || 40;
              moveTextLayer(key, x, y + fontSize);
            }}
          />
        )}
        {createTextLayers.map((t) => (
          <View key={t.key} style={styles.draftRow}>
            <TextInput style={styles.input} value={t.label} onChangeText={(v) => updateTextLayer(t.key, { label: v })} placeholder="ラベル（例: 見出し）" placeholderTextColor={COLORS.textMuted} />
            <TextInput style={styles.input} value={t.sampleText} onChangeText={(v) => updateTextLayer(t.key, { sampleText: v })} placeholder="サンプル文言" placeholderTextColor={COLORS.textMuted} />
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
              <TouchableOpacity style={[styles.colorSwatch, { backgroundColor: t.color }]} onPress={() => setColorPickerTargetKey(t.key)} />
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
              {(['left', 'center', 'right'] as const).map((al) => (
                <TouchableOpacity key={al} style={[styles.chip, t.align === al && styles.chipActive]} onPress={() => updateTextLayer(t.key, { align: al })}>
                  <Text style={[styles.chipText, t.align === al && styles.chipTextActive]}>{al === 'left' ? '左揃え' : al === 'center' ? '中央揃え' : '右揃え'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <PositionToolRow
              onAlign={(where) => alignTextLayer(t.key, where)}
            />
          </View>
        ))}
        <TouchableOpacity style={styles.addRowBtn} onPress={addTextLayer}>
          <Ionicons name="add" size={16} color={COLORS.primary} />
          <Text style={styles.addRowBtnText}>テキストを追加</Text>
        </TouchableOpacity>

        <Text style={styles.label}>プレビュー</Text>
        <View style={styles.livePreviewWrap}>
          {createLivePreviewLoading ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : createLivePreviewUrl ? (
            <Image source={{ uri: createLivePreviewUrl }} style={styles.livePreviewImg} resizeMode="contain" />
          ) : (
            <Text style={styles.emptyText}>背景画像を選ぶとプレビューが表示されます</Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.genBtn, createSaving && styles.genBtnDisabled]}
          onPress={handleSaveMyTemplate}
          disabled={createSaving}
          activeOpacity={0.85}
        >
          {createSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.genBtnText}>保存する</Text>}
        </TouchableOpacity>

        <ColorPickerModal
          visible={!!colorPickerTargetKey}
          initialColor={colorPickerValue}
          onChange={(hex) => { if (colorPickerTargetKey) updateTextLayer(colorPickerTargetKey, { color: hex }); }}
          onClose={() => setColorPickerTargetKey(null)}
        />
      </View>
    );
  }

  if (step === 'edit' && selectedTile) {
    const textLayers = selectedTile.template.textLayers ?? [];

    return (
      <View style={styles.wrap}>
        <BackRow label="テンプレートを選び直す" onPress={() => setStep('gallery')} />
        <Text style={styles.templateTitle}>{selectedTile.name}</Text>

        <Text style={styles.label}>写真を選ぶ（{selectedTile.photoCount}枚）</Text>
        <View style={styles.photoGrid}>
          {Array.from({ length: selectedTile.photoCount }).map((_, i) => (
            <TouchableOpacity key={i} style={styles.photoSlot} onPress={() => pickPhoto(i)} activeOpacity={0.85}>
              {photos[i] ? (
                <Image source={{ uri: photos[i]! }} style={styles.photoThumb} resizeMode="cover" />
              ) : (
                <Ionicons name="image-outline" size={24} color={COLORS.textSecondary} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {textLayers.map((l) => (
          <View key={l.id}>
            <Text style={styles.label}>{l.label ?? l.id}</Text>
            <TextInput
              style={styles.input}
              value={textValues[l.id] ?? ''}
              onChangeText={(v) => setTextValues((p) => ({ ...p, [l.id]: v }))}
              placeholder={l.sampleText}
              placeholderTextColor={COLORS.textMuted}
            />
          </View>
        ))}

        <TouchableOpacity
          style={[styles.genBtn, !ready && styles.genBtnDisabled]}
          onPress={generatePreview}
          disabled={!ready || composing}
          activeOpacity={0.85}
        >
          {composing ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.genBtnText}>{ready ? 'プレビューを作る' : `あと${selectedTile.photoCount - filledCount}枚選んでください`}</Text>
          )}
        </TouchableOpacity>

        {finalPreview && (
          <View style={styles.previewWrap}>
            <Image source={{ uri: finalPreview }} style={styles.previewImg} resizeMode="contain" />
            <TouchableOpacity style={styles.useBtn} onPress={useThis} activeOpacity={0.85}>
              <Text style={styles.useBtnText}>この内容で進める ›</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>テンプレートを選ぶ</Text>
      <TextInput
        style={styles.input}
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="キーワードで検索（例: シンプル、3分割）"
        placeholderTextColor={COLORS.textMuted}
      />
      <ScrollTagRow tags={topTags} activeTag={activeTag} onSelect={setActiveTag} />

      <TouchableOpacity style={styles.createTemplateBtn} onPress={openCreate} activeOpacity={0.85}>
        <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
        <Text style={styles.createTemplateBtnText}>自分のテンプレートを作る</Text>
      </TouchableOpacity>

      {visibleMyTiles.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>自分のテンプレート</Text>
          {renderTileGrid(visibleMyTiles, { onDelete: handleDeleteMyTemplate })}
        </>
      )}

      {visiblePublicTiles.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>テンプレート</Text>
          {renderTileGrid(visiblePublicTiles)}
        </>
      )}

      {visibleMyTiles.length === 0 && visiblePublicTiles.length === 0 && (
        <Text style={styles.emptyText}>該当するテンプレートがありません</Text>
      )}
    </View>
  );
}

/** ギャラリー上部のタグ絞り込みチップ行（「すべて」＋頻出タグ上位16件） */
function ScrollTagRow({ tags, activeTag, onSelect }: { tags: string[]; activeTag: string | null; onSelect: (t: string | null) => void }) {
  return (
    <View style={styles.tagRow}>
      <TouchableOpacity style={[styles.tagChip, !activeTag && styles.tagChipActive]} onPress={() => onSelect(null)}>
        <Text style={[styles.tagChipText, !activeTag && styles.tagChipTextActive]}>すべて</Text>
      </TouchableOpacity>
      {tags.map((tag) => (
        <TouchableOpacity
          key={tag}
          style={[styles.tagChip, activeTag === tag && styles.tagChipActive]}
          onPress={() => onSelect(activeTag === tag ? null : tag)}
        >
          <Text style={[styles.tagChipText, activeTag === tag && styles.tagChipTextActive]}>{tag}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: SPACING.xl },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700', marginTop: SPACING.md, marginBottom: SPACING.xs },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: SPACING.sm },
  backText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  templateTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800', marginBottom: SPACING.sm },
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800', marginTop: SPACING.lg, marginBottom: SPACING.sm },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm, marginBottom: SPACING.sm },
  tagChip: {
    paddingVertical: 6, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  tagChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tagChipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  tagChipTextActive: { color: '#fff' },
  createTemplateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: COLORS.primary, borderRadius: RADIUS.full,
    paddingVertical: SPACING.sm, marginTop: SPACING.xs, marginBottom: SPACING.sm,
  },
  createTemplateBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  templateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  templateCard: { width: 140, alignItems: 'center' },
  templateThumbWrap: {
    width: 140,
    height: (140 * 1920) / 1080,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  templateThumb: { width: '100%', height: '100%' },
  templateName: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 6, textAlign: 'center', maxWidth: 140 },
  tileDeleteBtn: {
    position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: SPACING.lg },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  photoSlot: {
    width: 90,
    height: 90,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoThumb: { width: '100%', height: '100%' },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  bgPickBtn: {
    width: 140, height: (140 * 1920) / 1080, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', gap: SPACING.xs,
  },
  bgPickImg: { width: '100%', height: '100%' },
  bgPickText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  draftRow: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.sm, marginBottom: SPACING.sm, gap: SPACING.xs,
  },
  numRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexWrap: 'wrap' },
  numInput: {
    width: 64, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.xs, paddingVertical: 6, color: COLORS.text, backgroundColor: COLORS.background, fontSize: 12,
  },
  addRowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    paddingVertical: SPACING.xs, marginBottom: SPACING.sm,
  },
  addRowBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.full,
    backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  livePreviewWrap: {
    width: 180, height: (180 * 1920) / 1080, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: SPACING.sm,
  },
  livePreviewImg: { width: '100%', height: '100%' },
  genBtn: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  genBtnDisabled: { opacity: 0.5 },
  genBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  previewWrap: { marginTop: SPACING.lg, alignItems: 'center' },
  previewImg: { width: 260, height: (260 * 1920) / 1080, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  useBtn: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  useBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

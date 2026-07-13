// コラージュテンプレートの「写真エリア・テキストレイヤー・装飾画像」の配置を
// 1画面で編集する共通コンポーネント（管理画面・自分専用テンプレート作成フォームの両方で使う）。
// 下タブの追加ボタンで要素を足し、キャンバス上でタップ選択・ドラッグで移動し、
// 選択中の要素のパラメータだけを上に表示する（要素が増えても画面が縦に伸び続けない）。
// キャンバス・パラメータパネルはどちらもスクロール不要で画面内に収まるようレイアウトし、
// メニューボタンから全レイヤーの一覧（選択・削除）を開けるようにしている。
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, TextInput, ActivityIndicator, Platform, Alert, Modal, ScrollView, LayoutChangeEvent,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import { COLLAGE_FONT_PRESETS, COLLAGE_W, COLLAGE_H, COLLAGE_Z_BANDS } from '../utils/collageCompositor';
import { uploadBlob } from '../services/storage';
import ColorPickerModal from './ColorPickerModal';
import PositionToolRow from './PositionToolRow';
import PositionCanvas, { PositionCanvasBox } from './PositionCanvas';

export interface PhotoAreaDraft {
  key: string;
  x: string; y: string; w: string; h: string;
}
export interface TextLayerDraft {
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
export interface DecorationDraft {
  key: string;
  imageUrl: string | null;
  uploading: boolean;
  x: string; y: string; w: string; h: string;
}

let draftKeySeq = 0;
const nextDraftKey = () => `tpe-${draftKeySeq++}`;

export function newPhotoAreaDraft(): PhotoAreaDraft {
  return { key: nextDraftKey(), x: '48', y: '200', w: '984', h: '760' };
}
export function newTextLayerDraft(n: number): TextLayerDraft {
  return {
    key: nextDraftKey(), id: `text_${n}`, label: '', sampleText: '',
    x: '100', y: '200', maxWidth: '600', fontSize: '40', color: '#FFFFFF',
    font: COLLAGE_FONT_PRESETS[0].id, align: 'left',
    lineHeight: '1.25', letterSpacing: '0', maxLines: '3', rotation: '0', zIndex: String(COLLAGE_Z_BANDS.text),
  };
}
export function newDecorationDraft(): DecorationDraft {
  return { key: nextDraftKey(), imageUrl: null, uploading: false, x: '400', y: '800', w: '200', h: '200' };
}

type LayerType = 'photo' | 'text' | 'decoration';
type Selected = { type: LayerType; key: string } | null;
type AlignWhere = 'centerX' | 'left' | 'right' | 'top' | 'bottom';

const LAYER_ICON: Record<LayerType, keyof typeof Ionicons.glyphMap> = {
  photo: 'square-outline',
  decoration: 'image-outline',
  text: 'text-outline',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  backgroundUri?: string | null;
  photoAreas: PhotoAreaDraft[];
  onPhotoAreasChange: (v: PhotoAreaDraft[]) => void;
  textLayers: TextLayerDraft[];
  onTextLayersChange: (v: TextLayerDraft[]) => void;
  decorations: DecorationDraft[];
  onDecorationsChange: (v: DecorationDraft[]) => void;
}

export default function TemplatePositionEditor({
  visible, onClose, backgroundUri,
  photoAreas, onPhotoAreasChange,
  textLayers, onTextLayersChange,
  decorations, onDecorationsChange,
}: Props) {
  const [selected, setSelected] = useState<Selected>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [canvasArea, setCanvasArea] = useState({ width: 0, height: 0 });

  // pickDecorationImage()は画像選択待ちで長時間非同期処理が続くため、その間に
  // 追加された装飾要素を含む最新のdecorationsをrefで参照する（PanResponderの
  // クロージャ固定不具合と同じ理由。propsの古いクロージャのままpatchを当てると、
  // 選択直後に追加した要素そのものが消えてしまう）
  const decorationsLatest = useRef(decorations);
  useEffect(() => { decorationsLatest.current = decorations; });

  const alertMsg = (msg: string) => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert('お知らせ', msg);
  };

  // ==== 写真エリア（枠） ====
  const addPhotoArea = () => {
    const draft = newPhotoAreaDraft();
    onPhotoAreasChange([...photoAreas, draft]);
    setSelected({ type: 'photo', key: draft.key });
  };
  const updatePhotoArea = (key: string, patch: Partial<PhotoAreaDraft>) => {
    onPhotoAreasChange(photoAreas.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  };
  const removePhotoArea = (key: string) => {
    onPhotoAreasChange(photoAreas.filter((a) => a.key !== key));
    setSelected((s) => (s?.key === key ? null : s));
  };
  const movePhotoArea = (key: string, x: number, y: number) => updatePhotoArea(key, { x: String(Math.round(x)), y: String(Math.round(y)) });
  const resizePhotoArea = (key: string, w: number, h: number) => updatePhotoArea(key, { w: String(Math.round(w)), h: String(Math.round(h)) });
  const alignPhotoArea = (key: string, where: AlignWhere) => {
    const a = photoAreas.find((x) => x.key === key);
    if (!a) return;
    const w = Number(a.w) || 0, h = Number(a.h) || 0;
    if (where === 'centerX') updatePhotoArea(key, { x: String(Math.round((COLLAGE_W - w) / 2)) });
    else if (where === 'left') updatePhotoArea(key, { x: '0' });
    else if (where === 'right') updatePhotoArea(key, { x: String(COLLAGE_W - w) });
    else if (where === 'top') updatePhotoArea(key, { y: '0' });
    else updatePhotoArea(key, { y: String(COLLAGE_H - h) });
  };
  const duplicatePhotoArea = (key: string) => {
    const idx = photoAreas.findIndex((a) => a.key === key);
    if (idx === -1) return;
    const src = photoAreas[idx];
    const copy: PhotoAreaDraft = { ...src, key: nextDraftKey(), x: String((Number(src.x) || 0) + 20), y: String((Number(src.y) || 0) + 20) };
    onPhotoAreasChange([...photoAreas.slice(0, idx + 1), copy, ...photoAreas.slice(idx + 1)]);
    setSelected({ type: 'photo', key: copy.key });
  };

  // ==== テキストレイヤー ====
  const addTextLayer = () => {
    const draft = newTextLayerDraft(textLayers.length + 1);
    onTextLayersChange([...textLayers, draft]);
    setSelected({ type: 'text', key: draft.key });
  };
  const updateTextLayer = (key: string, patch: Partial<TextLayerDraft>) => {
    onTextLayersChange(textLayers.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  };
  const removeTextLayer = (key: string) => {
    onTextLayersChange(textLayers.filter((t) => t.key !== key));
    setSelected((s) => (s?.key === key ? null : s));
  };
  const moveTextLayer = (key: string, x: number, y: number) => updateTextLayer(key, { x: String(Math.round(x)), y: String(Math.round(y)) });
  // テキストは矩形の幅・高さそのものではなく、最大幅と文字サイズとして保持しているため、
  // リサイズ操作（ハンドルドラッグ・2本指ピンチ）で来たw/hをそちらに変換する
  const resizeTextLayer = (key: string, w: number, h: number) => {
    updateTextLayer(key, { maxWidth: String(Math.round(w)), fontSize: String(Math.max(8, Math.round(h / 1.4))) });
  };
  const alignTextLayer = (key: string, where: AlignWhere) => {
    if (where === 'centerX') updateTextLayer(key, { x: String(Math.round(COLLAGE_W / 2)) });
    else if (where === 'left') updateTextLayer(key, { x: '0' });
    else if (where === 'right') updateTextLayer(key, { x: String(COLLAGE_W) });
    else if (where === 'top') updateTextLayer(key, { y: '80' });
    else updateTextLayer(key, { y: String(COLLAGE_H - 80) });
  };
  const duplicateTextLayer = (key: string) => {
    const idx = textLayers.findIndex((t) => t.key === key);
    if (idx === -1) return;
    const src = textLayers[idx];
    const copy: TextLayerDraft = { ...src, key: nextDraftKey(), id: `${src.id}_copy${draftKeySeq}`, y: String((Number(src.y) || 0) + 40) };
    onTextLayersChange([...textLayers.slice(0, idx + 1), copy, ...textLayers.slice(idx + 1)]);
    setSelected({ type: 'text', key: copy.key });
  };

  // ==== 装飾画像（写真） ====
  const pickDecorationImage = async (key: string) => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { alertMsg('写真へのアクセスを許可してください'); return; }
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.95 });
    if (res.canceled) return;
    onDecorationsChange(decorationsRef(key, { uploading: true }));
    try {
      const blob = await (await fetch(res.assets[0].uri)).blob();
      const url = await uploadBlob(blob);
      onDecorationsChange(decorationsRef(key, { imageUrl: url, uploading: false }));
    } catch (e) {
      onDecorationsChange(decorationsRef(key, { uploading: false }));
      alertMsg(e instanceof Error ? e.message : '画像のアップロードに失敗しました');
    }
  };
  // 直近のdecorations配列に対してpatchを当てる（非同期アップロード中の古いクロージャ対策のため、
  // 呼び出しごとに現在のdecorationsから作り直す）
  const decorationsRef = (key: string, patch: Partial<DecorationDraft>) =>
    decorationsLatest.current.map((d) => (d.key === key ? { ...d, ...patch } : d));

  const addDecoration = () => {
    const draft = newDecorationDraft();
    onDecorationsChange([...decorations, draft]);
    setSelected({ type: 'decoration', key: draft.key });
    pickDecorationImage(draft.key);
  };
  const updateDecoration = (key: string, patch: Partial<DecorationDraft>) => {
    onDecorationsChange(decorations.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };
  const removeDecoration = (key: string) => {
    onDecorationsChange(decorations.filter((d) => d.key !== key));
    setSelected((s) => (s?.key === key ? null : s));
  };
  const moveDecoration = (key: string, x: number, y: number) => updateDecoration(key, { x: String(Math.round(x)), y: String(Math.round(y)) });
  const resizeDecoration = (key: string, w: number, h: number) => updateDecoration(key, { w: String(Math.round(w)), h: String(Math.round(h)) });
  const alignDecoration = (key: string, where: AlignWhere) => {
    const d = decorations.find((x) => x.key === key);
    if (!d) return;
    const w = Number(d.w) || 0, h = Number(d.h) || 0;
    if (where === 'centerX') updateDecoration(key, { x: String(Math.round((COLLAGE_W - w) / 2)) });
    else if (where === 'left') updateDecoration(key, { x: '0' });
    else if (where === 'right') updateDecoration(key, { x: String(COLLAGE_W - w) });
    else if (where === 'top') updateDecoration(key, { y: '0' });
    else updateDecoration(key, { y: String(COLLAGE_H - h) });
  };
  const duplicateDecoration = (key: string) => {
    const idx = decorations.findIndex((d) => d.key === key);
    if (idx === -1) return;
    const src = decorations[idx];
    const copy: DecorationDraft = { ...src, key: nextDraftKey(), x: String((Number(src.x) || 0) + 20), y: String((Number(src.y) || 0) + 20) };
    onDecorationsChange([...decorations.slice(0, idx + 1), copy, ...decorations.slice(idx + 1)]);
    setSelected({ type: 'decoration', key: copy.key });
  };

  // ==== レイヤー一覧（メニューから選択・削除するための統合リスト） ====
  const layersList = [
    ...photoAreas.map((a, i) => ({ type: 'photo' as const, key: a.key, title: `写真エリア ${i + 1}` })),
    ...decorations.map((d, i) => ({ type: 'decoration' as const, key: d.key, title: `写真(装飾) ${i + 1}` })),
    ...textLayers.map((t, i) => ({ type: 'text' as const, key: t.key, title: t.label || t.sampleText || `テキスト ${i + 1}` })),
  ];
  const selectLayer = (type: LayerType, key: string) => {
    setSelected({ type, key });
    setMenuOpen(false);
  };
  const removeLayer = (type: LayerType, key: string) => {
    if (type === 'photo') removePhotoArea(key);
    else if (type === 'decoration') removeDecoration(key);
    else removeTextLayer(key);
  };

  // ==== キャンバス（すべての要素を重ねて表示） ====
  const canvasBoxes: PositionCanvasBox[] = [
    ...photoAreas.map((a): PositionCanvasBox => ({
      key: a.key, x: Number(a.x) || 0, y: Number(a.y) || 0, w: Number(a.w) || 100, h: Number(a.h) || 100,
      color: COLORS.primary, resizable: true, selected: selected?.type === 'photo' && selected.key === a.key,
    })),
    ...decorations.map((d): PositionCanvasBox => ({
      key: d.key, x: Number(d.x) || 0, y: Number(d.y) || 0, w: Number(d.w) || 100, h: Number(d.h) || 100,
      color: '#4A90D9', resizable: true, selected: selected?.type === 'decoration' && selected.key === d.key,
    })),
    ...textLayers.map((t): PositionCanvasBox => {
      const fontSize = Number(t.fontSize) || 40;
      return {
        key: t.key, x: Number(t.x) || 0, y: (Number(t.y) || 0) - fontSize,
        w: Number(t.maxWidth) || 300, h: fontSize * 1.4,
        color: '#3E8E6E', resizable: true, selected: selected?.type === 'text' && selected.key === t.key,
        previewText: t.sampleText || t.label || 'テキスト',
        previewTextColor: t.color,
        previewFontSize: fontSize,
        previewAlign: t.align,
      };
    }),
  ];

  const handleCanvasMove = (key: string, x: number, y: number) => {
    if (photoAreas.some((a) => a.key === key)) return movePhotoArea(key, x, y);
    if (decorations.some((d) => d.key === key)) return moveDecoration(key, x, y);
    const textLayer = textLayers.find((t) => t.key === key);
    if (textLayer) {
      const fontSize = Number(textLayer.fontSize) || 40;
      moveTextLayer(key, x, y + fontSize);
    }
  };
  const handleCanvasResize = (key: string, w: number, h: number) => {
    if (photoAreas.some((a) => a.key === key)) return resizePhotoArea(key, w, h);
    if (decorations.some((d) => d.key === key)) return resizeDecoration(key, w, h);
    if (textLayers.some((t) => t.key === key)) return resizeTextLayer(key, w, h);
  };
  const handleCanvasSelect = (key: string) => {
    if (photoAreas.some((a) => a.key === key)) return setSelected({ type: 'photo', key });
    if (decorations.some((d) => d.key === key)) return setSelected({ type: 'decoration', key });
    if (textLayers.some((t) => t.key === key)) return setSelected({ type: 'text', key });
  };

  const selectedPhoto = selected?.type === 'photo' ? photoAreas.find((a) => a.key === selected.key) : undefined;
  const selectedText = selected?.type === 'text' ? textLayers.find((t) => t.key === selected.key) : undefined;
  const selectedDecoration = selected?.type === 'decoration' ? decorations.find((d) => d.key === selected.key) : undefined;

  const onCanvasAreaLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setCanvasArea({ width, height });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setMenuOpen(true)} style={styles.menuBtn}>
            <Ionicons name="menu-outline" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>配置を編集</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="checkmark" size={20} color="#fff" />
            <Text style={styles.closeBtnText}>完了</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.canvasWrap} onLayout={onCanvasAreaLayout}>
          {canvasArea.width > 0 && (
            <PositionCanvas
              backgroundUri={backgroundUri}
              maxWidth={canvasArea.width - SPACING.md * 2}
              maxHeight={canvasArea.height - SPACING.md * 2}
              boxes={canvasBoxes}
              onMove={handleCanvasMove}
              onResize={handleCanvasResize}
              onSelect={handleCanvasSelect}
            />
          )}
        </View>

        <View style={styles.panelWrap}>
          {selectedPhoto && (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>写真エリア（枠）</Text>
              <View style={styles.numRow}>
                <TextInput style={styles.numInput} value={selectedPhoto.x} onChangeText={(v) => updatePhotoArea(selectedPhoto.key, { x: v })} placeholder="x" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                <TextInput style={styles.numInput} value={selectedPhoto.y} onChangeText={(v) => updatePhotoArea(selectedPhoto.key, { y: v })} placeholder="y" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                <TextInput style={styles.numInput} value={selectedPhoto.w} onChangeText={(v) => updatePhotoArea(selectedPhoto.key, { w: v })} placeholder="幅" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                <TextInput style={styles.numInput} value={selectedPhoto.h} onChangeText={(v) => updatePhotoArea(selectedPhoto.key, { h: v })} placeholder="高さ" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                <TouchableOpacity onPress={() => removePhotoArea(selectedPhoto.key)}>
                  <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                </TouchableOpacity>
              </View>
              <PositionToolRow onAlign={(w) => alignPhotoArea(selectedPhoto.key, w)} onDuplicate={() => duplicatePhotoArea(selectedPhoto.key)} />
            </View>
          )}

          {selectedDecoration && (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>写真（装飾画像）</Text>
              <View style={styles.decorationRow}>
                <TouchableOpacity style={styles.decorationImgBtn} onPress={() => pickDecorationImage(selectedDecoration.key)} disabled={selectedDecoration.uploading}>
                  {selectedDecoration.uploading ? (
                    <ActivityIndicator color={COLORS.primary} />
                  ) : selectedDecoration.imageUrl ? (
                    <Image source={{ uri: selectedDecoration.imageUrl }} style={styles.decorationImgPreview} resizeMode="contain" />
                  ) : (
                    <Text style={styles.chipText}>画像を選ぶ</Text>
                  )}
                </TouchableOpacity>
                <View style={styles.numRow}>
                  <TextInput style={styles.numInput} value={selectedDecoration.x} onChangeText={(v) => updateDecoration(selectedDecoration.key, { x: v })} placeholder="x" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                  <TextInput style={styles.numInput} value={selectedDecoration.y} onChangeText={(v) => updateDecoration(selectedDecoration.key, { y: v })} placeholder="y" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                  <TextInput style={styles.numInput} value={selectedDecoration.w} onChangeText={(v) => updateDecoration(selectedDecoration.key, { w: v })} placeholder="幅" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                  <TextInput style={styles.numInput} value={selectedDecoration.h} onChangeText={(v) => updateDecoration(selectedDecoration.key, { h: v })} placeholder="高さ" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                  <TouchableOpacity onPress={() => removeDecoration(selectedDecoration.key)}>
                    <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              </View>
              <PositionToolRow onAlign={(w) => alignDecoration(selectedDecoration.key, w)} onDuplicate={() => duplicateDecoration(selectedDecoration.key)} />
            </View>
          )}

          {selectedText && (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>テキストレイヤー</Text>
              <View style={styles.numRow}>
                <TextInput style={[styles.input, { flex: 1 }]} value={selectedText.label} onChangeText={(v) => updateTextLayer(selectedText.key, { label: v })} placeholder="ラベル" placeholderTextColor={COLORS.textMuted} />
                <TextInput style={[styles.input, { flex: 1 }]} value={selectedText.sampleText} onChangeText={(v) => updateTextLayer(selectedText.key, { sampleText: v })} placeholder="サンプル文言" placeholderTextColor={COLORS.textMuted} />
              </View>
              <View style={styles.numRow}>
                <TextInput style={styles.numInput} value={selectedText.x} onChangeText={(v) => updateTextLayer(selectedText.key, { x: v })} placeholder="x" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                <TextInput style={styles.numInput} value={selectedText.y} onChangeText={(v) => updateTextLayer(selectedText.key, { y: v })} placeholder="y" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                <TextInput style={styles.numInput} value={selectedText.maxWidth} onChangeText={(v) => updateTextLayer(selectedText.key, { maxWidth: v })} placeholder="最大幅" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                <TextInput style={styles.numInput} value={selectedText.fontSize} onChangeText={(v) => updateTextLayer(selectedText.key, { fontSize: v })} placeholder="文字サイズ" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                <TouchableOpacity onPress={() => removeTextLayer(selectedText.key)}>
                  <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                </TouchableOpacity>
              </View>
              <View style={styles.colorRow}>
                <TouchableOpacity style={[styles.colorSwatch, { backgroundColor: selectedText.color }]} onPress={() => setColorPickerOpen(true)} />
                <TextInput style={[styles.input, { width: 90 }]} value={selectedText.color} onChangeText={(v) => updateTextLayer(selectedText.key, { color: v })} placeholder="#FFFFFF" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" autoCorrect={false} />
                <Text style={styles.smallLabel}>回転</Text>
                <TextInput style={styles.numInput} value={selectedText.rotation} onChangeText={(v) => updateTextLayer(selectedText.key, { rotation: v })} placeholder="0" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                <Text style={styles.smallLabel}>順</Text>
                <TextInput style={styles.numInput} value={selectedText.zIndex} onChangeText={(v) => updateTextLayer(selectedText.key, { zIndex: v })} placeholder="zIndex" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {COLLAGE_FONT_PRESETS.map((f) => (
                  <TouchableOpacity key={f.id} style={[styles.chip, selectedText.font === f.id && styles.chipActive]} onPress={() => updateTextLayer(selectedText.key, { font: f.id })}>
                    <Text style={[styles.chipText, selectedText.font === f.id && styles.chipTextActive]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
                <View style={styles.chipDivider} />
                {(['left', 'center', 'right'] as const).map((al) => (
                  <TouchableOpacity key={al} style={[styles.chip, selectedText.align === al && styles.chipActive]} onPress={() => updateTextLayer(selectedText.key, { align: al })}>
                    <Text style={[styles.chipText, selectedText.align === al && styles.chipTextActive]}>{al === 'left' ? '左' : al === 'center' ? '中央' : '右'}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.numRow}>
                <Text style={styles.smallLabel}>行間</Text>
                <TextInput style={styles.numInput} value={selectedText.lineHeight} onChangeText={(v) => updateTextLayer(selectedText.key, { lineHeight: v })} placeholder="1.25" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                <Text style={styles.smallLabel}>字間</Text>
                <TextInput style={styles.numInput} value={selectedText.letterSpacing} onChangeText={(v) => updateTextLayer(selectedText.key, { letterSpacing: v })} placeholder="0" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
                <Text style={styles.smallLabel}>最大行数</Text>
                <TextInput style={styles.numInput} value={selectedText.maxLines} onChangeText={(v) => updateTextLayer(selectedText.key, { maxLines: v })} placeholder="3" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
              </View>
              <PositionToolRow onAlign={(w) => alignTextLayer(selectedText.key, w)} onDuplicate={() => duplicateTextLayer(selectedText.key)} />
            </View>
          )}

          {!selected && (
            <Text style={styles.emptyHint}>下のボタンから要素を追加するか、メニューかキャンバス上の要素をタップして選択してください</Text>
          )}
        </View>

        <View style={styles.bottomTabBar}>
          <TouchableOpacity style={styles.bottomTabBtn} onPress={addTextLayer}>
            <Ionicons name="text-outline" size={20} color={COLORS.text} />
            <Text style={styles.bottomTabBtnText}>テキスト追加</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomTabBtn} onPress={addPhotoArea}>
            <Ionicons name="square-outline" size={20} color={COLORS.text} />
            <Text style={styles.bottomTabBtnText}>枠追加</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bottomTabBtn} onPress={addDecoration}>
            <Ionicons name="image-outline" size={20} color={COLORS.text} />
            <Text style={styles.bottomTabBtnText}>写真追加</Text>
          </TouchableOpacity>
        </View>

        {selectedText && (
          <ColorPickerModal
            visible={colorPickerOpen}
            initialColor={selectedText.color}
            onChange={(hex) => updateTextLayer(selectedText.key, { color: hex })}
            onClose={() => setColorPickerOpen(false)}
          />
        )}

        <Modal visible={menuOpen} animationType="fade" transparent onRequestClose={() => setMenuOpen(false)}>
          <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
            <TouchableOpacity style={styles.menuPanel} activeOpacity={1} onPress={() => {}}>
              <Text style={styles.menuPanelTitle}>レイヤー</Text>
              <ScrollView style={styles.menuList}>
                {layersList.length === 0 && <Text style={styles.emptyHint}>まだ要素がありません</Text>}
                {layersList.map((item) => {
                  const isSelected = selected?.type === item.type && selected.key === item.key;
                  return (
                    <TouchableOpacity
                      key={item.key}
                      style={[styles.menuRow, isSelected && styles.menuRowActive]}
                      onPress={() => selectLayer(item.type, item.key)}
                    >
                      <Ionicons name={LAYER_ICON[item.type]} size={16} color={isSelected ? COLORS.primary : COLORS.textSecondary} />
                      <Text style={[styles.menuRowText, isSelected && styles.menuRowTextActive]} numberOfLines={1}>{item.title}</Text>
                      <TouchableOpacity onPress={() => removeLayer(item.type, item.key)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="trash-outline" size={16} color={COLORS.error} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  menuBtn: { padding: SPACING.xs },
  headerTitle: { flex: 1, textAlign: 'center', color: COLORS.text, fontWeight: '800', fontSize: 15 },
  closeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs,
  },
  closeBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  canvasWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  panelWrap: { paddingHorizontal: SPACING.md },
  panel: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.sm, gap: SPACING.xs,
  },
  panelTitle: { color: COLORS.text, fontWeight: '800', fontSize: 13, marginBottom: 2 },
  emptyHint: { color: COLORS.textMuted, textAlign: 'center', marginTop: SPACING.md, fontSize: 13 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm, paddingVertical: 6, color: COLORS.text, backgroundColor: COLORS.background, fontSize: 13,
  },
  numRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexWrap: 'wrap' },
  numInput: {
    width: 56, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.xs, paddingVertical: 6, color: COLORS.text, backgroundColor: COLORS.background, fontSize: 12,
  },
  smallLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexWrap: 'wrap' },
  colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  chipDivider: { width: 1, alignSelf: 'stretch', backgroundColor: COLORS.border, marginHorizontal: 2 },
  chip: {
    paddingHorizontal: SPACING.sm, paddingVertical: 6, borderRadius: RADIUS.full,
    backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  decorationRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start' },
  decorationImgBtn: {
    width: 64, height: 64, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  decorationImgPreview: { width: '100%', height: '100%' },
  bottomTabBar: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  bottomTabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.sm, gap: 2 },
  bottomTabBtnText: { color: COLORS.text, fontSize: 11, fontWeight: '700' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  menuPanel: {
    position: 'absolute', top: 0, bottom: 0, left: 0, width: '78%', maxWidth: 320,
    backgroundColor: COLORS.surface, paddingTop: SPACING.xxl, paddingHorizontal: SPACING.md,
  },
  menuPanelTitle: { color: COLORS.text, fontWeight: '800', fontSize: 16, marginBottom: SPACING.sm },
  menuList: { flex: 1 },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  menuRowActive: { backgroundColor: 'rgba(225,48,108,0.08)' },
  menuRowText: { flex: 1, color: COLORS.text, fontSize: 13, fontWeight: '600' },
  menuRowTextActive: { color: COLORS.primary },
});

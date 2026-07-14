// コラージュテンプレートの「写真エリア・テキストレイヤー・装飾画像」の配置を
// 1画面で編集する共通コンポーネント（管理画面・自分専用テンプレート作成フォームの両方で使う）。
// 下タブの追加ボタンで要素を足し、キャンバス上でタップ選択・ドラッグで移動し、
// 選択中の要素のパラメータだけを上に表示する（要素が増えても画面が縦に伸び続けない）。
// キャンバス・パラメータパネルはどちらもスクロール不要で画面内に収まるようレイアウトし、
// メニューボタンから全レイヤーの一覧（選択・削除）を開けるようにしている。
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, TextInput, ActivityIndicator, Platform, Alert, Modal, ScrollView, LayoutChangeEvent,
  PanResponder,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import { COLLAGE_FONT_PRESETS, COLLAGE_W, COLLAGE_H, COLLAGE_Z_BANDS, ensureFontLink } from '../utils/collageCompositor';
import { uploadBlob } from '../services/storage';
import ColorPickerModal from './ColorPickerModal';
import PositionToolRow from './PositionToolRow';
import PositionCanvas, { PositionCanvasBox } from './PositionCanvas';

export interface PhotoAreaDraft {
  key: string;
  x: string; y: string; w: string; h: string;
  /** 描画順（昇順）。レイヤーメニューでのドラッグ並び替えで決まる */
  zIndex: string;
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
  /** 描画順（昇順）。レイヤーメニューでのドラッグ並び替えで決まる */
  zIndex: string;
}

let draftKeySeq = 0;
const nextDraftKey = () => `tpe-${draftKeySeq++}`;

// 追加直後のプレビューサイズは、要素の種類によって印象が大きく変わらないよう
// 幅・高さ（テキストは折り返し幅）をすべて揃えている（NEW_ELEMENT_SIZE基準・中央寄せ）
const NEW_ELEMENT_SIZE = 500;
const NEW_ELEMENT_X = Math.round((COLLAGE_W - NEW_ELEMENT_SIZE) / 2);
const NEW_ELEMENT_Y = Math.round((COLLAGE_H - NEW_ELEMENT_SIZE) / 2);
// レイヤーメニューの行の高さ（ドラッグ時、指の移動量からどの行の位置まで動かしたかを
// 割り出すための基準値として使うので、行ごとに高さが変わらないよう固定にしている）
const MENU_ROW_HEIGHT = 44;

export function newPhotoAreaDraft(): PhotoAreaDraft {
  return {
    key: nextDraftKey(), x: String(NEW_ELEMENT_X), y: String(NEW_ELEMENT_Y), w: String(NEW_ELEMENT_SIZE), h: String(NEW_ELEMENT_SIZE),
    zIndex: String(COLLAGE_Z_BANDS.photos),
  };
}
export function newTextLayerDraft(n: number): TextLayerDraft {
  const fontSize = 80;
  return {
    key: nextDraftKey(), id: `text_${n}`, label: '', sampleText: '',
    // yはテキストのベースライン。ボックスの見た目の上端(y - fontSize)が他の要素と揃うようにする
    x: String(NEW_ELEMENT_X), y: String(NEW_ELEMENT_Y + fontSize), maxWidth: String(NEW_ELEMENT_SIZE), fontSize: String(fontSize), color: '#FFFFFF',
    font: COLLAGE_FONT_PRESETS[0].id, align: 'left',
    lineHeight: '1.25', letterSpacing: '0', maxLines: '3', rotation: '0', zIndex: String(COLLAGE_Z_BANDS.text),
  };
}
export function newDecorationDraft(): DecorationDraft {
  return {
    key: nextDraftKey(), imageUrl: null, uploading: false, x: String(NEW_ELEMENT_X), y: String(NEW_ELEMENT_Y), w: String(NEW_ELEMENT_SIZE), h: String(NEW_ELEMENT_SIZE),
    zIndex: String(COLLAGE_Z_BANDS.decoration),
  };
}

type LayerType = 'photo' | 'text' | 'decoration';
type Selected = { type: LayerType; key: string } | null;
type AlignWhere = 'centerX' | 'left' | 'right' | 'top' | 'bottom';

const LAYER_ICON: Record<LayerType, keyof typeof Ionicons.glyphMap> = {
  photo: 'square-outline',
  decoration: 'image-outline',
  text: 'text-outline',
};

/** 「サイズ」欄の数値入力＋上下ボタン（キーボード入力なしでも1タップで増減できるようにする） */
function SizeField({ value, onFocus, onChangeText, onStepUp, onStepDown }: {
  value: string;
  onFocus?: () => void;
  onChangeText: (v: string) => void;
  onStepUp: () => void;
  onStepDown: () => void;
}) {
  return (
    <View style={styles.sizeFieldRow}>
      <TextInput
        style={styles.numInput}
        value={value}
        onFocus={onFocus}
        onChangeText={onChangeText}
        placeholder="サイズ"
        keyboardType="numeric"
        placeholderTextColor={COLORS.textMuted}
      />
      <View style={styles.stepperCol}>
        <TouchableOpacity style={styles.stepperBtn} onPress={onStepUp} hitSlop={{ top: 4, bottom: 1, left: 4, right: 4 }}>
          <Ionicons name="caret-up" size={11} color={COLORS.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.stepperBtn} onPress={onStepDown} hitSlop={{ top: 1, bottom: 4, left: 4, right: 4 }}>
          <Ionicons name="caret-down" size={11} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** レイヤー一覧の1行。左端の並び替えハンドルを指でドラッグすると重なり順を変更できる
 *  （タップでの選択・ゴミ箱での削除と競合しないよう、ドラッグ操作はハンドル部分だけに絞っている） */
function DraggableMenuRow({
  icon, title, isSelected, isDragging, dragY, onSelect, onRemove, onDragMove, onDragEnd,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  isSelected: boolean;
  isDragging: boolean;
  dragY: number;
  onSelect: () => void;
  onRemove: () => void;
  onDragMove: (dy: number) => void;
  onDragEnd: (dy: number) => void;
}) {
  // PanResponderは初回生成時のクロージャに固定されるため、最新のコールバックは
  // refで参照する（PositionCanvas.tsxのDraggableBoxと同じパターン）
  const onDragMoveRef = useRef(onDragMove);
  const onDragEndRef = useRef(onDragEnd);
  useEffect(() => { onDragMoveRef.current = onDragMove; onDragEndRef.current = onDragEnd; });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => onDragMoveRef.current(0),
      onPanResponderMove: (_evt, gesture) => onDragMoveRef.current(gesture.dy),
      onPanResponderRelease: (_evt, gesture) => onDragEndRef.current(gesture.dy),
      onPanResponderTerminate: (_evt, gesture) => onDragEndRef.current(gesture.dy),
    })
  ).current;

  return (
    <View
      style={[
        styles.layerMenuRow,
        isDragging && styles.layerMenuRowDragging,
        isDragging && { transform: [{ translateY: dragY }] },
      ]}
    >
      <TouchableOpacity
        style={[styles.layerMenuRowTouchable, isSelected && styles.menuRowActive]}
        onPress={onSelect}
        activeOpacity={0.7}
      >
        <View style={styles.dragHandle} pointerEvents="none">
          <Ionicons name="reorder-three-outline" size={18} color={COLORS.textMuted} />
        </View>
        <Ionicons name={icon} size={16} color={isSelected ? COLORS.primary : COLORS.textSecondary} />
        <Text style={[styles.menuRowText, isSelected && styles.menuRowTextActive]} numberOfLines={1}>{title}</Text>
        <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="trash-outline" size={16} color={COLORS.error} />
        </TouchableOpacity>
      </TouchableOpacity>
      {/* ドラッグ用のタッチ領域は行のTouchableOpacityの兄弟として絶対配置する。ネストした
          PanResponder同士はWeb上でタッチの取り合いが不安定になり、親（タップ選択）側へ
          横取りされることがあるため（PositionCanvas.tsxのResizeHandleと同じ理由・パターン）。 */}
      <View {...panResponder.panHandlers} style={styles.dragHandleOverlay} />
    </View>
  );
}

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
  // レイヤーメニューでの並び替えドラッグ中の状態（ドラッグ中の行のインデックスと移動量）
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [canvasArea, setCanvasArea] = useState({ width: 0, height: 0 });
  // パラメータパネルの高さは要素の種類（写真エリア／装飾画像／テキスト）ごとに項目数が
  // 違うため、素直に中身の高さに合わせるとキャンバスの残り高さ・つまり縮尺が選択中の
  // 要素によって変わってしまい、同じサイズの値でもプレビュー上の見た目の大きさが
  // 一致しなくなる。そこでパネル領域の高さは「これまでに表示した中で一番背の高い
  // パネル」に固定し、キャンバスの縮尺を常に一定に保つ。
  const [panelHeight, setPanelHeight] = useState(280);
  const onPanelLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    setPanelHeight((prev) => Math.max(prev, h));
  };

  // フォント選択メニューでプルダウンを開いた瞬間に選択肢の文字がそのフォントで
  // プレビュー表示されるよう、候補全件のWebフォントを先読みしておく
  useEffect(() => {
    COLLAGE_FONT_PRESETS.forEach((preset) => ensureFontLink(preset));
  }, []);

  // pickDecorationImage()は画像選択待ちで長時間非同期処理が続くため、その間に
  // 追加された装飾要素を含む最新のdecorationsをrefで参照する（PanResponderの
  // クロージャ固定不具合と同じ理由。propsの古いクロージャのままpatchを当てると、
  // 選択直後に追加した要素そのものが消えてしまう）
  const decorationsLatest = useRef(decorations);
  useEffect(() => { decorationsLatest.current = decorations; });

  // 追加ボタンで足したばかりで一切編集していない要素のkeyを覚えておき、別の追加ボタンが
  // 押された時点でまだ手つかずなら自動的に削除する（下タブを連打して試しただけの空要素が
  // 溜まり続けるのを防ぐ）。いずれかのプロパティを変更した時点でmarkTouchedして対象から外す。
  const untouchedRef = useRef<{ type: LayerType; key: string } | null>(null);
  const markTouched = (key: string) => {
    if (untouchedRef.current?.key === key) untouchedRef.current = null;
  };
  const discardUntouched = () => {
    const u = untouchedRef.current;
    untouchedRef.current = null;
    if (!u) return;
    if (u.type === 'photo') removePhotoArea(u.key);
    else if (u.type === 'decoration') removeDecoration(u.key);
    else removeTextLayer(u.key);
  };

  const alertMsg = (msg: string) => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert('お知らせ', msg);
  };

  // ==== 写真エリア（枠） ====
  const addPhotoArea = () => {
    discardUntouched();
    const draft = newPhotoAreaDraft();
    onPhotoAreasChange([...photoAreas, draft]);
    setSelected({ type: 'photo', key: draft.key });
    untouchedRef.current = { type: 'photo', key: draft.key };
  };
  const updatePhotoArea = (key: string, patch: Partial<PhotoAreaDraft>) => {
    markTouched(key);
    onPhotoAreasChange(photoAreas.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  };
  const removePhotoArea = (key: string) => {
    markTouched(key);
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
  // 「サイズ」欄はエクセルの文字サイズのように、1つの数値を上げるだけで矩形全体が
  // 大きくなるようにする（幅の値として表示し、高さは編集開始時点の縦横比を保って追従させる）。
  // 縦横比は入力にフォーカスした瞬間の値を基準にする（キー入力のたびに現在値から
  // 比率を取り直すと、1桁ずつ入力する間に誤差が積み重なってしまうため）。
  const photoSizeAspect = useRef(1);
  const handlePhotoSizeFocus = (key: string) => {
    const a = photoAreas.find((x) => x.key === key);
    if (!a) return;
    const w = Number(a.w) || 100, h = Number(a.h) || 100;
    photoSizeAspect.current = h > 0 ? w / h : 1;
  };
  const handlePhotoSizeChange = (key: string, v: string) => {
    const newW = Number(v) || 0;
    const newH = photoSizeAspect.current > 0 ? newW / photoSizeAspect.current : newW;
    updatePhotoArea(key, { w: v, h: String(Math.round(newH)) });
  };
  const PHOTO_SIZE_STEP = 20;
  const stepPhotoSize = (key: string, delta: number) => {
    handlePhotoSizeFocus(key);
    const a = photoAreas.find((x) => x.key === key);
    if (!a) return;
    const newW = Math.max(20, (Number(a.w) || 0) + delta);
    handlePhotoSizeChange(key, String(newW));
  };

  // ==== テキストレイヤー ====
  const addTextLayer = () => {
    discardUntouched();
    const draft = newTextLayerDraft(textLayers.length + 1);
    onTextLayersChange([...textLayers, draft]);
    setSelected({ type: 'text', key: draft.key });
    untouchedRef.current = { type: 'text', key: draft.key };
  };
  const updateTextLayer = (key: string, patch: Partial<TextLayerDraft>) => {
    markTouched(key);
    onTextLayersChange(textLayers.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  };
  const removeTextLayer = (key: string) => {
    markTouched(key);
    onTextLayersChange(textLayers.filter((t) => t.key !== key));
    setSelected((s) => (s?.key === key ? null : s));
  };
  const moveTextLayer = (key: string, x: number, y: number) => updateTextLayer(key, { x: String(Math.round(x)), y: String(Math.round(y)) });
  // キャンバス上での枠のリサイズ（ハンドルドラッグ・2本指ピンチ）は、一般的なテキストエリアの
  // リサイズと同じく幅(maxWidth)と高さ(表示行数=maxLines)を変える。文字サイズ自体は
  // 「サイズ」欄（数値入力・上下ボタン）でのみ変更する——枠を広げるたびに文字まで拡大されると
  // 意図せずレイアウトが崩れるため、分離している。
  const resizeTextLayer = (key: string, w: number, h: number) => {
    const t = textLayers.find((x) => x.key === key);
    const fontSize = Number(t?.fontSize) || 80;
    const lineHeightMul = Number(t?.lineHeight) || 1.25;
    const newMaxLines = Math.max(1, Math.round(h / (fontSize * lineHeightMul)));
    updateTextLayer(key, { maxWidth: String(Math.round(w)), maxLines: String(newMaxLines) });
  };
  const TEXT_SIZE_STEP = 2;
  const stepTextFontSize = (key: string, delta: number) => {
    const t = textLayers.find((x) => x.key === key);
    if (!t) return;
    const newSize = Math.max(8, (Number(t.fontSize) || 80) + delta);
    updateTextLayer(key, { fontSize: String(newSize) });
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
    const copy: TextLayerDraft = { ...src, key: nextDraftKey(), id: `${src.id}_copy${draftKeySeq}`, y: String((Number(src.y) || 0) + 80) };
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
    markTouched(key);
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
    discardUntouched();
    const draft = newDecorationDraft();
    onDecorationsChange([...decorations, draft]);
    setSelected({ type: 'decoration', key: draft.key });
    untouchedRef.current = { type: 'decoration', key: draft.key };
    pickDecorationImage(draft.key);
  };
  const updateDecoration = (key: string, patch: Partial<DecorationDraft>) => {
    markTouched(key);
    onDecorationsChange(decorations.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };
  const removeDecoration = (key: string) => {
    markTouched(key);
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
  // 写真エリアと同じ「サイズ」欄（幅の値・高さは縦横比を保って追従）
  const decorationSizeAspect = useRef(1);
  const handleDecorationSizeFocus = (key: string) => {
    const d = decorations.find((x) => x.key === key);
    if (!d) return;
    const w = Number(d.w) || 100, h = Number(d.h) || 100;
    decorationSizeAspect.current = h > 0 ? w / h : 1;
  };
  const handleDecorationSizeChange = (key: string, v: string) => {
    const newW = Number(v) || 0;
    const newH = decorationSizeAspect.current > 0 ? newW / decorationSizeAspect.current : newW;
    updateDecoration(key, { w: v, h: String(Math.round(newH)) });
  };
  const stepDecorationSize = (key: string, delta: number) => {
    handleDecorationSizeFocus(key);
    const d = decorations.find((x) => x.key === key);
    if (!d) return;
    const newW = Math.max(20, (Number(d.w) || 0) + delta);
    handleDecorationSizeChange(key, String(newW));
  };

  // ==== レイヤー一覧（メニューから選択・削除・並び替えするための統合リスト） ====
  // zIndexの降順（前面が先頭）に並べる。メニュー上でドラッグして並び替えると、その並び順
  // からzIndexを振り直すので、メニューの表示順とキャンバス上の重なり順は常に一致する。
  const layersList = [
    ...photoAreas.map((a, i) => ({ type: 'photo' as const, key: a.key, title: `写真エリア ${i + 1}`, zIndex: Number(a.zIndex) || COLLAGE_Z_BANDS.photos })),
    ...decorations.map((d, i) => ({ type: 'decoration' as const, key: d.key, title: `写真(装飾) ${i + 1}`, zIndex: Number(d.zIndex) || COLLAGE_Z_BANDS.decoration })),
    ...textLayers.map((t, i) => ({ type: 'text' as const, key: t.key, title: t.label || t.sampleText || `テキスト ${i + 1}`, zIndex: Number(t.zIndex) || COLLAGE_Z_BANDS.text })),
  ].sort((a, b) => b.zIndex - a.zIndex);
  const selectLayer = (type: LayerType, key: string) => {
    setSelected({ type, key });
    setMenuOpen(false);
  };
  const removeLayer = (type: LayerType, key: string) => {
    if (type === 'photo') removePhotoArea(key);
    else if (type === 'decoration') removeDecoration(key);
    else removeTextLayer(key);
  };
  // レイヤーメニュー上でのドラッグ並び替え。新しい並び順（先頭=最前面）に沿って
  // 全レイヤーのzIndexを振り直す。写真エリア・装飾画像・テキストのどれでも統一的に扱える。
  const reorderLayers = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const list = [...layersList];
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    const n = list.length;
    list.forEach((item, i) => {
      const z = String((n - i) * 10);
      if (item.type === 'photo') updatePhotoArea(item.key, { zIndex: z });
      else if (item.type === 'decoration') updateDecoration(item.key, { zIndex: z });
      else updateTextLayer(item.key, { zIndex: z });
    });
  };
  const handleRowDragMove = (index: number, dy: number) => {
    setDragIndex(index);
    setDragY(dy);
  };
  const handleRowDragEnd = (index: number, dy: number) => {
    const target = Math.max(0, Math.min(layersList.length - 1, index + Math.round(dy / MENU_ROW_HEIGHT)));
    reorderLayers(index, target);
    setDragIndex(null);
    setDragY(0);
  };

  // ==== キャンバス（すべての要素をzIndex昇順=背面から前面の順に重ねて表示） ====
  // レイヤーメニューでの並び替え結果（zIndex）がキャンバス上の見た目にも反映されるよう、
  // 描画直前にzIndex昇順でソートする（配列の後ろほど上に重なって描画されるため）。
  const zSortedBoxes: { z: number; box: PositionCanvasBox }[] = [
    ...photoAreas.map((a) => ({
      z: Number(a.zIndex) || COLLAGE_Z_BANDS.photos,
      box: {
        key: a.key, x: Number(a.x) || 0, y: Number(a.y) || 0, w: Number(a.w) || 100, h: Number(a.h) || 100,
        color: COLORS.primary, resizable: true, selected: selected?.type === 'photo' && selected.key === a.key,
      } as PositionCanvasBox,
    })),
    ...decorations.map((d) => ({
      z: Number(d.zIndex) || COLLAGE_Z_BANDS.decoration,
      box: {
        key: d.key, x: Number(d.x) || 0, y: Number(d.y) || 0, w: Number(d.w) || 100, h: Number(d.h) || 100,
        color: '#4A90D9', resizable: true, selected: selected?.type === 'decoration' && selected.key === d.key,
      } as PositionCanvasBox,
    })),
    ...textLayers.map((t) => {
      const fontSize = Number(t.fontSize) || 80;
      const lineHeightMul = Number(t.lineHeight) || 1.25;
      const maxLines = Math.max(1, Number(t.maxLines) || 3);
      const fontPreset = COLLAGE_FONT_PRESETS.find((f) => f.id === t.font) ?? COLLAGE_FONT_PRESETS[0];
      return {
        z: Number(t.zIndex) || COLLAGE_Z_BANDS.text,
        box: {
          key: t.key, x: Number(t.x) || 0, y: (Number(t.y) || 0) - fontSize,
          w: Number(t.maxWidth) || 300, h: fontSize * lineHeightMul * maxLines,
          color: '#3E8E6E', resizable: true, selected: selected?.type === 'text' && selected.key === t.key,
          previewText: t.sampleText || t.label || 'テキスト',
          previewTextColor: t.color,
          previewFontSize: fontSize,
          previewAlign: t.align,
          previewFontFamily: fontPreset.family,
          previewFontWeight: fontPreset.weight,
        } as PositionCanvasBox,
      };
    }),
  ];
  const canvasBoxes: PositionCanvasBox[] = [...zSortedBoxes].sort((a, b) => a.z - b.z).map((x) => x.box);

  const handleCanvasMove = (key: string, x: number, y: number) => {
    if (photoAreas.some((a) => a.key === key)) return movePhotoArea(key, x, y);
    if (decorations.some((d) => d.key === key)) return moveDecoration(key, x, y);
    const textLayer = textLayers.find((t) => t.key === key);
    if (textLayer) {
      const fontSize = Number(textLayer.fontSize) || 80;
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

        <View style={[styles.panelWrap, { height: panelHeight }]}>
          {selectedPhoto && (
            <View style={styles.panel} onLayout={onPanelLayout}>
              <Text style={styles.panelTitle}>写真エリア（枠）</Text>
              <View style={styles.numRow}>
                <Text style={styles.smallLabel}>サイズ</Text>
                <SizeField
                  value={selectedPhoto.w}
                  onFocus={() => handlePhotoSizeFocus(selectedPhoto.key)}
                  onChangeText={(v) => handlePhotoSizeChange(selectedPhoto.key, v)}
                  onStepUp={() => stepPhotoSize(selectedPhoto.key, PHOTO_SIZE_STEP)}
                  onStepDown={() => stepPhotoSize(selectedPhoto.key, -PHOTO_SIZE_STEP)}
                />
                <TouchableOpacity onPress={() => removePhotoArea(selectedPhoto.key)}>
                  <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                </TouchableOpacity>
              </View>
              <PositionToolRow onAlign={(w) => alignPhotoArea(selectedPhoto.key, w)} onDuplicate={() => duplicatePhotoArea(selectedPhoto.key)} />
            </View>
          )}

          {selectedDecoration && (
            <View style={styles.panel} onLayout={onPanelLayout}>
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
                  <Text style={styles.smallLabel}>サイズ</Text>
                  <SizeField
                    value={selectedDecoration.w}
                    onFocus={() => handleDecorationSizeFocus(selectedDecoration.key)}
                    onChangeText={(v) => handleDecorationSizeChange(selectedDecoration.key, v)}
                    onStepUp={() => stepDecorationSize(selectedDecoration.key, PHOTO_SIZE_STEP)}
                    onStepDown={() => stepDecorationSize(selectedDecoration.key, -PHOTO_SIZE_STEP)}
                  />
                  <TouchableOpacity onPress={() => removeDecoration(selectedDecoration.key)}>
                    <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              </View>
              <PositionToolRow onAlign={(w) => alignDecoration(selectedDecoration.key, w)} onDuplicate={() => duplicateDecoration(selectedDecoration.key)} />
            </View>
          )}

          {selectedText && (
            <View style={styles.panel} onLayout={onPanelLayout}>
              <Text style={styles.panelTitle}>テキストレイヤー</Text>
              <View style={styles.numRow}>
                <TextInput style={[styles.input, { flex: 1 }]} value={selectedText.label} onChangeText={(v) => updateTextLayer(selectedText.key, { label: v })} placeholder="ラベル" placeholderTextColor={COLORS.textMuted} />
                <TextInput style={[styles.input, { flex: 1 }]} value={selectedText.sampleText} onChangeText={(v) => updateTextLayer(selectedText.key, { sampleText: v })} placeholder="サンプル文言" placeholderTextColor={COLORS.textMuted} />
              </View>
              <View style={styles.numRow}>
                <Text style={styles.smallLabel}>サイズ</Text>
                <SizeField
                  value={selectedText.fontSize}
                  onChangeText={(v) => updateTextLayer(selectedText.key, { fontSize: v })}
                  onStepUp={() => stepTextFontSize(selectedText.key, TEXT_SIZE_STEP)}
                  onStepDown={() => stepTextFontSize(selectedText.key, -TEXT_SIZE_STEP)}
                />
                <Text style={styles.smallLabel}>幅</Text>
                <TextInput style={styles.numInput} value={selectedText.maxWidth} onChangeText={(v) => updateTextLayer(selectedText.key, { maxWidth: v })} placeholder="幅" keyboardType="numeric" placeholderTextColor={COLORS.textMuted} />
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
              <View style={styles.numRow}>
                <TouchableOpacity style={styles.fontDropdownBtn} onPress={() => setFontPickerOpen(true)}>
                  <Text style={styles.fontDropdownBtnText} numberOfLines={1}>
                    {COLLAGE_FONT_PRESETS.find((f) => f.id === selectedText.font)?.label ?? 'フォントを選ぶ'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
                {(['left', 'center', 'right'] as const).map((al) => (
                  <TouchableOpacity key={al} style={[styles.chip, selectedText.align === al && styles.chipActive]} onPress={() => updateTextLayer(selectedText.key, { align: al })}>
                    <Text style={[styles.chipText, selectedText.align === al && styles.chipTextActive]}>{al === 'left' ? '左' : al === 'center' ? '中央' : '右'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
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

        {selectedText && (
          <Modal visible={fontPickerOpen} animationType="fade" transparent onRequestClose={() => setFontPickerOpen(false)}>
            <TouchableOpacity style={styles.fontOverlay} activeOpacity={1} onPress={() => setFontPickerOpen(false)}>
              <TouchableOpacity style={styles.fontCard} activeOpacity={1} onPress={() => {}}>
                <Text style={styles.fontCardTitle}>フォントを選ぶ</Text>
                <ScrollView style={styles.fontList}>
                  {COLLAGE_FONT_PRESETS.map((f) => {
                    const isSelected = selectedText.font === f.id;
                    return (
                      <TouchableOpacity
                        key={f.id}
                        style={[styles.menuRow, isSelected && styles.menuRowActive]}
                        onPress={() => { updateTextLayer(selectedText.key, { font: f.id }); setFontPickerOpen(false); }}
                      >
                        <Text
                          style={[styles.fontListRowText, { fontFamily: f.family, fontWeight: f.weight as any }, isSelected && styles.menuRowTextActive]}
                          numberOfLines={1}
                        >
                          {f.label}
                        </Text>
                        {isSelected && <Ionicons name="checkmark" size={16} color={COLORS.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        )}

        <Modal visible={menuOpen} animationType="fade" transparent onRequestClose={() => setMenuOpen(false)}>
          <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
            <TouchableOpacity style={styles.menuPanel} activeOpacity={1} onPress={() => {}}>
              <Text style={styles.menuPanelTitle}>レイヤー</Text>
              <Text style={styles.menuPanelHint}>左のハンドルをドラッグすると重なり順を変更できます</Text>
              <ScrollView style={styles.menuList} scrollEnabled={dragIndex === null}>
                {layersList.length === 0 && <Text style={styles.emptyHint}>まだ要素がありません</Text>}
                {layersList.map((item, index) => (
                  <DraggableMenuRow
                    key={item.key}
                    icon={LAYER_ICON[item.type]}
                    title={item.title}
                    isSelected={selected?.type === item.type && selected.key === item.key}
                    isDragging={dragIndex === index}
                    dragY={dragIndex === index ? dragY : 0}
                    onSelect={() => selectLayer(item.type, item.key)}
                    onRemove={() => removeLayer(item.type, item.key)}
                    onDragMove={(dy) => handleRowDragMove(index, dy)}
                    onDragEnd={(dy) => handleRowDragEnd(index, dy)}
                  />
                ))}
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
  sizeFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  stepperCol: { justifyContent: 'space-between', height: 26 },
  stepperBtn: {
    width: 18, height: 12, borderRadius: 3, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center',
  },
  smallLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexWrap: 'wrap' },
  colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border },
  chip: {
    paddingHorizontal: SPACING.sm, paddingVertical: 6, borderRadius: RADIUS.full,
    backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  fontDropdownBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4,
    paddingHorizontal: SPACING.sm, paddingVertical: 6, borderRadius: RADIUS.full,
    backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border,
  },
  fontDropdownBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  fontOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  fontCard: {
    width: '100%', maxWidth: 360, maxHeight: '75%', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg,
  },
  fontCardTitle: { color: COLORS.text, fontWeight: '800', fontSize: 16, marginBottom: SPACING.sm },
  fontList: { maxHeight: 420 },
  fontListRowText: { flex: 1, fontSize: 15, color: COLORS.text },
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
  menuPanelTitle: { color: COLORS.text, fontWeight: '800', fontSize: 16, marginBottom: 2 },
  menuPanelHint: { color: COLORS.textMuted, fontSize: 11, marginBottom: SPACING.sm },
  menuList: { flex: 1 },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  menuRowActive: { backgroundColor: 'rgba(225,48,108,0.08)' },
  menuRowText: { flex: 1, color: COLORS.text, fontSize: 13, fontWeight: '600' },
  menuRowTextActive: { color: COLORS.primary },
  layerMenuRow: {
    position: 'relative', height: MENU_ROW_HEIGHT, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  layerMenuRowDragging: {
    backgroundColor: COLORS.background, borderRadius: RADIUS.sm, borderBottomColor: 'transparent',
    zIndex: 10, elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  layerMenuRowTouchable: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, height: '100%',
  },
  dragHandle: { padding: 2 },
  dragHandleOverlay: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 32 },
});

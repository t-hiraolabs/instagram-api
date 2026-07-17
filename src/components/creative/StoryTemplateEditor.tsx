// 「ストーリー作成」エディター。Instagram本体のストーリー編集画面と同じ体験
// （1画面完結・スクロール無し・選択した要素のプロパティをその場で操作）を目指し、
// 別モーダルに逃がしていた文字編集・ステッカー選択・背景選択をすべて同一画面内の
// インラインパネルに統合した（2026-07-17）。写真 or 背景の上に、文字・絵文字
// ステッカーを乗せるだけのシンプルな機能で、Canva等の汎用デザインツールとは
// 競わず、Instagram標準のストーリー編集（フォント数少・ステッカー限定的）を
// フォント19種・ステッカー50種・背景12種で上回ることを狙う。
import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, Alert, Modal, ScrollView, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import ViewShot from 'react-native-view-shot';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { saveStoryDraft } from '../../services/storyStudioService';
import { useCreativeEditorStore, serializeCreativeEditor } from '../../store/creativeEditorStore';
import { TextLayer, TemplateLayer, CANVAS_W, CANVAS_H } from '../../types/creativeTemplate';
import { FONT_PRESETS } from '../../utils/fontPresets';
import { BACKGROUND_PRESETS } from '../../utils/backgroundPresets';
import { STICKER_CATEGORIES } from '../../utils/stickerPresets';
import CreativeCanvas from './CreativeCanvas';
import BackgroundPresetSvg from './BackgroundPresetSvg';

const PHOTO_SLOT_ID = 'photo_1';
const FULL_BLEED_SLOT = { id: PHOTO_SLOT_ID, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
const TEXT_COLOR_OPTIONS = ['#FFFFFF', '#000000', '#FF7A59', '#FFD36E', '#8B5FBF', '#38BDF8', '#3E8E6E', '#D6597A'];
const ALIGN_OPTIONS: { key: NonNullable<TextLayer['align']>; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'left', icon: 'menu-outline' }, { key: 'center', icon: 'reorder-two-outline' }, { key: 'right', icon: 'menu-outline' },
];

type Panel = 'none' | 'background' | 'sticker';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 完成した画像（PNG dataURL/URI）を渡す。呼び出し側でアップロード・投稿フローへ */
  onFinish: (dataUrl: string) => void;
}

export default function StoryTemplateEditor({ visible, onClose, onFinish }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [panel, setPanel] = useState<Panel>('none');
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [started, setStarted] = useState(false);

  const canvasShotRef = useRef<ViewShot>(null);

  const templateId = useCreativeEditorStore((s) => s.templateId);
  const photoSlots = useCreativeEditorStore((s) => s.photoSlots);
  const photoAssignments = useCreativeEditorStore((s) => s.photoAssignments);
  const layers = useCreativeEditorStore((s) => s.layers);
  const textLayers = useCreativeEditorStore((s) => s.textLayers);
  const selectedId = useCreativeEditorStore((s) => s.selectedId);
  const loadTemplate = useCreativeEditorStore((s) => s.loadTemplate);
  const reset = useCreativeEditorStore((s) => s.reset);
  const selectItem = useCreativeEditorStore((s) => s.selectItem);
  const setActiveSlot = useCreativeEditorStore((s) => s.setActiveSlot);
  const assignPhoto = useCreativeEditorStore((s) => s.assignPhoto);
  const updatePhotoAssignment = useCreativeEditorStore((s) => s.updatePhotoAssignment);
  const addTextLayer = useCreativeEditorStore((s) => s.addTextLayer);
  const updateTextLayer = useCreativeEditorStore((s) => s.updateTextLayer);
  const removeTextLayer = useCreativeEditorStore((s) => s.removeTextLayer);

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  // 開いたら常に写真スロット（空）から始める。写真を選ぶ・背景に切り替える・
  // 文字やステッカーを足す、をすべて同じ1画面上で行う（Instagramのストーリー
  // 作成と同じく、ギャラリー選択などの別ステップを挟まない）。
  if (visible && !started) {
    loadTemplate({ templateId: '', photoSlots: [FULL_BLEED_SLOT], layers: [], textLayers: [] });
    setStarted(true);
  }

  const close = () => {
    reset();
    setStarted(false);
    setPanel('none');
    onClose();
  };

  const pickPhoto = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { alertMsg('写真へのアクセスを許可してください', '権限エラー'); return; }
    }
    setPicking(true);
    // Web版のImagePickerは、ファイル選択ダイアログをキャンセルするとPromiseが
    // 解決されないまま残ることがある（既知の制約）。ウィンドウがフォーカスを
    // 取り戻してもファイルが来なければ、スピナーだけは強制的に止める
    // （実際の選択結果を待つ処理自体はそのまま継続するので、遅れて選択が
    // 完了しても問題なく反映される）。
    let clearSpinnerTimer: ReturnType<typeof setTimeout> | undefined;
    const onWindowFocus = () => {
      clearSpinnerTimer = setTimeout(() => setPicking(false), 800);
    };
    if (Platform.OS === 'web') window.addEventListener('focus', onWindowFocus);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      // 背景モードだった場合は解除し、写真スロットへ戻す（文字・ステッカーは維持）
      if (photoSlots.length === 0) {
        loadTemplate({ templateId: templateId || '', photoSlots: [FULL_BLEED_SLOT], layers: [], textLayers });
      }
      assignPhoto(PHOTO_SLOT_ID, asset.uri, asset.width || CANVAS_W, asset.height || CANVAS_H);
      setPanel('none');
    } finally {
      if (Platform.OS === 'web') {
        window.removeEventListener('focus', onWindowFocus);
        if (clearSpinnerTimer) clearTimeout(clearSpinnerTimer);
      }
      setPicking(false);
    }
  };

  const applyBackground = (presetId: string) => {
    const bgLayer: TemplateLayer = {
      id: 'bg', kind: 'background', band: 'background', uri: '', bgPresetId: presetId,
      x: 0, y: 0, w: CANVAS_W, h: CANVAS_H,
    };
    // 写真は使わないので写真スロットは空にする（文字・ステッカーは維持）
    loadTemplate({ templateId: templateId || '', photoSlots: [], layers: [bgLayer], textLayers });
    setPanel('none');
  };

  const selectBackground = (presetId: string) => {
    const hasPhoto = photoAssignments.length > 0;
    if (!hasPhoto) { applyBackground(presetId); return; }
    // 写真が選ばれている状態で背景を選ぶと写真が失われるため、必ず確認する
    const msg = '背景に変更すると、選択中の写真は使われなくなります。よろしいですか？';
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) applyBackground(presetId);
      return;
    }
    Alert.alert('確認', msg, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '背景に変更', style: 'destructive', onPress: () => applyBackground(presetId) },
    ]);
  };

  const selectedTextLayer = textLayers.find((t) => t.id === selectedId) as TextLayer | undefined;

  const handleAddTextLayer = () => {
    const layer: TextLayer = {
      id: `text_${Date.now()}`, text: '新しいテキスト',
      x: 120, y: 860, font: 'gothic', color: '#FFFFFF', size: 64, align: 'left',
      scale: 1, rotation: 0, visible: true,
    };
    addTextLayer(layer);
    setPanel('none');
  };

  const handleAddSticker = (emoji: string) => {
    const layer: TextLayer = {
      id: `sticker_${Date.now()}`, label: 'ステッカー', text: emoji,
      x: (CANVAS_W - 160) / 2, y: (CANVAS_H - 160) / 2, font: 'gothic', color: '#FFFFFF', size: 160,
      scale: 1, rotation: 0, visible: true,
    };
    addTextLayer(layer);
    setPanel('none');
  };

  const capture = async (): Promise<string | null> => {
    if (!canvasShotRef.current?.capture) return null;
    try {
      return await canvasShotRef.current.capture();
    } catch {
      alertMsg('画像の書き出しに失敗しました');
      return null;
    }
  };

  const filledCount = photoSlots.filter((s) => photoAssignments.some((a) => a.slotId === s.id)).length;
  const isBackgroundMode = photoSlots.length === 0 && layers.some((l) => l.kind === 'background');
  const canFinish = isBackgroundMode || (photoSlots.length > 0 && filledCount === photoSlots.length);

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      await saveStoryDraft({ templateId: templateId || undefined, layersJson: serializeCreativeEditor({ photoSlots, layers, textLayers }) });
      alertMsg('下書きに保存しました');
      close();
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setSaving(true);
    try {
      const uri = await capture();
      if (!uri) return;
      onFinish(uri);
      close();
    } finally {
      setSaving(false);
    }
  };

  // --- レイアウト計算: 縦スクロール無しで1画面に収まるよう、残り高さからキャンバス幅を逆算する。
  // プロパティパネル・ステッカー/背景ストリップはキャンバスの上に重ねて表示する（サイズを
  // 変えない）ため、この計算にパネルの有無は影響させない（常に同じ高さを確保しておく）。
  const TOPBAR_H = 48;
  const TOOLBAR_H = 56;
  const FINISH_H = 64;
  const reservedH = insets.top + insets.bottom + TOPBAR_H + TOOLBAR_H + FINISH_H + SPACING.md * 2;
  const availH = Math.max(200, winH - reservedH);
  const canvasWByHeight = availH * (CANVAS_W / CANVAS_H);
  const canvasW = Math.min(winW - SPACING.lg * 2, canvasWByHeight);
  const overlayActive = !!selectedTextLayer || panel !== 'none';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      {/* React NativeのModalはネイティブでは別ルートとして描画されるため、その中で
          react-native-gesture-handlerのジェスチャー（ピンチ・回転等）を確実に動かすには
          GestureHandlerRootViewをModalの中に別途置く必要がある */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[styles.modal, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={close}><Ionicons name="close" size={26} color={COLORS.text} /></TouchableOpacity>
          <Text style={styles.title}>ストーリーを作る</Text>
          <View style={{ width: 26 }} />
        </View>

        <View style={styles.canvasWrap}>
          <ViewShot ref={canvasShotRef} options={{ format: 'png', quality: 0.95, width: 1080, height: 1920 }}>
            <CreativeCanvas
              displayWidth={canvasW}
              photoSlots={photoSlots}
              layers={layers}
              textLayers={textLayers}
              photoAssignments={photoAssignments}
              selectedId={selectedId}
              onSelectSlot={setActiveSlot}
              onSlotChange={(slotId, patch) => updatePhotoAssignment(slotId, patch)}
              onPickPhoto={pickPhoto}
              onSelectText={selectItem}
              onTextChange={(id, patch) => updateTextLayer(id, patch)}
            />
          </ViewShot>

          {/* パネル表示中はキャンバスのサイズを変えず、少し暗くしてその上にパネルを重ねる */}
          {overlayActive && <View style={styles.dimOverlay} pointerEvents="none" />}

          {/* 選択中の文字・ステッカーのプロパティ（別モーダルではなく同一画面内、キャンバスの上に重ねて表示） */}
          {selectedTextLayer && (
            <View style={[styles.textPanel, styles.overlayPanel]}>
              <View style={styles.textPanelTopRow}>
                <TextInput
                  style={styles.textInput}
                  value={selectedTextLayer.text}
                  onChangeText={(text) => updateTextLayer(selectedTextLayer.id, { text })}
                  placeholder="文字を入力"
                  placeholderTextColor={COLORS.textMuted}
                />
                <TouchableOpacity onPress={() => { removeTextLayer(selectedTextLayer.id); }} hitSlop={8}>
                  <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => selectItem(null)} hitSlop={8}>
                  <Text style={styles.doneText}>完了</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {FONT_PRESETS.map((f) => (
                  <TouchableOpacity
                    key={f.id}
                    style={[styles.fontChip, selectedTextLayer.font === f.id && styles.chipActive]}
                    onPress={() => updateTextLayer(selectedTextLayer.id, { font: f.id })}
                  >
                    <Text style={[styles.fontChipText, { fontFamily: f.family }, selectedTextLayer.font === f.id && styles.chipTextActive]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.colorAlignRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {TEXT_COLOR_OPTIONS.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.swatch, { backgroundColor: c }, selectedTextLayer.color === c && styles.swatchActive]}
                      onPress={() => updateTextLayer(selectedTextLayer.id, { color: c })}
                    />
                  ))}
                </ScrollView>
                <View style={styles.alignRow}>
                  {ALIGN_OPTIONS.map((a) => (
                    <TouchableOpacity
                      key={a.key}
                      style={[styles.alignBtn, (selectedTextLayer.align ?? 'left') === a.key && styles.chipActive]}
                      onPress={() => updateTextLayer(selectedTextLayer.id, { align: a.key })}
                    >
                      <Ionicons name={a.icon} size={16} color={(selectedTextLayer.align ?? 'left') === a.key ? '#fff' : COLORS.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          )}

          {/* 背景プリセット・ステッカーのインライン選択パネル（別モーダルにせず、キャンバスの上に重ねて表示） */}
          {!selectedTextLayer && panel === 'background' && (
            <View style={[styles.stripPanel, styles.overlayPanel]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripContent}>
                {BACKGROUND_PRESETS.map((preset) => (
                  <TouchableOpacity key={preset.id} style={styles.bgSwatchItem} onPress={() => selectBackground(preset.id)} activeOpacity={0.85}>
                    <View style={styles.bgSwatch}>
                      <BackgroundPresetSvg preset={preset} width={44} height={78} />
                    </View>
                    <Text style={styles.bgSwatchLabel} numberOfLines={1}>{preset.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          {!selectedTextLayer && panel === 'sticker' && (
            <View style={[styles.stripPanel, styles.overlayPanel]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripContent}>
                {STICKER_CATEGORIES.flatMap((cat) => cat.emojis).map((emoji, i) => (
                  <TouchableOpacity key={`${emoji}_${i}`} style={styles.stickerItem} onPress={() => handleAddSticker(emoji)} activeOpacity={0.7}>
                    <Text style={styles.stickerEmoji}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* アイコンツールバー（常時同じ高さを確保。文字選択中はキャンバスサイズを変えないため空のまま） */}
        <View style={styles.toolbar}>
          {!selectedTextLayer && (
            <>
              <TouchableOpacity style={styles.toolBtn} onPress={pickPhoto} disabled={picking}>
                {picking ? <ActivityIndicator size="small" color={COLORS.text} /> : <Ionicons name="image-outline" size={22} color={COLORS.text} />}
                <Text style={styles.toolBtnText}>写真</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => setPanel((p) => (p === 'background' ? 'none' : 'background'))}>
                <Ionicons name="color-palette-outline" size={22} color={panel === 'background' ? COLORS.primary : COLORS.text} />
                <Text style={[styles.toolBtnText, panel === 'background' && styles.toolBtnTextActive]}>背景</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={handleAddTextLayer}>
                <Ionicons name="text-outline" size={22} color={COLORS.text} />
                <Text style={styles.toolBtnText}>文字</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => setPanel((p) => (p === 'sticker' ? 'none' : 'sticker'))}>
                <Ionicons name="happy-outline" size={22} color={panel === 'sticker' ? COLORS.primary : COLORS.text} />
                <Text style={[styles.toolBtnText, panel === 'sticker' && styles.toolBtnTextActive]}>ステッカー</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.finishRow}>
          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveDraft} disabled={saving} activeOpacity={0.85}>
            {saving ? <ActivityIndicator color={COLORS.text} /> : <Text style={styles.saveBtnText}>保存</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.publishBtn, !canFinish && styles.publishBtnDisabled]}
            onPress={handlePublish}
            disabled={saving || !canFinish}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishBtnText}>投稿する ›</Text>}
          </TouchableOpacity>
        </View>
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: COLORS.background },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  canvasWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dimOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  overlayPanel: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.surfaceElevated, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, borderBottomWidth: 0,
  },
  toolbar: {
    height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  toolBtn: { alignItems: 'center', gap: 2 },
  toolBtnText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
  toolBtnTextActive: { color: COLORS.primary },
  stripPanel: { height: 96, justifyContent: 'center' },
  stripContent: { alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md },
  bgSwatchItem: { alignItems: 'center', gap: 4 },
  bgSwatch: { width: 44, height: 78, borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  bgSwatchLabel: { color: COLORS.textMuted, fontSize: 9, maxWidth: 50, textAlign: 'center' },
  stickerItem: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  stickerEmoji: { fontSize: 24 },
  textPanel: { minHeight: 132, paddingVertical: SPACING.sm, gap: SPACING.xs },
  textPanelTopRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md },
  textInput: {
    flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm, paddingVertical: 6, color: COLORS.text, backgroundColor: COLORS.surface, fontSize: 14,
  },
  doneText: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
  chipRow: { gap: SPACING.sm, paddingHorizontal: SPACING.md },
  fontChip: { paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  fontChipText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipTextActive: { color: '#fff' },
  colorAlignRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: COLORS.border },
  swatchActive: { borderColor: COLORS.primary },
  alignRow: { flexDirection: 'row', gap: SPACING.xs, paddingRight: SPACING.md },
  alignBtn: { width: 30, height: 30, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  finishRow: {
    height: 64, flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.md, alignItems: 'center',
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  saveBtn: {
    flex: 1, alignItems: 'center', paddingVertical: SPACING.sm, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  saveBtnText: { color: COLORS.text, fontWeight: '800', fontSize: 14 },
  publishBtn: { flex: 1, alignItems: 'center', paddingVertical: SPACING.sm, borderRadius: RADIUS.full, backgroundColor: COLORS.primary },
  publishBtnDisabled: { opacity: 0.4 },
  publishBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});

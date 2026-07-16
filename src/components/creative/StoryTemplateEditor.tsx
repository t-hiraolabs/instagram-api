// 「ストーリー作成」エディター。テンプレートギャラリーは廃止し、Canva等の汎用デザイン
// ツールと競う方向はやめた（2026-07-16）。代わりにInstagram標準のストーリー編集機能を
// 上回るフォント数（19種）・素材（絵文字ステッカー・背景プリセット）を持つ、
// 「写真 or 背景 + 文字 + ステッカー」だけのシンプルな機能として拡充している。
// 単一フロー：①写真または背景を選ぶ→②文字・ステッカーを追加編集→③プレビュー→④保存/投稿。
// 描画はテンプレート方式の頃と同じCreativeCanvas＋creativeEditorStoreをそのまま流用する。
import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Platform, Alert, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import ViewShot from 'react-native-view-shot';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { saveStoryDraft } from '../../services/storyStudioService';
import { useCreativeEditorStore, serializeCreativeEditor } from '../../store/creativeEditorStore';
import { TextLayer, TemplateLayer, CANVAS_W, CANVAS_H } from '../../types/creativeTemplate';
import { BackgroundPreset } from '../../utils/backgroundPresets';
import CreativeCanvas from './CreativeCanvas';
import CreativeLayerListPanel from './CreativeLayerListPanel';
import TextStyleModal from './TextStyleModal';
import BackgroundPickerModal from './BackgroundPickerModal';
import StickerPickerModal from './StickerPickerModal';

type Step = 'pick' | 'edit';

const PHOTO_SLOT_ID = 'photo_1';
/** 写真1枚がキャンバス全面を覆うフルブリードスロット（テンプレート無し・常にこの1枚だけ） */
const FULL_BLEED_SLOT = { id: PHOTO_SLOT_ID, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 完成した画像（PNG dataURL/URI）を渡す。呼び出し側でアップロード・投稿フローへ */
  onFinish: (dataUrl: string) => void;
}

export default function StoryTemplateEditor({ visible, onClose, onFinish }: Props) {
  const [step, setStep] = useState<Step>('pick');
  const [previewMode, setPreviewMode] = useState(false);
  const [textEditVisible, setTextEditVisible] = useState(false);
  const [bgPickerVisible, setBgPickerVisible] = useState(false);
  const [stickerPickerVisible, setStickerPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const canvasShotRef = useRef<ViewShot>(null);

  const templateId = useCreativeEditorStore((s) => s.templateId);
  const photoSlots = useCreativeEditorStore((s) => s.photoSlots);
  const photoAssignments = useCreativeEditorStore((s) => s.photoAssignments);
  const layers = useCreativeEditorStore((s) => s.layers);
  const textLayers = useCreativeEditorStore((s) => s.textLayers);
  const selectedId = useCreativeEditorStore((s) => s.selectedId);
  const activeSlotId = useCreativeEditorStore((s) => s.activeSlotId);
  const loadTemplate = useCreativeEditorStore((s) => s.loadTemplate);
  const reset = useCreativeEditorStore((s) => s.reset);
  const selectItem = useCreativeEditorStore((s) => s.selectItem);
  const setActiveSlot = useCreativeEditorStore((s) => s.setActiveSlot);
  const assignPhoto = useCreativeEditorStore((s) => s.assignPhoto);
  const updatePhotoAssignment = useCreativeEditorStore((s) => s.updatePhotoAssignment);
  const swapPhotoAssignments = useCreativeEditorStore((s) => s.swapPhotoAssignments);
  const addTextLayer = useCreativeEditorStore((s) => s.addTextLayer);
  const updateTextLayer = useCreativeEditorStore((s) => s.updateTextLayer);
  const removeTextLayer = useCreativeEditorStore((s) => s.removeTextLayer);
  const toggleTextVisible = useCreativeEditorStore((s) => s.toggleTextVisible);
  const bringToFront = useCreativeEditorStore((s) => s.bringToFront);
  const sendToBack = useCreativeEditorStore((s) => s.sendToBack);

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  const close = () => {
    reset();
    setStep('pick');
    setPreviewMode(false);
    setTextEditVisible(false);
    onClose();
  };

  const pickPhotoForSlot = async (slotId: string) => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { alertMsg('写真へのアクセスを許可してください', '権限エラー'); return; }
    }
    setPicking(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      assignPhoto(slotId, asset.uri, asset.width || CANVAS_W, asset.height || CANVAS_H);
    } finally {
      setPicking(false);
    }
  };

  /** 最初の1枚を選ぶ。テンプレートは使わず、常にキャンバス全面のフルブリードスロット1つだけを持つ状態にする */
  const pickInitialPhoto = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { alertMsg('写真へのアクセスを許可してください', '権限エラー'); return; }
    }
    setPicking(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      loadTemplate({ templateId: '', photoSlots: [FULL_BLEED_SLOT], layers: [], textLayers: [] });
      assignPhoto(PHOTO_SLOT_ID, asset.uri, asset.width || CANVAS_W, asset.height || CANVAS_H);
      setPreviewMode(false);
      setStep('edit');
    } finally {
      setPicking(false);
    }
  };

  /** 写真を使わず、色・グラデーション・パターンだけの背景で始める */
  const handleSelectBackground = (preset: BackgroundPreset) => {
    const bgLayer: TemplateLayer = {
      id: 'bg', kind: 'background', band: 'background', uri: '', bgPresetId: preset.id,
      x: 0, y: 0, w: CANVAS_W, h: CANVAS_H,
    };
    loadTemplate({ templateId: '', photoSlots: [], layers: [bgLayer], textLayers: [] });
    setPreviewMode(false);
    setStep('edit');
  };

  const selectedTextLayer = textLayers.find((t) => t.id === selectedId) as TextLayer | undefined;

  const handleAddTextLayer = () => {
    const layer: TextLayer = {
      id: `text_${Date.now()}`, text: '新しいテキスト',
      x: 100, y: 900, font: 'gothic', color: '#FFFFFF', size: 64,
      scale: 1, rotation: 0, visible: true,
    };
    addTextLayer(layer);
    setTextEditVisible(true);
  };

  /** 絵文字ステッカーを追加する。画像素材を使わず既存のテキストレイヤーの仕組みで
   *  位置・拡大率・回転をそのまま操作できる（Instagram標準のステッカーより自由度が高い） */
  const handleAddSticker = (emoji: string) => {
    const layer: TextLayer = {
      id: `sticker_${Date.now()}`, label: 'ステッカー', text: emoji,
      x: (CANVAS_W - 160) / 2, y: (CANVAS_H - 160) / 2, font: 'gothic', color: '#FFFFFF', size: 160,
      scale: 1, rotation: 0, visible: true,
    };
    addTextLayer(layer);
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
  const allFilled = isBackgroundMode || (photoSlots.length > 0 && filledCount === photoSlots.length);

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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <TouchableOpacity onPress={close}><Text style={styles.cancel}>閉じる</Text></TouchableOpacity>
          <Text style={styles.title}>ストーリーを作る</Text>
          <View style={{ width: 48 }} />
        </View>

        {step === 'pick' && (
          <View style={styles.pickWrap}>
            <Ionicons name="image-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.pickTitle}>写真か背景を選んで、文字を入れましょう</Text>
            <Text style={styles.pickDesc}>Canvaなどで作った画像もそのまま使えます</Text>
            <TouchableOpacity style={styles.pickBtn} onPress={pickInitialPhoto} disabled={picking} activeOpacity={0.85}>
              {picking ? <ActivityIndicator color="#fff" /> : <Text style={styles.pickBtnText}>写真を選ぶ</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.pickBtnOutline} onPress={() => setBgPickerVisible(true)} activeOpacity={0.85}>
              <Text style={styles.pickBtnOutlineText}>背景を選ぶ（写真なし）</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'edit' && (
          <View style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.editScroll}>
              {photoSlots.length > 0 && (
                <TouchableOpacity onPress={() => pickPhotoForSlot(PHOTO_SLOT_ID)} activeOpacity={0.85}>
                  <Text style={styles.changePhotoText}>写真を変更する</Text>
                </TouchableOpacity>
              )}

              <ViewShot ref={canvasShotRef} options={{ format: 'png', quality: 0.95, width: 1080, height: 1920 }}>
                <CreativeCanvas
                  photoSlots={photoSlots}
                  layers={layers}
                  textLayers={textLayers}
                  photoAssignments={photoAssignments}
                  locked={previewMode}
                  selectedId={selectedId}
                  onSelectSlot={setActiveSlot}
                  onSlotChange={(slotId, patch) => updatePhotoAssignment(slotId, patch)}
                  onPickPhoto={pickPhotoForSlot}
                  onSelectText={selectItem}
                  onTextChange={(id, patch) => updateTextLayer(id, patch)}
                />
              </ViewShot>

              {!previewMode && (
                <>
                  <View style={styles.toolbar}>
                    <TouchableOpacity style={styles.toolBtn} onPress={handleAddTextLayer}>
                      <Ionicons name="text-outline" size={20} color={COLORS.text} />
                      <Text style={styles.toolBtnText}>文字を追加</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.toolBtn} onPress={() => setStickerPickerVisible(true)}>
                      <Ionicons name="happy-outline" size={20} color={COLORS.text} />
                      <Text style={styles.toolBtnText}>ステッカー</Text>
                    </TouchableOpacity>
                    {selectedTextLayer && (
                      <TouchableOpacity style={styles.toolBtn} onPress={() => setTextEditVisible(true)}>
                        <Ionicons name="create-outline" size={20} color={COLORS.text} />
                        <Text style={styles.toolBtnText}>文字を編集</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <CreativeLayerListPanel
                    photoSlots={photoSlots}
                    photoAssignments={photoAssignments}
                    layers={layers}
                    textLayers={textLayers}
                    selectedId={selectedId}
                    activeSlotId={activeSlotId}
                    onSelectSlot={setActiveSlot}
                    onSwapSlots={swapPhotoAssignments}
                    onSelectItem={selectItem}
                    onToggleTextVisible={toggleTextVisible}
                    onBringToFront={bringToFront}
                    onSendToBack={sendToBack}
                    onRemoveText={removeTextLayer}
                  />
                </>
              )}

              <TouchableOpacity
                style={styles.previewToggle}
                onPress={() => setPreviewMode((v) => !v)}
                activeOpacity={0.85}
              >
                <Ionicons name={previewMode ? 'create-outline' : 'eye-outline'} size={16} color={COLORS.primary} />
                <Text style={styles.previewToggleText}>{previewMode ? '編集に戻る' : 'プレビュー'}</Text>
              </TouchableOpacity>
            </ScrollView>

            <View style={styles.finishRow}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveDraft} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color={COLORS.text} /> : <Text style={styles.saveBtnText}>保存</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.publishBtn, !allFilled && styles.publishBtnDisabled]}
                onPress={handlePublish}
                disabled={saving || !allFilled}
                activeOpacity={0.85}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishBtnText}>投稿する ›</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TextStyleModal
          visible={textEditVisible}
          layer={selectedTextLayer ?? null}
          onClose={() => setTextEditVisible(false)}
          onChange={(patch) => selectedTextLayer && updateTextLayer(selectedTextLayer.id, patch)}
        />
        <BackgroundPickerModal
          visible={bgPickerVisible}
          onClose={() => setBgPickerVisible(false)}
          onSelect={handleSelectBackground}
        />
        <StickerPickerModal
          visible={stickerPickerVisible}
          onClose={() => setStickerPickerVisible(false)}
          onSelect={handleAddSticker}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  cancel: { color: COLORS.textMuted, fontSize: 15 },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  editScroll: { alignItems: 'center', paddingVertical: SPACING.md, paddingBottom: 120 },
  pickWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl, gap: SPACING.sm },
  pickTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginTop: SPACING.sm, textAlign: 'center' },
  pickDesc: { color: COLORS.textMuted, fontSize: 12.5, textAlign: 'center', marginBottom: SPACING.md },
  pickBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl, minWidth: 160, alignItems: 'center' },
  pickBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  pickBtnOutline: { borderRadius: RADIUS.full, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl, minWidth: 160, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  pickBtnOutlineText: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
  changePhotoText: { color: COLORS.primary, fontSize: 13, fontWeight: '700', marginBottom: SPACING.sm },
  toolbar: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
  toolBtn: { alignItems: 'center', gap: 2 },
  toolBtnText: { color: COLORS.textSecondary, fontSize: 11 },
  previewToggle: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.md,
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.primary,
  },
  previewToggleText: { color: COLORS.primary, fontSize: 13, fontWeight: '700' },
  finishRow: {
    flexDirection: 'row', gap: SPACING.sm, padding: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.background,
  },
  saveBtn: {
    flex: 1, alignItems: 'center', paddingVertical: SPACING.md, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  saveBtnText: { color: COLORS.text, fontWeight: '800', fontSize: 15 },
  publishBtn: { flex: 1, alignItems: 'center', paddingVertical: SPACING.md, borderRadius: RADIUS.full, backgroundColor: COLORS.primary },
  publishBtnDisabled: { opacity: 0.4 },
  publishBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});

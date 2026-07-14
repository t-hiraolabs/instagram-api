// 「ストーリー作成」統合エディター。旧StoryStudioScreen/CollageEditorを段階的に置き換える
// 単一フロー：①ギャラリー表示→②テンプレート選択→③必要写真枚数を表示→④写真を各スロットへ
// 設定→⑤位置と拡大率を調整→⑥テキストを編集→⑦プレビュー→⑧保存または投稿へ進む。
// 写真枚数（1枚 or 複数枚）で画面や描画方式を分けず、常にCreativeCanvas＋
// creativeEditorStoreの同じ経路を通す（統合の核心）。
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Platform, Alert, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import ViewShot from 'react-native-view-shot';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { Plan } from '../../utils/plans';
import { getMyPlan } from '../../services/scheduleService';
import { saveStoryDraft } from '../../services/storyStudioService';
import { useCreativeEditorStore, serializeCreativeEditor } from '../../store/creativeEditorStore';
import { TextLayer, CreativeTemplate } from '../../types/creativeTemplate';
import StoryGalleryScreen from './StoryGalleryScreen';
import CreativeCanvas from './CreativeCanvas';
import CreativeLayerListPanel from './CreativeLayerListPanel';
import TextStyleModal from './TextStyleModal';

type Step = 'gallery' | 'edit';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 完成した画像（PNG dataURL/URI）を渡す。呼び出し側でアップロード・投稿フローへ */
  onFinish: (dataUrl: string) => void;
}

export default function StoryTemplateEditor({ visible, onClose, onFinish }: Props) {
  const [step, setStep] = useState<Step>('gallery');
  const [plan, setPlan] = useState<Plan>('free');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [textEditVisible, setTextEditVisible] = useState(false);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    if (visible) getMyPlan().then(setPlan).catch(() => {});
  }, [visible]);

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  const close = () => {
    reset();
    setStep('gallery');
    setSelectedTemplateId(null);
    setPreviewMode(false);
    setTextEditVisible(false);
    onClose();
  };

  const handleSelectTemplate = (template: CreativeTemplate) => {
    setSelectedTemplateId(template.id);
    loadTemplate({
      templateId: template.id, photoSlots: template.photoSlots,
      layers: template.layers, textLayers: template.textLayers,
    });
    setPreviewMode(false);
    setStep('edit');
  };

  const pickPhotoForSlot = async (slotId: string) => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { alertMsg('写真へのアクセスを許可してください', '権限エラー'); return; }
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    assignPhoto(slotId, asset.uri, asset.width || 1080, asset.height || 1920);
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
  const allFilled = photoSlots.length > 0 && filledCount === photoSlots.length;

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      await saveStoryDraft({ templateId: templateId ?? undefined, layersJson: serializeCreativeEditor({ photoSlots, layers, textLayers }) });
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

        {step === 'gallery' && (
          <StoryGalleryScreen plan={plan} onSelectTemplate={handleSelectTemplate} />
        )}

        {step === 'edit' && (
          <View style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.editScroll}>
              <Text style={styles.slotHint}>
                写真{photoSlots.length}枚のテンプレートです（設定済み {filledCount}/{photoSlots.length}）
              </Text>

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
  slotHint: { color: COLORS.textSecondary, fontSize: 12, marginBottom: SPACING.sm, textAlign: 'center' },
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

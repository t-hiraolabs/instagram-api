// Story Studio: 写真を選ぶだけでInstagramストーリーを完成させる画面。
// ①写真選択 → ②AIおすすめ → ③編集 → ④保存/投稿する、の4ステップで構成。
import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, ScrollView,
  ActivityIndicator, Platform, Alert, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import ViewShot from 'react-native-view-shot';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { useAppStore } from '../../store/appStore';
import { useStoryEditorStore, TextLayer, serializeLayers } from '../../store/storyEditorStore';
import {
  rankTemplatesByTags, getAssetsByIds, recordRecentTemplate, getRecentTemplateIds,
  saveStoryDraft, StoryTemplate,
} from '../../services/storyStudioService';
import { recommendStoryTemplate } from '../../services/aiService';
import { getMyPlan } from '../../services/scheduleService';
import { Plan } from '../../utils/plans';
import StoryCanvas, { DISPLAY_W, DISPLAY_H, PREVIEW_DISPLAY_W } from './StoryCanvas';
import LayerListPanel from './LayerListPanel';
import AssetPickerModal from './AssetPickerModal';
import TextStyleModal from './TextStyleModal';
import { buildLayersFromTemplate } from './storyLayerBuilder';

type Step = 'photo' | 'purpose' | 'recommend' | 'edit';

const PURPOSES = ['集客', '告知・お知らせ', '商品紹介', '空席・在庫状況', 'シンプルに紹介'];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 完成した画像（PNG dataURL）を渡す。呼び出し側でアップロード・投稿フローへ */
  onFinish: (dataUrl: string) => void;
}

export default function StoryStudioScreen({ visible, onClose, onFinish }: Props) {
  const [step, setStep] = useState<Step>('photo');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [purpose, setPurpose] = useState<string | null>(null);
  const [ranked, setRanked] = useState<StoryTemplate[]>([]);
  const [rankIndex, setRankIndex] = useState(0);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [assetPickerVisible, setAssetPickerVisible] = useState(false);
  const [textEditVisible, setTextEditVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState<Plan>('free');

  React.useEffect(() => {
    if (visible) getMyPlan().then(setPlan).catch(() => {});
  }, [visible]);

  const canvasShotRef = useRef<ViewShot>(null);
  const brandSettings = useAppStore((s) => s.brandSettings);
  const layers = useStoryEditorStore((s) => s.layers);
  const selectedLayerId = useStoryEditorStore((s) => s.selectedLayerId);
  const loadLayers = useStoryEditorStore((s) => s.loadLayers);
  const addLayer = useStoryEditorStore((s) => s.addLayer);
  const updateLayer = useStoryEditorStore((s) => s.updateLayer);
  const reset = useStoryEditorStore((s) => s.reset);

  const alertMsg = (msg: string, title = 'お知らせ') => {
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(title, msg);
  };

  const close = () => {
    reset();
    setStep('photo');
    setPhotoUris([]);
    setPurpose(null);
    setRanked([]);
    setRankIndex(0);
    onClose();
  };

  const pickPhotos = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { alertMsg('写真へのアクセスを許可してください', '権限エラー'); return; }
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 4,
      quality: 0.9,
    });
    if (res.canceled) return;
    setPhotoUris(res.assets.map((a) => a.uri));
  };

  const runRecommendation = async (chosenPurpose: string) => {
    setStep('recommend');
    setRecommendLoading(true);
    setRecommendError(null);
    try {
      const plan = await getMyPlan();
      const candidateTags = [
        brandSettings.industry, brandSettings.atmosphere, brandSettings.tone, chosenPurpose,
      ].filter(Boolean) as string[];
      const recentIds = await getRecentTemplateIds().catch(() => []);
      const candidates = await rankTemplatesByTags({ plan, candidateTags, limit: 20 });
      if (candidates.length === 0) {
        setRecommendError('利用できるテンプレートがまだありません。管理者に素材の追加を依頼してください。');
        return;
      }
      let chosen = candidates[0];
      let fontOverride: string | undefined;
      let colorOverride: string | undefined;
      try {
        const ai = await recommendStoryTemplate({
          candidates: candidates.map((c) => ({ id: c.id, name: c.name, tags: c.tags })),
          purpose: chosenPurpose,
          recentTemplateIds: recentIds,
        });
        const picked = candidates.find((c) => c.id === ai.template);
        if (picked) chosen = picked;
        fontOverride = ai.font;
        colorOverride = ai.titleColor;
      } catch {
        // AI選定に失敗しても、タグスコア1位のテンプレートで進める
      }
      // 選ばれたテンプレートをリストの先頭に並べ替え、以降を「他の候補」にする
      const reordered = [chosen, ...candidates.filter((c) => c.id !== chosen.id)];
      setRanked(reordered);
      setRankIndex(0);
      await applyTemplate(reordered[0], fontOverride, colorOverride);
      recordRecentTemplate(chosen.id).catch(() => {});
    } catch (e) {
      setRecommendError(e instanceof Error ? e.message : 'おすすめの取得に失敗しました');
    } finally {
      setRecommendLoading(false);
    }
  };

  const applyTemplate = async (template: StoryTemplate, font?: string, titleColor?: string) => {
    const ids = [
      template.layerDefaults.background?.assetId,
      template.layerDefaults.frame?.assetId,
      template.layerDefaults.flower?.assetId,
      template.layerDefaults.decoration?.assetId,
    ].filter(Boolean) as string[];
    const assetsById = await getAssetsByIds(ids);
    const built = buildLayersFromTemplate(template, assetsById, photoUris, { font, titleColor });
    loadLayers(template.id, built);
  };

  const selectRankedTemplate = async (index: number) => {
    setRankIndex(index);
    await applyTemplate(ranked[index]);
  };

  const selectedTextLayer = layers.find((l) => l.id === selectedLayerId && (l.type === 'text' || l.type === 'cta')) as TextLayer | undefined;

  const addTextLayer = () => {
    addLayer({
      id: `text_${Date.now()}`, type: 'text', text: '新しいテキスト',
      font: 'default', color: '#FFFFFF', size: 64,
      x: 100, y: 900, scale: 1, rotation: 0, visible: true,
    });
    setTextEditVisible(true);
  };

  const capture = async (): Promise<string | null> => {
    if (!canvasShotRef.current?.capture) return null;
    try {
      const uri = await canvasShotRef.current.capture();
      return uri;
    } catch {
      alertMsg('画像の書き出しに失敗しました');
      return null;
    }
  };

  // 「保存」：画像化はせずJSONのまま下書き保存。あとから何度でも再編集できる
  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      await saveStoryDraft({ templateId: ranked[rankIndex]?.id, layersJson: serializeLayers(layers) });
      alertMsg('下書きに保存しました');
      close();
    } catch (e) {
      alertMsg(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 「投稿する」：1080x1920のPNGとして書き出し、投稿タブの作成フローへ渡す
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

        {step === 'photo' && (
          <View style={styles.center}>
            <Text style={styles.stepTitle}>写真を選んでください</Text>
            <Text style={styles.stepDesc}>デザインはAIとテンプレートにおまかせ。あなたは写真を選ぶだけです。</Text>
            <TouchableOpacity style={styles.photoPickBtn} onPress={pickPhotos} activeOpacity={0.85}>
              {photoUris.length > 0 ? (
                <ScrollView horizontal contentContainerStyle={{ gap: SPACING.sm }}>
                  {photoUris.map((uri, i) => (
                    <Image key={i} source={{ uri }} style={styles.photoThumb} resizeMode="cover" />
                  ))}
                </ScrollView>
              ) : (
                <>
                  <Ionicons name="image-outline" size={32} color={COLORS.textSecondary} />
                  <Text style={styles.photoPickText}>タップして写真を選ぶ</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.nextBtn, photoUris.length === 0 && styles.nextBtnDisabled]}
              disabled={photoUris.length === 0}
              onPress={() => setStep('purpose')}
              activeOpacity={0.85}
            >
              <Text style={styles.nextBtnText}>次へ</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'purpose' && (
          <View style={styles.center}>
            <Text style={styles.stepTitle}>今回の投稿目的は？</Text>
            <Text style={styles.stepDesc}>この1タップだけで、AIがテンプレートを選びます</Text>
            <View style={styles.purposeGrid}>
              {PURPOSES.map((p) => (
                <TouchableOpacity key={p} style={styles.purposeChip} onPress={() => { setPurpose(p); runRecommendation(p); }} activeOpacity={0.85}>
                  <Text style={styles.purposeChipText}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {step === 'recommend' && (
          <ScrollView contentContainerStyle={styles.recommendScroll}>
            {recommendLoading ? (
              <>
                <ActivityIndicator color={COLORS.primary} size="large" />
                <Text style={styles.stepDesc}>あなたのアカウントに合うデザインを選んでいます...</Text>
              </>
            ) : recommendError ? (
              <Text style={styles.errorText}>{recommendError}</Text>
            ) : (
              <>
                <Text style={styles.stepTitle}>おすすめ #{rankIndex + 1}</Text>
                {ranked[rankIndex] && <Text style={styles.stepDesc}>{ranked[rankIndex].name}（スコア {ranked[rankIndex].score}）</Text>}
                <View style={styles.previewWrap}>
                  <StoryCanvas displayWidth={PREVIEW_DISPLAY_W} locked />
                </View>
                <Text style={styles.previewHint}>確定すると指で編集できるようになります</Text>
                <TouchableOpacity style={styles.nextBtn} onPress={() => setStep('edit')} activeOpacity={0.85}>
                  <Text style={styles.nextBtnText}>このデザインで編集する</Text>
                </TouchableOpacity>
                {rankIndex + 1 < ranked.length && (
                  <TouchableOpacity onPress={() => selectRankedTemplate(rankIndex + 1)} style={styles.otherLinkBtn}>
                    <Text style={styles.otherLink}>他の候補を見る（残り{ranked.length - rankIndex - 1}件）</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </ScrollView>
        )}

        {step === 'edit' && (
          <View style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.editScroll}>
              <ViewShot ref={canvasShotRef} options={{ format: 'png', quality: 0.95, width: 1080, height: 1920 }}>
                <StoryCanvas />
              </ViewShot>

              <View style={styles.toolbar}>
                <TouchableOpacity style={styles.toolBtn} onPress={addTextLayer}>
                  <Ionicons name="text-outline" size={20} color={COLORS.text} />
                  <Text style={styles.toolBtnText}>文字を追加</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.toolBtn} onPress={() => setAssetPickerVisible(true)}>
                  <Ionicons name="flower-outline" size={20} color={COLORS.text} />
                  <Text style={styles.toolBtnText}>素材を追加</Text>
                </TouchableOpacity>
                {selectedTextLayer && (
                  <TouchableOpacity style={styles.toolBtn} onPress={() => setTextEditVisible(true)}>
                    <Ionicons name="create-outline" size={20} color={COLORS.text} />
                    <Text style={styles.toolBtnText}>文字を編集</Text>
                  </TouchableOpacity>
                )}
              </View>

              <LayerListPanel />
            </ScrollView>

            <View style={styles.finishRow}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveDraft} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color={COLORS.text} /> : <Text style={styles.saveBtnText}>保存</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.publishBtn} onPress={handlePublish} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishBtnText}>投稿する ›</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <AssetPickerModal
          visible={assetPickerVisible}
          plan={plan}
          onClose={() => setAssetPickerVisible(false)}
          onSelect={(asset) => {
            if (!selectedLayerId) return;
            updateLayer(selectedLayerId, { assetId: asset.id, uri: asset.fileUrl } as any);
          }}
        />
        <TextStyleModal
          visible={textEditVisible}
          layer={selectedTextLayer ?? null}
          onClose={() => setTextEditVisible(false)}
          onChange={(patch) => selectedTextLayer && updateLayer(selectedTextLayer.id, patch)}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  recommendScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  otherLinkBtn: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md },
  stepTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800', marginBottom: SPACING.xs, textAlign: 'center' },
  stepDesc: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: SPACING.lg },
  photoPickBtn: {
    width: DISPLAY_W * 0.7, minHeight: 160, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg, padding: SPACING.sm,
  },
  photoPickText: { color: COLORS.textSecondary, fontSize: 13, marginTop: SPACING.xs },
  photoThumb: { width: 100, height: 140, borderRadius: RADIUS.sm },
  nextBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  purposeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, justifyContent: 'center' },
  purposeChip: {
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  purposeChipText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  errorText: { color: COLORS.error, fontSize: 14, textAlign: 'center' },
  previewWrap: { marginBottom: SPACING.sm },
  previewHint: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center', marginBottom: SPACING.lg },
  otherLink: { color: COLORS.primary, fontSize: 13, fontWeight: '700', marginTop: SPACING.md, textAlign: 'center' },
  editScroll: { alignItems: 'center', paddingVertical: SPACING.md, paddingBottom: 120 },
  toolbar: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
  toolBtn: { alignItems: 'center', gap: 2 },
  toolBtnText: { color: COLORS.textSecondary, fontSize: 11 },
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
  publishBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});

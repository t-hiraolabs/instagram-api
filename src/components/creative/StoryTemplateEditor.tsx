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
  ActivityIndicator, Platform, Alert, Modal, ScrollView, useWindowDimensions, Keyboard,
  NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import ViewShot from 'react-native-view-shot';
import { COLORS, SPACING, RADIUS } from '../../utils/theme';
import { useCreativeEditorStore } from '../../store/creativeEditorStore';
import { TextLayer, TemplateLayer, CANVAS_W, CANVAS_H } from '../../types/creativeTemplate';
import { FONT_PRESETS, getFontPreset } from '../../utils/fontPresets';
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

// フォント一覧の各行の高さ（スナップ幅と一致させる）
const FONT_ROW_H = 44;
// ドロップダウンを開いた時に表示する一覧の高さ（3行分）。今後フォント数を増やしても
// 一覧はこの高さのまま内側でスクロールするだけなので、増加分の影響を受けない
const FONT_LIST_H = FONT_ROW_H * 3;

/** フォント選択用のドロップダウン。開くと縦スクロールの一覧になり、スクロールしている
 *  最中に中央へ来た行がそのままリアルタイムに選択へ切り替わる（指を離すのを待たず、
 *  スクロールしながら見た目を確認するだけで選べる）。フォント数が今後増えても
 *  一覧の高さは変えず、内側でスクロールするだけで対応できる。
 *  注意: react-native-webの`ScrollView`はonMomentumScrollEnd/onScrollEndDragを
 *  Web上では一切発火しない（ネイティブ専用の実装のため）ため、onScroll自体を使う
 *  （Web・ネイティブ両対応）*/
function FontDropdown({ value, onChange }: { value: string; onChange: (fontId: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = getFontPreset(value);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.y / FONT_ROW_H);
    const clamped = Math.max(0, Math.min(FONT_PRESETS.length - 1, index));
    const preset = FONT_PRESETS[clamped];
    if (preset.id !== value) onChange(preset.id);
  };

  return (
    <View>
      <TouchableOpacity testID="font-dropdown-trigger" style={styles.fontDropdownTrigger} onPress={() => setOpen((o) => !o)} activeOpacity={0.8}>
        <Text testID="font-dropdown-trigger-label" style={[styles.fontDropdownTriggerText, { fontFamily: current.family }]} numberOfLines={1}>
          {current.label}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMuted} />
      </TouchableOpacity>
      {open && (
        <View style={styles.fontDropdownList}>
          <ScrollView
            testID="font-dropdown-scroll"
            showsVerticalScrollIndicator={false}
            snapToInterval={FONT_ROW_H}
            decelerationRate="fast"
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingVertical: (FONT_LIST_H - FONT_ROW_H) / 2 }}
            onScroll={handleScroll}
            keyboardShouldPersistTaps="always"
          >
            {FONT_PRESETS.map((f) => (
              <TouchableOpacity
                key={f.id}
                style={styles.fontDropdownRow}
                onPress={() => { onChange(f.id); setOpen(false); }}
              >
                <Text
                  style={[styles.fontDropdownRowText, { fontFamily: f.family }, f.id === value && styles.fontDropdownRowTextActive]}
                  numberOfLines={1}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 完成した画像（PNG dataURL/URI）を渡す。呼び出し側でアップロード・投稿フローへ */
  onFinish: (dataUrl: string) => void;
}

export default function StoryTemplateEditor({ visible, onClose, onFinish }: Props) {
  // useWindowDimensions()は、ソフトキーボード表示中はキーボード分だけ縮んだ高さを
  // 返すプラットフォームがあり、これをキャンバス表示サイズの計算に使うと、文字入力中
  // （キーボード表示中）にキャンバス・上部プレビューの文字サイズまでもが一緒に縮んで
  // しまう不具合の原因になっていた。iOSの`Modal`（pageSheet）自体がキーボード表示に
  // 応じてレイアウトを調整する場合もあり、原因を1つに断定できないため、「変化する値を
  // 追いかけて正しく計算し直す」のではなく、モーダルを開いた瞬間（下のvisible &&
  // !startedの分岐）の値を一度だけ捕まえ、そのセッション中は（原因が何であれ）
  // 二度と再計算しないようにする
  const liveWin = useWindowDimensions();
  const liveInsets = useSafeAreaInsets();
  const [frozenWin, setFrozenWin] = useState(liveWin);
  const [frozenInsets, setFrozenInsets] = useState(liveInsets);
  const { width: winW, height: winH } = frozenWin;
  const insets = frozenInsets;

  const [panel, setPanel] = useState<Panel>('none');
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [started, setStarted] = useState(false);
  // プロパティパネル・上部プレビューの表示状態。「選択中かどうか」とは独立して持つ：
  // タップして指を離した時だけtrueにし、指で位置を動かし始めた瞬間にfalseへ戻す。
  // 動かして離した後もtrueへは戻さない（＝移動操作の最後はプロパティを表示しない）。
  // 再び表示するには、もう一度タップして離す必要がある
  const [showProps, setShowProps] = useState(false);
  // 上部プレビューの入力欄（TextInput）は、<Text>と違って内容に合わせて自動的に
  // 縮まない（既定では実際の文字より大きな当たり判定を持つ）。そのままだと見えない
  // 余白部分が、キャンバス上の実際の（小さい）テキストへのドラッグ操作を奪ってしまう
  // ため、内容の実寸を測って追従させ、見た目とほぼ同じ大きさの当たり判定に留める
  const [previewInputSize, setPreviewInputSize] = useState<{ width: number; height: number } | null>(null);

  const canvasShotRef = useRef<ViewShot>(null);

  const templateId = useCreativeEditorStore((s) => s.templateId);
  const photoSlots = useCreativeEditorStore((s) => s.photoSlots);
  const photoAssignments = useCreativeEditorStore((s) => s.photoAssignments);
  const layers = useCreativeEditorStore((s) => s.layers);
  const textLayers = useCreativeEditorStore((s) => s.textLayers);
  const selectedId = useCreativeEditorStore((s) => s.selectedId);
  const loadTemplate = useCreativeEditorStore((s) => s.loadTemplate);
  const setBackgroundLayer = useCreativeEditorStore((s) => s.setBackgroundLayer);
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
    setFrozenWin(liveWin);
    setFrozenInsets(liveInsets);
    setStarted(true);
  }

  const close = () => {
    reset();
    setStarted(false);
    setPanel('none');
    setShowProps(false);
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
      // 写真スロットがまだ無ければ作る（文字・ステッカー・背景は維持する。写真を
      // 拡大率1.0未満に縮小すればスロット内に余白ができ、そこに背景が見えるため、
      // 写真と背景は共存できる仕様にしている）
      if (photoSlots.length === 0) {
        loadTemplate({ templateId: templateId || '', photoSlots: [FULL_BLEED_SLOT], layers, textLayers });
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

  // 写真スロット・写真の割当には触れない（setBackgroundLayerは背景レイヤーだけを
  // 置き換える）。写真を拡大率1.0未満に縮小した時の余白に背景を表示したい、という
  // 意図があるため、写真を追加済みでも背景をいつでも設定・変更できる
  const selectBackground = (presetId: string) => {
    const bgLayer: TemplateLayer = {
      id: 'bg', kind: 'background', band: 'background', uri: '', bgPresetId: presetId,
      x: 0, y: 0, w: CANVAS_W, h: CANVAS_H,
    };
    setBackgroundLayer(bgLayer);
    setPanel('none');
  };

  const selectedTextLayer = textLayers.find((t) => t.id === selectedId) as TextLayer | undefined;
  React.useEffect(() => { setPreviewInputSize(null); }, [selectedTextLayer?.id]);

  // テキストをタップしてプロパティ・上部プレビューを開いた時、Instagram同様に
  // 文字入力キーボードも一緒に開く（フォント・色などはキーボードを開いたまま
  // 操作できる。各ScrollViewのkeyboardShouldPersistTapsも参照）。
  // 注意: Safari（iOS）は、ユーザーの操作イベントと同期していないfocus()呼び出しでは
  // ソフトキーボードを表示しない（「信頼できるユーザー操作」由来である間だけ許可する
  // 仕組みのため）。setTimeoutで遅延させるとこの猶予から外れてキーボードが開かなく
  // なるため、遅延を挟まずuseLayoutEffectで、タップ操作によるレンダー直後・
  // ブラウザが描画する前に同期的にfocus()を呼ぶ
  const previewInputRef = useRef<TextInput>(null);
  // タブを開いている間・テキスト編集中に他の場所をタップしたら閉じる判定で、
  // 「他の場所」から除外する対象（下のuseEffect参照）
  const textPanelRef = useRef<View>(null);
  const stripPanelRef = useRef<View>(null);
  // フォーカスした瞬間、カーソルを文末に置く（既定では先頭になってしまい、
  // 追記したい時に毎回カーソルを文末へ動かす手間が発生していたため）。
  // selectionは一度だけ設定し、その後は更新しない（更新し続けると入力中の
  // カーソル移動そのものを打ち消してしまうため、依存配列にselectedTextLayer.text
  // を含めない）
  const [previewSelection, setPreviewSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  React.useLayoutEffect(() => {
    if (!selectedTextLayer || !showProps) return;
    setPreviewSelection({ start: selectedTextLayer.text.length, end: selectedTextLayer.text.length });
    previewInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showProps, selectedTextLayer?.id]);

  const handleAddTextLayer = () => {
    const layer: TextLayer = {
      id: `text_${Date.now()}`, text: '',
      x: 120, y: 860, font: 'gothic', color: '#FFFFFF', size: 64, align: 'left',
      scale: 1, rotation: 0, visible: true,
    };
    addTextLayer(layer);
    setPanel('none');
    setShowProps(true);
  };

  // 何も入力しないまま選択が外れた（別の要素をタップした、完了を押した等）テキストは
  // 追加しなかったことにする。ステッカーはlabelを持つテキストレイヤーとして表現している
  // ため、文字が空でも消さないよう区別する
  const removeIfEmptyText = (id: string) => {
    const layer = textLayers.find((t) => t.id === id) as TextLayer | undefined;
    if (layer && !layer.label && !layer.text.trim()) removeTextLayer(id);
  };
  const prevSelectedIdRef = useRef<string | null>(null);
  React.useEffect(() => {
    const prevId = prevSelectedIdRef.current;
    prevSelectedIdRef.current = selectedId;
    if (prevId && prevId !== selectedId) removeIfEmptyText(prevId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleAddSticker = (emoji: string) => {
    const layer: TextLayer = {
      id: `sticker_${Date.now()}`, label: 'ステッカー', text: emoji,
      x: (CANVAS_W - 160) / 2, y: (CANVAS_H - 160) / 2, font: 'gothic', color: '#FFFFFF', size: 160,
      scale: 1, rotation: 0, visible: true,
    };
    addTextLayer(layer);
    setPanel('none');
    setShowProps(true);
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
  // テキストをタップして選択した時だけプロパティ・上部プレビューを表示する
  // （showPropsの管理はstate定義側のコメント参照）
  const showTextProps = !!selectedTextLayer && showProps;
  const overlayActive = showTextProps || panel !== 'none';

  // 上部プレビューの入力欄はキャンバス上のテキストの裏にpointerEvents="box-none"で
  // 重ねている（ドラッグ操作を奪わないため）。そのため、そのテキストを再タップした時、
  // ブラウザは入力欄以外の場所へのmousedownとして扱い、標準動作で入力欄のフォーカスを
  // 解除してしまう（リッチテキストエディタのツールバーボタンでも起きる既知の挙動と同じ）。
  // キーボードを開いたまま維持したいので、入力欄がフォーカスされている間は、入力欄自身
  // 以外へのmousedownによるフォーカス解除だけを止める
  React.useEffect(() => {
    if (!showTextProps || Platform.OS !== 'web') return;
    const handleMouseDown = (e: MouseEvent) => {
      const input = previewInputRef.current as unknown as HTMLElement | null;
      if (!input || document.activeElement !== input) return;
      const target = e.target as Node | null;
      if (target && input.contains(target)) return;
      e.preventDefault();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => document.removeEventListener('mousedown', handleMouseDown, true);
  }, [showTextProps]);

  // タブ（背景・ステッカーの一覧パネル）を開いている間、またはテキストの
  // プロパティ・上部プレビューを表示している間に、それら以外の場所をタップしたら
  // 閉じる（背景/ステッカーパネルはpanelを'none'に、テキストは完了ボタンと同じ扱いで
  // 選択解除する）。ただし、今まさに選択中のテキスト自身（キャンバス上の実物）への
  // タップは除外する: そこだけは再タップでキーボードを開き直す既存の挙動
  // （上のフォーカス維持の仕組み参照）を壊さないようにするため
  React.useEffect(() => {
    if (!overlayActive || Platform.OS !== 'web') return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const input = previewInputRef.current as unknown as HTMLElement | null;
      const textPanelEl = textPanelRef.current as unknown as HTMLElement | null;
      const stripPanelEl = stripPanelRef.current as unknown as HTMLElement | null;
      const selectedEl = selectedId ? document.querySelector(`[data-testid="layer-${selectedId}"]`) : null;
      if (input?.contains(target)) return;
      if (textPanelEl?.contains(target)) return;
      if (stripPanelEl?.contains(target)) return;
      if (selectedEl?.contains(target)) return;
      if (panel !== 'none') setPanel('none');
      if (showTextProps) { selectItem(null); setShowProps(false); }
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => document.removeEventListener('mousedown', handleMouseDown, true);
  }, [overlayActive, panel, showTextProps, selectedId]);
  const previewDisplayScale = canvasW / CANVAS_W;
  const previewFontSize = selectedTextLayer
    ? Math.min(72, Math.max(20, selectedTextLayer.size * previewDisplayScale * 2.2))
    : 0;

  // プロパティパネル（フォント・色等）はキャンバスの下端にbottom:0で重ねているが、
  // キャンバスの表示サイズ自体はモーダル起動時の値で固定している（上の注記参照）
  // ため、キーボード表示時にレイアウトの再計算では追従しない。キーボードがその
  // 固定レイアウトの下側にかぶさって隠してしまわないよう、キーボードの高さ分だけ
  // パネルをその場で持ち上げる。WebはvisualViewportのresize、ネイティブは
  // Keyboardイベントで高さを取得する（どちらも実際にキーボードが出ている間だけ
  // 0より大きい値になる）
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  React.useEffect(() => {
    if (Platform.OS === 'web') {
      const vv = typeof window !== 'undefined' ? (window as any).visualViewport : null;
      if (!vv) return;
      const update = () => {
        setKeyboardHeight(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
      };
      update();
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      };
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  // keyboardHeightは画面の本当の下端からの高さだが、パネル自体はcanvasWrapの下端
  // （その下にツールバー・投稿バー・下端セーフエリア分の余白がすでにある）に
  // bottom:0で重ねているため、keyboardHeightをそのまま使うとその余白の分だけ
  // 余計に持ち上がり、キーボードよりかなり上に浮いて見えてしまう。すでに空いている
  // その分を差し引いた「実際にキーボードがcanvasWrapへ食い込む量」だけ持ち上げる
  const belowCanvasH = TOOLBAR_H + FINISH_H + insets.bottom;
  const panelKeyboardOffset = Math.max(0, keyboardHeight - belowCanvasH);

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
              // 写真の追加はツールバーの「写真」アイコンからのみ行う（プレビュー全体を
              // タップしても追加されないようにする）ため、ここではonPickPhotoを渡さない
              onSelectText={selectItem}
              onTextChange={(id, patch) => updateTextLayer(id, patch)}
              onTextTap={() => setShowProps(true)}
              onTextDragStateChange={(dragging) => { if (dragging) setShowProps(false); }}
            />
          </ViewShot>

          {/* パネル表示中はキャンバスのサイズを変えず、少し暗くしてその上にパネルを重ねる */}
          {overlayActive && <View style={styles.dimOverlay} pointerEvents="none" />}

          {/* テキストをタップして選択した時だけ、実際の配置とは別にキャンバス上部へ
              大きく表示するプレビュー（キャンバス上では小さく・回転していて見づらい
              ことがあるため）。文字内容自体はここへ直接入力して変更できる
              （プロパティパネル側には重複する入力欄を置かない）。中央ではなく上部に
              置くのは、キャンバス上の実際のテキストへのドラッグ操作をなるべく
              邪魔しないようにするため（キャンバス中央付近に置かれることが多い実際の
              テキストと、常に大きく表示されるこのプレビューの重なりを避ける）。
              位置を動かしている間は配置先を隠さないよう表示しない。外枠はbox-none
              にして、入力欄以外の部分は下の実際のテキストへのドラッグ操作を
              邪魔しないようにする */}
          {showTextProps && selectedTextLayer && (
            <View testID="story-editor-text-preview" style={styles.previewWrap} pointerEvents="box-none">
              {/* 入力欄自身のonContentSizeChangeで自分の大きさを決めると、適用した
                  大きさがまた新しいcontentSizeを報告し直してしまい無限ループになる
                  ため、独立した非表示の計測専用テキストで実寸を求める（見た目には
                  出さず、入力欄の大きさだけに反映する） */}
              <View style={styles.previewMeasure} pointerEvents="none">
                <Text
                  style={[
                    styles.previewText,
                    {
                      maxWidth: canvasW - SPACING.lg * 2,
                      fontSize: previewFontSize,
                      fontFamily: getFontPreset(selectedTextLayer.font).family,
                      fontWeight: getFontPreset(selectedTextLayer.font).fontWeight as any,
                    },
                  ]}
                  onLayout={(e) => {
                    const { width, height } = e.nativeEvent.layout;
                    setPreviewInputSize((prev) => {
                      if (prev && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5) return prev;
                      return { width, height };
                    });
                  }}
                >
                  {selectedTextLayer.text || ' '}
                </Text>
              </View>
              <TextInput
                ref={previewInputRef}
                testID="story-editor-text-preview-input"
                style={[
                  styles.previewText,
                  styles.previewInput,
                  {
                    color: selectedTextLayer.color,
                    fontSize: previewFontSize,
                    fontFamily: getFontPreset(selectedTextLayer.font).family,
                    fontWeight: getFontPreset(selectedTextLayer.font).fontWeight as any,
                    textAlign: selectedTextLayer.align ?? 'center',
                  },
                  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
                  previewInputSize
                    ? { width: previewInputSize.width + 8, height: previewInputSize.height + 8 }
                    : null,
                ]}
                value={selectedTextLayer.text}
                onChangeText={(text) => updateTextLayer(selectedTextLayer.id, { text })}
                selection={previewSelection}
                multiline
              />
            </View>
          )}

          {/* 選択中の文字・ステッカーのプロパティ（別モーダルではなく同一画面内、キャンバスの上に重ねて表示） */}
          {showTextProps && selectedTextLayer && (
            <View ref={textPanelRef} testID="story-editor-text-panel" style={[styles.textPanel, styles.overlayPanel, { bottom: panelKeyboardOffset }]}>
              <View style={styles.textPanelTopRow}>
                {/* 文字内容の編集は上部プレビュー側の入力欄で直接行う（ここには重複させない） */}
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={() => { removeTextLayer(selectedTextLayer.id); }} hitSlop={8}>
                  <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { selectItem(null); setShowProps(false); }} hitSlop={8}>
                  <Text style={styles.doneText}>完了</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.fontDropdownWrap}>
                <FontDropdown
                  value={selectedTextLayer.font}
                  onChange={(font) => updateTextLayer(selectedTextLayer.id, { font })}
                />
              </View>
              <View style={styles.colorAlignRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="always">
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

          {/* 背景プリセット・ステッカーのインライン選択パネル（別モーダルにせず、キャンバスの上に重ねて表示）。
              !selectedTextLayerではなく!showTextPropsで判定する: 移動して指を離した直後は
              選択状態自体は続くがプロパティは非表示になる（state定義側のコメント参照）ため、
              !selectedTextLayerのままだと移動直後にこれらのパネルもツールバーもずっと
              出せなくなってしまう */}
          {!showTextProps && panel === 'background' && (
            <View ref={stripPanelRef} style={[styles.stripPanel, styles.overlayPanel]}>
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
          {!showTextProps && panel === 'sticker' && (
            <View ref={stripPanelRef} style={[styles.stripPanel, styles.overlayPanel]}>
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

        {/* アイコンツールバー（常時同じ高さを確保。プロパティパネル表示中はキャンバスサイズを
            変えないため空のまま。移動して指を離した直後（選択は続くがプロパティは非表示）は
            ここにアイコンを出す必要があるため、!selectedTextLayerではなく!showTextPropsで判定する） */}
        <View style={styles.toolbar}>
          {!showTextProps && (
            <>
              <TouchableOpacity style={styles.toolBtn} onPress={pickPhoto} disabled={picking}>
                {picking ? <ActivityIndicator size="small" color={COLORS.text} /> : <Ionicons name="image-outline" size={22} color={COLORS.text} />}
                <Text style={styles.toolBtnText}>写真</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => setPanel((p) => (p === 'background' ? 'none' : 'background'))}>
                <Ionicons name="color-palette-outline" size={22} color={panel === 'background' ? COLORS.primary : COLORS.text} />
                <Text style={[styles.toolBtnText, panel === 'background' && styles.toolBtnTextActive]}>背景</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="story-editor-add-text-btn" style={styles.toolBtn} onPress={handleAddTextLayer}>
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
          {/* 下書き保存・端末へのダウンロードは、投稿するを押した後の画面
              （ScheduleScreen.tsxの投稿方法選択画面）側に用意されている。
              ここでは編集を終えて次の画面へ進む「投稿する」のみを置く */}
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
  previewWrap: {
    // プレビュー自体の大きさ（previewFontSize等）やキャンバスの表示サイズ
    // （canvasW等）は変えず、表示位置だけをキャンバス上部に寄せる（中央に置くと
    // 大きな入力欄がキャンバス上の実際のテキストへのドラッグ操作を奪ってしまうため）
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg,
  },
  previewText: { textAlign: 'center' },
  previewInput: { padding: 0, margin: 0, borderWidth: 0, backgroundColor: 'transparent' },
  previewMeasure: { position: 'absolute', opacity: 0 },
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
  doneText: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
  chipRow: { gap: SPACING.sm, paddingHorizontal: SPACING.md },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  fontDropdownWrap: { paddingHorizontal: SPACING.md },
  fontDropdownTrigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, paddingHorizontal: SPACING.md, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  fontDropdownTriggerText: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: '700' },
  fontDropdownList: {
    height: FONT_LIST_H, marginTop: SPACING.xs, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, overflow: 'hidden',
  },
  fontDropdownRow: { height: FONT_ROW_H, justifyContent: 'center', paddingHorizontal: SPACING.md },
  fontDropdownRowText: { color: COLORS.textMuted, fontSize: 15 },
  fontDropdownRowTextActive: { color: COLORS.text, fontWeight: '800' },
  colorAlignRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: COLORS.border },
  swatchActive: { borderColor: COLORS.primary },
  alignRow: { flexDirection: 'row', gap: SPACING.xs, paddingRight: SPACING.md },
  alignBtn: { width: 30, height: 30, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  finishRow: {
    height: 64, flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.md, alignItems: 'center',
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  publishBtn: { flex: 1, alignItems: 'center', paddingVertical: SPACING.sm, borderRadius: RADIUS.full, backgroundColor: COLORS.primary },
  publishBtnDisabled: { opacity: 0.4 },
  publishBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});

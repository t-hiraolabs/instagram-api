import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  ActivityIndicator,
  Dimensions,
  Platform,
  ScrollView,
} from 'react-native';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { FeedTransform, DEFAULT_FEED_TRANSFORM, ASPECTS, AspectKey, composeFeedImage, makeBlurredBackgroundUrl } from '../utils/composeFeed';
import { loadImage } from '../utils/composeStory';
import { snapValueWithHit } from '../utils/snap';

interface Props {
  visible: boolean;
  images: string[];
  initialIndex?: number; // 最初に選択（表示）する写真のインデックス
  onCancel: () => void;
  onDone: (results: { blob: Blob; previewUrl: string }[]) => void;
}

const SCREEN_W = Dimensions.get('window').width;
const FRAME_W = Math.min(SCREEN_W - SPACING.md * 2, 340);
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;
// 「ちょうど枠を覆う倍率（scale=1）」「中央」に近づいたときに一瞬止まるスナップの許容量
const SCALE_SNAP_ZONE = 0.04;
const POSITION_SNAP_PX = 8;
// スナップ中に表示する、見えやすいガイド線・枠線の色
const GUIDE_COLOR = '#00E5FF';

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

// iOS Safari の長押しメニュー（共有/保存）や選択を無効化するWeb用スタイル
const NO_CALLOUT = Platform.OS === 'web'
  ? ({ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', touchAction: 'none' } as object)
  : {};

interface Meta { iw: number; ih: number; }

export default function FeedCropEditor({ visible, images, initialIndex = 0, onCancel, onDone }: Props) {
  const [aspect, setAspect] = useState<AspectKey>('square');
  const [idx, setIdx] = useState(0);
  const [imgs, setImgs] = useState<string[]>([]); // 並べ替え可能な内部コピー
  const [transforms, setTransforms] = useState<FeedTransform[]>([]);
  const [metas, setMetas] = useState<(Meta | null)[]>([]);
  const [processing, setProcessing] = useState(false);
  const [bgUrl, setBgUrl] = useState('');

  const ar = ASPECTS[aspect];
  const frameH = FRAME_W / ar;

  // 焼き込みと同じ処理でぼかし背景を生成し、プレビューに使う（端末問わず完全一致）
  useEffect(() => {
    if (!visible || !imgs[idx]) { setBgUrl(''); return; }
    let cancelled = false;
    makeBlurredBackgroundUrl(imgs[idx], ar).then((u) => { if (!cancelled) setBgUrl(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, imgs, idx, ar]);

  useEffect(() => {
    if (!visible) return;
    setImgs([...images]);
    setTransforms(images.map(() => ({ ...DEFAULT_FEED_TRANSFORM })));
    setIdx(Math.max(0, Math.min(initialIndex, images.length - 1)));
    setAspect('square');
    let cancelled = false;
    (async () => {
      const ms: (Meta | null)[] = [];
      for (const uri of images) {
        try { const img = await loadImage(uri); ms.push({ iw: img.width, ih: img.height }); }
        catch { ms.push(null); }
      }
      if (!cancelled) setMetas(ms);
    })();
    return () => { cancelled = true; };
  }, [visible, images]);

  // サムネをドラッグして並べ替える
  const moveThumb = (from: number, to: number) => {
    if (from === to) return;
    const reorder = <T,>(arr: T[]) => {
      const a = [...arr];
      const [it] = a.splice(from, 1);
      a.splice(to, 0, it);
      return a;
    };
    setImgs((a) => reorder(a));
    setTransforms((a) => reorder(a));
    setMetas((a) => reorder(a));
    setIdx(to);
  };

  const cur = transforms[idx] ?? DEFAULT_FEED_TRANSFORM;
  const meta = metas[idx] ?? null;

  // cover基準のサイズ（フレームを覆う）
  const baseCover = meta ? Math.max(FRAME_W / meta.iw, frameH / meta.ih) : 1;
  const coverW = meta ? meta.iw * baseCover : FRAME_W;
  const coverH = meta ? meta.ih * baseCover : frameH;

  // 最新値ref（PanResponder用）
  const refs = useRef({ idx, transforms, metas, ar, frameH, coverW, coverH });
  refs.current = { idx, transforms, metas, ar, frameH, coverW, coverH };
  const startRef = useRef<{ x: number; y: number; scale: number; dist: number | null }>({ x: 0, y: 0, scale: 1, dist: null });

  // ちょうど枠を覆う倍率・中央に近づいてスナップした間だけ、見えやすいガイド線・枠線を表示する
  const [snapped, setSnapped] = useState({ x: false, y: false, scale: false });

  const setT = (patch: Partial<FeedTransform>) => {
    setTransforms((prev) => {
      const r = refs.current;
      const i = r.idx;
      const next = [...prev];
      const t = { ...(next[i] ?? DEFAULT_FEED_TRANSFORM), ...patch };
      t.scale = clamp(t.scale, MIN_SCALE, MAX_SCALE);
      // ちょうど枠を覆う倍率（縮小していくと上下または左右がぴったり画面いっぱいになる境目）に
      // 近づいたら一瞬止まるようにする
      const scaleHit = snapValueWithHit(t.scale, [1], SCALE_SNAP_ZONE);
      t.scale = scaleHit.value;
      // 拡大時ははみ出し分、縮小時は余白分まで移動を許可（背景で埋まる）
      const ox = Math.abs(r.coverW * t.scale - FRAME_W) / 2 / FRAME_W;
      const oy = Math.abs(r.coverH * t.scale - r.frameH) / 2 / r.frameH;
      t.x = clamp(t.x, -ox, ox);
      t.y = clamp(t.y, -oy, oy);
      // 中央に近づいたら一瞬止まるようにする
      const xHit = snapValueWithHit(t.x, [0], POSITION_SNAP_PX / FRAME_W);
      const yHit = snapValueWithHit(t.y, [0], POSITION_SNAP_PX / r.frameH);
      t.x = xHit.value;
      t.y = yHit.value;
      next[i] = t;
      setSnapped({ x: xHit.hit !== null, y: yHit.hit !== null, scale: scaleHit.hit !== null });
      return next;
    });
  };
  const setTRef = useRef(setT); setTRef.current = setT;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const r = refs.current;
        const t = r.transforms[r.idx] ?? DEFAULT_FEED_TRANSFORM;
        startRef.current = { x: t.x, y: t.y, scale: t.scale, dist: null };
      },
      onPanResponderMove: (evt, gesture) => {
        const r = refs.current;
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (startRef.current.dist == null) startRef.current.dist = dist;
          else setTRef.current({ scale: startRef.current.scale * (dist / startRef.current.dist) });
        } else {
          setTRef.current({
            x: startRef.current.x + gesture.dx / FRAME_W,
            y: startRef.current.y + gesture.dy / r.frameH,
          });
        }
      },
      onPanResponderRelease: () => { startRef.current.dist = null; setSnapped({ x: false, y: false, scale: false }); },
      onPanResponderTerminate: () => { startRef.current.dist = null; setSnapped({ x: false, y: false, scale: false }); },
    })
  ).current;

  const handleDone = async () => {
    setProcessing(true);
    try {
      const results: { blob: Blob; previewUrl: string }[] = [];
      for (let i = 0; i < imgs.length; i++) {
        results.push(await composeFeedImage(imgs[i], transforms[i] ?? DEFAULT_FEED_TRANSFORM, ar));
      }
      onDone(results);
    } catch {
      // noop
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel}><Text style={styles.cancel}>キャンセル</Text></TouchableOpacity>
          <Text style={styles.title}>写真を調整</Text>
          <TouchableOpacity onPress={handleDone} disabled={processing}>
            {processing ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.next}>次へ ›</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: SPACING.xl }} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>ドラッグで位置・2本指で拡大できます</Text>

        {/* 固定フレーム内で写真を動かす（Instagram方式）。枠外も薄く見える */}
        {(() => {
          const MARGIN = 28;
          const stageW = SCREEN_W;
          const stageH = frameH + MARGIN * 2;
          const frameLeft = (stageW - FRAME_W) / 2;
          const frameTop = MARGIN;
          return (
            <View style={[styles.stage, NO_CALLOUT, { width: stageW, height: stageH }]} {...pan.panHandlers}>
              {/* 自動背景（焼き込みと同一処理で生成）。縮小時の余白を埋める */}
              {bgUrl ? (
                <Image
                  source={{ uri: bgUrl }}
                  style={{
                    position: 'absolute',
                    left: frameLeft,
                    top: frameTop,
                    width: FRAME_W,
                    height: frameH,
                  }}
                  resizeMode="cover"
                />
              ) : null}
              {imgs[idx] && (
                <Image
                  source={{ uri: imgs[idx] }}
                  style={{
                    position: 'absolute',
                    width: coverW,
                    height: coverH,
                    left: frameLeft + (FRAME_W - coverW) / 2,
                    top: frameTop + (frameH - coverH) / 2,
                    transform: [
                      { translateX: cur.x * FRAME_W },
                      { translateY: cur.y * frameH },
                      { scale: cur.scale },
                    ],
                  }}
                  resizeMode="cover"
                  draggable={false}
                  pointerEvents="none"
                />
              )}
              {/* 枠外の薄暗いマスク */}
              <View pointerEvents="none" style={[styles.mask, { left: 0, top: 0, width: stageW, height: frameTop }]} />
              <View pointerEvents="none" style={[styles.mask, { left: 0, top: frameTop + frameH, width: stageW, height: stageH - frameTop - frameH }]} />
              <View pointerEvents="none" style={[styles.mask, { left: 0, top: frameTop, width: frameLeft, height: frameH }]} />
              <View pointerEvents="none" style={[styles.mask, { left: frameLeft + FRAME_W, top: frameTop, width: stageW - frameLeft - FRAME_W, height: frameH }]} />
              {/* 枠線。ちょうど枠を覆う倍率にスナップした間は見えやすい色に変える */}
              <View
                testID="feedcrop-box"
                pointerEvents="none"
                style={[
                  styles.cropBox,
                  { left: frameLeft, top: frameTop, width: FRAME_W, height: frameH },
                  snapped.scale && { borderColor: GUIDE_COLOR, borderWidth: 3 },
                ]}
              />
              {/* 中央に近づいてスナップした間だけ表示するガイド線 */}
              {snapped.x && (
                <View testID="feedcrop-guide-v" pointerEvents="none" style={[styles.guideV, { left: frameLeft + FRAME_W / 2, top: frameTop, height: frameH }]} />
              )}
              {snapped.y && (
                <View testID="feedcrop-guide-h" pointerEvents="none" style={[styles.guideH, { top: frameTop + frameH / 2, left: frameLeft, width: FRAME_W }]} />
              )}
            </View>
          );
        })()}

        {/* 比率切り替え */}
        <View style={styles.aspectRow}>
          <TouchableOpacity style={[styles.aspectBtn, aspect === 'square' && styles.aspectBtnActive]} onPress={() => setAspect('square')}>
            <Text style={[styles.aspectText, aspect === 'square' && styles.aspectTextActive]}>1:1</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.aspectBtn, aspect === 'portrait' && styles.aspectBtnActive]} onPress={() => setAspect('portrait')}>
            <Text style={[styles.aspectText, aspect === 'portrait' && styles.aspectTextActive]}>4:5</Text>
          </TouchableOpacity>
        </View>

        {/* ズーム（スライダー） */}
        <View style={styles.zoomWrap}>
          <Text style={styles.zoomLabel}>拡大 {Math.round(cur.scale * 100)}%</Text>
          <SliderBar
            value={cur.scale}
            min={MIN_SCALE}
            max={MAX_SCALE}
            onChange={(v) => setT({ scale: v })}
          />
        </View>

        {imgs.length > 1 && (
          <>
            <Text style={styles.reorderHint}>サムネイルを長押ししてドラッグすると並べ替えできます</Text>
            <View style={styles.thumbRow}>
              {imgs.map((uri, i) => (
                <DraggableThumb
                  key={uri + i}
                  uri={uri}
                  index={i}
                  active={i === idx}
                  count={imgs.length}
                  onSelect={() => setIdx(i)}
                  onMove={moveThumb}
                />
              ))}
            </View>
          </>
        )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// 自作の拡大率スライダー（タップ／ドラッグで操作）
function SliderBar({ value, min, max, onChange }: {
  value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  const [w, setW] = useState(0);
  const setFromX = (x: number) => {
    if (w <= 0) return;
    const r = clamp(x / w, 0, 1);
    onChange(min + r * (max - min));
  };
  const ratio = (value - min) / (max - min);
  return (
    <View
      style={styles.sliderTrack}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => setFromX(e.nativeEvent.locationX)}
      onResponderMove={(e) => setFromX(e.nativeEvent.locationX)}
    >
      <View style={styles.sliderBg} />
      <View style={[styles.sliderFill, { width: Math.max(0, w * ratio) }]} />
      <View style={[styles.sliderKnob, { left: clamp(w * ratio - 11, 0, Math.max(0, w - 22)) }]} pointerEvents="none" />
    </View>
  );
}

// ドラッグで並べ替え可能なサムネイル
const THUMB_STEP = 56 + SPACING.sm; // サムネ幅 + 余白
function DraggableThumb({ uri, index, active, count, onSelect, onMove }: {
  uri: string; index: number; active: boolean; count: number;
  onSelect: () => void; onMove: (from: number, to: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const dxRef = useRef(0);
  const [dx, setDx] = useState(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => { setDragging(true); dxRef.current = 0; setDx(0); },
      onPanResponderMove: (_e, g) => { dxRef.current = g.dx; setDx(g.dx); },
      onPanResponderRelease: (_e, g) => {
        setDragging(false); setDx(0);
        if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) { onSelect(); return; }
        const shift = Math.round(g.dx / THUMB_STEP);
        const to = Math.max(0, Math.min(count - 1, index + shift));
        onMove(index, to);
      },
      onPanResponderTerminate: () => { setDragging(false); setDx(0); },
    })
  ).current;
  return (
    <View
      {...pan.panHandlers}
      style={[
        styles.thumb,
        NO_CALLOUT,
        active && styles.thumbActive,
        dragging && { transform: [{ translateX: dx }, { scale: 1.1 }], zIndex: 10, opacity: 0.9 },
      ]}
    >
      <Image source={{ uri }} style={styles.thumbImg} resizeMode="cover" draggable={false} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  cancel: { color: COLORS.textMuted, fontSize: 15, fontWeight: '600' },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  next: { color: COLORS.primary, fontSize: 15, fontWeight: '800' },
  hint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: SPACING.sm },
  stage: {
    overflow: 'hidden',
    marginTop: SPACING.md,
    alignSelf: 'center',
    backgroundColor: '#000',
    ...(Platform.OS === 'web' ? ({ cursor: 'grab', touchAction: 'none' } as object) : {}),
  },
  mask: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  cropBox: { position: 'absolute', borderWidth: 2, borderColor: '#fff', borderRadius: 2 },
  // 中央にスナップした間だけ表示する見えやすいガイド線
  guideV: { position: 'absolute', width: 2, backgroundColor: GUIDE_COLOR },
  guideH: { position: 'absolute', height: 2, backgroundColor: GUIDE_COLOR },
  aspectRow: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm, marginTop: SPACING.md },
  aspectBtn: { paddingHorizontal: SPACING.lg, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  aspectBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  aspectText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '700' },
  aspectTextActive: { color: '#fff' },
  zoomWrap: { marginTop: SPACING.md, paddingHorizontal: SPACING.xl, alignItems: 'center' },
  zoomLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: SPACING.sm },
  sliderTrack: {
    width: '100%',
    maxWidth: 320,
    height: 32,
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer', touchAction: 'none' } as object) : {}),
  },
  sliderBg: { position: 'absolute', left: 0, right: 0, height: 5, borderRadius: 3, backgroundColor: COLORS.border },
  sliderFill: { position: 'absolute', left: 0, height: 5, borderRadius: 3, backgroundColor: COLORS.primary },
  sliderKnob: {
    position: 'absolute', width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fff', borderWidth: 2, borderColor: COLORS.primary,
  },
  reorderHint: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center', marginTop: SPACING.md },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, justifyContent: 'center', marginTop: SPACING.sm, paddingHorizontal: SPACING.md },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: COLORS.primary },
  thumbImg: { width: '100%', height: '100%' },
});

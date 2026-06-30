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
} from 'react-native';
import { COLORS, SPACING, RADIUS } from '../utils/theme';
import { FeedCrop, composeSquareImage } from '../utils/composeFeed';
import { loadImage } from '../utils/composeStory';

interface Props {
  visible: boolean;
  images: string[];
  onCancel: () => void;
  onDone: (results: { blob: Blob; previewUrl: string }[]) => void;
}

const SCREEN_W = Dimensions.get('window').width;
const STAGE_W = Math.min(SCREEN_W - SPACING.md * 2, 420);
const STAGE_MAX_H = 460;
const MIN_CS = 60;

interface Meta { iw: number; ih: number; dW: number; dH: number; }
interface Crop { fx: number; fy: number; cs: number; } // 表示px上の切り抜き枠

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

export default function FeedCropEditor({ visible, images, onCancel, onDone }: Props) {
  const [idx, setIdx] = useState(0);
  const [metas, setMetas] = useState<(Meta | null)[]>([]);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const ms: (Meta | null)[] = [];
      const cs: Crop[] = [];
      for (const uri of images) {
        try {
          const img = await loadImage(uri);
          const ar = img.width / img.height;
          let dW = STAGE_W, dH = STAGE_W / ar;
          if (dH > STAGE_MAX_H) { dH = STAGE_MAX_H; dW = STAGE_MAX_H * ar; }
          const side = Math.min(dW, dH);
          ms.push({ iw: img.width, ih: img.height, dW, dH });
          cs.push({ fx: (dW - side) / 2, fy: (dH - side) / 2, cs: side });
        } catch {
          ms.push(null);
          cs.push({ fx: 0, fy: 0, cs: STAGE_W });
        }
      }
      if (!cancelled) { setMetas(ms); setCrops(cs); setIdx(0); }
    })();
    return () => { cancelled = true; };
  }, [visible, images]);

  const meta = metas[idx] ?? null;
  const crop = crops[idx] ?? { fx: 0, fy: 0, cs: STAGE_W };

  // PanResponder内で最新値を参照するためのref
  const stateRef = useRef({ idx, metas, crops });
  stateRef.current = { idx, metas, crops };
  const startRef = useRef<{ fx: number; fy: number; cs: number; dist: number | null }>({ fx: 0, fy: 0, cs: 0, dist: null });

  const setCrop = (patch: Partial<Crop>) => {
    setCrops((prev) => {
      const i = stateRef.current.idx;
      const m = stateRef.current.metas[i];
      const next = [...prev];
      const c = { ...(next[i] ?? { fx: 0, fy: 0, cs: STAGE_W }), ...patch };
      if (m) {
        c.cs = clamp(c.cs, MIN_CS, Math.min(m.dW, m.dH));
        c.fx = clamp(c.fx, 0, m.dW - c.cs);
        c.fy = clamp(c.fy, 0, m.dH - c.cs);
      }
      next[i] = c;
      return next;
    });
  };
  const setCropRef = useRef(setCrop); setCropRef.current = setCrop;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const { idx: i, crops: cs } = stateRef.current;
        const c = cs[i] ?? { fx: 0, fy: 0, cs: STAGE_W };
        startRef.current = { fx: c.fx, fy: c.fy, cs: c.cs, dist: null };
      },
      onPanResponderMove: (evt, gesture) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (startRef.current.dist == null) startRef.current.dist = dist;
          else {
            const ratio = dist / startRef.current.dist;
            // 指を広げる=拡大=枠を小さく（被写体に寄る）
            setCropRef.current({ cs: startRef.current.cs / ratio });
          }
        } else {
          setCropRef.current({ fx: startRef.current.fx + gesture.dx, fy: startRef.current.fy + gesture.dy });
        }
      },
      onPanResponderRelease: () => { startRef.current.dist = null; },
      onPanResponderTerminate: () => { startRef.current.dist = null; },
    })
  ).current;

  const zoom = (factor: number) => setCrop({ cs: crop.cs * factor });

  const handleDone = async () => {
    setProcessing(true);
    try {
      const results: { blob: Blob; previewUrl: string }[] = [];
      for (let i = 0; i < images.length; i++) {
        const m = metas[i]; const c = crops[i];
        const cropN: FeedCrop = m
          ? { x: c.fx / m.dW, y: c.fy / m.dH, size: c.cs / m.dW }
          : { x: 0, y: 0, size: 1 };
        results.push(await composeSquareImage(images[i], cropN));
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
          <Text style={styles.title}>切り抜き範囲を選ぶ</Text>
          <TouchableOpacity onPress={handleDone} disabled={processing}>
            {processing ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.next}>次へ ›</Text>}
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>枠をドラッグして移動・2本指で大きさを調整できます</Text>

        {/* 写真は固定、切り抜き枠を動かす */}
        <View style={styles.stageWrap}>
          {meta ? (
            <View style={{ width: meta.dW, height: meta.dH }} {...pan.panHandlers}>
              <Image source={{ uri: images[idx] }} style={{ width: meta.dW, height: meta.dH }} resizeMode="contain" />
              {/* 枠外を暗くするマスク */}
              <View style={[styles.mask, { left: 0, top: 0, width: meta.dW, height: crop.fy }]} pointerEvents="none" />
              <View style={[styles.mask, { left: 0, top: crop.fy + crop.cs, width: meta.dW, height: meta.dH - crop.fy - crop.cs }]} pointerEvents="none" />
              <View style={[styles.mask, { left: 0, top: crop.fy, width: crop.fx, height: crop.cs }]} pointerEvents="none" />
              <View style={[styles.mask, { left: crop.fx + crop.cs, top: crop.fy, width: meta.dW - crop.fx - crop.cs, height: crop.cs }]} pointerEvents="none" />
              {/* 枠の枠線 */}
              <View style={[styles.cropBox, { left: crop.fx, top: crop.fy, width: crop.cs, height: crop.cs }]} pointerEvents="none" />
            </View>
          ) : (
            <View style={{ width: STAGE_W, height: STAGE_W, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          )}
        </View>

        <View style={styles.zoomRow}>
          <TouchableOpacity style={styles.zoomBtn} onPress={() => zoom(1 / 0.85)}><Text style={styles.zoomBtnText}>－</Text></TouchableOpacity>
          <Text style={styles.zoomLabel}>大きさ</Text>
          <TouchableOpacity style={styles.zoomBtn} onPress={() => zoom(0.85)}><Text style={styles.zoomBtnText}>＋</Text></TouchableOpacity>
        </View>

        {images.length > 1 && (
          <View style={styles.thumbRow}>
            {images.map((uri, i) => (
              <TouchableOpacity key={i} onPress={() => setIdx(i)} style={[styles.thumb, i === idx && styles.thumbActive]}>
                <Image source={{ uri }} style={styles.thumbImg} resizeMode="cover" />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </Modal>
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
  hint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: SPACING.md },
  stageWrap: {
    alignItems: 'center', justifyContent: 'center', marginTop: SPACING.md,
    minHeight: STAGE_MAX_H,
    ...(Platform.OS === 'web' ? ({ touchAction: 'none' } as object) : {}),
  },
  mask: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  cropBox: { position: 'absolute', borderWidth: 2, borderColor: '#fff' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.md, marginTop: SPACING.lg },
  zoomBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  zoomBtnText: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  zoomLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, justifyContent: 'center', marginTop: SPACING.xl, paddingHorizontal: SPACING.md },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: COLORS.primary },
  thumbImg: { width: '100%', height: '100%' },
});

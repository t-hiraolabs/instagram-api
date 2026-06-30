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
import { FeedTransform, DEFAULT_FEED_TRANSFORM, ASPECTS, AspectKey, composeFeedImage } from '../utils/composeFeed';

interface Props {
  visible: boolean;
  images: string[];
  onCancel: () => void;
  onDone: (results: { blob: Blob; previewUrl: string }[]) => void;
}

const SCREEN_W = Dimensions.get('window').width;
const FRAME_W = Math.min(SCREEN_W - SPACING.md * 2, 400);
const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

export default function FeedCropEditor({ visible, images, onCancel, onDone }: Props) {
  const [aspect, setAspect] = useState<AspectKey>('square');
  const [idx, setIdx] = useState(0);
  const [transforms, setTransforms] = useState<FeedTransform[]>([]);
  const [processing, setProcessing] = useState(false);

  const ar = ASPECTS[aspect];
  const frameH = FRAME_W / ar;

  useEffect(() => {
    if (visible) {
      setTransforms(images.map(() => ({ ...DEFAULT_FEED_TRANSFORM })));
      setIdx(0);
      setAspect('square');
    }
  }, [visible, images]);

  const cur = transforms[idx] ?? DEFAULT_FEED_TRANSFORM;

  // PanResponder用の最新値ref
  const stateRef = useRef({ idx, transforms });
  stateRef.current = { idx, transforms };
  const startRef = useRef<{ x: number; y: number; scale: number; dist: number | null }>({ x: 0, y: 0, scale: 1, dist: null });

  const setT = (patch: Partial<FeedTransform>) => {
    setTransforms((prev) => {
      const i = stateRef.current.idx;
      const next = [...prev];
      const t = { ...(next[i] ?? DEFAULT_FEED_TRANSFORM), ...patch };
      t.scale = clamp(t.scale, MIN_SCALE, MAX_SCALE);
      // 黒フチが出ないよう移動量を制限（拡大時のみ動かせる）
      const lim = (t.scale - 1) / 2;
      t.x = clamp(t.x, -lim, lim);
      t.y = clamp(t.y, -lim, lim);
      next[i] = t;
      return next;
    });
  };
  const setTRef = useRef(setT); setTRef.current = setT;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const { idx: i, transforms: ts } = stateRef.current;
        const t = ts[i] ?? DEFAULT_FEED_TRANSFORM;
        startRef.current = { x: t.x, y: t.y, scale: t.scale, dist: null };
      },
      onPanResponderMove: (evt, gesture) => {
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
            y: startRef.current.y + gesture.dy / (FRAME_W / ASPECTS[aspectRef.current]),
          });
        }
      },
      onPanResponderRelease: () => { startRef.current.dist = null; },
      onPanResponderTerminate: () => { startRef.current.dist = null; },
    })
  ).current;
  const aspectRef = useRef(aspect); aspectRef.current = aspect;

  const zoom = (delta: number) => setT({ scale: cur.scale + delta });

  const handleDone = async () => {
    setProcessing(true);
    try {
      const results: { blob: Blob; previewUrl: string }[] = [];
      for (let i = 0; i < images.length; i++) {
        results.push(await composeFeedImage(images[i], transforms[i] ?? DEFAULT_FEED_TRANSFORM, ar));
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

        <Text style={styles.hint}>ドラッグで位置・2本指で拡大できます</Text>

        {/* 固定フレーム内で写真を動かす（Instagram方式） */}
        <View style={styles.stageWrap}>
          <View style={[styles.frame, { width: FRAME_W, height: frameH }]} {...pan.panHandlers}>
            {images[idx] && (
              <Image
                source={{ uri: images[idx] }}
                style={{
                  width: FRAME_W,
                  height: frameH,
                  transform: [
                    { translateX: cur.x * FRAME_W },
                    { translateY: cur.y * frameH },
                    { scale: cur.scale },
                  ],
                }}
                resizeMode="cover"
              />
            )}
          </View>
        </View>

        {/* 比率切り替え */}
        <View style={styles.aspectRow}>
          <TouchableOpacity style={[styles.aspectBtn, aspect === 'square' && styles.aspectBtnActive]} onPress={() => setAspect('square')}>
            <Text style={[styles.aspectText, aspect === 'square' && styles.aspectTextActive]}>1:1</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.aspectBtn, aspect === 'portrait' && styles.aspectBtnActive]} onPress={() => setAspect('portrait')}>
            <Text style={[styles.aspectText, aspect === 'portrait' && styles.aspectTextActive]}>4:5</Text>
          </TouchableOpacity>
        </View>

        {/* ズーム補助 */}
        <View style={styles.zoomRow}>
          <TouchableOpacity style={styles.zoomBtn} onPress={() => zoom(-0.2)}><Text style={styles.zoomBtnText}>－</Text></TouchableOpacity>
          <Text style={styles.zoomLabel}>拡大 {Math.round(cur.scale * 100)}%</Text>
          <TouchableOpacity style={styles.zoomBtn} onPress={() => zoom(0.2)}><Text style={styles.zoomBtnText}>＋</Text></TouchableOpacity>
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
  stageWrap: { alignItems: 'center', marginTop: SPACING.md },
  frame: {
    overflow: 'hidden',
    borderRadius: RADIUS.md,
    backgroundColor: '#000',
    ...(Platform.OS === 'web' ? ({ cursor: 'grab', touchAction: 'none' } as object) : {}),
  },
  aspectRow: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm, marginTop: SPACING.lg },
  aspectBtn: { paddingHorizontal: SPACING.lg, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  aspectBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  aspectText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '700' },
  aspectTextActive: { color: '#fff' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.md, marginTop: SPACING.md },
  zoomBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  zoomBtnText: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  zoomLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', minWidth: 90, textAlign: 'center' },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, justifyContent: 'center', marginTop: SPACING.xl, paddingHorizontal: SPACING.md },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: COLORS.primary },
  thumbImg: { width: '100%', height: '100%' },
});

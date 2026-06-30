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
import { FeedTransform, DEFAULT_FEED_TRANSFORM, composeSquareImage } from '../utils/composeFeed';

interface Props {
  visible: boolean;
  images: string[]; // 編集する写真のURI（生）
  onCancel: () => void;
  onDone: (results: { blob: Blob; previewUrl: string }[]) => void;
}

const SCREEN_W = Dimensions.get('window').width;
const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export default function FeedCropEditor({ visible, images, onCancel, onDone }: Props) {
  const frame = Math.min(SCREEN_W - SPACING.md * 2, 420);
  const [idx, setIdx] = useState(0);
  const [transforms, setTransforms] = useState<FeedTransform[]>([]);
  const [processing, setProcessing] = useState(false);

  // 画像が変わったら初期化
  useEffect(() => {
    if (visible) {
      setTransforms(images.map(() => ({ ...DEFAULT_FEED_TRANSFORM })));
      setIdx(0);
    }
  }, [visible, images]);

  const cur = transforms[idx] ?? DEFAULT_FEED_TRANSFORM;

  // ジェスチャー開始時の値を保持
  const startRef = useRef<{ x: number; y: number; scale: number; dist: number | null }>({
    x: 0, y: 0, scale: 1, dist: null,
  });

  const update = (patch: Partial<FeedTransform>) => {
    setTransforms((prev) => {
      const next = [...prev];
      next[idx] = { ...(next[idx] ?? DEFAULT_FEED_TRANSFORM), ...patch };
      return next;
    });
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const t = transformsRef.current[idxRef.current] ?? DEFAULT_FEED_TRANSFORM;
        startRef.current = { x: t.x, y: t.y, scale: t.scale, dist: null };
      },
      onPanResponderMove: (evt, gesture) => {
        const touches = evt.nativeEvent.touches;
        const f = frameRef.current;
        if (touches.length >= 2) {
          // ピンチ（2本指）で拡大縮小
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (startRef.current.dist == null) {
            startRef.current.dist = dist;
            startRef.current.scale = (transformsRef.current[idxRef.current] ?? DEFAULT_FEED_TRANSFORM).scale;
          } else {
            const ratio = dist / startRef.current.dist;
            updateRef.current({ scale: clamp(startRef.current.scale * ratio, MIN_SCALE, MAX_SCALE) });
          }
        } else {
          // 1本指でドラッグ移動（フレーム比に変換）
          updateRef.current({
            x: startRef.current.x + gesture.dx / f,
            y: startRef.current.y + gesture.dy / f,
          });
        }
      },
      onPanResponderRelease: () => { startRef.current.dist = null; },
      onPanResponderTerminate: () => { startRef.current.dist = null; },
    })
  ).current;

  // PanResponder内で最新値を参照するためのref
  const transformsRef = useRef(transforms); transformsRef.current = transforms;
  const idxRef = useRef(idx); idxRef.current = idx;
  const frameRef = useRef(frame); frameRef.current = frame;
  const updateRef = useRef(update); updateRef.current = update;

  const zoomBy = (delta: number) => update({ scale: clamp(cur.scale + delta, MIN_SCALE, MAX_SCALE) });

  const handleDone = async () => {
    setProcessing(true);
    try {
      const results: { blob: Blob; previewUrl: string }[] = [];
      for (let i = 0; i < images.length; i++) {
        results.push(await composeSquareImage(images[i], transforms[i] ?? DEFAULT_FEED_TRANSFORM));
      }
      onDone(results);
    } catch {
      // 失敗時は何もしない（呼び出し側でハンドリングしてもよい）
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancel}>キャンセル</Text>
          </TouchableOpacity>
          <Text style={styles.title}>写真を調整</Text>
          <TouchableOpacity onPress={handleDone} disabled={processing}>
            {processing ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.next}>次へ ›</Text>}
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>2本指で拡大・1本指で位置調整できます</Text>

        {/* 編集フレーム（正方形） */}
        <View style={styles.frameWrap}>
          <View style={[styles.frame, { width: frame, height: frame }]} {...pan.panHandlers}>
            {images[idx] && (
              <Image
                source={{ uri: images[idx] }}
                style={{
                  width: frame,
                  height: frame,
                  transform: [
                    { translateX: cur.x * frame },
                    { translateY: cur.y * frame },
                    { scale: cur.scale },
                  ],
                }}
                resizeMode="cover"
              />
            )}
          </View>
        </View>

        {/* ズーム操作（Webやマウス用の補助） */}
        <View style={styles.zoomRow}>
          <TouchableOpacity style={styles.zoomBtn} onPress={() => zoomBy(-0.2)}>
            <Text style={styles.zoomBtnText}>－</Text>
          </TouchableOpacity>
          <Text style={styles.zoomLabel}>拡大 {Math.round(cur.scale * 100)}%</Text>
          <TouchableOpacity style={styles.zoomBtn} onPress={() => zoomBy(0.2)}>
            <Text style={styles.zoomBtnText}>＋</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resetBtn} onPress={() => update({ ...DEFAULT_FEED_TRANSFORM })}>
            <Text style={styles.resetBtnText}>リセット</Text>
          </TouchableOpacity>
        </View>

        {/* 複数枚: サムネ切り替え */}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  cancel: { color: COLORS.textMuted, fontSize: 15, fontWeight: '600' },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  next: { color: COLORS.primary, fontSize: 15, fontWeight: '800' },
  hint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: SPACING.md },
  frameWrap: { alignItems: 'center', marginTop: SPACING.md },
  frame: {
    overflow: 'hidden',
    borderRadius: RADIUS.md,
    backgroundColor: '#000',
    ...(Platform.OS === 'web' ? ({ cursor: 'grab', touchAction: 'none' } as object) : {}),
  },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    marginTop: SPACING.lg,
  },
  zoomBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  zoomBtnText: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  zoomLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', minWidth: 90, textAlign: 'center' },
  resetBtn: { paddingHorizontal: SPACING.md, paddingVertical: 10, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  resetBtnText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, justifyContent: 'center', marginTop: SPACING.xl, paddingHorizontal: SPACING.md },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: COLORS.primary },
  thumbImg: { width: '100%', height: '100%' },
});

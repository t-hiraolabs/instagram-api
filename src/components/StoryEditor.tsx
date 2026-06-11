// ストーリーのレイアウト編集（web専用）: 写真・文字をドラッグで移動、ボタンで拡大縮小
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../utils/theme';
import {
  StoryOverlay,
  StoryTransform,
  DEFAULT_TRANSFORM,
  loadImage,
  drawStory,
  W,
  H,
} from '../utils/composeStory';

const DISP_W = 270; // 画面に表示する横幅(px)
const DISP_H = (DISP_W * H) / W;

interface Props {
  imageUri: string;
  overlay: StoryOverlay;
  onChange: (t: StoryTransform) => void;
}

type Target = 'text' | 'image';

export default function StoryEditor({ imageUri, overlay, onChange }: Props) {
  const hostRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const tRef = useRef<StoryTransform>({ ...DEFAULT_TRANSFORM });
  const targetRef = useRef<Target>('text');
  const overlayRef = useRef(overlay);
  const onChangeRef = useRef(onChange);
  const [target, setTarget] = useState<Target>('text');

  overlayRef.current = overlay;
  onChangeRef.current = onChange;

  const redraw = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawStory(ctx, img, overlayRef.current, tRef.current);
  };

  // キャンバスとドラッグ操作を一度だけ用意
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const host = hostRef.current as HTMLElement | null;
    if (!host) return;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    Object.assign(canvas.style, {
      width: `${DISP_W}px`,
      height: `${DISP_H}px`,
      borderRadius: '14px',
      touchAction: 'none',
      cursor: 'grab',
      display: 'block',
      backgroundColor: '#000',
    } as Partial<CSSStyleDeclaration>);
    host.appendChild(canvas);
    canvasRef.current = canvas;

    let last: { x: number; y: number } | null = null;
    const factor = () => W / canvas.getBoundingClientRect().width;

    const down = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      const f = factor();
      const dx = (e.clientX - last.x) * f;
      const dy = (e.clientY - last.y) * f;
      last = { x: e.clientX, y: e.clientY };
      const t = tRef.current;
      if (targetRef.current === 'image') {
        t.imgX += dx;
        t.imgY += dy;
      } else {
        t.textX += dx;
        t.textY += dy;
      }
      redraw();
    };
    const up = () => {
      if (!last) return;
      last = null;
      canvas.style.cursor = 'grab';
      onChangeRef.current({ ...tRef.current });
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.remove();
    };
  }, []);

  // 写真が変わったら読み込んで再描画
  useEffect(() => {
    let alive = true;
    if (!imageUri) return;
    loadImage(imageUri)
      .then((img) => {
        if (!alive) return;
        imgRef.current = img;
        redraw();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [imageUri]);

  // 文字が変わったら再描画
  useEffect(() => {
    redraw();
  }, [overlay.title, overlay.bodyText, overlay.cta, overlay.textColor]);

  const scale = (dir: 1 | -1) => {
    const t = tRef.current;
    const k = dir > 0 ? 1.08 : 1 / 1.08;
    if (targetRef.current === 'image') {
      t.imgScale = Math.min(4, Math.max(0.3, t.imgScale * k));
    } else {
      t.textScale = Math.min(3, Math.max(0.4, t.textScale * k));
    }
    redraw();
    onChangeRef.current({ ...t });
  };

  const reset = () => {
    tRef.current = { ...DEFAULT_TRANSFORM };
    redraw();
    onChangeRef.current({ ...tRef.current });
  };

  const pick = (tg: Target) => {
    targetRef.current = tg;
    setTarget(tg);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.segment}>
        <TouchableOpacity
          style={[styles.seg, target === 'text' && styles.segActive]}
          onPress={() => pick('text')}
          activeOpacity={0.85}
        >
          <Text style={[styles.segText, target === 'text' && styles.segTextActive]}>
            ✏️ 文字を動かす
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.seg, target === 'image' && styles.segActive]}
          onPress={() => pick('image')}
          activeOpacity={0.85}
        >
          <Text style={[styles.segText, target === 'image' && styles.segTextActive]}>
            🖼 写真を動かす
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.canvasWrap}>
        <View ref={hostRef} style={styles.canvasHost} />
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.ctrlBtn} onPress={() => scale(-1)} activeOpacity={0.8}>
          <Text style={styles.ctrlText}>－ 縮小</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={() => scale(1)} activeOpacity={0.8}>
          <Text style={styles.ctrlText}>＋ 拡大</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={reset} activeOpacity={0.8}>
          <Text style={styles.ctrlText}>↺ 戻す</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        画像をドラッグで移動 ／ ＋－で拡大縮小（「文字」「写真」を上で切替）
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginTop: SPACING.sm },
  segment: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  seg: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.primary + '66',
    backgroundColor: COLORS.surfaceElevated,
  },
  segActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  segText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  segTextActive: { color: '#fff' },
  canvasWrap: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  canvasHost: { width: DISP_W, height: DISP_H },
  controls: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  ctrlBtn: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.primary + '44',
  },
  ctrlText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  hint: {
    color: COLORS.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
});

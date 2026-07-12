// 任意の色をHSVカラースペースからhexコードで選べるモーダル。
// 彩度・明度の正方形パッドと色相バーをドラッグして選択し、hex欄への直接入力にも対応する。
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, StyleSheet, PanResponder, GestureResponderEvent,
} from 'react-native';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS } from '../utils/theme';

const SV_SIZE = 260;
const HUE_HEIGHT = 28;
const THUMB = 22;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

interface ColorPickerModalProps {
  visible: boolean;
  initialColor: string;
  onChange: (hex: string) => void;
  onClose: () => void;
}

export default function ColorPickerModal({ visible, initialColor, onChange, onClose }: ColorPickerModalProps) {
  const [hex, setHex] = useState(initialColor || '#FFFFFF');
  const [h, setH] = useState(0);
  const [s, setS] = useState(1);
  const [v, setV] = useState(1);
  // ドラッグハンドラはPanResponder生成時（初回レンダー）のクロージャに固定されるため、
  // 最新のh/s/vはstateではなくrefで読み書きする
  const hsvRef = useRef({ h: 0, s: 1, v: 1 });

  const svRef = useRef<View>(null);
  const hueRef = useRef<View>(null);
  const svOrigin = useRef({ x: 0, y: 0 });
  const hueOrigin = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!visible) return;
    const parsed = hexToHsv(initialColor) ?? { h: 0, s: 1, v: 1 };
    hsvRef.current = parsed;
    setH(parsed.h); setS(parsed.s); setV(parsed.v);
    setHex((initialColor || '#FFFFFF').toUpperCase());
  }, [visible, initialColor]);

  const applyHsv = (nh: number, ns: number, nv: number) => {
    hsvRef.current = { h: nh, s: ns, v: nv };
    setH(nh); setS(ns); setV(nv);
    const newHex = hsvToHex(nh, ns, nv);
    setHex(newHex);
    onChange(newHex);
  };

  const handleSvMove = (pageX: number, pageY: number) => {
    const ns = clamp((pageX - svOrigin.current.x) / SV_SIZE, 0, 1);
    const nv = clamp(1 - (pageY - svOrigin.current.y) / SV_SIZE, 0, 1);
    applyHsv(hsvRef.current.h, ns, nv);
  };

  const handleHueMove = (pageX: number) => {
    const nh = clamp(((pageX - hueOrigin.current.x) / SV_SIZE) * 360, 0, 359.999);
    applyHsv(nh, hsvRef.current.s, hsvRef.current.v);
  };

  const svResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        svRef.current?.measure((_x, _y, _w, _h2, pageX, pageY) => {
          svOrigin.current = { x: pageX, y: pageY };
          handleSvMove(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        });
      },
      onPanResponderMove: (evt: GestureResponderEvent) => handleSvMove(evt.nativeEvent.pageX, evt.nativeEvent.pageY),
    })
  ).current;

  const hueResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        hueRef.current?.measure((_x, _y, _w, _h2, pageX, pageY) => {
          hueOrigin.current = { x: pageX, y: pageY };
          handleHueMove(evt.nativeEvent.pageX);
        });
      },
      onPanResponderMove: (evt: GestureResponderEvent) => handleHueMove(evt.nativeEvent.pageX),
    })
  ).current;

  const handleHexInput = (text: string) => {
    setHex(text);
    const parsed = hexToHsv(text);
    if (parsed) {
      hsvRef.current = parsed;
      setH(parsed.h); setS(parsed.s); setV(parsed.v);
      onChange(`#${text.trim().replace(/^#/, '').toUpperCase()}`);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.title}>カラーピッカー</Text>

          <View
            ref={svRef}
            style={{ width: SV_SIZE, height: SV_SIZE }}
            {...svResponder.panHandlers}
          >
            <Svg width={SV_SIZE} height={SV_SIZE}>
              <Defs>
                <LinearGradient id="satGrad" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
                  <Stop offset="1" stopColor={hsvToHex(h, 1, 1)} stopOpacity={1} />
                </LinearGradient>
                <LinearGradient id="valGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#000000" stopOpacity={0} />
                  <Stop offset="1" stopColor="#000000" stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width={SV_SIZE} height={SV_SIZE} fill="url(#satGrad)" />
              <Rect x={0} y={0} width={SV_SIZE} height={SV_SIZE} fill="url(#valGrad)" />
            </Svg>
            <View
              pointerEvents="none"
              style={[
                styles.thumb,
                { left: s * SV_SIZE - THUMB / 2, top: (1 - v) * SV_SIZE - THUMB / 2, backgroundColor: hex },
              ]}
            />
          </View>

          <View
            ref={hueRef}
            style={{ width: SV_SIZE, height: HUE_HEIGHT, marginTop: SPACING.md }}
            {...hueResponder.panHandlers}
          >
            <Svg width={SV_SIZE} height={HUE_HEIGHT}>
              <Defs>
                <LinearGradient id="hueGrad" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#FF0000" />
                  <Stop offset="0.17" stopColor="#FFFF00" />
                  <Stop offset="0.33" stopColor="#00FF00" />
                  <Stop offset="0.5" stopColor="#00FFFF" />
                  <Stop offset="0.67" stopColor="#0000FF" />
                  <Stop offset="0.83" stopColor="#FF00FF" />
                  <Stop offset="1" stopColor="#FF0000" />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width={SV_SIZE} height={HUE_HEIGHT} rx={HUE_HEIGHT / 2} fill="url(#hueGrad)" />
            </Svg>
            <View
              pointerEvents="none"
              style={[
                styles.hueThumb,
                { left: (h / 360) * SV_SIZE - HUE_HEIGHT / 2, backgroundColor: hsvToHex(h, 1, 1) },
              ]}
            />
          </View>

          <View style={styles.hexRow}>
            <View style={[styles.previewSwatch, { backgroundColor: hex }]} />
            <TextInput
              style={styles.hexInput}
              value={hex}
              onChangeText={handleHexInput}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="#FFFFFF"
              placeholderTextColor={COLORS.textMuted}
            />
          </View>

          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>閉じる</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  card: {
    width: SV_SIZE + SPACING.lg * 2, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, alignItems: 'center',
  },
  closeBtn: { position: 'absolute', top: SPACING.sm, right: SPACING.sm, padding: SPACING.xs, zIndex: 1 },
  title: { color: COLORS.text, fontWeight: '800', fontSize: 15, marginBottom: SPACING.md },
  thumb: {
    position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 2, elevation: 3,
  },
  hueThumb: {
    position: 'absolute', top: 0, width: HUE_HEIGHT, height: HUE_HEIGHT, borderRadius: HUE_HEIGHT / 2,
    borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 2, elevation: 3,
  },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.lg, width: '100%' },
  previewSwatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border },
  hexInput: {
    flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, color: COLORS.text, backgroundColor: COLORS.background,
  },
  doneBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md, marginTop: SPACING.md, width: '100%', alignItems: 'center',
  },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

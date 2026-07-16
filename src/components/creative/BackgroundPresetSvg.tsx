// 写真を使わない背景（色・グラデーション・パターン）をreact-native-svgで描画する。
// Web・ネイティブ両対応で、外部の画像素材を必要としない。
import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Rect, Pattern, Circle } from 'react-native-svg';
import { BackgroundPreset } from '../../utils/backgroundPresets';

interface Props {
  preset: BackgroundPreset;
  width: number;
  height: number;
}

export default function BackgroundPresetSvg({ preset, width, height }: Props) {
  const [base, accent] = preset.colors;
  const patternId = `bg-${preset.id}`;

  if (preset.kind === 'solid') {
    return (
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill={base} />
      </Svg>
    );
  }

  if (preset.kind === 'gradient') {
    return (
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={patternId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={base} />
            <Stop offset="1" stopColor={accent} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${patternId})`} />
      </Svg>
    );
  }

  if (preset.kind === 'dots') {
    const tile = Math.max(28, width * 0.09);
    return (
      <Svg width={width} height={height}>
        <Defs>
          <Pattern id={patternId} patternUnits="userSpaceOnUse" width={tile} height={tile}>
            <Rect x={0} y={0} width={tile} height={tile} fill={base} />
            <Circle cx={tile / 2} cy={tile / 2} r={tile * 0.12} fill={accent} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${patternId})`} />
      </Svg>
    );
  }

  // stripes
  const tile = Math.max(36, width * 0.12);
  return (
    <Svg width={width} height={height}>
      <Defs>
        <Pattern
          id={patternId}
          patternUnits="userSpaceOnUse"
          width={tile}
          height={tile}
          patternTransform="rotate(45)"
        >
          <Rect x={0} y={0} width={tile} height={tile} fill={base} />
          <Rect x={0} y={0} width={tile / 2} height={tile} fill={accent} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${patternId})`} />
    </Svg>
  );
}

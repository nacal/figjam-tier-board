// 色。Figma のノードには触らない。

import { ColorPreset } from '../events';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const COLOR_PRESETS: ColorPreset[] = [
  { key: 'red', label: 'レッド', hex: '#F19A9A' },
  { key: 'orange', label: 'オレンジ', hex: '#F5BC85' },
  { key: 'yellow', label: 'イエロー', hex: '#F8DE94' },
  { key: 'lemon', label: 'レモン', hex: '#FBFB9C' },
  { key: 'green', label: 'グリーン', hex: '#CBF6A0' },
  { key: 'blue', label: 'ブルー', hex: '#A8DAFF' },
  { key: 'purple', label: 'パープル', hex: '#D3BDFF' },
  { key: 'gray', label: 'グレー', hex: '#D9D9D9' },
];

export const FALLBACK_COLOR_KEY = 'gray';

export function hexToRgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

export function findPreset(key: string): ColorPreset {
  for (const preset of COLOR_PRESETS) {
    if (preset.key === key) {
      return preset;
    }
  }
  for (const preset of COLOR_PRESETS) {
    if (preset.key === FALLBACK_COLOR_KEY) {
      return preset;
    }
  }
  throw new Error('color preset table is broken');
}

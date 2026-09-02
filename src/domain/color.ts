import { ColorPreset } from '../events';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const COLOR_PRESETS: ColorPreset[] = [
  { key: 'red', label: 'Red', hex: '#F19A9A' },
  { key: 'orange', label: 'Orange', hex: '#F5BC85' },
  { key: 'yellow', label: 'Yellow', hex: '#F8DE94' },
  { key: 'lemon', label: 'Lemon', hex: '#FBFB9C' },
  { key: 'green', label: 'Green', hex: '#CBF6A0' },
  { key: 'blue', label: 'Blue', hex: '#A8DAFF' },
  { key: 'purple', label: 'Purple', hex: '#D3BDFF' },
  { key: 'gray', label: 'Gray', hex: '#D9D9D9' },
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

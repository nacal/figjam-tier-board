import { Rgb } from './color';

// Canvas fills are document data, so every collaborator sees the same colours;
// this cannot follow each viewer's editor theme. Figma has the same constraint —
// its theme setting only picks the default background of *new* files. So the
// theme is a per-board choice, seeded from the canvas background.
export type BoardTheme = 'light' | 'dark';

export interface BoardPalette {
  content: string;
  border: string;
  title: string;
}

export const BOARD_PALETTES: Record<BoardTheme, BoardPalette> = {
  dark: { content: '#1B1B1B', border: '#3D3D3D', title: '#F2F2F2' },
  // The light face is brighter than the canvas so the board reads as a card.
  // Matching the canvas would leave nothing but the row borders visible.
  light: { content: '#FFFFFF', border: '#D5D5D5', title: '#1E1E1E' },
};

export const DEFAULT_BOARD_THEME: BoardTheme = 'dark';

export function paletteFor(theme: BoardTheme): BoardPalette {
  return BOARD_PALETTES[theme];
}

export function parseTheme(value: string, fallback: BoardTheme): BoardTheme {
  return value === 'light' || value === 'dark' ? value : fallback;
}

// sRGB relative luminance. A plain average underrates green and overrates blue,
// which reads a pure green background as dark.
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

export function themeForBackground(background: Rgb | null, fallback: BoardTheme): BoardTheme {
  if (background === null) {
    return fallback;
  }
  return relativeLuminance(background) < 0.5 ? 'dark' : 'light';
}

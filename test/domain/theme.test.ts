import assert from 'node:assert/strict';
import { test } from 'vitest';

import { hexToRgb } from '../../src/domain/color';
import {
  BOARD_PALETTES,
  paletteFor,
  parseTheme,
  relativeLuminance,
  themeForBackground,
} from '../../src/domain/theme';

test('light and dark differ in face, border and heading', () => {
  const dark = paletteFor('dark');
  const light = paletteFor('light');
  assert.notEqual(dark.content, light.content);
  assert.notEqual(dark.border, light.border);
  assert.notEqual(dark.title, light.title);
});

test('the heading contrasts enough with the face', () => {
  for (const theme of ['light', 'dark'] as const) {
    const palette = BOARD_PALETTES[theme];
    const diff = Math.abs(
      relativeLuminance(hexToRgb(palette.content)) - relativeLuminance(hexToRgb(palette.title)),
    );
    assert.ok(diff > 0.5, `${theme}: face vs heading differs by only ${diff.toFixed(2)}`);
  }
});

test('the light face is brighter than the canvas, so more than the borders shows', () => {
  // FigJam's light default background, as measured.
  const canvas = relativeLuminance(hexToRgb('#E5E5E5'));
  const content = relativeLuminance(hexToRgb(BOARD_PALETTES.light.content));
  assert.ok(content > canvas, 'a face darker than the background would not read as a card');
});

test('the palette follows the lightness of the canvas background', () => {
  // Figma defaults: light #F5F5F5, dark #1E1E1E. FigJam measures #E5E5E5.
  assert.equal(themeForBackground(hexToRgb('#F5F5F5'), 'dark'), 'light');
  assert.equal(themeForBackground(hexToRgb('#E5E5E5'), 'dark'), 'light');
  assert.equal(themeForBackground(hexToRgb('#1E1E1E'), 'light'), 'dark');
  assert.equal(themeForBackground(hexToRgb('#000000'), 'light'), 'dark');
});

test('falls back when the background cannot be read', () => {
  assert.equal(themeForBackground(null, 'dark'), 'dark');
  assert.equal(themeForBackground(null, 'light'), 'light');
});

test('luminance weights green over blue, unlike a plain average', () => {
  const green = relativeLuminance(hexToRgb('#00FF00'));
  const blue = relativeLuminance(hexToRgb('#0000FF'));
  assert.ok(green > blue);
  // A plain average makes both 1/3 and reads a pure green background as dark.
  assert.equal(themeForBackground(hexToRgb('#00FF00'), 'dark'), 'light');
  assert.equal(themeForBackground(hexToRgb('#0000FF'), 'light'), 'dark');
});

test('an unreadable value falls back to the default', () => {
  assert.equal(parseTheme('light', 'dark'), 'light');
  assert.equal(parseTheme('dark', 'light'), 'dark');
  assert.equal(parseTheme('', 'dark'), 'dark', 'a board with no palette keeps the default');
  assert.equal(parseTheme('sepia', 'light'), 'light');
});

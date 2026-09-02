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

test('ライトとダークで面・境界線・見出しの色が入れ替わる', () => {
  const dark = paletteFor('dark');
  const light = paletteFor('light');
  assert.notEqual(dark.content, light.content);
  assert.notEqual(dark.border, light.border);
  assert.notEqual(dark.title, light.title);
});

test('見出しの文字は面と十分な明暗差がある', () => {
  for (const theme of ['light', 'dark'] as const) {
    const palette = BOARD_PALETTES[theme];
    const diff = Math.abs(
      relativeLuminance(hexToRgb(palette.content)) - relativeLuminance(hexToRgb(palette.title)),
    );
    assert.ok(diff > 0.5, `${theme}: 面と見出しの差が ${diff.toFixed(2)} しかない`);
  }
});

test('ライトの面はキャンバスより明るい（境界線だけの見た目にならない）', () => {
  // FigJam のライトの既定背景（実測値）
  const canvas = relativeLuminance(hexToRgb('#E5E5E5'));
  const content = relativeLuminance(hexToRgb(BOARD_PALETTES.light.content));
  assert.ok(content > canvas, '面が背景より暗いとカードに見えない');
});

test('キャンバス背景の明暗で配色が決まる', () => {
  // Figma の既定値: ライト #F5F5F5 / ダーク #1E1E1E、FigJam の実測は #E5E5E5
  assert.equal(themeForBackground(hexToRgb('#F5F5F5'), 'dark'), 'light');
  assert.equal(themeForBackground(hexToRgb('#E5E5E5'), 'dark'), 'light');
  assert.equal(themeForBackground(hexToRgb('#1E1E1E'), 'light'), 'dark');
  assert.equal(themeForBackground(hexToRgb('#000000'), 'light'), 'dark');
});

test('背景が読めなければ既定のまま', () => {
  assert.equal(themeForBackground(null, 'dark'), 'dark');
  assert.equal(themeForBackground(null, 'light'), 'light');
});

test('輝度は緑を重く、青を軽く見る（単純な平均ではない）', () => {
  const green = relativeLuminance(hexToRgb('#00FF00'));
  const blue = relativeLuminance(hexToRgb('#0000FF'));
  assert.ok(green > blue);
  // 平均だとどちらも 1/3 になり、真緑の背景をダークと誤判定する
  assert.equal(themeForBackground(hexToRgb('#00FF00'), 'dark'), 'light');
  assert.equal(themeForBackground(hexToRgb('#0000FF'), 'light'), 'dark');
});

test('読めない値は既定に落ちる', () => {
  assert.equal(parseTheme('light', 'dark'), 'light');
  assert.equal(parseTheme('dark', 'light'), 'dark');
  assert.equal(parseTheme('', 'dark'), 'dark', '配色を持たない盤面は既定のまま');
  assert.equal(parseTheme('sepia', 'light'), 'light');
});

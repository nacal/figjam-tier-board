import assert from 'node:assert/strict';
import { test } from 'vitest';

import { BOARD_PALETTES } from '../src/domain/theme';
import { createHarness, type FakeNode, type Harness } from './harness';

function fillHex(node: FakeNode): string {
  const fills = JSON.parse(JSON.stringify(node.fills)) as Array<{
    color: { r: number; g: number; b: number };
  }>;
  const { r, g, b } = fills[0].color;
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function strokeHex(node: FakeNode): string {
  const strokes = JSON.parse(JSON.stringify(node.strokes)) as Array<{
    color: { r: number; g: number; b: number };
  }>;
  const { r, g, b } = strokes[0].color;
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

async function boardOn(h: Harness, background: string): Promise<FakeNode> {
  h.setCanvasBackground(background);
  await h.send('CREATE_BOARD');
  await h.flush();
  return h.containers()[0];
}

test('明るいキャンバスに作った盤面はライト配色になる', async () => {
  const h = createHarness();
  // FigJam のライトの既定（実測値）
  const container = await boardOn(h, '#E5E5E5');

  assert.equal(h.state().boardTheme, 'light');
  assert.equal(fillHex(h.rowsOf(container)[0]), BOARD_PALETTES.light.content.toUpperCase());
  assert.equal(strokeHex(h.rowsOf(container)[0]), BOARD_PALETTES.light.border.toUpperCase());
});

test('暗いキャンバスに作った盤面はダーク配色になる', async () => {
  const h = createHarness();
  // Figma のダークの既定
  const container = await boardOn(h, '#1E1E1E');

  assert.equal(h.state().boardTheme, 'dark');
  assert.equal(fillHex(h.rowsOf(container)[0]), BOARD_PALETTES.dark.content.toUpperCase());
  assert.equal(strokeHex(h.rowsOf(container)[0]), BOARD_PALETTES.dark.border.toUpperCase());
});

test('ライトの面はキャンバスより明るく、境界線だけの見た目にならない', async () => {
  const h = createHarness();
  const container = await boardOn(h, '#E5E5E5');

  assert.notEqual(fillHex(h.rowsOf(container)[0]), '#E5E5E5');
});

test('切り替えると行・器・境界線が塗り替わる', async () => {
  const h = createHarness();
  const container = await boardOn(h, '#E5E5E5');
  const id = h.state().boards[0].id;
  assert.equal(fillHex(container), BOARD_PALETTES.light.content.toUpperCase());

  await h.send('SET_BOARD_THEME', id, 'dark');
  await h.flush();

  assert.equal(h.state().boardTheme, 'dark');
  assert.equal(fillHex(container), BOARD_PALETTES.dark.content.toUpperCase(), '器も塗り替わる');
  for (const row of h.rowsOf(container)) {
    assert.equal(fillHex(row), BOARD_PALETTES.dark.content.toUpperCase());
    assert.equal(strokeHex(row), BOARD_PALETTES.dark.border.toUpperCase());
  }
});

test('切り替えても色セルの色は変わらない', async () => {
  const h = createHarness();
  const container = await boardOn(h, '#E5E5E5');
  const id = h.state().boards[0].id;
  const before = h.rowsOf(container).map((row) => fillHex(h.label(row)!));

  await h.send('SET_BOARD_THEME', id, 'dark');
  await h.flush();

  assert.deepEqual(
    h.rowsOf(container).map((row) => fillHex(h.label(row)!)),
    before,
    'ティアの色はパステルのままで、どちらの配色でも読める',
  );
});

test('見出しの文字色も切り替わる', async () => {
  const h = createHarness();
  const container = await boardOn(h, '#E5E5E5');
  const id = h.state().boards[0].id;
  await h.send('SET_BOARD_NAME', id, '名前');
  assert.equal(fillHex(h.titleOf(container)!), BOARD_PALETTES.light.title.toUpperCase());

  await h.send('SET_BOARD_THEME', id, 'dark');
  await h.flush();
  await h.send('SET_BOARD_NAME', id, '名前2');

  assert.equal(fillHex(h.titleOf(container)!), BOARD_PALETTES.dark.title.toUpperCase());
});

test('盤面ごとに別の配色を持てる', async () => {
  const h = createHarness();
  h.setCanvasBackground('#E5E5E5');
  await h.send('CREATE_BOARD');
  await h.send('CREATE_BOARD');
  await h.flush();
  const ids = h.state().boards.map((b) => b.id);

  await h.send('SET_BOARD_THEME', ids[0], 'dark');
  await h.flush();

  const [first, second] = h.containers();
  assert.equal(fillHex(first), BOARD_PALETTES.dark.content.toUpperCase());
  assert.equal(fillHex(second), BOARD_PALETTES.light.content.toUpperCase(), 'もう一方は変わらない');
});

test('背景が読めないときは既定のダーク', async () => {
  const h = createHarness();
  h.page.backgrounds = [];
  await h.send('CREATE_BOARD');
  await h.flush();

  assert.equal(h.state().boardTheme, 'dark');
});

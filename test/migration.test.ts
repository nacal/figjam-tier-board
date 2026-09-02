import assert from 'node:assert/strict';
import { test } from 'vitest';
import { hexToRgb } from '../src/domain/color';
import { BOARD_PALETTES } from '../src/domain/theme';
import { createHarness, type FakeNode, type Harness } from './harness';

// 色セルが無く、行に色が塗ってあり、幅も狭く、器にも入っていない
// ── 旧バージョンが作った盤面
function legacyRow(
  h: Harness,
  { name, color, x, y, width }: { name: string; color: string; x: number; y: number; width: number },
): FakeNode {
  const row = h.figma.createSection();
  row.name = name;
  row.setPluginData('figjamTierRow', '1');
  row.setPluginData('figjamTierColor', color);
  row.resizeWithoutConstraints(width, 300);
  row.x = x;
  row.y = y;
  row.fills = [{ type: 'SOLID', color: { r: 1, g: 0.7, b: 0.7 } }];
  h.page.appendChild(row);
  return row;
}

test('器に入っていない旧盤面は、まとめてひとつの盤面として包み直される', async () => {
  const h = createHarness();
  const legacy = [
    legacyRow(h, { name: 'S', color: 'red', x: 100, y: 200, width: 1608 }),
    legacyRow(h, { name: 'A', color: 'orange', x: 100, y: 540, width: 1608 }),
  ];
  h.createSticky('マイクラ', 124, 230);
  h.settle();
  assert.equal(h.items(legacy[0]).length, 1, '付箋は旧盤面の中にいる');

  await h.send('ARRANGE_NOW');

  const containers = h.containers();
  assert.equal(containers.length, 1, '器がひとつできる');
  assert.deepEqual(h.absolute(containers[0]), { x: 100, y: 200 }, '元の場所を保つ');
  for (const row of h.rows()) {
    assert.equal(row.parent!.id, containers[0].id, '行は器の子になる');
  }
});

test('包み直しても中身と見た目は移行する', async () => {
  const h = createHarness();
  legacyRow(h, { name: 'S', color: 'red', x: 0, y: 0, width: 1608 });
  legacyRow(h, { name: 'A', color: 'orange', x: 0, y: 340, width: 1608 });
  const sticky = h.createSticky('マイクラ', 24, 30);
  h.settle();

  await h.send('ARRANGE_NOW');

  for (const row of h.rows()) {
    const label = h.label(row);
    assert.ok(label, '色セルが足される');
    assert.equal(h.labelText(row), row.name);
    assert.equal(label.width, 300);
    assert.equal(label.height, row.height);
    // vm 側で作られたオブジェクトなのでプロトタイプが違う。値で比べる。
    // 配色を持たない盤面は既定のダークのまま（開いた途端に色が変わらない）。
    assert.deepEqual(
      JSON.parse(JSON.stringify(row.fills)),
      [{ type: 'SOLID', color: hexToRgb(BOARD_PALETTES.dark.content) }],
      '面が暗くなる',
    );
    assert.equal(row.width, 2964, '既定幅に広がる');
  }

  assert.equal(h.rows()[1].y, h.rows()[0].y + h.rows()[0].height, '隙間が詰まる');
  assert.equal(sticky.parent!.id, h.rows()[0].id, '中身は行に残る');
  assert.equal(sticky.x, 324, '色セルの右へ寄せ直される');
});

test('移行後の整列は面を塗り直さない', async () => {
  const h = createHarness();
  legacyRow(h, { name: 'S', color: 'red', x: 0, y: 0, width: 1608 });
  await h.send('ARRANGE_NOW');
  const fills = h.rows()[0].fills;

  await h.send('ARRANGE_NOW');

  assert.equal(h.rows()[0].fills, fills, '同じ配列のまま（無駄な書き込みをしない）');
});

test('包み直したあとは表ごと動かせる', async () => {
  const h = createHarness();
  legacyRow(h, { name: 'S', color: 'red', x: 0, y: 0, width: 1608 });
  legacyRow(h, { name: 'A', color: 'orange', x: 0, y: 340, width: 1608 });
  await h.send('ARRANGE_NOW');

  const container = h.containers()[0];
  container.x += 900;
  h.settle();
  await h.send('ARRANGE_NOW');

  assert.equal(h.absolute(container).x, 900, '動かした場所に留まる');
  assert.equal(h.rows().length, 2);
});

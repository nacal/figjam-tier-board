import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

// 色セルが無く、行に色が塗ってあり、幅も狭い ── 旧バージョンが作った盤面
function legacyRow(h, { name, color, x, y, width }) {
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

test('色セルが無い頃の盤面は、次の整列で新しい見た目に移行する', async () => {
  const h = createHarness();
  const legacy = [
    legacyRow(h, { name: 'S', color: 'red', x: 0, y: 0, width: 1608 }),
    legacyRow(h, { name: 'A', color: 'orange', x: 0, y: 340, width: 1608 }),
  ];
  const sticky = h.createSticky('マイクラ', 24, 30);
  h.settle();
  assert.equal(h.items(legacy[0]).length, 1, '付箋は旧盤面の中にいる');

  await h.send({ type: 'arrange-now' });

  for (const row of h.rows()) {
    const label = h.label(row);
    assert.ok(label, '色セルが足される');
    assert.equal(label.text.characters, row.name);
    assert.equal(label.width, 300);
    assert.equal(label.height, row.height);
    // vm 側で作られたオブジェクトなのでプロトタイプが違う。値で比べる。
    assert.deepEqual(JSON.parse(JSON.stringify(row.fills)), [
      { type: 'SOLID', color: { r: 0.106, g: 0.106, b: 0.106 } },
    ], '面が暗くなる');
    assert.equal(row.width, 2964, '既定幅に広がる');
  }

  assert.equal(h.rows()[1].y, h.rows()[0].y + h.rows()[0].height, '隙間が詰まる');
  assert.equal(sticky.parent.id, legacy[0].id, '中身は行に残る');
  assert.equal(sticky.x, 324, '色セルの右へ寄せ直される');
});

test('移行後の整列は面を塗り直さない', async () => {
  const h = createHarness();
  legacyRow(h, { name: 'S', color: 'red', x: 0, y: 0, width: 1608 });
  await h.send({ type: 'arrange-now' });
  const fills = h.rows()[0].fills;

  await h.send({ type: 'arrange-now' });

  assert.equal(h.rows()[0].fills, fills, '同じ配列のまま（無駄な書き込みをしない）');
});

// ドメインのテスト。Figma のモックは要らない。矩形を渡して矩形が返るだけ。
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { layoutRow, readingOrder, type Box, type RowMetrics } from '../../src/domain/layout';

const METRICS: RowMetrics = {
  labelWidth: 300,
  padding: 24,
  gap: 24,
  minHeight: 300,
  lineTolerance: 120,
};

const WIDTH = 300 + 24 * 2 + 240 * 10 + 24 * 9; // 付箋10枚ぶん = 2964

interface Item extends Box {
  name: string;
}

function sticky(name: string, x: number, y: number, height = 240): Item {
  return { name, x, y, width: 240, height };
}

test('読み順は上の段が先、同じ段では左が先', () => {
  const items = [
    sticky('2段目-右', 600, 300),
    sticky('1段目-右', 600, 24),
    sticky('2段目-左', 24, 300),
    sticky('1段目-左', 24, 24),
  ];

  assert.deepEqual(
    readingOrder(items, METRICS.lineTolerance).map((item) => item.name),
    ['1段目-左', '1段目-右', '2段目-左', '2段目-右'],
  );
});

test('段の判定は上端。背の高いものが混ざっても段が割れない', () => {
  const items = [
    sticky('低い', 24, 24),
    sticky('高い', 300, 24, 900),
    sticky('次の段', 24, 948),
  ];

  assert.deepEqual(
    readingOrder(items, METRICS.lineTolerance).map((item) => item.name),
    ['低い', '高い', '次の段'],
    '中心で見ると高いものが別の段に落ちる',
  );
});

test('既定の幅には10枚入り、11枚目から折り返す', () => {
  const items = Array.from({ length: 13 }, (_, i) => sticky(`item${i}`, i * 10, 30));

  const layout = layoutRow(items, WIDTH, METRICS);

  const firstLine = layout.placements.filter((p) => p.y === 24);
  const secondLine = layout.placements.filter((p) => p.y === 24 + 240 + 24);
  assert.equal(firstLine.length, 10);
  assert.equal(secondLine.length, 3);
  assert.deepEqual(
    firstLine.map((p) => p.x),
    Array.from({ length: 10 }, (_, i) => 324 + i * 264),
  );
  assert.equal(layout.height, 24 * 2 + 240 * 2 + 24, '2段ぶんに伸びる');
});

test('色セルの右から詰まる', () => {
  const layout = layoutRow([sticky('one', 900, 100)], WIDTH, METRICS);
  assert.deepEqual(layout.placements, [{ x: 324, y: 24 }]);
});

test('空の行は最小の高さ', () => {
  assert.equal(layoutRow([], WIDTH, METRICS).height, 300);
});

test('何度並べても結果が変わらない（整列が止まらなくならない）', () => {
  let items = Array.from({ length: 13 }, (_, i) => sticky(`item${i}`, i * 10, 30));

  const first = layoutRow(items, WIDTH, METRICS);
  let previous = JSON.stringify(first.items.map((item, i) => [item.name, first.placements[i]]));

  for (let round = 0; round < 5; round++) {
    // 前回の結果を反映してから、もう一度並べる
    items = first.items.map((item, i) => ({
      ...item,
      x: first.placements[i].x,
      y: first.placements[i].y,
    }));
    const again = layoutRow(items, WIDTH, METRICS);
    const now = JSON.stringify(again.items.map((item, i) => [item.name, again.placements[i]]));
    assert.equal(now, previous, `${round + 2}回目でも同じ`);
    previous = now;
  }
});

test('幅を狭めると折り返しの枚数が減る', () => {
  const items = Array.from({ length: 6 }, (_, i) => sticky(`item${i}`, i * 10, 30));
  const narrow = 300 + 24 * 2 + 240 * 4 + 24 * 3; // 4枚ぶん

  const layout = layoutRow(items, narrow, METRICS);

  assert.equal(layout.placements.filter((p) => p.y === 24).length, 4);
  assert.equal(layout.height, 24 * 2 + 240 * 2 + 24);
});

test('背の高いアイテムがある段は、その高さぶん次の段が下がる', () => {
  const items = [sticky('高い', 0, 24, 500), sticky('次', 0, 600)];

  const layout = layoutRow(items, 300 + 24 * 2 + 240, METRICS); // 1枚ぶんの幅

  assert.deepEqual(layout.placements, [
    { x: 324, y: 24 },
    { x: 324, y: 24 + 500 + 24 },
  ]);
  assert.equal(layout.height, 24 * 2 + 500 + 24 + 240);
});

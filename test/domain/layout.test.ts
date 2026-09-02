// Domain tests need no Figma mock: rectangles in, rectangles out.
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

const WIDTH = 300 + 24 * 2 + 240 * 10 + 24 * 9; // ten stickies = 2964

interface Item extends Box {
  name: string;
}

function sticky(name: string, x: number, y: number, height = 240): Item {
  return { name, x, y, width: 240, height };
}

test('reading order is upper line first, leftmost first within a line', () => {
  const items = [
    sticky('line2-right', 600, 300),
    sticky('line1-right', 600, 24),
    sticky('line2-left', 24, 300),
    sticky('line1-left', 24, 24),
  ];

  assert.deepEqual(
    readingOrder(items, METRICS.lineTolerance).map((item) => item.name),
    ['line1-left', 'line1-right', 'line2-left', 'line2-right'],
  );
});

test('lines are detected by top edge, so a tall item does not split one', () => {
  const items = [
    sticky('short', 24, 24),
    sticky('tall', 300, 24, 900),
    sticky('next line', 24, 948),
  ];

  assert.deepEqual(
    readingOrder(items, METRICS.lineTolerance).map((item) => item.name),
    ['short', 'tall', 'next line'],
    'by centre the tall one would fall onto its own line',
  );
});

test('the default width fits ten items and wraps at the eleventh', () => {
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
  assert.equal(layout.height, 24 * 2 + 240 * 2 + 24, 'grows to two lines');
});

test('packs from the right of the tier label', () => {
  const layout = layoutRow([sticky('one', 900, 100)], WIDTH, METRICS);
  assert.deepEqual(layout.placements, [{ x: 324, y: 24 }]);
});

test('an empty row is at the minimum height', () => {
  assert.equal(layoutRow([], WIDTH, METRICS).height, 300);
});

test('repeated layout is idempotent, so arranging cannot loop', () => {
  let items = Array.from({ length: 13 }, (_, i) => sticky(`item${i}`, i * 10, 30));

  const first = layoutRow(items, WIDTH, METRICS);
  let previous = JSON.stringify(first.items.map((item, i) => [item.name, first.placements[i]]));

  for (let round = 0; round < 5; round++) {
    // Feed the previous result back in and lay out again.
    items = first.items.map((item, i) => ({
      ...item,
      x: first.placements[i].x,
      y: first.placements[i].y,
    }));
    const again = layoutRow(items, WIDTH, METRICS);
    const now = JSON.stringify(again.items.map((item, i) => [item.name, again.placements[i]]));
    assert.equal(now, previous, `same on pass ${round + 2}`);
    previous = now;
  }
});

test('narrowing fits fewer items per line', () => {
  const items = Array.from({ length: 6 }, (_, i) => sticky(`item${i}`, i * 10, 30));
  const narrow = 300 + 24 * 2 + 240 * 4 + 24 * 3; // four stickies

  const layout = layoutRow(items, narrow, METRICS);

  assert.equal(layout.placements.filter((p) => p.y === 24).length, 4);
  assert.equal(layout.height, 24 * 2 + 240 * 2 + 24);
});

test('a line with a tall item pushes the next line down by that height', () => {
  const items = [sticky('tall', 0, 24, 500), sticky('next', 0, 600)];

  const layout = layoutRow(items, 300 + 24 * 2 + 240, METRICS); // one sticky wide

  assert.deepEqual(layout.placements, [
    { x: 324, y: 24 },
    { x: 324, y: 24 + 500 + 24 },
  ]);
  assert.equal(layout.height, 24 * 2 + 500 + 24 + 240);
});

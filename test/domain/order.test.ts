import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  applyOrder,
  byVerticalCenter,
  nextRowName,
  resolveBoardWidth,
  stackPositions,
  swapNeighbour,
} from '../../src/domain/order';

test('row order comes from vertical centres', () => {
  const rows = [
    { id: 'a', y: 300, height: 300 },
    { id: 'b', y: 0, height: 300 },
  ];
  assert.deepEqual(byVerticalCenter(rows).map((r) => r.id), ['b', 'a']);
});

test('order holds until the neighbour centre is crossed', () => {
  const stay = [
    { id: 'S', y: 140, height: 300 }, // centre 290
    { id: 'A', y: 300, height: 300 }, // centre 450
  ];
  assert.deepEqual(byVerticalCenter(stay).map((r) => r.id), ['S', 'A']);

  const swap = [
    { id: 'S', y: 460, height: 300 }, // centre 610
    { id: 'A', y: 300, height: 300 }, // centre 450
  ];
  assert.deepEqual(byVerticalCenter(swap).map((r) => r.id), ['A', 'S']);
});

test('stacks flush', () => {
  assert.deepEqual(stackPositions([300, 552, 300], 0, 0), [0, 300, 852]);
});

test('stacks below the heading', () => {
  assert.deepEqual(stackPositions([300, 300], 0, 119), [119, 419]);
});

test('no swap at the ends', () => {
  const rows = ['S', 'A', 'B'];
  assert.deepEqual(swapNeighbour(rows, 0, 'up'), ['S', 'A', 'B']);
  assert.deepEqual(swapNeighbour(rows, 2, 'down'), ['S', 'A', 'B']);
  assert.deepEqual(swapNeighbour(rows, 0, 'down'), ['A', 'S', 'B']);
});

test('orders by the given ids and pushes unknown rows to the end', () => {
  const rows = [{ id: 'S' }, { id: 'A' }, { id: 'B' }];
  assert.deepEqual(applyOrder(rows, ['B', 'S']).map((r) => r.id), ['B', 'S', 'A']);
  assert.deepEqual(applyOrder(rows, ['B', 'B']).map((r) => r.id), ['B', 'S', 'A'], 'duplicates are ignored');
  assert.deepEqual(applyOrder(rows, ['X']).map((r) => r.id), ['S', 'A', 'B'], 'unknown ids are ignored');
});

test('the width comes from the row that no longer matches what was written to it', () => {
  const rows = [
    { width: 2964, stored: 2964 },
    { width: 3492, stored: 2964 }, // the row the user dragged
    { width: 2964, stored: 2964 },
  ];
  assert.equal(resolveBoardWidth(rows, 2964), 3492);
});

test('with nothing changed, the previously written width stands', () => {
  const rows = [
    { width: 2964, stored: 2964 },
    { width: 2964, stored: 2964 },
  ];
  assert.equal(resolveBoardWidth(rows, 1000), 2964);
});

test('with nothing recorded, the larger of the default and the widest row', () => {
  assert.equal(resolveBoardWidth([{ width: 1608, stored: null }], 2964), 2964);
  assert.equal(resolveBoardWidth([{ width: 4000, stored: null }], 2964), 4000);
});

test('row names take the first free letter from S onwards', () => {
  assert.equal(nextRowName([], 1), 'S');
  assert.equal(nextRowName(['S'], 2), 'A');
  assert.equal(nextRowName(['S', 'A', 'B', 'C', 'D'], 6), 'E');
  assert.equal(nextRowName('SABCDEFGHIJKLMNOPQRTUVWXYZ'.split(''), 27), 'Tier 27');
});

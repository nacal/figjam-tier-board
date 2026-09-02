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

test('行の順序は中心で決まる', () => {
  const rows = [
    { id: 'a', y: 300, height: 300 },
    { id: 'b', y: 0, height: 300 },
  ];
  assert.deepEqual(byVerticalCenter(rows).map((r) => r.id), ['b', 'a']);
});

test('隣の中心を越えるまでは順序が変わらない', () => {
  const stay = [
    { id: 'S', y: 140, height: 300 }, // 中心 290
    { id: 'A', y: 300, height: 300 }, // 中心 450
  ];
  assert.deepEqual(byVerticalCenter(stay).map((r) => r.id), ['S', 'A']);

  const swap = [
    { id: 'S', y: 460, height: 300 }, // 中心 610
    { id: 'A', y: 300, height: 300 }, // 中心 450
  ];
  assert.deepEqual(byVerticalCenter(swap).map((r) => r.id), ['A', 'S']);
});

test('隙間なく積む', () => {
  assert.deepEqual(stackPositions([300, 552, 300], 0, 0), [0, 300, 852]);
});

test('見出しのぶんだけ下げて積む', () => {
  assert.deepEqual(stackPositions([300, 300], 0, 119), [119, 419]);
});

test('端では入れ替えない', () => {
  const rows = ['S', 'A', 'B'];
  assert.deepEqual(swapNeighbour(rows, 0, 'up'), ['S', 'A', 'B']);
  assert.deepEqual(swapNeighbour(rows, 2, 'down'), ['S', 'A', 'B']);
  assert.deepEqual(swapNeighbour(rows, 0, 'down'), ['A', 'S', 'B']);
});

test('渡された順に並べ、知らない行は後ろへ回す', () => {
  const rows = [{ id: 'S' }, { id: 'A' }, { id: 'B' }];
  assert.deepEqual(applyOrder(rows, ['B', 'S']).map((r) => r.id), ['B', 'S', 'A']);
  assert.deepEqual(applyOrder(rows, ['B', 'B']).map((r) => r.id), ['B', 'S', 'A'], '重複は無視');
  assert.deepEqual(applyOrder(rows, ['X']).map((r) => r.id), ['S', 'A', 'B'], '知らない ID は無視');
});

test('幅は「前回書いた値と食い違う行」を採る', () => {
  const rows = [
    { width: 2964, stored: 2964 },
    { width: 3492, stored: 2964 }, // ユーザーが引っ張った行
    { width: 2964, stored: 2964 },
  ];
  assert.equal(resolveBoardWidth(rows, 2964), 3492);
});

test('誰も変えていなければ前回の値のまま', () => {
  const rows = [
    { width: 2964, stored: 2964 },
    { width: 2964, stored: 2964 },
  ];
  assert.equal(resolveBoardWidth(rows, 1000), 2964);
});

test('記録が無ければ、既定幅といちばん広い行の大きいほう', () => {
  assert.equal(resolveBoardWidth([{ width: 1608, stored: null }], 2964), 2964);
  assert.equal(resolveBoardWidth([{ width: 4000, stored: null }], 2964), 4000);
});

test('行の名前は S から順に空いている文字を採る', () => {
  assert.equal(nextRowName([], 1), 'S');
  assert.equal(nextRowName(['S'], 2), 'A');
  assert.equal(nextRowName(['S', 'A', 'B', 'C', 'D'], 6), 'E');
  assert.equal(nextRowName('SABCDEFGHIJKLMNOPQRTUVWXYZ'.split(''), 27), 'Tier 27');
});

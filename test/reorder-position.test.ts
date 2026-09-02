import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness } from './harness';

const CONTENT_X = 300 + 24;

test('並べ替えても盤面の位置は動かない', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];
  const before = h.absolute(container);
  const ids = h.rows().map((r) => r.id);

  await h.send('REORDER_ROWS', [ids[4], ids[0], ids[1], ids[2], ids[3]]);

  assert.deepEqual(h.absolute(container), before, '表そのものは動かない');
  assert.deepEqual(h.rows().map((r) => r.name), ['D', 'S', 'A', 'B', 'C']);
  assert.deepEqual(h.rows().map((r) => r.y), [0, 300, 600, 900, 1200], '枠は元のまま');
});

test('↑↓ で入れ替えても盤面の位置は動かない', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];
  const before = h.absolute(container);

  await h.send('MOVE_ROW', h.rows()[0].id, 'down');

  assert.deepEqual(h.absolute(container), before);
  assert.deepEqual(h.rows().map((r) => r.name), ['A', 'S', 'B', 'C', 'D']);
});

test('整列で行の高さが変わっても盤面の左上は動かない', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];
  const before = h.absolute(container);
  const rows = h.rows();

  for (let i = 0; i < 13; i++) {
    h.dropIn(rows[2], `item${i}`, CONTENT_X + i * 10, 30);
  }
  await h.send('ARRANGE_NOW');

  assert.deepEqual(h.absolute(container), before, '左上は固定');
  assert.ok(h.rows()[2].height > 300, '中身が増えた行だけ伸びる');
  assert.equal(container.height, h.rows().reduce((sum, r) => sum + r.height, 0), '表の高さは行の合計');
});

test('表を掴んで動かすと中身ごと動き、整列しても戻らない', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];
  const row = h.rows()[0];
  const sticky = h.dropIn(row, 'マイクラ', CONTENT_X, 30);
  await h.send('ARRANGE_NOW');

  // ユーザーが表ごとドラッグした
  container.x += 2500;
  container.y -= 800;
  const moved = h.absolute(container);
  const stickyAt = h.absolute(sticky);

  await h.send('ARRANGE_NOW');

  assert.deepEqual(h.absolute(container), moved, '動かした場所に留まる');
  assert.deepEqual(h.absolute(sticky), stickyAt, '中の付箋も一緒に動いている');
  assert.equal(sticky.parent!.id, row.id);
});

test('1行だけ横にずらしても、整列で盤面の左端に揃う', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const rows = h.rows();

  rows[2].x = -900;

  await h.send('ARRANGE_NOW');

  for (const row of h.rows()) {
    assert.equal(row.x, 0, '盤面の左端に揃う');
  }
});

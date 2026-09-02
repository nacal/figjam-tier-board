import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness, type FakeNode, type Harness } from './harness';

const CONTENT_X = 300 + 24;

// 行のなかに、左詰めになっていない位置で付箋を置く
function scatter(h: Harness, row: FakeNode, names: string[], offsets: number[]): FakeNode[] {
  return names.map((name, i) => h.dropIn(row, name, CONTENT_X + offsets[i], 30));
}

test('ある行を触っても、別の行の中身は並び直さない', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();

  const rows = h.rows();

  // A 行には、詰まっていない位置のまま付箋を置いておく
  const untouched = scatter(h, rows[1], ['あ', 'い'], [600, 1200]);
  const before = untouched.map((n) => ({ id: n.id, x: n.x, y: n.y }));

  // S 行に付箋を落として動かす
  const moved = scatter(h, rows[0], ['S1'], [900])[0];
  h.change(moved);
  await h.flush();

  assert.equal(moved.x, CONTENT_X, '触った行は左詰めになる');
  assert.deepEqual(
    untouched.map((n) => ({ id: n.id, x: n.x, y: n.y })),
    before,
    '触っていない行の中身は1ミリも動かない',
  );
});

test('別の盤面の中身も並び直さない', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.send('CREATE_BOARD');
  await h.flush();

  const boards = h.state().boards;
  const rowsOf = (id: string) =>
    h.rowsOf(h.containers().find((c) => c.getPluginData('figjamTierBoard') === id)!);

  const other = rowsOf(boards[1].id)[0];
  const untouched = scatter(h, other, ['X', 'Y'], [700, 1400]);
  const before = untouched.map((n) => ({ x: n.x, y: n.y }));

  const first = rowsOf(boards[0].id)[0];
  const moved = scatter(h, first, ['A'], [900])[0];
  h.change(moved);
  await h.flush();

  assert.equal(moved.x, CONTENT_X);
  assert.deepEqual(untouched.map((n) => ({ x: n.x, y: n.y })), before);
});

test('付箋を行の外へ出すと、元の行だけが詰め直される', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();

  const items = scatter(h, rows[0], ['1', '2', '3'], [0, 264, 528]);
  h.change(items);
  await h.flush();
  assert.deepEqual(h.items(rows[0]).map((n) => n.x).sort((a, b) => a - b), [324, 588, 852]);

  // 真ん中を行の外（キャンバスの下）へ放り出す
  const dragged = items[1];
  const container = h.containers()[0];
  h.page.appendChild(dragged);
  dragged.x = h.absolute(container).x;
  dragged.y = h.absolute(container).y + container.height + 400;
  h.settle();
  h.change(dragged);
  await h.flush();

  assert.equal(h.items(rows[0]).length, 2);
  assert.deepEqual(
    h.items(rows[0]).map((n) => n.x).sort((a, b) => a - b),
    [324, 588],
    '抜けた穴は詰まる',
  );
});

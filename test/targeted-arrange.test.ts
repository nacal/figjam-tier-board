import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness, type FakeNode, type Harness } from './harness';

const CONTENT_X = 300 + 24;

// Places stickies inside a row at positions that are not packed left.
function scatter(h: Harness, row: FakeNode, names: string[], offsets: number[]): FakeNode[] {
  return names.map((name, i) => h.dropIn(row, name, CONTENT_X + offsets[i], 30));
}

test('touching one row leaves the contents of other rows alone', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();

  const rows = h.rows();

  // Leave row A's stickies unpacked.
  const untouched = scatter(h, rows[1], ['a', 'i'], [600, 1200]);
  const before = untouched.map((n) => ({ id: n.id, x: n.x, y: n.y }));

  // Drop a sticky into row S and move it.
  const moved = scatter(h, rows[0], ['S1'], [900])[0];
  h.change(moved);
  await h.flush();

  assert.equal(moved.x, CONTENT_X, 'the touched row packs left');
  assert.deepEqual(
    untouched.map((n) => ({ id: n.id, x: n.x, y: n.y })),
    before,
    'the contents of an untouched row do not move at all',
  );
});

test('the contents of another board are not rearranged either', async () => {
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

test('moving a sticky out of a row repacks only that row', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();

  const items = scatter(h, rows[0], ['1', '2', '3'], [0, 264, 528]);
  h.change(items);
  await h.flush();
  assert.deepEqual(h.items(rows[0]).map((n) => n.x).sort((a, b) => a - b), [324, 588, 852]);

  // Throw the middle one out of the row, below the canvas content.
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
    'the gap closes',
  );
});

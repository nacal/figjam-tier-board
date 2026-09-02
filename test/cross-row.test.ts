import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness, type FakeNode, type Harness } from './harness';

const CONTENT_X = 300 + 24;

// Grabbing a sticky on the canvas and moving it.
function dragBy(h: Harness, sticky: FakeNode, dx: number, dy: number): void {
  const pos = h.absolute(sticky);
  h.page.appendChild(sticky);
  sticky.x = pos.x + dx;
  sticky.y = pos.y + dy;
  h.settle();
  h.change(sticky);
}

test('packing still runs when a sticky is dragged from A straight up into S', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();
  const [s, a] = rows;

  h.dropIn(a, 'a', CONTENT_X, 30);
  const moved = h.dropIn(a, 'i', CONTENT_X + 400, 30);
  h.dropIn(a, 'u', CONTENT_X + 800, 30);
  await h.send('ARRANGE_NOW');
  assert.deepEqual(h.items(a).map((n) => n.x).sort((x, y) => x - y), [324, 588, 852]);

  // Straight up by one row (300px): the relative position in the new row matches the old.
  dragBy(h, moved, 0, -300);
  await h.flush();

  assert.equal(moved.parent!.id, s.id, 'landed in S');
  assert.equal(moved.x, CONTENT_X, 'packs left inside S');
  assert.deepEqual(h.items(a).map((n) => n.x).sort((x, y) => x - y), [324, 588], 'A is repacked too');
});

test('packing still runs when a sticky is dragged from A into S loosely', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();
  const [s, a] = rows;

  h.dropIn(a, 'a', CONTENT_X, 30);
  const moved = h.dropIn(a, 'i', CONTENT_X + 400, 30);
  await h.send('ARRANGE_NOW');

  dragBy(h, moved, 137, -263);
  await h.flush();

  assert.equal(moved.parent!.id, s.id);
  assert.equal(moved.x, CONTENT_X);
  assert.deepEqual(h.items(a).map((n) => n.x), [324]);
});

test('packing keeps working when a sticky is moved back across rows', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const [s, a] = h.rows();

  const moved = h.dropIn(a, 'i', CONTENT_X, 30);
  h.dropIn(a, 'a', CONTENT_X + 400, 30);
  await h.send('ARRANGE_NOW');

  // A -> S -> A, exactly one row each time.
  dragBy(h, moved, 0, -300);
  await h.flush();
  assert.equal(moved.parent!.id, s.id);
  assert.equal(moved.x, CONTENT_X);

  dragBy(h, moved, 0, 300);
  await h.flush();
  assert.equal(moved.parent!.id, a.id, 'returns to A');
  assert.deepEqual(h.items(a).map((n) => n.x).sort((x, y) => x - y), [324, 588], 'both pack left');
});

test('a sticky moved out at the same relative position still repacks the row', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const container = h.containers()[0];
  const row = h.rows()[0];

  h.dropIn(row, 'a', CONTENT_X, 30);
  const moved = h.dropIn(row, 'i', CONTENT_X + 400, 30);
  await h.send('ARRANGE_NOW');

  // Out of the board, to a page position that coincides with its old relative one.
  const pos = h.absolute(moved);
  h.page.appendChild(moved);
  moved.x = moved.x - h.absolute(container).x;
  moved.y = pos.y - h.absolute(container).y - 3000;
  h.settle();
  h.change(moved);
  await h.flush();

  assert.equal(moved.parent!.type, 'PAGE');
  assert.deepEqual(h.items(row).map((n) => n.x), [324], 'the remaining one packs left');
});

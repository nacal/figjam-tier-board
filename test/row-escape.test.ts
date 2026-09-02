import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness, type FakeNode, type Harness } from './harness';

const CONTENT_X = 300 + 24;

// Grabbing a row on the canvas. Once it leaves the board, FigJam drops it from
// the board's children.
function dragRowOut(h: Harness, row: FakeNode, dx: number, dy: number): void {
  const pos = h.absolute(row);
  h.page.appendChild(row);
  row.x = pos.x + dx;
  row.y = pos.y + dy;
  h.settle();
}

test('a row carried off onto the canvas returns to its board', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];
  const row = h.rows()[1];
  const sticky = h.dropIn(row, 'Minecraft', CONTENT_X, 30);
  await h.send('ARRANGE_NOW');

  dragRowOut(h, row, 4000, 3000);
  assert.equal(row.parent!.type, 'PAGE', 'left the board');

  await h.send('ARRANGE_NOW');

  assert.equal(row.parent!.id, container.id, 'returns to its board');
  assert.equal(h.containers().length, 1, 'no new board is created');
  assert.equal(h.rows().length, 5);
  assert.equal(sticky.parent!.id, row.id, 'the stickies inside come back too');
  assert.equal(h.rows()[4].id, row.id, 'dropped low, so it goes last');
});

test('dragging a row down puts it in the order of where it landed', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];
  const row = h.rows()[0];
  assert.equal(row.name, 'S');

  // Drop it below the bottom of the board.
  dragRowOut(h, row, 0, container.height + 200);
  await h.send('ARRANGE_NOW');

  assert.deepEqual(h.rows().map((r) => r.name), ['A', 'B', 'C', 'D', 'S'], 'moves to the end');
  assert.equal(row.parent!.id, container.id);
  assert.deepEqual(h.rows().map((r) => r.y), [0, 300, 600, 900, 1200], 'packs flush');
});

test('order holds until the next row centre is crossed', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const rows = h.rows();
  const row = rows[0];

  // Short of half a row height.
  row.y = 140;
  await h.send('ARRANGE_NOW');
  assert.deepEqual(h.rows().map((r) => r.name), ['S', 'A', 'B', 'C', 'D'], 'no swap');
  assert.equal(h.rows()[0].y, 0, 'returns to its slot');

  // Past the next row's centre (450).
  row.y = 460;
  await h.send('ARRANGE_NOW');
  assert.deepEqual(h.rows().map((r) => r.name), ['A', 'S', 'B', 'C', 'D'], 'swaps with the row below');
});

test('a row dropped onto another row is not packed as an item', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const container = h.containers()[0];
  const rows = h.rows();
  const dragged = rows[3];

  // Reproduce FigJam nesting one row inside another.
  rows[0].appendChild(dragged);
  dragged.x = 500;
  dragged.y = 30;

  h.change(dragged);
  await h.flush();

  assert.equal(dragged.parent!.id, container.id, 'returns as a child of the board, not of a row');
  assert.equal(h.items(rows[0]).length, 0, 'the row is not counted as a sticky');
  assert.equal(rows[0].height, 300, 'the row height is intact');
  assert.equal(dragged.width, 2964, 'the row width was not crushed to a sticky width');
  assert.equal(h.rows().length, 5, 'still five rows');
  assert.deepEqual(h.rows().map((r) => r.y), [0, 300, 600, 900, 1200], 'stacked flush');
});

test('arrow reordering and drag reordering agree', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];

  await h.send('MOVE_ROW', h.rows()[0].id, 'down');
  assert.deepEqual(h.rows().map((r) => r.name), ['A', 'S', 'B', 'C', 'D']);

  // Drag the bottom row (D) above the board.
  const row = h.rows()[4];
  dragRowOut(h, row, 0, -(container.height + 500));
  await h.send('ARRANGE_NOW');

  assert.deepEqual(h.rows().map((r) => r.name), ['D', 'A', 'S', 'B', 'C'], 'the dragged position is honoured');
  assert.deepEqual(h.rows().map((r) => r.y), [0, 300, 600, 900, 1200]);
});

test('a row moved to another board belongs to that board', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.send('CREATE_BOARD');
  await h.flush();

  const [first, second] = h.containers();
  const row = h.rowsOf(first)[0];

  // Drop into the second board. Nesting a section inside another is FigJam's job,
  // so only the outcome is reproduced.
  h.moveRowInto(row, second, second.height - 10);

  await h.send('ARRANGE_NOW');

  assert.equal(row.parent!.id, second.id, 'becomes a child of the destination board');
  assert.equal(row.getPluginData('figjamTierBoard'), second.getPluginData('figjamTierBoard'));
  assert.equal(h.rowsOf(first).length, 4);
  assert.equal(h.rowsOf(second).length, 6);
});

test('moving a row does not carry the board name with it', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.send('CREATE_BOARD');
  await h.flush();
  const ids = h.state().boards.map((b) => b.id);
  await h.send('SET_BOARD_NAME', ids[0], 'Fun');

  const [first, second] = h.containers();
  h.moveRowInto(h.rowsOf(first)[0], second, second.height - 10);

  await h.send('ARRANGE_NOW');

  assert.deepEqual(h.state().boards.map((b) => b.name), ['Fun', '']);
});

test('auto-arrange brings the row back too', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const container = h.containers()[0];
  const row = h.rows()[2];

  dragRowOut(h, row, 3000, 2000);
  h.change(row);
  await h.flush();

  assert.equal(row.parent!.id, container.id);
  assert.equal(h.containers().length, 1);
});

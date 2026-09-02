import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness } from './harness';

const CONTENT_X = 300 + 24;

test('reordering does not move the board', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];
  const before = h.absolute(container);
  const ids = h.rows().map((r) => r.id);

  await h.send('REORDER_ROWS', [ids[4], ids[0], ids[1], ids[2], ids[3]]);

  assert.deepEqual(h.absolute(container), before, 'the table itself does not move');
  assert.deepEqual(h.rows().map((r) => r.name), ['D', 'S', 'A', 'B', 'C']);
  assert.deepEqual(h.rows().map((r) => r.y), [0, 300, 600, 900, 1200], 'the slots are unchanged');
});

test('the board does not move when rows are swapped with the arrows', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];
  const before = h.absolute(container);

  await h.send('MOVE_ROW', h.rows()[0].id, 'down');

  assert.deepEqual(h.absolute(container), before);
  assert.deepEqual(h.rows().map((r) => r.name), ['A', 'S', 'B', 'C', 'D']);
});

test('the board top left holds even when a row height changes', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];
  const before = h.absolute(container);
  const rows = h.rows();

  for (let i = 0; i < 13; i++) {
    h.dropIn(rows[2], `item${i}`, CONTENT_X + i * 10, 30);
  }
  await h.send('ARRANGE_NOW');

  assert.deepEqual(h.absolute(container), before, 'the top left is fixed');
  assert.ok(h.rows()[2].height > 300, 'only the row that gained items grows');
  assert.equal(container.height, h.rows().reduce((sum, r) => sum + r.height, 0), 'the table height is the sum of the rows');
});

test('grabbing the table moves its contents and arranging does not undo it', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];
  const row = h.rows()[0];
  const sticky = h.dropIn(row, 'Minecraft', CONTENT_X, 30);
  await h.send('ARRANGE_NOW');

  // The user dragged the whole table.
  container.x += 2500;
  container.y -= 800;
  const moved = h.absolute(container);
  const stickyAt = h.absolute(sticky);

  await h.send('ARRANGE_NOW');

  assert.deepEqual(h.absolute(container), moved, 'stays where it was moved');
  assert.deepEqual(h.absolute(sticky), stickyAt, 'the stickies inside moved with it');
  assert.equal(sticky.parent!.id, row.id);
});

test('a single row nudged sideways snaps back to the board left edge', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const rows = h.rows();

  rows[2].x = -900;

  await h.send('ARRANGE_NOW');

  for (const row of h.rows()) {
    assert.equal(row.x, 0, 'aligns to the board left edge');
  }
});

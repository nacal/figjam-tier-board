import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness, type Harness } from './harness';

const CONTENT_X = 300 + 24;
const DEFAULT_WIDTH = 300 + 24 * 2 + 240 * 10 + 24 * 9;

async function twoBoards(h: Harness) {
  await h.send('CREATE_BOARD');
  await h.send('CREATE_BOARD');
  const boards = h.state().boards;
  assert.equal(boards.length, 2);
  const ids = boards.map((b) => b.id);
  const containerOf = (id: string) => h.containers().find((c) => c.getPluginData('figjamTierBoard') === id);
  const rowsOf = (id: string) => h.rowsOf(containerOf(id)!);
  return { ids, rowsOf, containerOf };
}

test('any number of boards can be created, the second below the first', async () => {
  const h = createHarness();
  const { ids, rowsOf, containerOf } = await twoBoards(h);

  const first = rowsOf(ids[0]);
  const second = rowsOf(ids[1]);
  assert.equal(first.length, 5);
  assert.equal(second.length, 5);

  const top = containerOf(ids[0])!;
  const bottom = containerOf(ids[1])!;
  assert.ok(h.absolute(bottom).y >= h.absolute(top).y + top.height, 'the second sits below the first');

  // Each board stacks flush internally.
  for (const rows of [first, second]) {
    for (let i = 1; i < rows.length; i++) {
      assert.equal(rows[i].y, rows[i - 1].y + rows[i - 1].height);
    }
  }
});

test('arranging does not merge boards', async () => {
  const h = createHarness();
  const { ids, rowsOf, containerOf } = await twoBoards(h);
  const gap = () =>
    h.absolute(containerOf(ids[1])!).y -
    (h.absolute(containerOf(ids[0])!).y + containerOf(ids[0])!.height);
  const gapBefore = gap();

  await h.send('ARRANGE_NOW');

  assert.equal(gap(), gapBefore, 'the gap between boards is not closed');
  assert.equal(rowsOf(ids[0]).length, 5);
  assert.equal(rowsOf(ids[1]).length, 5);
});

test('a width change spreads within its own board only', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);

  const widened = DEFAULT_WIDTH + 528;
  const target = rowsOf(ids[0])[2];
  target.resizeWithoutConstraints(widened, target.height);

  await h.send('ARRANGE_NOW');

  for (const row of rowsOf(ids[0])) {
    assert.equal(row.width, widened, 'the same board widens');
  }
  for (const row of rowsOf(ids[1])) {
    assert.equal(row.width, DEFAULT_WIDTH, 'the other is untouched');
  }
});

test('reordering never crosses boards', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);
  const otherBefore = rowsOf(ids[1]).map((r) => ({ name: r.name, y: r.y }));

  const target = rowsOf(ids[0]);
  await h.send('REORDER_ROWS', [target[4].id, target[0].id, target[1].id, target[2].id, target[3].id]);

  assert.deepEqual(rowsOf(ids[0]).map((r) => r.name), ['D', 'S', 'A', 'B', 'C']);
  assert.deepEqual(rowsOf(ids[1]).map((r) => ({ name: r.name, y: r.y })), otherBefore, 'the other does not move');
  assert.deepEqual(rowsOf(ids[0]).map((r) => r.y), [0, 300, 600, 900, 1200], 'the slots are unchanged');
});

test('selecting on the canvas switches the panel to that board', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);

  // The board just created is the active one.
  assert.equal(h.state().activeBoardId, ids[1]);

  // Select a sticky inside the first board.
  const row = rowsOf(ids[0])[0];
  const sticky = h.dropIn(row, 'Minecraft', CONTENT_X, 30);
  h.select(sticky);

  const message = h.state();
  assert.equal(message.activeBoardId, ids[0], 'switches to the board holding the selected sticky');
  assert.deepEqual(message.rows.map((r) => r.id), Array.from(rowsOf(ids[0]), (r) => r.id));
});

test('a new row goes into the active board', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);

  h.select(rowsOf(ids[0])[0]);
  await h.send('ADD_ROW');

  assert.equal(rowsOf(ids[0]).length, 6);
  assert.equal(rowsOf(ids[1]).length, 5);
  const added = rowsOf(ids[0])[5];
  assert.equal(added.y, rowsOf(ids[0])[4].y + rowsOf(ids[0])[4].height, 'appended flush at the end');
});

test('deleting a row on one board leaves the other still', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);
  const otherBefore = rowsOf(ids[1]).map((r) => ({ name: r.name, y: r.y }));

  await h.send('DELETE_ROW', rowsOf(ids[0])[1].id);

  assert.equal(rowsOf(ids[0]).length, 4);
  assert.deepEqual(rowsOf(ids[1]).map((r) => ({ name: r.name, y: r.y })), otherBefore);
});

test('wiping out one board leaves the other', async () => {
  const h = createHarness();
  const { ids, rowsOf, containerOf } = await twoBoards(h);

  for (const row of rowsOf(ids[0])) {
    await h.send('DELETE_ROW', row.id);
  }

  assert.equal(containerOf(ids[0]), undefined, 'an emptied board disappears with its container');
  assert.equal(rowsOf(ids[1]).length, 5);
  assert.equal(h.state().boards.length, 1);
  assert.equal(h.state().activeBoardId, ids[1], 'the surviving board becomes active');
});

test('the rescue target of a deleted row does not land in the board below', async () => {
  const h = createHarness();
  const { ids, rowsOf, containerOf } = await twoBoards(h);

  const row = rowsOf(ids[0])[1];
  h.dropIn(row, 'Minecraft', CONTENT_X, 30);
  await h.send('ARRANGE_NOW');
  const sticky = h.items(row)[0];
  const lower = containerOf(ids[1])!;
  const lowerBottom = h.absolute(lower).y + lower.height;

  await h.send('DELETE_ROW', row.id);

  assert.equal(sticky.removed, false);
  assert.equal(sticky.parent!.type, 'PAGE', 'not adopted by the board below');
  assert.ok(h.absolute(sticky).y >= lowerBottom, 'sits below the second board');
});

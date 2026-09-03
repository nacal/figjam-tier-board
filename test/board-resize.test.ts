import assert from 'node:assert/strict';
import { test } from 'vitest';

import { createHarness, type FakeNode, type Harness } from './harness';

const PADDING = 24;
const STICKY = 240;
const DEFAULT_ROW_HEIGHT = 300;
const DEFAULT_WIDTH = 300 + PADDING * 2 + STICKY * 10 + 24 * 9; // 2964
const MIN_ROW_HEIGHT = 96;

async function board(h: Harness): Promise<FakeNode> {
  await h.send('CREATE_BOARD');
  await h.flush();
  return h.containers()[0];
}

// Dragging the board's own handles. FigJam resizes the section; the plugin reads
// the new size on the next arrange.
async function resizeBoard(h: Harness, container: FakeNode, width: number, height: number): Promise<void> {
  container.resizeWithoutConstraints(width, height);
  h.change(container);
  await h.flush();
}

test('dragging the right edge of the board widens every row', async () => {
  const h = createHarness();
  const container = await board(h);
  const widened = DEFAULT_WIDTH + 528;

  await resizeBoard(h, container, widened, container.height);

  for (const row of h.rowsOf(container)) {
    assert.equal(row.width, widened);
  }
  assert.equal(container.width, widened);
});

test('dragging the bottom edge makes every row taller', async () => {
  const h = createHarness();
  const container = await board(h);
  const rows = h.rowsOf(container).length;

  await resizeBoard(h, container, container.width, DEFAULT_ROW_HEIGHT * rows + 100 * rows);

  for (const row of h.rowsOf(container)) {
    assert.equal(row.height, DEFAULT_ROW_HEIGHT + 100);
  }
  assert.equal(container.height, (DEFAULT_ROW_HEIGHT + 100) * rows);
});

test('the tier label stays square as the board grows', async () => {
  const h = createHarness();
  const container = await board(h);
  const rows = h.rowsOf(container).length;

  await resizeBoard(h, container, container.width, 400 * rows);

  for (const row of h.rowsOf(container)) {
    const label = h.label(row)!;
    assert.equal(label.height, 400);
    assert.equal(label.width, 400, 'the label side follows the row height');
  }
});

test('the corner changes both dimensions at once', async () => {
  const h = createHarness();
  const container = await board(h);
  const rows = h.rowsOf(container).length;

  await resizeBoard(h, container, DEFAULT_WIDTH + 264, 350 * rows);

  for (const row of h.rowsOf(container)) {
    assert.equal(row.width, DEFAULT_WIDTH + 264);
    assert.equal(row.height, 350);
  }
});

test('an empty board shrinks well below the default', async () => {
  const h = createHarness();
  const container = await board(h);
  const rows = h.rowsOf(container).length;

  await resizeBoard(h, container, container.width, 10 * rows);

  for (const row of h.rowsOf(container)) {
    assert.equal(row.height, MIN_ROW_HEIGHT, 'clamped to the minimum, not back to the default');
  }
  assert.equal(container.height, MIN_ROW_HEIGHT * rows);
  assert.ok(container.height < DEFAULT_ROW_HEIGHT * rows / 2, 'meaningfully smaller');
});

test('a board holding stickies stops at what they need', async () => {
  const h = createHarness();
  const container = await board(h);
  const rows = h.rowsOf(container);
  h.dropIn(rows[2], 'Minecraft', 300 + PADDING, 30);
  await h.send('ARRANGE_NOW');

  await resizeBoard(h, container, container.width, 10 * rows.length);

  for (const row of h.rowsOf(container)) {
    assert.equal(row.height, PADDING * 2 + STICKY, 'rows stay uniform at the sticky height');
  }
});

test('the tier letter shrinks with its cell', async () => {
  const h = createHarness();
  const container = await board(h);
  const rows = h.rowsOf(container).length;
  const before = h.label(h.rowsOf(container)[0])!.text!.fontSize;

  await resizeBoard(h, container, container.width, 10 * rows);

  const after = h.label(h.rowsOf(container)[0])!.text!.fontSize;
  assert.ok(after < before, `letter should shrink, was ${before} now ${after}`);
  assert.ok(after <= MIN_ROW_HEIGHT, 'the letter fits inside the cell');
});

test('a taller board fits fewer items per line, because the label grows too', async () => {
  const h = createHarness();
  const container = await board(h);
  const row = h.rowsOf(container)[0];
  for (let i = 0; i < 10; i++) {
    h.dropIn(row, `item${i}`, 300 + PADDING + i * 10, 30);
  }
  await h.send('ARRANGE_NOW');
  assert.equal(h.items(row).filter((n) => n.y === PADDING).length, 10, 'ten fit at first');

  await resizeBoard(h, container, container.width, 600 * h.rowsOf(container).length);

  const first = h.items(h.rowsOf(container)[0]).filter((n) => n.y === PADDING);
  assert.ok(first.length < 10, 'the wider label leaves room for fewer');
});

test('a row added after a resize matches the board', async () => {
  const h = createHarness();
  const container = await board(h);
  const rows = h.rowsOf(container).length;
  await resizeBoard(h, container, DEFAULT_WIDTH + 264, 400 * rows);

  await h.send('ADD_ROW');
  await h.flush();

  const added = h.rowsOf(container)[rows];
  assert.equal(added.width, DEFAULT_WIDTH + 264);
  assert.equal(added.height, 400);
});

test('resizing one board leaves the other alone', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.send('CREATE_BOARD');
  await h.flush();
  const [first, second] = h.containers();

  await resizeBoard(h, first, DEFAULT_WIDTH + 528, 400 * h.rowsOf(first).length);

  for (const row of h.rowsOf(second)) {
    assert.equal(row.width, DEFAULT_WIDTH);
    assert.equal(row.height, DEFAULT_ROW_HEIGHT);
  }
});

test('a board left alone keeps its size across arranges', async () => {
  const h = createHarness();
  const container = await board(h);
  const before = { width: container.width, height: container.height };

  await h.send('ARRANGE_NOW');
  await h.send('ARRANGE_NOW');

  assert.deepEqual({ width: container.width, height: container.height }, before);
  for (const row of h.rowsOf(container)) {
    assert.equal(row.height, DEFAULT_ROW_HEIGHT);
  }
});

// A large shrink pushes the lower rows out of the section, which FigJam does on
// its own. The strays are returned before the arrange runs, and returning them
// resizes the container back to fit — so the size the user dragged to only
// exists in the change event.
function shrinkPastTheRows(h: Harness, container: FakeNode, height: number): void {
  const rows = h.rowsOf(container);
  const at = h.absolute(container);
  container.resizeWithoutConstraints(container.width, height);
  for (const row of rows) {
    const pos = h.absolute(row);
    h.page.appendChild(row);
    row.x = pos.x;
    row.y = pos.y;
  }
  h.change([container, ...rows]);
  void at;
}

test('a shrink large enough to eject the rows still lands on the minimum', async () => {
  const h = createHarness();
  const container = await board(h);
  const rowCount = h.rowsOf(container).length;

  shrinkPastTheRows(h, container, 200);
  await h.flush();

  assert.equal(h.rowsOf(container).length, rowCount, 'the ejected rows came back');
  for (const row of h.rowsOf(container)) {
    assert.equal(row.height, MIN_ROW_HEIGHT, 'shrunk to the limit, not left at the old size');
  }
  assert.equal(container.height, MIN_ROW_HEIGHT * rowCount);
});

test('the same shrink keeps the row order', async () => {
  const h = createHarness();
  const container = await board(h);
  const before = h.rowsOf(container).map((row) => row.name);

  shrinkPastTheRows(h, container, 200);
  await h.flush();

  assert.deepEqual(h.rowsOf(container).map((row) => row.name), before);
});

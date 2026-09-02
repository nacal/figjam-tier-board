import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness } from './harness';

const DEFAULT_WIDTH = 300 + 24 * 2 + 240 * 10 + 24 * 9; // 2964

test('the default width is ten stickies wide', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  for (const row of h.rows()) {
    assert.equal(row.width, DEFAULT_WIDTH);
  }
  assert.equal(h.containers()[0].width, DEFAULT_WIDTH, 'the table width matches the rows');
});

test('resizing one row resizes every row', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');

  // As if the user dragged the middle row's right edge.
  const widened = DEFAULT_WIDTH + 528; // two stickies wider
  h.rows()[2].resizeWithoutConstraints(widened, h.rows()[2].height);

  await h.send('ARRANGE_NOW');

  for (const row of h.rows()) {
    assert.equal(row.width, widened, 'every row widens');
  }
  assert.equal(h.containers()[0].width, widened, 'the whole table widens');
});

test('narrowing fits fewer items per line', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const row = h.rows()[0];

  for (let i = 0; i < 6; i++) {
    h.dropIn(row, `item${i}`, 324 + i * 10, 30);
  }
  await h.send('ARRANGE_NOW');
  assert.equal(row.height, 300, 'six fit on one line');

  // Narrow to four stickies wide.
  const narrow = 300 + 24 * 2 + 240 * 4 + 24 * 3;
  row.resizeWithoutConstraints(narrow, row.height);
  await h.send('ARRANGE_NOW');

  for (const other of h.rows()) {
    assert.equal(other.width, narrow);
  }
  assert.equal(h.items(row).length, 6, 'narrowing does not drop stickies out of the row');
  assert.equal(row.height, 24 * 2 + 240 * 2 + 24, 'wraps onto two lines');
});

test('a new row is created at the board current width', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');

  const widened = DEFAULT_WIDTH + 264;
  h.rows()[0].resizeWithoutConstraints(widened, h.rows()[0].height);
  await h.send('ARRANGE_NOW');

  await h.send('ADD_ROW');

  assert.equal(h.rows().length, 6);
  for (const row of h.rows()) {
    assert.equal(row.width, widened);
  }
});

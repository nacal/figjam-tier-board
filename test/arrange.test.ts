import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness } from './harness';

const PADDING = 24;
const GAP = 24;
const LABEL_WIDTH = 300;
const CONTENT_X = LABEL_WIDTH + PADDING;
const COLUMNS = 10;

test('creating a board stacks S/A/B/C/D flush', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');

  const rows = h.rows();
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.name), ['S', 'A', 'B', 'C', 'D']);
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i].x, rows[0].x);
    assert.equal(rows[i].y, rows[i - 1].y + rows[i - 1].height, 'there is no gap between rows');
  }
});

test('every row is a child of the board section', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');

  const containers = h.containers();
  assert.equal(containers.length, 1);
  for (const row of h.rows()) {
    assert.equal(row.parent!.id, containers[0].id);
    assert.equal(row.x, 0, 'positions are relative to the board');
  }
});

test('every row carries a coloured tier label on its left', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');

  for (const row of h.rows()) {
    const label = h.label(row);
    assert.ok(label, 'has a tier label');
    assert.equal(h.labelText(row), row.name);
    assert.equal(label.x, 0);
    assert.equal(label.y, 0);
    assert.equal(label.width, LABEL_WIDTH);
    assert.equal(label.height, row.height);
    assert.equal(label.locked, true, 'cannot be grabbed on the canvas');
    assert.notDeepEqual(label.fills, [], 'has a colour');
  }

  const colors = h.rows().map((r) => JSON.stringify(h.label(r)!.fills));
  assert.equal(new Set(colors).size, 5);
});

test('the default width fits ten stickies and wraps at the eleventh', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const row = h.rows()[0];

  for (let i = 0; i < 13; i++) {
    h.dropIn(row, `item${i}`, CONTENT_X + i * 10, 30);
  }
  await h.send('ARRANGE_NOW');

  const arranged = h.items(row).sort((a, b) => a.y - b.y || a.x - b.x);
  assert.equal(arranged.length, 13);

  const firstLine = arranged.filter((n) => n.y === PADDING);
  const secondLine = arranged.filter((n) => n.y === PADDING + 240 + GAP);
  assert.equal(firstLine.length, COLUMNS);
  assert.equal(secondLine.length, 3);

  firstLine.forEach((node, i) => {
    assert.equal(node.x, CONTENT_X + i * (240 + GAP), `item ${i} on line 1 packs from the right of the tier label`);
  });

  assert.equal(row.height, PADDING * 2 + 240 * 2 + GAP, 'grows by one more line');
  assert.equal(h.label(row)!.height, row.height, 'the tier label grows with it');
  assert.equal(h.rows()[1].y, row.y + row.height, 'the row below is pushed down');
});

test('rank comes from where a sticky was dropped, trading places with what was there', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const row = h.rows()[0];

  const a = h.dropIn(row, 'A', CONTENT_X, 30);
  h.dropIn(row, 'B', CONTENT_X + 270, 30);
  const c = h.dropIn(row, 'C', CONTENT_X + 540, 30);
  await h.send('ARRANGE_NOW');
  assert.deepEqual(h.items(row).sort((x, y) => x.x - y.x).map((n) => n.name), ['A', 'B', 'C']);

  // Drag C between A and B.
  c.x = a.x + 130;
  h.settle();
  await h.send('ARRANGE_NOW');

  assert.deepEqual(
    h.items(row).sort((x, y) => x.x - y.x).map((n) => n.name),
    ['A', 'C', 'B'],
    'C trades places with B',
  );
  assert.equal(a.x, CONTENT_X);
});

test('an emptied row returns to the default height', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const row = h.rows()[0];

  for (let i = 0; i < 13; i++) {
    h.dropIn(row, `item${i}`, CONTENT_X + i * 10, 30);
  }
  await h.send('ARRANGE_NOW');
  assert.ok(row.height > 300);

  for (const child of h.items(row)) {
    const pos = h.absolute(child);
    h.page.appendChild(child);
    child.x = pos.x - 4000;
    child.y = pos.y;
  }
  await h.send('ARRANGE_NOW');
  assert.equal(row.height, 300);
  assert.equal(h.label(row)!.height, 300);
});

test('deleting a row moves its stickies outside the board and closes the gap', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const container = h.containers()[0];
  const row = h.rows()[1];

  h.dropIn(row, 'keep me', CONTENT_X, 30);
  await h.send('ARRANGE_NOW');
  const sticky = h.items(row)[0];
  const boardBottom = h.absolute(container).y + container.height;

  await h.send('DELETE_ROW', row.id);

  assert.equal(h.rows().length, 4);
  assert.equal(sticky.removed, false, 'the sticky was not deleted');
  assert.equal(sticky.parent!.type, 'PAGE', 'adopted by neither a row nor the board');
  assert.ok(h.absolute(sticky).y >= boardBottom, 'sits below the board');

  const left = h.rows();
  for (let i = 1; i < left.length; i++) {
    assert.equal(left[i].y, left[i - 1].y + left[i - 1].height, 'the gaps are closed');
  }
});

test('the contents of a row travel with it when reordered', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const target = h.rows()[0];

  h.dropIn(target, 'rider', CONTENT_X, 30);
  await h.send('ARRANGE_NOW');
  const sticky = h.items(target)[0];

  await h.send('MOVE_ROW', target.id, 'down');

  assert.equal(sticky.parent!.id, target.id, 'the sticky stays with its row');
  assert.equal(h.rows()[1].id, target.id);
});

test('reordering in the panel is reflected on the canvas', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const ids = h.rows().map((r) => r.id);

  await h.send('REORDER_ROWS', [ids[4], ids[0], ids[1], ids[2], ids[3]]);

  assert.deepEqual(h.rows().map((r) => r.name), ['D', 'S', 'A', 'B', 'C']);
});

test('renaming a row updates the letter on its tier label', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  const row = h.rows()[0];

  await h.send('RENAME_ROW', row.id, 'God');

  assert.equal(row.name, 'God');
  assert.equal(h.labelText(row), 'God');
});

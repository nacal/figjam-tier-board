import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness, type FakeNode, type Harness } from './harness';

const CONTENT_X = 300 + 24;

function snapshot(h: Harness, row: FakeNode): string {
  return h
    .items(row)
    .map((n) => `${n.name}@${n.x},${n.y}`)
    .sort()
    .join(' | ');
}

test('arranging a wrapped row repeatedly changes nothing', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const row = h.rows()[0];

  // Enough to wrap onto two lines.
  for (let i = 0; i < 13; i++) {
    h.dropIn(row, `item${i}`, CONTENT_X + i * 10, 30);
  }

  await h.send('ARRANGE_NOW');
  const first = snapshot(h, row);

  for (let round = 0; round < 5; round++) {
    await h.send('ARRANGE_NOW');
    assert.equal(snapshot(h, row), first, `same on pass ${round + 2}`);
  }
});

test('a wrapped row reads upper line first, leftmost first', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const row = h.rows()[0];

  // Overflowing the row width would push stickies out, so overlap them and arrange.
  const names = [];
  for (let i = 0; i < 13; i++) {
    names.push(`item${i}`);
    h.dropIn(row, `item${i}`, CONTENT_X + i * 100, 30);
  }
  await h.send('ARRANGE_NOW');

  const read = h.items(row).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.name);
  assert.deepEqual(read, names, 'the left-to-right order it was dropped in is kept');

  await h.send('ARRANGE_NOW');
  const again = h.items(row).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.name);
  assert.deepEqual(again, names, 'lines do not interleave on a second pass');
});

test('touching a wrapped row does not start an endless arrange', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const row = h.rows()[0];

  const items = [];
  for (let i = 0; i < 13; i++) {
    items.push(h.dropIn(row, `item${i}`, CONTENT_X + i * 100, 30));
  }
  h.change(items);
  await h.flush();

  const settled = snapshot(h, row);

  // Auto-arrange must not keep reacting to its own writes forever.
  await h.flush(900);
  assert.equal(snapshot(h, row), settled, 'nothing keeps moving when left alone');
});

test('dragging a second-line item onto the first takes the rank of where it landed', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const row = h.rows()[0];

  const items = [];
  for (let i = 0; i < 12; i++) {
    items.push(h.dropIn(row, `item${i}`, CONTENT_X + i * 100, 30));
  }
  await h.send('ARRANGE_NOW');

  // Move the head of line 2 (item10) between the first and second of line 1.
  const moved = items[10];
  moved.x = CONTENT_X + 130;
  moved.y = 24;
  await h.send('ARRANGE_NOW');

  const read = h.items(row).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.name);
  assert.equal(read[0], 'item0');
  assert.equal(read[1], 'item10', 'takes the rank of where it was dropped');
  assert.equal(read[2], 'item1');
});

test('a tall sticky does not break line detection', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const row = h.rows()[0];

  const items = [];
  for (let i = 0; i < 13; i++) {
    items.push(h.dropIn(row, `item${i}`, CONTENT_X + i * 100, 30));
  }
  await h.send('ARRANGE_NOW');
  assert.equal(h.items(row).length, 13, 'all 13 are inside the row');

  // A wordy sticky grows taller, so centres no longer line up within a line.
  for (let i = 0; i < items.length; i += 3) {
    items[i].height = 900;
  }
  await h.send('ARRANGE_NOW');

  const first = snapshot(h, row);
  const order = h.items(row).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.name);

  for (let round = 0; round < 4; round++) {
    await h.send('ARRANGE_NOW');
    assert.equal(snapshot(h, row), first, 'positions are unchanged');
    assert.deepEqual(
      h.items(row).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.name),
      order,
      'the order is unchanged too',
    );
  }
});

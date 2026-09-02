import assert from 'node:assert/strict';
import { test } from 'vitest';
import { relativeLuminance } from '../src/domain/theme';
import { createHarness, type FakeNode, type Harness } from './harness';

function containerOf(h: Harness, boardId: string): FakeNode | null {
  return h.containers().find((c) => c.getPluginData('figjamTierBoard') === boardId) ?? null;
}

function title(h: Harness, boardId: string): FakeNode | null {
  const container = containerOf(h, boardId);
  return container === null ? null : h.titleOf(container);
}

async function board(h: Harness): Promise<string> {
  await h.send('CREATE_BOARD');
  await h.flush();
  return h.state().boards[0].id;
}

test('naming a board puts a heading inside it', async () => {
  const h = createHarness();
  const id = await board(h);

  await h.send('SET_BOARD_NAME', id, 'Best games of 2026');

  const heading = title(h, id);
  assert.ok(heading, 'a heading is created');
  assert.equal(heading.characters, 'Best games of 2026');
  assert.equal(heading.parent!.id, containerOf(h, id)!.id, 'a child of the board, so it travels with the table');

  const top = h.rows()[0];
  assert.equal(heading.x, 0, 'aligns to the board left edge');
  assert.ok(heading.y + heading.height <= top.y, 'sits above the topmost row');
});

test('the name becomes the board section name too', async () => {
  const h = createHarness();
  const id = await board(h);

  await h.send('SET_BOARD_NAME', id, 'Survival');

  assert.equal(containerOf(h, id)!.name, 'Survival');
  const listed = h.state().boards[0];
  assert.equal(listed.name, 'Survival');
  assert.equal(listed.label, 'Survival', 'replaces the unnamed Board N label');
});

test('clearing the name removes the heading', async () => {
  const h = createHarness();
  const id = await board(h);
  await h.send('SET_BOARD_NAME', id, 'named for now');
  assert.ok(title(h, id));

  await h.send('SET_BOARD_NAME', id, '   ');

  assert.equal(title(h, id), null);
  assert.equal(h.state().boards[0].label, 'Board 1');
  assert.equal(h.rows()[0].y, 0, 'the space the heading took is reclaimed');
});

test('the heading follows when the whole table moves', async () => {
  const h = createHarness();
  const id = await board(h);
  await h.send('SET_BOARD_NAME', id, 'Follow test');

  const container = containerOf(h, id)!;
  const heading = title(h, id)!;
  const before = h.absolute(heading);

  container.x += 1200;
  container.y += 400;
  h.settle();

  assert.deepEqual(h.absolute(heading), { x: before.x + 1200, y: before.y + 400 });
  assert.equal(heading.parent!.id, container.id);
});

test('the heading is not swallowed when a row grows', async () => {
  const h = createHarness();
  const id = await board(h);
  await h.send('SET_BOARD_NAME', id, 'Follow test');

  const rows = h.rows();
  for (let i = 0; i < 13; i++) {
    h.dropIn(rows[0], `item${i}`, 324 + i * 10, 30);
  }
  await h.send('ARRANGE_NOW');

  const heading = title(h, id);
  assert.ok(heading, 'the heading survives');
  assert.equal(heading.parent!.id, containerOf(h, id)!.id);
  assert.ok(heading.y + heading.height <= h.rows()[0].y);
});

test('each board can have its own name', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.send('CREATE_BOARD');
  await h.flush();
  const ids = h.state().boards.map((b) => b.id);

  await h.send('SET_BOARD_NAME', ids[0], 'Fun');
  await h.send('SET_BOARD_NAME', ids[1], 'Difficulty');

  assert.deepEqual(h.state().boards.map((b) => b.name), ['Fun', 'Difficulty']);
  assert.equal(title(h, ids[0])!.characters, 'Fun');
  assert.equal(title(h, ids[1])!.characters, 'Difficulty');
});

test('deleting every row takes the container with it', async () => {
  const h = createHarness();
  const id = await board(h);
  await h.send('SET_BOARD_NAME', id, 'Board to delete');

  for (const row of h.rows()) {
    await h.send('DELETE_ROW', row.id);
  }

  assert.equal(h.rows().length, 0);
  assert.equal(containerOf(h, id), null, 'the heading goes with it');
});

test('the heading contrasts enough with the row face', async () => {
  const h = createHarness();
  const id = await board(h);

  await h.send('SET_BOARD_NAME', id, 'Readable?');

  const container = containerOf(h, id)!;
  const titleFill = JSON.parse(JSON.stringify(title(h, id)!.fills))[0].color;
  const rowFill = JSON.parse(JSON.stringify(h.rowsOf(container)[0].fills))[0].color;
  const diff = Math.abs(relativeLuminance(titleFill) - relativeLuminance(rowFill));
  assert.ok(diff > 0.5, `face vs heading differs by only ${diff.toFixed(2)}`);
});

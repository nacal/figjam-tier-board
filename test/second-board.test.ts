import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness } from './harness';

const CONTENT_X = 300 + 24;

test('a sticky dropped onto a second board added after opening the plugin packs left', async () => {
  const h = createHarness();
  // Start with one board already there, as if from an earlier session.
  await h.send('CREATE_BOARD');
  await h.flush();
  h.restart();
  await h.send('REQUEST_STATE');

  // Add a second one.
  await h.send('CREATE_BOARD');
  await h.flush();
  const containers = h.containers();
  assert.equal(containers.length, 2);

  const row = h.rowsOf(containers[1])[0];
  const sticky = h.dropIn(row, 'Minecraft', CONTENT_X + 900, 60);
  assert.equal(sticky.parent!.id, row.id, 'is a child of the row');

  h.change(sticky);
  await h.flush();

  assert.equal(sticky.x, CONTENT_X, 'packs left');
  assert.equal(sticky.y, 24);
});

test('a sticky dropped onto the second board from elsewhere packs left', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.send('CREATE_BOARD');
  await h.flush();
  const containers = h.containers();
  const row = h.rowsOf(containers[1])[2];

  // Grab a distant sticky and drop it into a row of the second board.
  const sticky = h.createSticky('Palworld', 0, 0);
  h.settle();
  h.change(sticky);

  const at = h.absolute(row);
  h.page.appendChild(sticky);
  sticky.x = at.x + CONTENT_X + 1200;
  sticky.y = at.y + 40;
  h.settle();
  h.change(sticky);
  await h.flush();

  assert.equal(sticky.parent!.id, row.id);
  assert.equal(sticky.x, CONTENT_X, 'packs left');
});

test('a sticky FigJam attached to the outer board is adopted by the row it overlaps and packs left', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.send('CREATE_BOARD');
  await h.flush();
  const containers = h.containers();
  const rows = h.rowsOf(containers[1]);

  // A sticky attached to the board at the height of the third row (C).
  const sticky = h.dropOnBoard(containers[1], 'Minecraft', CONTENT_X + 900, rows[2].y + 40);
  assert.equal(sticky.parent!.id, containers[1].id, 'a child of the board, not of a row');

  h.change(sticky);
  await h.flush();

  assert.equal(sticky.parent!.id, rows[2].id, 'the overlapping row adopts it');
  assert.equal(sticky.x, CONTENT_X, 'packs left');
  assert.equal(sticky.y, 24);
});

test('the heading is not adopted', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const id = h.state().boards[0].id;
  await h.send('SET_BOARD_NAME', id, 'Name');

  await h.send('ARRANGE_NOW');

  const container = h.containers()[0];
  const heading = h.titleOf(container);
  assert.ok(heading, 'the heading stays a child of the board');
  assert.equal(heading.parent!.id, container.id);
});

test('the adopting row is decided by the drop height', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const container = h.containers()[0];
  const rows = h.rowsOf(container);

  const top = h.dropOnBoard(container, 'to row S', CONTENT_X, rows[0].y + 10);
  const bottom = h.dropOnBoard(container, 'to row D', CONTENT_X, rows[4].y + 250);
  h.change([top, bottom]);
  await h.flush();

  assert.equal(top.parent!.id, rows[0].id);
  assert.equal(bottom.parent!.id, rows[4].id);
});

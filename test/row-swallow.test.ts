import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness, type FakeNode } from './harness';

const CONTENT_X = 300 + 24;

// Dropping one row onto another makes the section swallow the other's contents,
// labels and stickies alike. Only the outcome is reproduced.
// It was dragged, so the row's own position changes too.
function dragOnto(dragged: FakeNode, victim: FakeNode): void {
  dragged.y = victim.y + 30;
  for (const child of victim.children.slice()) {
    dragged.appendChild(child);
  }
}

test('dropping A onto B does not leave two rows labelled B', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();
  const [s, a, b] = rows;

  assert.equal(h.labelText(a), 'A');
  assert.equal(h.labelText(b), 'B');

  dragOnto(a, b);
  assert.equal(h.label(b), null, 'B had its tier label stolen');

  h.change(a);
  await h.flush();

  // The order changes, but every row still owns a label with its own letter.
  assert.equal(h.rows().length, 5);
  for (const row of h.rows()) {
    assert.ok(h.label(row), `${row.name} has a tier label`);
    assert.equal(h.labelText(row), row.name, `${row.name} owns its tier label`);
  }
  const letters = h.rows().map((r) => h.labelText(r)).sort();
  assert.deepEqual(letters, ['A', 'B', 'C', 'D', 'S'], 'no letter appears twice');

  // The thief must not keep two labels, which would overlap indistinguishably.
  for (const row of h.rows()) {
    const cells = row.children.filter(
      (child) => (child.getPluginData('figjamTierLabel') || '') !== '',
    );
    assert.equal(cells.length, 1, `${row.name} has exactly one tier label`);
  }
  assert.equal(s.name, 'S');
});

test('stickies of the row that was covered go back to it', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();
  const [, a, b] = rows;

  const inB = h.dropIn(b, 'Minecraft', CONTENT_X, 30);
  const inA = h.dropIn(a, 'Palworld', CONTENT_X, 30);
  await h.send('ARRANGE_NOW');
  assert.equal(inB.parent!.id, b.id);

  dragOnto(a, b);
  assert.equal(inB.parent!.id, a.id, 'the stickies were taken as well');

  h.change(a);
  await h.flush();

  assert.equal(inB.parent!.id, b.id, 'returns to its row');
  assert.equal(inA.parent!.id, a.id, 'the sticky that was already in A stays put');
  assert.equal(inB.x, CONTENT_X, 'packs left where it returns');
});

test('a sticky a person moved to another row is left there', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const [s, a] = h.rows();

  const sticky = h.dropIn(a, 'Minecraft', CONTENT_X, 30);
  await h.send('ARRANGE_NOW');

  // Move only the sticky into S, leaving the rows alone.
  const pos = h.absolute(sticky);
  h.page.appendChild(sticky);
  sticky.x = pos.x;
  sticky.y = pos.y - 300;
  h.settle();
  h.change(sticky);
  await h.flush();

  assert.equal(sticky.parent!.id, s.id, 'stays in S and is not sent back to A');
  assert.equal(sticky.x, CONTENT_X);
});

test('a tier label whose owner is gone is discarded', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();
  const [, a, b] = rows;

  const stolen = h.label(b)!;
  a.y = b.y + 30;
  a.appendChild(stolen);
  await h.send('DELETE_ROW', b.id);

  await h.send('ARRANGE_NOW');

  assert.equal(stolen.removed, true, 'an ownerless tier label does not survive');
  assert.equal(h.labelText(a), 'A', 'A keeps its own tier label');
});

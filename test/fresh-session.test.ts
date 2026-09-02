import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness, type FakeNode, type Harness } from './harness';

const CONTENT_X = 300 + 24;

function dragBy(h: Harness, sticky: FakeNode, dx: number, dy: number): void {
  const pos = h.absolute(sticky);
  h.page.appendChild(sticky);
  sticky.x = pos.x + dx;
  sticky.y = pos.y + dy;
  h.settle();
  h.change(sticky);
}

test('packing works on the first drag after the plugin reopens', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const [, a] = h.rows();
  h.dropIn(a, 'a', CONTENT_X, 30);
  const moved = h.dropIn(a, 'i', CONTENT_X + 400, 30);
  await h.send('ARRANGE_NOW');

  // Reopen the plugin here.
  h.restart();
  await h.send('REQUEST_STATE');

  // Move a sticky on the canvas without pressing Arrange now.
  dragBy(h, moved, 60, 40);
  await h.flush();

  assert.deepEqual(
    h.items(a).map((n) => n.x).sort((x, y) => x - y),
    [324, 588],
    'repacks even right after reopening',
  );
});

test('moving to another row right after reopening repacks both rows', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const [s, a] = h.rows();
  h.dropIn(a, 'a', CONTENT_X, 30);
  const moved = h.dropIn(a, 'i', CONTENT_X + 400, 30);
  h.dropIn(a, 'u', CONTENT_X + 800, 30);
  await h.send('ARRANGE_NOW');

  h.restart();
  await h.send('REQUEST_STATE');

  dragBy(h, moved, 30, -300);
  await h.flush();

  assert.equal(moved.parent!.id, s.id);
  assert.equal(moved.x, CONTENT_X, 'packs left where it moved');
  assert.deepEqual(h.items(a).map((n) => n.x).sort((x, y) => x - y), [324, 588], 'the gap in the original row closes too');
});

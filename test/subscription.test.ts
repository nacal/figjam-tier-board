import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness } from './harness';

const CONTENT_X = 300 + 24;

test('subscribes to canvas changes on both channels and reports them', async () => {
  const h = createHarness();
  await h.send('REQUEST_STATE');

  const subscriptions = h.state().subscriptions;
  assert.deepEqual(subscriptions, ['nodechange', 'documentchange']);
});

for (const channel of ['nodechange', 'documentchange'] as const) {
  test(`arranges when only ${channel} is delivered`, async () => {
    const h = createHarness();
    await h.send('CREATE_BOARD');
    await h.flush();
    const row = h.rows()[0];

    h.dropIn(row, 'a', CONTENT_X + 600, 40);
    h.dropIn(row, 'i', CONTENT_X + 1200, 40);
    h.changeVia(channel, h.items(row));
    await h.flush();

    assert.deepEqual(
      h.items(row).map((n) => n.x).sort((a, b) => a - b),
      [324, 588],
      'packs left',
    );
  });
}

test('duplicate delivery on both channels changes nothing', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const row = h.rows()[0];

  h.dropIn(row, 'a', CONTENT_X + 600, 40);
  h.dropIn(row, 'i', CONTENT_X + 1200, 40);
  h.change(h.items(row));
  await h.flush();

  assert.deepEqual(h.items(row).map((n) => n.x).sort((a, b) => a - b), [324, 588]);
  assert.equal(row.height, 300);
});

test('survives style changes, which carry no node', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const row = h.rows()[0];
  h.dropIn(row, 'a', CONTENT_X + 600, 40);

  // Only a change with no node arrives, so nothing is arranged.
  for (const listener of h.figma.documentListeners()) {
    listener({ documentChanges: [{ type: 'STYLE_PROPERTY_CHANGE', id: 'S:1', origin: 'LOCAL', style: {} }] });
  }
  await h.flush();
  assert.deepEqual(h.items(row).map((n) => n.x), [924], 'a style change does not trigger an arrange');

  // A real change afterwards is still picked up.
  h.change(h.items(row));
  await h.flush();
  assert.deepEqual(h.items(row).map((n) => n.x), [324], 'later arranges still run');
});

test('a live node is not mistaken for a deleted one', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const row = h.rows()[0];
  const sticky = h.dropIn(row, 'a', CONTENT_X + 900, 40);

  // Real nodes always carry removed, false while alive. Testing for the property
  // instead of the value would take this sticky for deleted and skip it.
  assert.equal('removed' in sticky, true, 'a live node still has a removed property');
  assert.equal(sticky.removed, false);

  h.change(sticky);
  await h.flush();

  assert.equal(sticky.x, CONTENT_X, 'is targeted and arranged');
});

test('nodechange is live before the page load that documentchange waits on', () => {
  const h = createHarness();

  // Synchronously after boot: documentchange is still behind loadAllPagesAsync,
  // so nodechange has to be listening already or edits made in that window are
  // lost.
  const listening = h.listeners.some((l) => l.type === 'nodechange');
  assert.equal(listening, true);
});

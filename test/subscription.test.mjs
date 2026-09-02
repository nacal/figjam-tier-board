import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

const CONTENT_X = 300 + 24;

test('キャンバスの変更を両方の経路で購読し、パネルに出す', async () => {
  const h = createHarness();
  await h.send({ type: 'init' });

  const subscriptions = h.lastUiMessage().subscriptions;
  assert.deepEqual(subscriptions, ['nodechange', 'documentchange']);
});

for (const channel of ['nodechange', 'documentchange']) {
  test(`${channel} だけが届いても整列する`, async () => {
    const h = createHarness();
    await h.send({ type: 'create-board' });
    await h.flush();
    const row = h.rows()[0];

    h.dropIn(row, 'あ', CONTENT_X + 600, 40);
    h.dropIn(row, 'い', CONTENT_X + 1200, 40);
    h.changeVia(channel, h.items(row));
    await h.flush();

    assert.deepEqual(
      h.items(row).map((n) => n.x).sort((a, b) => a - b),
      [324, 588],
      '左に詰まる',
    );
  });
}

test('両方から二重に届いても結果は同じ', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.flush();
  const row = h.rows()[0];

  h.dropIn(row, 'あ', CONTENT_X + 600, 40);
  h.dropIn(row, 'い', CONTENT_X + 1200, 40);
  h.change(h.items(row));
  await h.flush();

  assert.deepEqual(h.items(row).map((n) => n.x).sort((a, b) => a - b), [324, 588]);
  assert.equal(row.height, 300);
});

test('スタイルの変更（node を持たない）が混ざっても落ちない', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.flush();
  const row = h.rows()[0];
  h.dropIn(row, 'あ', CONTENT_X + 600, 40);

  // node を持たない変更だけが届く（整列は走らない）
  for (const listener of h.figma.documentListeners()) {
    listener({ documentChanges: [{ type: 'STYLE_PROPERTY_CHANGE', id: 'S:1', origin: 'LOCAL', style: {} }] });
  }
  await h.flush();
  assert.deepEqual(h.items(row).map((n) => n.x), [924], 'スタイルの変更では整列しない');

  // そのあとの本物の変更はちゃんと拾える
  h.change(h.items(row));
  await h.flush();
  assert.deepEqual(h.items(row).map((n) => n.x), [324], 'あとの整列も生きている');
});

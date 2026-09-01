import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

const DEFAULT_WIDTH = 300 + 24 * 2 + 240 * 10 + 24 * 9; // 2964

test('既定の幅は付箋10枚ぶん', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  for (const row of h.rows()) {
    assert.equal(row.width, DEFAULT_WIDTH);
  }
});

test('1行の幅を変えると全行が同じ幅になる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });

  // 真ん中の行の右端をユーザーが引っ張った、という状況
  const widened = DEFAULT_WIDTH + 528; // 付箋2枚ぶん広げる
  h.rows()[2].resizeWithoutConstraints(widened, h.rows()[2].height);

  await h.send({ type: 'arrange-now' });

  for (const row of h.rows()) {
    assert.equal(row.width, widened, '全行が広がる');
  }
});

test('幅を狭めると折り返しの枚数も減る', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const row = h.rows()[0];

  for (let i = 0; i < 6; i++) {
    h.createSticky(`item${i}`, row.x + 324 + i * 10, row.y + 30);
  }
  h.settle();
  await h.send({ type: 'arrange-now' });
  assert.equal(row.height, 300, '6枚は1段に収まる');

  // 付箋4枚ぶんの幅まで狭める
  const narrow = 300 + 24 * 2 + 240 * 4 + 24 * 3;
  row.resizeWithoutConstraints(narrow, row.height);
  await h.send({ type: 'arrange-now' });

  for (const other of h.rows()) {
    assert.equal(other.width, narrow);
  }
  assert.equal(h.items(row).length, 6, '狭めても付箋は行から抜けない');
  assert.equal(row.height, 24 * 2 + 240 * 2 + 24, '2段に折り返す');
});

test('行を追加すると今の盤面の幅で作られる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });

  const widened = DEFAULT_WIDTH + 264;
  h.rows()[0].resizeWithoutConstraints(widened, h.rows()[0].height);
  await h.send({ type: 'arrange-now' });

  await h.send({ type: 'add-row' });

  assert.equal(h.rows().length, 6);
  for (const row of h.rows()) {
    assert.equal(row.width, widened);
  }
});

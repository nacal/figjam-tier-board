import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

test('並べ替えても盤面の位置は動かない', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });

  const before = h.rows().map((r) => ({ x: r.x, y: r.y }));
  const ids = h.rows().map((r) => r.id);

  // D を先頭へ
  await h.send({ type: 'reorder-rows', ids: [ids[4], ids[0], ids[1], ids[2], ids[3]] });

  const after = h.rows().map((r) => ({ x: r.x, y: r.y }));
  assert.deepEqual(after, before, '枠の位置はそのままで、中身の順番だけが入れ替わる');
  assert.deepEqual(h.rows().map((r) => r.name), ['D', 'S', 'A', 'B', 'C']);
});

test('↑↓ で入れ替えても盤面の位置は動かない', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });

  const before = h.rows().map((r) => ({ x: r.x, y: r.y }));
  const topId = h.rows()[0].id;

  await h.send({ type: 'move-row', id: topId, direction: 'down' });

  assert.deepEqual(h.rows().map((r) => ({ x: r.x, y: r.y })), before);
  assert.deepEqual(h.rows().map((r) => r.name), ['A', 'S', 'B', 'C', 'D']);
});

test('整列で行の高さが変わっても盤面の上端は動かない', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const rows = h.rows();
  const top = { x: rows[0].x, y: rows[0].y };

  for (let i = 0; i < 9; i++) {
    h.createSticky(`item${i}`, rows[2].x + 30 + i * 10, rows[2].y + 30);
  }
  h.settle();
  await h.send({ type: 'arrange-now' });

  assert.deepEqual({ x: h.rows()[0].x, y: h.rows()[0].y }, top, '上端は固定');
  assert.ok(h.rows()[2].height > 300, '中身が増えた行だけ伸びる');
});

test('1行だけ横にずらしても盤面はいちばん上の行の位置に揃う', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const rows = h.rows();
  const originX = rows[0].x;

  // 真ん中の行だけ左へ大きくずらす
  rows[2].x = originX - 900;

  await h.send({ type: 'arrange-now' });

  for (const row of h.rows()) {
    assert.equal(row.x, originX, '外れ値に引っ張られない');
  }
});

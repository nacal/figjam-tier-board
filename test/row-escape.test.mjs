import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

const CONTENT_X = 300 + 24;

// キャンバス上で行を掴んで動かす操作。行が盤面から外へ出ると、
// FigJam はその行を盤面の子から外す。
function dragRowOut(h, row, dx, dy) {
  const pos = h.absolute(row);
  h.page.appendChild(row);
  row.x = pos.x + dx;
  row.y = pos.y + dy;
  h.settle();
}

test('行だけをキャンバスへ持ち出しても、元の盤面に戻る', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const container = h.containers()[0];
  const row = h.rows()[1];
  const sticky = h.dropIn(row, 'マイクラ', CONTENT_X, 30);
  await h.send({ type: 'arrange-now' });

  dragRowOut(h, row, 4000, 3000);
  assert.equal(row.parent.type, 'PAGE', '外に出た');

  await h.send({ type: 'arrange-now' });

  assert.equal(row.parent.id, container.id, '元の盤面に戻る');
  assert.equal(h.containers().length, 1, '新しい盤面はできない');
  assert.equal(h.rows().length, 5);
  assert.equal(sticky.parent.id, row.id, '中の付箋も一緒に戻る');
});

test('行を下へドラッグすると、その高さの順番になる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const container = h.containers()[0];
  const row = h.rows()[0];
  assert.equal(row.name, 'S');

  // 盤面の下端より下へ落とす
  dragRowOut(h, row, 0, container.height + 200);
  await h.send({ type: 'arrange-now' });

  assert.deepEqual(h.rows().map((r) => r.name), ['A', 'B', 'C', 'D', 'S'], '末尾へ移る');
  assert.deepEqual(h.rows().map((r) => r.y), [0, 300, 600, 900, 1200], '隙間なく詰まる');
});

test('行を別の盤面へ移すと、その盤面の行になる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.send({ type: 'create-board' });
  await h.flush();

  const [first, second] = h.containers();
  const row = h.rowsOf(first)[0];

  // ２つ目の盤面の中へ落とす。セクションを別のセクションへ入れる操作は
  // FigJam 側がやることなので、その結果だけを再現する。
  h.moveRowInto(row, second, second.height - 10);

  await h.send({ type: 'arrange-now' });

  assert.equal(row.parent.id, second.id, '移した先の盤面の子になる');
  assert.equal(row.getPluginData('figjamTierBoard'), second.getPluginData('figjamTierBoard'));
  assert.equal(h.rowsOf(first).length, 4);
  assert.equal(h.rowsOf(second).length, 6);
});

test('行を移しても、盤面の名前は付いていかない', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.send({ type: 'create-board' });
  await h.flush();
  const ids = h.lastUiMessage().boards.map((b) => b.id);
  await h.send({ type: 'set-board-name', boardId: ids[0], name: '面白さ' });

  const [first, second] = h.containers();
  h.moveRowInto(h.rowsOf(first)[0], second, second.height - 10);

  await h.send({ type: 'arrange-now' });

  assert.deepEqual(h.lastUiMessage().boards.map((b) => b.name), ['面白さ', '']);
});

test('自動整列でも行は戻ってくる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.flush();
  const container = h.containers()[0];
  const row = h.rows()[2];

  dragRowOut(h, row, 3000, 2000);
  h.change(row);
  await h.flush();

  assert.equal(row.parent.id, container.id);
  assert.equal(h.containers().length, 1);
});

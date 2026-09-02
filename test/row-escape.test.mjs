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
  assert.equal(h.rows()[4].id, row.id, '下へ落としたので末尾になる');
});

test('行を下へドラッグすると、その位置の順番になる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const container = h.containers()[0];
  const row = h.rows()[0];
  assert.equal(row.name, 'S');

  // 盤面の下端より下へ落とす
  dragRowOut(h, row, 0, container.height + 200);
  await h.send({ type: 'arrange-now' });

  assert.deepEqual(h.rows().map((r) => r.name), ['A', 'B', 'C', 'D', 'S'], '末尾へ移る');
  assert.equal(row.parent.id, container.id);
  assert.deepEqual(h.rows().map((r) => r.y), [0, 300, 600, 900, 1200], '隙間なく詰まる');
});

test('隣の行の中心を越えるまでは順番が変わらない', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const rows = h.rows();
  const row = rows[0];

  // 1行の高さの半分より手前
  row.y = 140;
  await h.send({ type: 'arrange-now' });
  assert.deepEqual(h.rows().map((r) => r.name), ['S', 'A', 'B', 'C', 'D'], '入れ替わらない');
  assert.equal(h.rows()[0].y, 0, 'スロットに戻る');

  // 隣の行の中心（450）を越える
  row.y = 460;
  await h.send({ type: 'arrange-now' });
  assert.deepEqual(h.rows().map((r) => r.name), ['A', 'S', 'B', 'C', 'D'], '1つ下と入れ替わる');
});

test('行を別の行の上に落としても、その行がアイテムとして詰められない', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.flush();
  const container = h.containers()[0];
  const rows = h.rows();
  const dragged = rows[3];

  // FigJam が行を行の子にしてしまった状態を再現する
  rows[0].appendChild(dragged);
  dragged.x = 500;
  dragged.y = 30;

  h.change(dragged);
  await h.flush();

  assert.equal(dragged.parent.id, container.id, '行の子ではなく盤面の子に戻る');
  assert.equal(h.items(rows[0]).length, 0, '行が付箋として数えられていない');
  assert.equal(rows[0].height, 300, '行の高さが荒れていない');
  assert.equal(dragged.width, 2964, '行の幅が付箋の幅に潰されていない');
  assert.equal(h.rows().length, 5, '行は5つのまま');
  assert.deepEqual(h.rows().map((r) => r.y), [0, 300, 600, 900, 1200], '隙間なく積まれている');
});

test('矢印での並べ替えと、ドラッグでの並べ替えが噛み合う', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const container = h.containers()[0];

  await h.send({ type: 'move-row', id: h.rows()[0].id, direction: 'down' });
  assert.deepEqual(h.rows().map((r) => r.name), ['A', 'S', 'B', 'C', 'D']);

  // いちばん下（D）を盤面の上へドラッグする
  const row = h.rows()[4];
  dragRowOut(h, row, 0, -(container.height + 500));
  await h.send({ type: 'arrange-now' });

  assert.deepEqual(h.rows().map((r) => r.name), ['D', 'A', 'S', 'B', 'C'], 'ドラッグした位置が反映される');
  assert.deepEqual(h.rows().map((r) => r.y), [0, 300, 600, 900, 1200]);
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

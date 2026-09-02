import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

const CONTENT_X = 300 + 24;
const DEFAULT_WIDTH = 300 + 24 * 2 + 240 * 10 + 24 * 9;

async function twoBoards(h) {
  await h.send({ type: 'create-board' });
  await h.send({ type: 'create-board' });
  const boards = h.lastUiMessage().boards;
  assert.equal(boards.length, 2);
  const ids = boards.map((b) => b.id);
  const rowsOf = (id) => h.rows().filter((r) => r.getPluginData('figjamTierBoard') === id);
  return { ids, rowsOf };
}

test('盤面はいくつでも作れて、２つ目は１つ目の下に置かれる', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);

  const first = rowsOf(ids[0]);
  const second = rowsOf(ids[1]);
  assert.equal(first.length, 5);
  assert.equal(second.length, 5);

  const firstBottom = first[first.length - 1].y + first[first.length - 1].height;
  assert.ok(second[0].y >= firstBottom, '２つ目は１つ目より下');

  // それぞれの中では隙間なく積まれている
  for (const rows of [first, second]) {
    for (let i = 1; i < rows.length; i++) {
      assert.equal(rows[i].y, rows[i - 1].y + rows[i - 1].height);
    }
  }
});

test('整列しても盤面どうしは合体しない', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);
  const gapBefore = rowsOf(ids[1])[0].y - (rowsOf(ids[0])[4].y + rowsOf(ids[0])[4].height);

  await h.send({ type: 'arrange-now' });

  const gapAfter = rowsOf(ids[1])[0].y - (rowsOf(ids[0])[4].y + rowsOf(ids[0])[4].height);
  assert.equal(gapAfter, gapBefore, '盤面の間の余白は詰められない');
  assert.equal(rowsOf(ids[0]).length, 5);
  assert.equal(rowsOf(ids[1]).length, 5);
});

test('幅の変更は同じ盤面のなかだけに広がる', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);

  const widened = DEFAULT_WIDTH + 528;
  const target = rowsOf(ids[0])[2];
  target.resizeWithoutConstraints(widened, target.height);

  await h.send({ type: 'arrange-now' });

  for (const row of rowsOf(ids[0])) {
    assert.equal(row.width, widened, '同じ盤面は広がる');
  }
  for (const row of rowsOf(ids[1])) {
    assert.equal(row.width, DEFAULT_WIDTH, 'もう一方は元のまま');
  }
});

test('並べ替えは盤面をまたがない', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);
  const otherBefore = rowsOf(ids[1]).map((r) => ({ name: r.name, y: r.y }));

  const target = rowsOf(ids[0]);
  await h.send({ type: 'reorder-rows', ids: [target[4].id, target[0].id, target[1].id, target[2].id, target[3].id] });

  assert.deepEqual(rowsOf(ids[0]).map((r) => r.name), ['D', 'S', 'A', 'B', 'C']);
  assert.deepEqual(rowsOf(ids[1]).map((r) => ({ name: r.name, y: r.y })), otherBefore, 'もう一方は動かない');
});

test('キャンバスで選ぶと、パネルの操作対象がその盤面に移る', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);

  // ２つ目を作った直後はそちらが対象
  assert.equal(h.lastUiMessage().activeBoardId, ids[1]);

  // １つ目の行の中の付箋を選ぶ
  const row = rowsOf(ids[0])[0];
  const sticky = h.createSticky('マイクラ', row.x + CONTENT_X, row.y + 30);
  h.settle();
  h.select(sticky);

  const message = h.lastUiMessage();
  assert.equal(message.activeBoardId, ids[0], '選んだ付箋のいる盤面に移る');
  assert.deepEqual(message.rows.map((r) => r.id), Array.from(rowsOf(ids[0]), (r) => r.id));
});

test('行の追加は選択中の盤面に入る', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);

  h.select(rowsOf(ids[0])[0]);
  await h.send({ type: 'add-row' });

  assert.equal(rowsOf(ids[0]).length, 6);
  assert.equal(rowsOf(ids[1]).length, 5);
  const added = rowsOf(ids[0])[5];
  assert.equal(added.y, rowsOf(ids[0])[4].y + rowsOf(ids[0])[4].height, '末尾に隙間なく付く');
});

test('片方の盤面の行を消してももう一方は動かない', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);
  const otherBefore = rowsOf(ids[1]).map((r) => ({ name: r.name, y: r.y }));

  await h.send({ type: 'delete-row', id: rowsOf(ids[0])[1].id });

  assert.equal(rowsOf(ids[0]).length, 4);
  assert.deepEqual(rowsOf(ids[1]).map((r) => ({ name: r.name, y: r.y })), otherBefore);
});

test('盤面をひとつ消しきってももう一方は残る', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);

  for (const row of rowsOf(ids[0])) {
    await h.send({ type: 'delete-row', id: row.id });
  }

  assert.equal(rowsOf(ids[0]).length, 0);
  assert.equal(rowsOf(ids[1]).length, 5);
  assert.equal(h.lastUiMessage().boards.length, 1);
  assert.equal(h.lastUiMessage().activeBoardId, ids[1], '残った盤面が対象になる');
});

test('行を消したときの逃がし先が、下にある別の盤面に刺さらない', async () => {
  const h = createHarness();
  const { ids, rowsOf } = await twoBoards(h);

  const row = rowsOf(ids[0])[1];
  h.createSticky('マイクラ', row.x + CONTENT_X, row.y + 30);
  h.settle();
  await h.send({ type: 'arrange-now' });
  const sticky = h.items(row)[0];

  await h.send({ type: 'delete-row', id: row.id });

  assert.equal(sticky.removed, undefined);
  assert.equal(sticky.parent.type, 'PAGE', '下の盤面に取り込まれていない');
  const lastRow = rowsOf(ids[1])[4];
  assert.ok(sticky.y >= lastRow.y + lastRow.height, '２つ目の盤面より下にいる');
});

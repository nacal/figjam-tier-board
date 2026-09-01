import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

const ROW_GAP = 40;
const PADDING = 24;
const GAP = 24;

test('盤面を作成すると S/A/B/C/D の5行が等間隔で並ぶ', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });

  const rows = h.rows();
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.name), ['S', 'A', 'B', 'C', 'D']);
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i].x, rows[0].x);
    assert.equal(rows[i].y, rows[i - 1].y + rows[i - 1].height + ROW_GAP);
  }
});

test('行に落とした付箋は左寄せで詰められ、はみ出す分は折り返す', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const row = h.rows()[0];

  // 行の中にばらばらの位置で 8 枚落とす（順番も x の昇順ではない）
  const dropped = [];
  const spots = [900, 100, 1300, 500, 700, 1100, 300, 1500];
  spots.forEach((x, i) => {
    dropped.push(h.createSticky(`item${i}`, row.x + x - 120, row.y + 30));
  });
  h.settle();
  assert.equal(row.children.length, 8);

  await h.send({ type: 'arrange-now' });

  // 2段に折り返すので、読み順（y → x）で比べる
  const arranged = [...row.children].sort((a, b) => a.y - b.y || a.x - b.x);
  const expectedOrder = spots
    .map((x, i) => ({ x, name: `item${i}` }))
    .sort((a, b) => a.x - b.x)
    .map((e) => e.name);
  assert.deepEqual(arranged.map((n) => n.name), expectedOrder, '中心 x の昇順で並ぶ');

  // 既定幅にはちょうど 6 枚入るので 1行目 6 枚、2行目 2 枚。左端から padding + (240+gap) 刻み。
  const firstLine = arranged.filter((n) => n.y === PADDING);
  const secondLine = arranged.filter((n) => n.y === PADDING + 240 + GAP);
  assert.equal(firstLine.length, 6);
  assert.equal(secondLine.length, 2);
  firstLine.forEach((node, i) => {
    assert.equal(node.x, PADDING + i * (240 + GAP), `1行目 ${i} 枚目の左端`);
  });
  secondLine.forEach((node, i) => {
    assert.equal(node.x, PADDING + i * (240 + GAP), `2行目 ${i} 枚目の左端`);
  });

  // 2段になったぶん行の高さが伸び、下の行が押し下げられる
  assert.equal(row.height, PADDING * 2 + 240 * 2 + GAP);
  const rows = h.rows();
  assert.equal(rows[1].y, rows[0].y + rows[0].height + ROW_GAP);
});

test('付箋を別の付箋の左側に落とすと順位が入れ替わる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const row = h.rows()[0];

  const a = h.createSticky('A', row.x + 30, row.y + 30);
  const b = h.createSticky('B', row.x + 300, row.y + 30);
  const c = h.createSticky('C', row.x + 570, row.y + 30);
  h.settle();
  await h.send({ type: 'arrange-now' });
  assert.deepEqual(
    [...row.children].sort((x, y) => x.x - y.x).map((n) => n.name),
    ['A', 'B', 'C'],
  );

  // C を A と B のあいだへドラッグして落とす
  c.x = a.x + 130;
  h.settle();
  await h.send({ type: 'arrange-now' });

  assert.deepEqual(
    [...row.children].sort((x, y) => x.x - y.x).map((n) => n.name),
    ['A', 'C', 'B'],
    'C が B と場所を交代する',
  );
  assert.equal(a.x, PADDING);
  assert.equal(row.children.length, 3);
});

test('空になった行は既定の高さに戻る', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const row = h.rows()[0];

  for (let i = 0; i < 8; i++) {
    h.createSticky(`item${i}`, row.x + 30 + i * 20, row.y + 30);
  }
  h.settle();
  await h.send({ type: 'arrange-now' });
  assert.ok(row.height > 300);

  for (const child of [...row.children]) {
    h.page.appendChild(child);
    child.x = row.x - 2000;
    child.y = row.y;
  }
  await h.send({ type: 'arrange-now' });
  assert.equal(row.height, 300);
});

test('行を削除しても中の付箋は同じ絶対座標でキャンバスに残る', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const row = h.rows()[1];

  h.createSticky('keep me', row.x + 40, row.y + 30);
  h.settle();
  await h.send({ type: 'arrange-now' });

  const sticky = row.children[0];
  const before = h.absolute(sticky);

  await h.send({ type: 'delete-row', id: row.id });

  assert.equal(h.rows().length, 4);
  assert.equal(sticky.removed, undefined, '付箋は消えていない');
  assert.equal(sticky.parent.type, 'PAGE');
  assert.deepEqual(h.absolute(sticky), before, '絶対座標が保たれている');
});

test('パネルでの並び替えはキャンバスの y 順に反映される', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const ids = h.rows().map((r) => r.id);

  // D を先頭へ
  const reordered = [ids[4], ids[0], ids[1], ids[2], ids[3]];
  await h.send({ type: 'reorder-rows', ids: reordered });

  assert.deepEqual(h.rows().map((r) => r.name), ['D', 'S', 'A', 'B', 'C']);
  assert.deepEqual(h.rows().map((r) => r.id), reordered);
});

test('並び替えても行の中身は一緒に動く', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const rows = h.rows();
  const target = rows[0];

  h.createSticky('rider', target.x + 40, target.y + 30);
  h.settle();
  await h.send({ type: 'arrange-now' });
  const sticky = target.children[0];

  await h.send({ type: 'move-row', id: target.id, direction: 'down' });

  assert.equal(sticky.parent.id, target.id, '付箋は行に付いたまま');
  assert.equal(h.rows()[1].id, target.id);
});

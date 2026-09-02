import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

const PADDING = 24;
const GAP = 24;
const LABEL_WIDTH = 300;
const CONTENT_X = LABEL_WIDTH + PADDING;
const COLUMNS = 10;

test('盤面を作成すると S/A/B/C/D の5行が隙間なく積まれる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });

  const rows = h.rows();
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.name), ['S', 'A', 'B', 'C', 'D']);
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i].x, rows[0].x);
    assert.equal(rows[i].y, rows[i - 1].y + rows[i - 1].height, '行の間に隙間はない');
  }
});

test('行はすべて盤面のセクションの子になる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });

  const containers = h.containers();
  assert.equal(containers.length, 1);
  for (const row of h.rows()) {
    assert.equal(row.parent.id, containers[0].id);
    assert.equal(row.x, 0, '位置は盤面からの相対');
  }
});

test('各行の左端にティア名の色セルが載る', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });

  for (const row of h.rows()) {
    const label = h.label(row);
    assert.ok(label, 'ラベルがある');
    assert.equal(label.text.characters, row.name);
    assert.equal(label.x, 0);
    assert.equal(label.y, 0);
    assert.equal(label.width, LABEL_WIDTH);
    assert.equal(label.height, row.height);
    assert.equal(label.locked, true, 'キャンバス上で掴めない');
    assert.notDeepEqual(label.fills, [], '色が付いている');
  }

  const colors = h.rows().map((r) => JSON.stringify(h.label(r).fills));
  assert.equal(new Set(colors).size, 5);
});

test('既定の幅には付箋が横に10枚入り、11枚目から折り返す', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const row = h.rows()[0];

  for (let i = 0; i < 13; i++) {
    h.dropIn(row, `item${i}`, CONTENT_X + i * 10, 30);
  }
  await h.send({ type: 'arrange-now' });

  const arranged = h.items(row).sort((a, b) => a.y - b.y || a.x - b.x);
  assert.equal(arranged.length, 13);

  const firstLine = arranged.filter((n) => n.y === PADDING);
  const secondLine = arranged.filter((n) => n.y === PADDING + 240 + GAP);
  assert.equal(firstLine.length, COLUMNS);
  assert.equal(secondLine.length, 3);

  firstLine.forEach((node, i) => {
    assert.equal(node.x, CONTENT_X + i * (240 + GAP), `1行目 ${i} 枚目は色セルの右から詰まる`);
  });

  assert.equal(row.height, PADDING * 2 + 240 * 2 + GAP, '2段になったぶん伸びる');
  assert.equal(h.label(row).height, row.height, '色セルも一緒に伸びる');
  assert.equal(h.rows()[1].y, row.y + row.height, '下の行が押し下げられる');
});

test('付箋の順位は落とした位置で決まり、場所が入れ替わる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const row = h.rows()[0];

  const a = h.dropIn(row, 'A', CONTENT_X, 30);
  h.dropIn(row, 'B', CONTENT_X + 270, 30);
  const c = h.dropIn(row, 'C', CONTENT_X + 540, 30);
  await h.send({ type: 'arrange-now' });
  assert.deepEqual(h.items(row).sort((x, y) => x.x - y.x).map((n) => n.name), ['A', 'B', 'C']);

  // C を A と B のあいだへドラッグして落とす
  c.x = a.x + 130;
  h.settle();
  await h.send({ type: 'arrange-now' });

  assert.deepEqual(
    h.items(row).sort((x, y) => x.x - y.x).map((n) => n.name),
    ['A', 'C', 'B'],
    'C が B と場所を交代する',
  );
  assert.equal(a.x, CONTENT_X);
});

test('空になった行は既定の高さに戻る', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const row = h.rows()[0];

  for (let i = 0; i < 13; i++) {
    h.dropIn(row, `item${i}`, CONTENT_X + i * 10, 30);
  }
  await h.send({ type: 'arrange-now' });
  assert.ok(row.height > 300);

  for (const child of h.items(row)) {
    const pos = h.absolute(child);
    h.page.appendChild(child);
    child.x = pos.x - 4000;
    child.y = pos.y;
  }
  await h.send({ type: 'arrange-now' });
  assert.equal(row.height, 300);
  assert.equal(h.label(row).height, 300);
});

test('行を削除すると中の付箋は盤面の外へ逃げ、隙間は詰まる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const container = h.containers()[0];
  const row = h.rows()[1];

  h.dropIn(row, 'keep me', CONTENT_X, 30);
  await h.send({ type: 'arrange-now' });
  const sticky = h.items(row)[0];
  const boardBottom = h.absolute(container).y + container.height;

  await h.send({ type: 'delete-row', id: row.id });

  assert.equal(h.rows().length, 4);
  assert.equal(sticky.removed, false, '付箋は消えていない');
  assert.equal(sticky.parent.type, 'PAGE', 'どの行にも盤面にも取り込まれていない');
  assert.ok(h.absolute(sticky).y >= boardBottom, '盤面より下にいる');

  const left = h.rows();
  for (let i = 1; i < left.length; i++) {
    assert.equal(left[i].y, left[i - 1].y + left[i - 1].height, '隙間が詰まっている');
  }
});

test('並び替えても行の中身は一緒に動く', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const target = h.rows()[0];

  h.dropIn(target, 'rider', CONTENT_X, 30);
  await h.send({ type: 'arrange-now' });
  const sticky = h.items(target)[0];

  await h.send({ type: 'move-row', id: target.id, direction: 'down' });

  assert.equal(sticky.parent.id, target.id, '付箋は行に付いたまま');
  assert.equal(h.rows()[1].id, target.id);
});

test('パネルでの並び替えはキャンバスの並びに反映される', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const ids = h.rows().map((r) => r.id);

  await h.send({ type: 'reorder-rows', ids: [ids[4], ids[0], ids[1], ids[2], ids[3]] });

  assert.deepEqual(h.rows().map((r) => r.name), ['D', 'S', 'A', 'B', 'C']);
});

test('リネームすると色セルの文字も変わる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  const row = h.rows()[0];

  await h.send({ type: 'rename-row', id: row.id, name: '神' });

  assert.equal(row.name, '神');
  assert.equal(h.label(row).text.characters, '神');
});

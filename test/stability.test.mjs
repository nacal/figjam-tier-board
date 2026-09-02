import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

const CONTENT_X = 300 + 24;

function snapshot(h, row) {
  return h
    .items(row)
    .map((n) => `${n.name}@${n.x},${n.y}`)
    .sort()
    .join(' | ');
}

test('折り返した行を何度整列しても結果が変わらない', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.flush();
  const row = h.rows()[0];

  // 2段に折り返す枚数
  for (let i = 0; i < 13; i++) {
    h.createSticky(`item${i}`, row.x + CONTENT_X + i * 10, row.y + 30);
  }
  h.settle();

  await h.send({ type: 'arrange-now' });
  const first = snapshot(h, row);

  for (let round = 0; round < 5; round++) {
    await h.send({ type: 'arrange-now' });
    assert.equal(snapshot(h, row), first, `${round + 2}回目でも同じ`);
  }
});

test('折り返した行は読み順（上の段が先、同じ段では左が先）で並ぶ', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.flush();
  const row = h.rows()[0];

  // 行の幅からはみ出すと行の外に出てしまうので、重ねて置いてから整列させる
  const names = [];
  for (let i = 0; i < 13; i++) {
    names.push(`item${i}`);
    h.createSticky(`item${i}`, row.x + CONTENT_X + i * 100, row.y + 30);
  }
  h.settle();
  await h.send({ type: 'arrange-now' });

  const read = h.items(row).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.name);
  assert.deepEqual(read, names, '落とした左からの順番が保たれる');

  await h.send({ type: 'arrange-now' });
  const again = h.items(row).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.name);
  assert.deepEqual(again, names, '並べ直しても段が混ざらない');
});

test('折り返した行を触っても整列が止まらなくならない', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.flush();
  const row = h.rows()[0];

  const items = [];
  for (let i = 0; i < 13; i++) {
    items.push(h.createSticky(`item${i}`, row.x + CONTENT_X + i * 100, row.y + 30));
  }
  h.settle();
  h.change(items);
  await h.flush();

  const settled = snapshot(h, row);

  // 自動整列が自分の書き込みに反応して延々と走り続けないこと
  await h.flush(900);
  assert.equal(snapshot(h, row), settled, '放っておいても動き続けない');
});

test('2段目の付箋を1段目へドラッグすると、その位置の順位に入る', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.flush();
  const row = h.rows()[0];

  const items = [];
  for (let i = 0; i < 12; i++) {
    items.push(h.createSticky(`item${i}`, row.x + CONTENT_X + i * 100, row.y + 30));
  }
  h.settle();
  await h.send({ type: 'arrange-now' });

  // 2段目の先頭（item10）を1段目の先頭と2番目のあいだへ
  const moved = items[10];
  moved.x = CONTENT_X + 130;
  moved.y = 24;
  await h.send({ type: 'arrange-now' });

  const read = h.items(row).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.name);
  assert.equal(read[0], 'item0');
  assert.equal(read[1], 'item10', '落とした位置の順位に入る');
  assert.equal(read[2], 'item1');
});

test('背の高い付箋が混ざっても段の判定が崩れない', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.flush();
  const row = h.rows()[0];

  const items = [];
  for (let i = 0; i < 13; i++) {
    items.push(h.createSticky(`item${i}`, row.x + CONTENT_X + i * 100, row.y + 30));
  }
  h.settle();
  await h.send({ type: 'arrange-now' });
  assert.equal(h.items(row).length, 13, '13枚とも行の中にいる');

  // 文字数の多い付箋は縦に伸びる。同じ段にいても中心の高さがそろわなくなる。
  for (let i = 0; i < items.length; i += 3) {
    items[i].height = 900;
  }
  await h.send({ type: 'arrange-now' });

  const first = snapshot(h, row);
  const order = h.items(row).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.name);

  for (let round = 0; round < 4; round++) {
    await h.send({ type: 'arrange-now' });
    assert.equal(snapshot(h, row), first, '位置が変わらない');
    assert.deepEqual(
      h.items(row).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.name),
      order,
      '順序も変わらない',
    );
  }
});

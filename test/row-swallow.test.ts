import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness, type FakeNode } from './harness';

const CONTENT_X = 300 + 24;

// 行を別の行に重ねると、セクションは相手の行の中身（色セルも付箋も）を
// 取り込む。ドラッグ側の FigJam の挙動なので、その結果だけを再現する。
// 掴んで動かしたので、行そのものの位置も変わる。
function dragOnto(dragged: FakeNode, victim: FakeNode): void {
  dragged.y = victim.y + 30;
  for (const child of victim.children.slice()) {
    dragged.appendChild(child);
  }
}

test('A を B に重ねても、色セルが入れ替わって B が2つにならない', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();
  const [s, a, b] = rows;

  assert.equal(h.labelText(a), 'A');
  assert.equal(h.labelText(b), 'B');

  dragOnto(a, b);
  assert.equal(h.label(b), null, 'B は色セルを盗られた');

  h.change(a);
  await h.flush();

  // 並べ替えは起きるが、どの行も自分の名前の色セルを持っている
  assert.equal(h.rows().length, 5);
  for (const row of h.rows()) {
    assert.ok(h.label(row), `${row.name} に色セルがある`);
    assert.equal(h.labelText(row), row.name, `${row.name} の色セルは自分のもの`);
  }
  const letters = h.rows().map((r) => h.labelText(r)).sort();
  assert.deepEqual(letters, ['A', 'B', 'C', 'D', 'S'], '同じ文字が2つにならない');

  // 盗った側に色セルが2枚残っていないこと（重なって見分けがつかなくなる）
  for (const row of h.rows()) {
    const cells = row.children.filter(
      (child) => (child.getPluginData('figjamTierLabel') || '') !== '',
    );
    assert.equal(cells.length, 1, `${row.name} の色セルは1枚`);
  }
  assert.equal(s.name, 'S');
});

test('重ねられた行の付箋も元の行に戻る', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();
  const [, a, b] = rows;

  const inB = h.dropIn(b, 'マイクラ', CONTENT_X, 30);
  const inA = h.dropIn(a, 'パルワールド', CONTENT_X, 30);
  await h.send('ARRANGE_NOW');
  assert.equal(inB.parent!.id, b.id);

  dragOnto(a, b);
  assert.equal(inB.parent!.id, a.id, '付箋まで盗られた');

  h.change(a);
  await h.flush();

  assert.equal(inB.parent!.id, b.id, '元の行に戻る');
  assert.equal(inA.parent!.id, a.id, 'もともと A にいた付箋は動かない');
  assert.equal(inB.x, CONTENT_X, '戻り先で左に詰まる');
});

test('人が付箋を別の行へ動かしたときは戻さない', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const [s, a] = h.rows();

  const sticky = h.dropIn(a, 'マイクラ', CONTENT_X, 30);
  await h.send('ARRANGE_NOW');

  // 行は動かさず、付箋だけを S へ動かす
  const pos = h.absolute(sticky);
  h.page.appendChild(sticky);
  sticky.x = pos.x;
  sticky.y = pos.y - 300;
  h.settle();
  h.change(sticky);
  await h.flush();

  assert.equal(sticky.parent!.id, s.id, 'S に残る（A へ戻されない）');
  assert.equal(sticky.x, CONTENT_X);
});

test('色セルの持ち主が消えていたら捨てる', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();
  const [, a, b] = rows;

  const stolen = h.label(b)!;
  a.y = b.y + 30;
  a.appendChild(stolen);
  await h.send('DELETE_ROW', b.id);

  await h.send('ARRANGE_NOW');

  assert.equal(stolen.removed, true, '持ち主のいない色セルは残らない');
  assert.equal(h.labelText(a), 'A', 'A は自分の色セルのまま');
});

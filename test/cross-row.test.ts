import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness, type FakeNode, type Harness } from './harness';

const CONTENT_X = 300 + 24;

// キャンバス上で付箋を掴んで動かす操作
function dragBy(h: Harness, sticky: FakeNode, dx: number, dy: number): void {
  const pos = h.absolute(sticky);
  h.page.appendChild(sticky);
  sticky.x = pos.x + dx;
  sticky.y = pos.y + dy;
  h.settle();
  h.change(sticky);
}

test('A の付箋を S へ真上にドラッグしても左寄せが効く', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();
  const [s, a] = rows;

  h.dropIn(a, 'あ', CONTENT_X, 30);
  const moved = h.dropIn(a, 'い', CONTENT_X + 400, 30);
  h.dropIn(a, 'う', CONTENT_X + 800, 30);
  await h.send('ARRANGE_NOW');
  assert.deepEqual(h.items(a).map((n) => n.x).sort((x, y) => x - y), [324, 588, 852]);

  // 真上へ 1 行ぶん（300px）ドラッグ。移動先での相対座標が移動前と一致する。
  dragBy(h, moved, 0, -300);
  await h.flush();

  assert.equal(moved.parent!.id, s.id, 'S に入った');
  assert.equal(moved.x, CONTENT_X, 'S の中で左寄せされる');
  assert.deepEqual(h.items(a).map((n) => n.x).sort((x, y) => x - y), [324, 588], 'A も詰め直される');
});

test('A の付箋を S へ雑にドラッグしても左寄せが効く', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const rows = h.rows();
  const [s, a] = rows;

  h.dropIn(a, 'あ', CONTENT_X, 30);
  const moved = h.dropIn(a, 'い', CONTENT_X + 400, 30);
  await h.send('ARRANGE_NOW');

  dragBy(h, moved, 137, -263);
  await h.flush();

  assert.equal(moved.parent!.id, s.id);
  assert.equal(moved.x, CONTENT_X);
  assert.deepEqual(h.items(a).map((n) => n.x), [324]);
});

test('行をまたいで戻しても左寄せが効き続ける', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const [s, a] = h.rows();

  const moved = h.dropIn(a, 'い', CONTENT_X, 30);
  h.dropIn(a, 'あ', CONTENT_X + 400, 30);
  await h.send('ARRANGE_NOW');

  // A → S → A と、毎回ちょうど1行ぶんだけ動かす
  dragBy(h, moved, 0, -300);
  await h.flush();
  assert.equal(moved.parent!.id, s.id);
  assert.equal(moved.x, CONTENT_X);

  dragBy(h, moved, 0, 300);
  await h.flush();
  assert.equal(moved.parent!.id, a.id, 'A に戻る');
  assert.deepEqual(h.items(a).map((n) => n.x).sort((x, y) => x - y), [324, 588], '2枚とも詰まる');
});

test('付箋を行の外へ同じ相対位置で出しても、行が詰め直される', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const container = h.containers()[0];
  const row = h.rows()[0];

  h.dropIn(row, 'あ', CONTENT_X, 30);
  const moved = h.dropIn(row, 'い', CONTENT_X + 400, 30);
  await h.send('ARRANGE_NOW');

  // 盤面の外へ。ページ直下での座標が、行の中にいたときの相対座標と重なる位置。
  const pos = h.absolute(moved);
  h.page.appendChild(moved);
  moved.x = moved.x - h.absolute(container).x;
  moved.y = pos.y - h.absolute(container).y - 3000;
  h.settle();
  h.change(moved);
  await h.flush();

  assert.equal(moved.parent!.type, 'PAGE');
  assert.deepEqual(h.items(row).map((n) => n.x), [324], '残った1枚が左に詰まる');
});

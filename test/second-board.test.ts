import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHarness } from './harness';

const CONTENT_X = 300 + 24;

test('プラグインを開いて2つ目の盤面を足し、そこへ付箋を落とすと左に詰まる', async () => {
  const h = createHarness();
  // 1つ目はすでにある状態から始める（前のセッションで作られた盤面）
  await h.send('CREATE_BOARD');
  await h.flush();
  h.restart();
  await h.send('REQUEST_STATE');

  // 2つ目を追加
  await h.send('CREATE_BOARD');
  await h.flush();
  const containers = h.containers();
  assert.equal(containers.length, 2);

  const row = h.rowsOf(containers[1])[0];
  const sticky = h.dropIn(row, 'マイクラ', CONTENT_X + 900, 60);
  assert.equal(sticky.parent!.id, row.id, '行の子になっている');

  h.change(sticky);
  await h.flush();

  assert.equal(sticky.x, CONTENT_X, '左に詰まる');
  assert.equal(sticky.y, 24);
});

test('2つ目の盤面をキャンバス外から落とした付箋でも左に詰まる', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.send('CREATE_BOARD');
  await h.flush();
  const containers = h.containers();
  const row = h.rowsOf(containers[1])[2];

  // ページ上の遠くにある付箋を掴んで、2つ目の盤面の行へ落とす
  const sticky = h.createSticky('パルワールド', 0, 0);
  h.settle();
  h.change(sticky);

  const at = h.absolute(row);
  h.page.appendChild(sticky);
  sticky.x = at.x + CONTENT_X + 1200;
  sticky.y = at.y + 40;
  h.settle();
  h.change(sticky);
  await h.flush();

  assert.equal(sticky.parent!.id, row.id);
  assert.equal(sticky.x, CONTENT_X, '左に詰まる');
});

test('FigJam が外側の盤面に付けた付箋も、重なっている行に引き取られて左に詰まる', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.send('CREATE_BOARD');
  await h.flush();
  const containers = h.containers();
  const rows = h.rowsOf(containers[1]);

  // 3行目（C）の帯に重なる高さで、盤面に直接ぶら下がった付箋
  const sticky = h.dropOnBoard(containers[1], 'マイクラ', CONTENT_X + 900, rows[2].y + 40);
  assert.equal(sticky.parent!.id, containers[1].id, '盤面の子で、行の子ではない');

  h.change(sticky);
  await h.flush();

  assert.equal(sticky.parent!.id, rows[2].id, '重なっている行が引き取る');
  assert.equal(sticky.x, CONTENT_X, '左に詰まる');
  assert.equal(sticky.y, 24);
});

test('見出しは引き取られない', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const id = h.state().boards[0].id;
  await h.send('SET_BOARD_NAME', id, '名前');

  await h.send('ARRANGE_NOW');

  const container = h.containers()[0];
  const heading = h.titleOf(container);
  assert.ok(heading, '見出しは盤面の子のまま');
  assert.equal(heading.parent!.id, container.id);
});

test('引き取り先は落とした高さで決まる', async () => {
  const h = createHarness();
  await h.send('CREATE_BOARD');
  await h.flush();
  const container = h.containers()[0];
  const rows = h.rowsOf(container);

  const top = h.dropOnBoard(container, 'S行へ', CONTENT_X, rows[0].y + 10);
  const bottom = h.dropOnBoard(container, 'D行へ', CONTENT_X, rows[4].y + 250);
  h.change([top, bottom]);
  await h.flush();

  assert.equal(top.parent!.id, rows[0].id);
  assert.equal(bottom.parent!.id, rows[4].id);
});

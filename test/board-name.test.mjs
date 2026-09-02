import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

function containerOf(h, boardId) {
  return h.containers().find((c) => c.getPluginData('figjamTierBoard') === boardId) ?? null;
}

function title(h, boardId) {
  const container = containerOf(h, boardId);
  return container === null ? null : h.titleOf(container);
}

async function board(h) {
  await h.send({ type: 'create-board' });
  await h.flush();
  return h.lastUiMessage().boards[0].id;
}

test('名前を付けると盤面の中に見出しが出る', async () => {
  const h = createHarness();
  const id = await board(h);

  await h.send({ type: 'set-board-name', boardId: id, name: '2026年ベストゲーム' });

  const heading = title(h, id);
  assert.ok(heading, '見出しができる');
  assert.equal(heading.characters, '2026年ベストゲーム');
  assert.equal(heading.parent.id, containerOf(h, id).id, '盤面の子なので表ごと動く');

  const top = h.rows()[0];
  assert.equal(heading.x, 0, '盤面の左端に揃う');
  assert.ok(heading.y + heading.height <= top.y, 'いちばん上の行より上にいる');
});

test('名前は盤面のセクション名にもなる', async () => {
  const h = createHarness();
  const id = await board(h);

  await h.send({ type: 'set-board-name', boardId: id, name: 'サバイバル' });

  assert.equal(containerOf(h, id).name, 'サバイバル');
  const listed = h.lastUiMessage().boards[0];
  assert.equal(listed.name, 'サバイバル');
  assert.equal(listed.label, 'サバイバル', '無名のときの「盤面 N」を置き換える');
});

test('名前を消すと見出しも消える', async () => {
  const h = createHarness();
  const id = await board(h);
  await h.send({ type: 'set-board-name', boardId: id, name: 'いったん命名' });
  assert.ok(title(h, id));

  await h.send({ type: 'set-board-name', boardId: id, name: '   ' });

  assert.equal(title(h, id), null);
  assert.equal(h.lastUiMessage().boards[0].label, '盤面 1');
  assert.equal(h.rows()[0].y, 0, '見出しのぶんの余白も戻る');
});

test('表ごと動かしても見出しは付いてくる', async () => {
  const h = createHarness();
  const id = await board(h);
  await h.send({ type: 'set-board-name', boardId: id, name: '追従テスト' });

  const container = containerOf(h, id);
  const heading = title(h, id);
  const before = h.absolute(heading);

  container.x += 1200;
  container.y += 400;
  h.settle();

  assert.deepEqual(h.absolute(heading), { x: before.x + 1200, y: before.y + 400 });
  assert.equal(heading.parent.id, container.id);
});

test('行が伸びても見出しは行に飲まれない', async () => {
  const h = createHarness();
  const id = await board(h);
  await h.send({ type: 'set-board-name', boardId: id, name: '追従テスト' });

  const rows = h.rows();
  for (let i = 0; i < 13; i++) {
    h.dropIn(rows[0], `item${i}`, 324 + i * 10, 30);
  }
  await h.send({ type: 'arrange-now' });

  const heading = title(h, id);
  assert.ok(heading, '見出しが残っている');
  assert.equal(heading.parent.id, containerOf(h, id).id);
  assert.ok(heading.y + heading.height <= h.rows()[0].y);
});

test('盤面ごとに別の名前を持てる', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.send({ type: 'create-board' });
  await h.flush();
  const ids = h.lastUiMessage().boards.map((b) => b.id);

  await h.send({ type: 'set-board-name', boardId: ids[0], name: '面白さ' });
  await h.send({ type: 'set-board-name', boardId: ids[1], name: '難易度' });

  assert.deepEqual(h.lastUiMessage().boards.map((b) => b.name), ['面白さ', '難易度']);
  assert.equal(title(h, ids[0]).characters, '面白さ');
  assert.equal(title(h, ids[1]).characters, '難易度');
});

test('盤面の行を全部消すと器ごと片付く', async () => {
  const h = createHarness();
  const id = await board(h);
  await h.send({ type: 'set-board-name', boardId: id, name: '消える盤面' });

  for (const row of h.rows()) {
    await h.send({ type: 'delete-row', id: row.id });
  }

  assert.equal(h.rows().length, 0);
  assert.equal(containerOf(h, id), null, '見出しごと消える');
});

test('見出しの文字は暗い面の上でも読める明るさになる', async () => {
  const h = createHarness();
  const id = await board(h);

  await h.send({ type: 'set-board-name', boardId: id, name: '読めるか' });

  const fills = JSON.parse(JSON.stringify(title(h, id).fills));
  assert.equal(fills.length, 1);
  assert.ok(fills[0].color.r > 0.8 && fills[0].color.g > 0.8 && fills[0].color.b > 0.8);
});

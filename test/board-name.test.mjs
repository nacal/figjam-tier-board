import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

function title(h, boardId) {
  return h.page.children.find(
    (n) => n.type === 'TEXT' && n.getPluginData('figjamTierTitle') === boardId,
  ) ?? null;
}

async function board(h) {
  await h.send({ type: 'create-board' });
  await h.flush();
  return h.lastUiMessage().boards[0].id;
}

test('名前を付けるとキャンバスの盤面の上に見出しが出る', async () => {
  const h = createHarness();
  const id = await board(h);

  await h.send({ type: 'set-board-name', boardId: id, name: '2026年ベストゲーム' });

  const heading = title(h, id);
  assert.ok(heading, '見出しができる');
  assert.equal(heading.characters, '2026年ベストゲーム');
  assert.equal(heading.parent.type, 'PAGE', '行に取り込まれていない');

  const top = h.rows()[0];
  assert.equal(heading.x, top.x, '盤面の左端に揃う');
  assert.ok(heading.y + heading.height < top.y, 'いちばん上の行より上にいる');
});

test('名前はパネルの盤面一覧に出る', async () => {
  const h = createHarness();
  const id = await board(h);

  await h.send({ type: 'set-board-name', boardId: id, name: 'サバイバル' });

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
});

test('盤面が動いても見出しは付いてくる', async () => {
  const h = createHarness();
  const id = await board(h);
  await h.send({ type: 'set-board-name', boardId: id, name: '追従テスト' });

  const rows = h.rows();
  // いちばん上の行に13枚入れて背を伸ばす → 下の行が押し下げられる
  for (let i = 0; i < 13; i++) {
    h.createSticky(`item${i}`, rows[0].x + 324 + i * 10, rows[0].y + 30);
  }
  h.settle();
  await h.send({ type: 'arrange-now' });

  const heading = title(h, id);
  const top = h.rows()[0];
  assert.equal(heading.x, top.x);
  assert.ok(heading.y + heading.height < top.y, '見出しは行に飲まれない');
  assert.equal(heading.parent.type, 'PAGE');
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
  assert.notEqual(title(h, ids[0]).y, title(h, ids[1]).y);
});

test('盤面の行を全部消すと見出しも片付く', async () => {
  const h = createHarness();
  const id = await board(h);
  await h.send({ type: 'set-board-name', boardId: id, name: '消える盤面' });

  for (const row of h.rows()) {
    await h.send({ type: 'delete-row', id: row.id });
  }

  assert.equal(h.rows().length, 0);
  assert.equal(title(h, id), null, '見出しが取り残されない');
});

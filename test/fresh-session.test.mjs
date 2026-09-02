import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './harness.mjs';

const CONTENT_X = 300 + 24;

function dragBy(h, sticky, dx, dy) {
  const pos = h.absolute(sticky);
  h.page.appendChild(sticky);
  sticky.x = pos.x + dx;
  sticky.y = pos.y + dy;
  h.settle();
  h.change(sticky);
}

test('プラグインを開き直した直後でも、ドラッグで左寄せが効く', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.flush();
  const [, a] = h.rows();
  h.dropIn(a, 'あ', CONTENT_X, 30);
  const moved = h.dropIn(a, 'い', CONTENT_X + 400, 30);
  await h.send({ type: 'arrange-now' });

  // ここでプラグインを開き直す
  h.restart();
  await h.send({ type: 'init' });

  // キャンバスで付箋を動かす（今すぐ整列は押さない）
  dragBy(h, moved, 60, 40);
  await h.flush();

  assert.deepEqual(
    h.items(a).map((n) => n.x).sort((x, y) => x - y),
    [324, 588],
    '開き直した直後でも詰め直される',
  );
});

test('開き直した直後に別の行へ移しても、両方の行が詰め直される', async () => {
  const h = createHarness();
  await h.send({ type: 'create-board' });
  await h.flush();
  const [s, a] = h.rows();
  h.dropIn(a, 'あ', CONTENT_X, 30);
  const moved = h.dropIn(a, 'い', CONTENT_X + 400, 30);
  h.dropIn(a, 'う', CONTENT_X + 800, 30);
  await h.send({ type: 'arrange-now' });

  h.restart();
  await h.send({ type: 'init' });

  dragBy(h, moved, 30, -300);
  await h.flush();

  assert.equal(moved.parent.id, s.id);
  assert.equal(moved.x, CONTENT_X, '移した先で左寄せ');
  assert.deepEqual(h.items(a).map((n) => n.x).sort((x, y) => x - y), [324, 588], '元の行の穴も詰まる');
});

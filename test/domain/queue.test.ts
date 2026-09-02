import assert from 'node:assert/strict';
import { test } from 'vitest';

import { ArrangeQueue } from '../../src/domain/queue';

test('的にした行だけを返し、取り出すと空になる', () => {
  const queue = new ArrangeQueue(320);
  queue.markRow('row-1');
  queue.markRow('row-1');
  queue.markRow('row-2');

  assert.deepEqual(queue.take(), { targets: ['row-1', 'row-2'], rowDragged: false });
  assert.equal(queue.isEmpty, true);
  assert.deepEqual(queue.take(), { targets: [], rowDragged: false });
});

test('全体指定は個別の的より強い', () => {
  const queue = new ArrangeQueue(320);
  queue.markRow('row-1');
  queue.markAll();

  assert.deepEqual(queue.take(), { targets: null, rowDragged: false });
});

test('待ち時間はいちばん長いものに合わせる', () => {
  const queue = new ArrangeQueue(320);
  assert.equal(queue.pendingDelay, 320);

  queue.requestDelay(80);
  assert.equal(queue.pendingDelay, 320, '短い要求では縮めない');

  queue.requestDelay(420);
  assert.equal(queue.pendingDelay, 420, '行のドラッグは長く待つ');
});

test('取り出すと待ち時間も既定に戻る', () => {
  const queue = new ArrangeQueue(320);
  queue.requestDelay(420);
  queue.take();
  assert.equal(queue.pendingDelay, 320);
});

test('行が動かされたことを持ち越す', () => {
  const queue = new ArrangeQueue(320);
  queue.markRow('row-1');
  queue.markRowDragged();

  assert.equal(queue.take().rowDragged, true);
  assert.equal(queue.take().rowDragged, false, '一度取り出したら下がる');
});

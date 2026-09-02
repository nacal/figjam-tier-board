import assert from 'node:assert/strict';
import { test } from 'vitest';

import { ArrangeQueue } from '../../src/domain/queue';

test('returns only the marked rows and empties on take', () => {
  const queue = new ArrangeQueue(320);
  queue.markRow('row-1');
  queue.markRow('row-1');
  queue.markRow('row-2');

  assert.deepEqual(queue.take(), { targets: ['row-1', 'row-2'], rowDragged: false });
  assert.equal(queue.isEmpty, true);
  assert.deepEqual(queue.take(), { targets: [], rowDragged: false });
});

test('marking everything wins over individual targets', () => {
  const queue = new ArrangeQueue(320);
  queue.markRow('row-1');
  queue.markAll();

  assert.deepEqual(queue.take(), { targets: null, rowDragged: false });
});

test('the delay takes the longest request', () => {
  const queue = new ArrangeQueue(320);
  assert.equal(queue.pendingDelay, 320);

  queue.requestDelay(80);
  assert.equal(queue.pendingDelay, 320, 'a shorter request does not shorten it');

  queue.requestDelay(420);
  assert.equal(queue.pendingDelay, 420, 'a row drag waits longer');
});

test('taking resets the delay to the default', () => {
  const queue = new ArrangeQueue(320);
  queue.requestDelay(420);
  queue.take();
  assert.equal(queue.pendingDelay, 320);
});

test('carries over that a row was moved', () => {
  const queue = new ArrangeQueue(320);
  queue.markRow('row-1');
  queue.markRowDragged();

  assert.equal(queue.take().rowDragged, true);
  assert.equal(queue.take().rowDragged, false, 'clears once taken');
});

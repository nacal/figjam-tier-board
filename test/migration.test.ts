import assert from 'node:assert/strict';
import { test } from 'vitest';
import { hexToRgb } from '../src/domain/color';
import { BOARD_PALETTES } from '../src/domain/theme';
import { createHarness, type FakeNode, type Harness } from './harness';

// No tier label, colour painted on the row, narrow, and outside any container:
// a board from an older version.
function legacyRow(
  h: Harness,
  { name, color, x, y, width }: { name: string; color: string; x: number; y: number; width: number },
): FakeNode {
  const row = h.figma.createSection();
  row.name = name;
  row.setPluginData('figjamTierRow', '1');
  row.setPluginData('figjamTierColor', color);
  row.resizeWithoutConstraints(width, 300);
  row.x = x;
  row.y = y;
  row.fills = [{ type: 'SOLID', color: { r: 1, g: 0.7, b: 0.7 } }];
  h.page.appendChild(row);
  return row;
}

test('legacy rows with no container are wrapped together as one board', async () => {
  const h = createHarness();
  const legacy = [
    legacyRow(h, { name: 'S', color: 'red', x: 100, y: 200, width: 1608 }),
    legacyRow(h, { name: 'A', color: 'orange', x: 100, y: 540, width: 1608 }),
  ];
  h.createSticky('Minecraft', 124, 230);
  h.settle();
  assert.equal(h.items(legacy[0]).length, 1, 'the sticky is inside the legacy board');

  await h.send('ARRANGE_NOW');

  const containers = h.containers();
  assert.equal(containers.length, 1, 'one container is created');
  assert.deepEqual(h.absolute(containers[0]), { x: 100, y: 200 }, 'keeps its original position');
  for (const row of h.rows()) {
    assert.equal(row.parent!.id, containers[0].id, 'rows become children of the container');
  }
});

test('wrapping migrates the contents and the look', async () => {
  const h = createHarness();
  legacyRow(h, { name: 'S', color: 'red', x: 0, y: 0, width: 1608 });
  legacyRow(h, { name: 'A', color: 'orange', x: 0, y: 340, width: 1608 });
  const sticky = h.createSticky('Minecraft', 24, 30);
  h.settle();

  await h.send('ARRANGE_NOW');

  for (const row of h.rows()) {
    const label = h.label(row);
    assert.ok(label, 'a tier label is added');
    assert.equal(h.labelText(row), row.name);
    assert.equal(label.width, 300);
    assert.equal(label.height, row.height);
    // Built in the vm context, so the prototype differs; compare by value.
    // A board with no palette keeps the dark default rather than recolouring on open.
    assert.deepEqual(
      JSON.parse(JSON.stringify(row.fills)),
      [{ type: 'SOLID', color: hexToRgb(BOARD_PALETTES.dark.content) }],
      'the face goes dark',
    );
    assert.equal(row.width, 2964, 'widens to the default');
  }

  assert.equal(h.rows()[1].y, h.rows()[0].y + h.rows()[0].height, 'the gap closes');
  assert.equal(sticky.parent!.id, h.rows()[0].id, 'the contents stay in the row');
  assert.equal(sticky.x, 324, 'is repositioned right of the tier label');
});

test('arranging after migration does not repaint the face', async () => {
  const h = createHarness();
  legacyRow(h, { name: 'S', color: 'red', x: 0, y: 0, width: 1608 });
  await h.send('ARRANGE_NOW');
  const fills = h.rows()[0].fills;

  await h.send('ARRANGE_NOW');

  assert.equal(h.rows()[0].fills, fills, 'same array, so nothing was rewritten');
});

test('once wrapped, the whole table can be moved', async () => {
  const h = createHarness();
  legacyRow(h, { name: 'S', color: 'red', x: 0, y: 0, width: 1608 });
  legacyRow(h, { name: 'A', color: 'orange', x: 0, y: 340, width: 1608 });
  await h.send('ARRANGE_NOW');

  const container = h.containers()[0];
  container.x += 900;
  h.settle();
  await h.send('ARRANGE_NOW');

  assert.equal(h.absolute(container).x, 900, 'stays where it was moved');
  assert.equal(h.rows().length, 2);
});

import { emit, on, showUI } from '@create-figma-plugin/utilities';

import {
  AddRowHandler,
  ArrangeNowHandler,
  CreateBoardHandler,
  DeleteRowHandler,
  MoveRowHandler,
  PanelState,
  RenameRowHandler,
  ReorderRowsHandler,
  RequestStateHandler,
  SelectBoardHandler,
  SetAutoArrangeHandler,
  SetBoardNameHandler,
  SetBoardThemeHandler,
  SetRowColorHandler,
  StateHandler,
} from './events';
import { COLOR_PRESETS, FALLBACK_COLOR_KEY, findPreset, hexToRgb } from './domain/color';
import { layoutRow, RowMetrics } from './domain/layout';
import {
  applyOrder,
  byVerticalCenter,
  nextRowName,
  resolveBoardWidth,
  stackPositions,
  swapNeighbour,
} from './domain/order';
import { ArrangeQueue } from './domain/queue';
import {
  BoardTheme,
  DEFAULT_BOARD_THEME,
  paletteFor,
  parseTheme,
  themeForBackground,
} from './domain/theme';

// Tier Board — a FigJam plugin.
//
// A board is a section and so is every tier row; rows live inside the board's
// section, so dragging the board moves the whole table. Sections adopt whatever
// overlaps them, which makes membership a question of `parent` alone and treats
// plugin-made and hand-made stickies alike.
//
// Row order and the order within a row are both read off the canvas; nothing is
// stored. Whatever the user dragged into place is the truth.

const TIER_FLAG_KEY = 'figjamTierRow';
const TIER_COLOR_KEY = 'figjamTierColor';
const TIER_WIDTH_KEY = 'figjamTierWidth';
const TIER_BOARD_KEY = 'figjamTierBoard';
const TIER_BOARD_NAME_KEY = 'figjamTierBoardName';
const TIER_TITLE_KEY = 'figjamTierTitle';
// The section that wraps a whole board; grabbing it moves the table.
const BOARD_FLAG_KEY = 'figjamTierBoardSection';
const TIER_THEME_KEY = 'figjamTierTheme';
// The size the last arrange wrote to a board, so a resize by hand can be spotted.
const BOARD_SIZE_KEY = 'figjamTierBoardSize';
const ROW_HEIGHT_KEY = 'figjamTierRowHeight';
// The row a sticky last belonged to, so a sticky that leaves can be traced back.
const ITEM_HOME_KEY = 'figjamTierHome';
const TIER_LABEL_KEY = 'figjamTierLabel';
const AUTO_ARRANGE_KEY = 'autoArrange';

const ITEM_PADDING = 24;
const ITEM_GAP = 24;
const ITEM_WIDTH = 240; // default FigJam sticky width
// Half a sticky: top edges farther apart than this are on different lines.
const LINE_TOLERANCE = 120;

const DEFAULT_COLUMNS = 10;

const LABEL_WIDTH = 300;
const ROW_HEIGHT = 300;
// Rows stack flush, as on tiermaker.
const ROW_GAP = 0;
// Wide enough for exactly ten 240px stickies.
const ROW_WIDTH =
  LABEL_WIDTH + ITEM_PADDING * 2 + ITEM_WIDTH * DEFAULT_COLUMNS + ITEM_GAP * (DEFAULT_COLUMNS - 1);
const BOARD_MARGIN = 160;
// Rows only have to clear their own contents, so an empty board shrinks to this
// while one holding stickies stops at whatever they need. Clamping to the height
// of a sticky either way would leave shrinking barely distinguishable from
// snapping back to the default.
const MIN_ROW_HEIGHT = 96;

// The tier letter is sized against its cell, so shrinking a board does not leave
// oversized letters behind.
const LABEL_FONT_RATIO = 0.32;

function labelFontSize(rowHeight: number): number {
  return Math.max(12, Math.round(rowHeight * LABEL_FONT_RATIO));
}

// The tier label is a square whose side is the row height, so making rows taller
// scales the labels with them and the board reads as zoomed rather than stretched.
function metricsFor(rowHeight: number): RowMetrics {
  return {
    labelWidth: rowHeight,
    padding: ITEM_PADDING,
    gap: ITEM_GAP,
    minHeight: rowHeight,
    lineTolerance: LINE_TOLERANCE,
  };
}

function minBoardWidth(rowHeight: number): number {
  return rowHeight + ITEM_PADDING * 2 + ITEM_WIDTH;
}

const RESCUE_MARGIN = 80;
const TITLE_FONT_SIZE = 72;
const TITLE_GAP = 32;



// Arranging mid-drag yanks the sticky out of the hand, so wait for things to settle.
const ARRANGE_DEBOUNCE_MS = 320;
// Reordering while a row is still held shuffles the other rows underneath it and
// gets out of hand, so rows wait longer than stickies do.
const ROW_SETTLE_MS = 420;

const DEFAULT_TIERS: Array<{ name: string; color: string }> = [
  { name: 'S', color: 'red' },
  { name: 'A', color: 'orange' },
  { name: 'B', color: 'yellow' },
  { name: 'C', color: 'lemon' },
  { name: 'D', color: 'green' },
];



let autoArrange = true;
let activeBoardId: string | null = null;
let arrangeTimer: ReturnType<typeof setTimeout> | null = null;

const queue = new ArrangeQueue(ARRANGE_DEBOUNCE_MS);
// Which row each sticky was in. Only the deleted ones need to be held in memory;
// for live stickies the plugin data on the node itself is the truth.
let itemHome: { [nodeId: string]: string } = {};
// Which change channels were subscribed. Surfaced in the panel to triage silence.
let subscriptions: string[] = [];
// What the last arrange wrote. Arranging itself emits changes, and telling those
// echoes apart from a person's edit by value beats ignoring a window of time —
// a window drops every sticky moved inside it.
let written: { [nodeId: string]: string } = {};
// Board sizes read straight off the change event.
//
// A big shrink pushes the lower rows out of the section, and returning those
// strays resizes the container back to fit them — before the arrange ever gets
// to look at it. Reading the size when the change arrives is the only point at
// which the size the user dragged to still exists. Without this, small drags
// work and large ones appear to do nothing at all.
let resizedBoards: { [boardId: string]: { width: number; height: number } } = {};

function isTierRow(node: BaseNode): node is SectionNode {
  return node.type === 'SECTION' && node.getPluginData(TIER_FLAG_KEY) === '1';
}

// A tier label carries the id of the row that owns it. Dropping one row onto
// another makes the dragged section swallow the other's contents, labels included.
// Without an owner the stolen label passes as the thief's own, the robbed row
// builds a replacement, and two rows end up showing the same letter.
function isTierLabel(node: SceneNode): node is ShapeWithTextNode {
  return node.type === 'SHAPE_WITH_TEXT' && node.getPluginData(TIER_LABEL_KEY) !== '';
}

function labelOwner(node: SceneNode): string {
  return node.getPluginData(TIER_LABEL_KEY);
}

function isBoardContainer(node: BaseNode): node is SectionNode {
  return node.type === 'SECTION' && node.getPluginData(BOARD_FLAG_KEY) === '1';
}

function allSections(): SectionNode[] {
  return figma.currentPage.findAllWithCriteria({ types: ['SECTION'] });
}

// Position on the page: rows and stickies inside a board hold parent-relative coordinates.
function pagePosition(node: SceneNode): { x: number; y: number } {
  let x = node.x;
  let y = node.y;
  let parent: BaseNode | null = node.parent;
  while (parent !== null && parent.type === 'SECTION') {
    x += parent.x;
    y += parent.y;
    parent = parent.parent;
  }
  return { x, y };
}

interface Board {
  id: string;
  container: SectionNode;
  rows: SectionNode[];
}

function newBoardId(): string {
  return `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function makeContainer(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: BoardTheme,
): SectionNode {
  const container = figma.createSection();
  container.setPluginData(BOARD_FLAG_KEY, '1');
  container.setPluginData(TIER_BOARD_KEY, id);
  container.setPluginData(TIER_THEME_KEY, theme);
  container.name = 'Tier Board';
  container.resizeWithoutConstraints(Math.max(width, 1), Math.max(height, 1));
  container.x = x;
  container.y = y;
  container.fills = [{ type: 'SOLID', color: hexToRgb(paletteFor(theme).content) }];
  figma.currentPage.appendChild(container);
  return container;
}

// Boards created before palettes existed keep the default rather than being
// recoloured the moment the plugin opens.
function boardThemeOf(container: SectionNode): BoardTheme {
  return parseTheme(container.getPluginData(TIER_THEME_KEY), DEFAULT_BOARD_THEME);
}

// Seeded from the canvas background rather than the editor theme: the main thread
// cannot read the theme at all, and a hand-painted background is what is actually
// on screen.
function themeForCanvas(): BoardTheme {
  for (const paint of figma.currentPage.backgrounds) {
    if (paint.type === 'SOLID') {
      return themeForBackground(paint.color, DEFAULT_BOARD_THEME);
    }
  }
  return DEFAULT_BOARD_THEME;
}

// Collects tier rows that are not inside a board section.
//
// Carrying a single row off breaks the table, so a row goes back to its board if
// that board still exists. Rows cannot be locked: `locked` applies to children too,
// so locking a row would make its stickies unpickable and kill the whole point.
//
// A returning row keeps the height it was dropped at, which is what turns dragging
// a row up or down into a reorder.
//
// Rows with no board left — tables built before boards were wrapped — get a new
// container built around them.
function wrapLooseRows(): void {
  const containers: { [id: string]: SectionNode } = {};
  for (const section of allSections()) {
    if (isBoardContainer(section)) {
      containers[section.getPluginData(TIER_BOARD_KEY)] = section;
    }
  }

  const loose: SectionNode[] = [];
  for (const section of allSections()) {
    if (isTierRow(section) && (section.parent === null || !isBoardContainer(section.parent))) {
      loose.push(section);
    }
  }
  if (loose.length === 0) {
    return;
  }

  const returned: SectionNode[] = [];
  const orphans: SectionNode[] = [];
  for (const row of loose) {
    const container = containers[row.getPluginData(TIER_BOARD_KEY)];
    if (container === undefined) {
      orphans.push(row);
      continue;
    }
    const pos = pagePosition(row);
    container.appendChild(row);
    row.x = 0;
    // Keep the dropped height; the order comes from it.
    row.y = pos.y - container.y;
    if (returned.indexOf(container) < 0) {
      returned.push(container);
    }
  }
  for (const container of returned) {
    relayout(container, rowsOfContainer(container));
  }

  if (orphans.length === 0) {
    return;
  }

  const grouped: { [id: string]: SectionNode[] } = {};
  const order: string[] = [];
  // Rows with no board id predate multi-board support, when a page could only hold
  // one board, so they all belong to the same one.
  let legacyId = '';
  for (const row of orphans) {
    let id = row.getPluginData(TIER_BOARD_KEY);
    if (id === '') {
      if (legacyId === '') {
        legacyId = newBoardId();
      }
      id = legacyId;
      row.setPluginData(TIER_BOARD_KEY, id);
    }
    if (grouped[id] === undefined) {
      grouped[id] = [];
      order.push(id);
    }
    grouped[id].push(row);
  }

  for (const id of order) {
    const rows = grouped[id];
    rows.sort((a, b) => pagePosition(a).y - pagePosition(b).y);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const row of rows) {
      const pos = pagePosition(row);
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + row.width);
      maxY = Math.max(maxY, pos.y + row.height);
    }

    const container = makeContainer(id, minX, minY, maxX - minX, maxY - minY, DEFAULT_BOARD_THEME);
    for (const row of rows) {
      const pos = pagePosition(row);
      container.appendChild(row);
      row.x = pos.x - container.x;
      row.y = pos.y - container.y;
    }
    // Pull the heading in too, so it travels with the board.
    for (const node of figma.currentPage.children.slice()) {
      if (node.type === 'TEXT' && node.getPluginData(TIER_TITLE_KEY) === id) {
        container.appendChild(node);
        node.setPluginData(TIER_TITLE_KEY, '1');
        node.x = 0;
        node.y = 0;
      }
    }
  }
}

function boardContainerOf(node: BaseNode): SectionNode | null {
  let cursor: BaseNode | null = node;
  while (cursor !== null) {
    if (isBoardContainer(cursor)) {
      return cursor;
    }
    cursor = cursor.parent;
  }
  return null;
}

function isTitle(node: SceneNode): boolean {
  return node.type === 'TEXT' && node.getPluginData(TIER_TITLE_KEY) === '1';
}

// Hands items that landed on the board but in no row to the row they overlap.
//
// FigJam may attach a drop to the outer section instead of the inner row, and the
// plugin API never triggers adoption at all (moving a node by API leaves its
// parent alone), so which one wins is only decided in the editor. Handle both.
function adoptStrays(board: Board): SectionNode[] {
  const touched: SectionNode[] = [];
  if (board.rows.length === 0) {
    return touched;
  }
  for (const child of board.container.children.slice()) {
    if (isTierRow(child) || isTitle(child)) {
      continue;
    }
    const centerY = child.y + child.height / 2;
    let target = board.rows[0];
    for (const row of board.rows) {
      if (centerY >= row.y) {
        target = row;
      }
    }
    const x = child.x;
    const y = child.y;
    target.appendChild(child);
    child.x = x - target.x;
    child.y = y - target.y;
    if (touched.indexOf(target) < 0) {
      touched.push(target);
    }
  }
  return touched;
}

function rowsOfContainer(container: SectionNode): SectionNode[] {
  const rows: SectionNode[] = [];
  for (const child of container.children) {
    if (isTierRow(child)) {
      rows.push(child);
    }
  }
  return byVerticalCenter(rows);
}

// Boards on this page, topmost first.
function getBoards(): Board[] {
  wrapLooseRows();
  const containers: SectionNode[] = [];
  for (const section of allSections()) {
    if (isBoardContainer(section)) {
      containers.push(section);
    }
  }
  containers.sort((a, b) => a.y - b.y);
  return containers.map((container) => {
    const id = container.getPluginData(TIER_BOARD_KEY);
    const rows = rowsOfContainer(container);
    for (const row of rows) {
      // A row dragged into another board belongs to that board now.
      if (row.getPluginData(TIER_BOARD_KEY) !== id) {
        row.setPluginData(TIER_BOARD_KEY, id);
      }
      // Labels from before ownership existed belong to whichever row holds them.
      for (const child of row.children) {
        if (child.type === 'SHAPE_WITH_TEXT' && child.getPluginData(TIER_LABEL_KEY) === '1') {
          child.setPluginData(TIER_LABEL_KEY, row.id);
        }
      }
    }
    return { id, container, rows };
  });
}

// The name lives on the container. On a row it would follow that row into another
// board.
function boardName(board: Board): string {
  const stored = board.container.getPluginData(TIER_BOARD_NAME_KEY);
  if (stored !== '') {
    return stored;
  }
  // Recover a name set before it moved to the container.
  for (const row of board.rows) {
    const name = row.getPluginData(TIER_BOARD_NAME_KEY);
    if (name !== '') {
      board.container.setPluginData(TIER_BOARD_NAME_KEY, name);
      return name;
    }
  }
  return '';
}

// The name also appears on the canvas as a heading, because a name kept only in
// the panel is invisible to everyone else looking at the board. The heading is a
// child of the board section, so it travels with the table.
function findTitle(container: SectionNode): TextNode | null {
  for (const child of container.children) {
    if (child.type === 'TEXT' && child.getPluginData(TIER_TITLE_KEY) === '1') {
      return child;
    }
  }
  return null;
}

function findBoard(boards: Board[], id: string | null): Board | null {
  if (id === null) {
    return null;
  }
  for (const board of boards) {
    if (board.id === id) {
      return board;
    }
  }
  return null;
}

function activeBoard(boards: Board[]): Board | null {
  const found = findBoard(boards, activeBoardId);
  if (found !== null) {
    return found;
  }
  return boards.length > 0 ? boards[0] : null;
}

function boardOfRow(boards: Board[], rowId: string): Board | null {
  for (const board of boards) {
    for (const row of board.rows) {
      if (row.id === rowId) {
        return board;
      }
    }
  }
  return null;
}

function findLabel(row: SectionNode): ShapeWithTextNode | null {
  for (const child of row.children) {
    if (isTierLabel(child) && labelOwner(child) === row.id) {
      return child;
    }
  }
  return null;
}

// Sends stickies stolen by another row back home. Only called right after a row
// was moved; when a person moves a sticky themselves no row moved, so this never
// runs and their choice stands.
function repatriateItems(board: Board): SectionNode[] {
  const touched: SectionNode[] = [];
  for (const row of board.rows) {
    for (const item of itemsOf(row)) {
      const home = item.getPluginData(ITEM_HOME_KEY);
      if (home === '' || home === row.id) {
        continue;
      }
      let owner: SectionNode | null = null;
      for (const candidate of board.rows) {
        if (candidate.id === home) {
          owner = candidate;
        }
      }
      if (owner === null) {
        continue;
      }
      owner.appendChild(item);
      if (touched.indexOf(owner) < 0) {
        touched.push(owner);
      }
      if (touched.indexOf(row) < 0) {
        touched.push(row);
      }
    }
  }
  return touched;
}

// Returns stolen tier labels to their owner, or drops them if the owner is gone.
function repatriateLabels(board: Board): SectionNode[] {
  const touched: SectionNode[] = [];
  for (const row of board.rows) {
    for (const child of row.children.slice()) {
      if (!isTierLabel(child) || labelOwner(child) === row.id) {
        continue;
      }
      let owner: SectionNode | null = null;
      for (const candidate of board.rows) {
        if (candidate.id === labelOwner(child)) {
          owner = candidate;
        }
      }
      if (owner === null) {
        child.remove();
      } else {
        owner.appendChild(child);
        if (touched.indexOf(owner) < 0) {
          touched.push(owner);
        }
      }
      if (touched.indexOf(row) < 0) {
        touched.push(row);
      }
    }
  }
  return touched;
}

// The things being ranked. Rows, boards and headings are excluded: dropping a row
//
// onto another makes FigJam nest it, and counting it would pack a whole row into
// a 240px slot as if it were a sticky.
function itemsOf(row: SectionNode): SceneNode[] {
  const items: SceneNode[] = [];
  for (const child of row.children) {
    if (isTierLabel(child) || isTierRow(child) || isBoardContainer(child) || isTitle(child)) {
      continue;
    }
    items.push(child);
  }
  return items;
}

// Reapplied on every arrange, so boards built before the current look migrate to
// it by themselves.
function applyRowChrome(row: SectionNode, theme: BoardTheme): void {
  const palette = paletteFor(theme);
  const content = hexToRgb(palette.content);
  const fills = row.fills;
  if (typeof fills !== 'symbol' && fills.length === 1) {
    const paint = fills[0];
    if (
      paint.type === 'SOLID' &&
      Math.abs(paint.color.r - content.r) < 0.002 &&
      Math.abs(paint.color.g - content.g) < 0.002 &&
      Math.abs(paint.color.b - content.b) < 0.002
    ) {
      return;
    }
  }
  row.fills = [{ type: 'SOLID', color: content }];
  row.strokes = [{ type: 'SOLID', color: hexToRgb(palette.border) }];
  row.strokeWeight = 1;
}

async function ensureLabel(row: SectionNode): Promise<ShapeWithTextNode> {
  const existing = findLabel(row);
  if (existing !== null) {
    return existing;
  }
  const label = figma.createShapeWithText();
  label.shapeType = 'SQUARE';
  label.setPluginData(TIER_LABEL_KEY, row.id);
  label.resize(LABEL_WIDTH, row.height);
  row.appendChild(label);
  label.x = 0;
  label.y = 0;
  // Locked, or it would look like something to rank.
  label.locked = true;
  await writeLabelText(label, row.name, row.height);
  applyColor(row, row.getPluginData(TIER_COLOR_KEY) || FALLBACK_COLOR_KEY);
  return label;
}

async function writeLabelText(
  label: ShapeWithTextNode,
  text: string,
  rowHeight: number,
): Promise<void> {
  const fontName = label.text.fontName;
  if (typeof fontName === 'symbol') {
    return;
  }
  await figma.loadFontAsync(fontName);
  label.text.characters = text;
  label.text.fontSize = labelFontSize(rowHeight);
}

async function fitLabelText(label: ShapeWithTextNode, rowHeight: number): Promise<void> {
  const size = labelFontSize(rowHeight);
  if (label.text.fontSize === size) {
    return;
  }
  const fontName = label.text.fontName;
  if (typeof fontName === 'symbol') {
    return;
  }
  await figma.loadFontAsync(fontName);
  label.text.fontSize = size;
}

function applyColor(row: SectionNode, key: string): void {
  const preset = findPreset(key);
  row.setPluginData(TIER_COLOR_KEY, preset.key);
  const label = findLabel(row);
  if (label !== null) {
    label.fills = [{ type: 'SOLID', color: hexToRgb(preset.hex) }];
  }
}

async function createRow(
  container: SectionNode,
  name: string,
  colorKey: string,
  y: number,
  size: { width: number; rowHeight: number } = { width: ROW_WIDTH, rowHeight: ROW_HEIGHT },
): Promise<SectionNode> {
  const boardId = container.getPluginData(TIER_BOARD_KEY);
  const row = figma.createSection();
  row.name = name;
  row.setPluginData(TIER_FLAG_KEY, '1');
  row.setPluginData(TIER_BOARD_KEY, boardId);
  row.setPluginData(TIER_COLOR_KEY, colorKey);
  row.resizeWithoutConstraints(size.width, size.rowHeight);
  applyRowChrome(row, boardThemeOf(container));
  container.appendChild(row);
  row.x = 0;
  row.y = y;
  await ensureLabel(row);
  return row;
}

// Restacks rows inside the board section in the given order.
//
// Every position is relative to the board section and the board itself is never
// moved, so reordering leaves the table where it is, including where a user dragged it.
function titleBlockOf(container: SectionNode): number {
  const title = findTitle(container);
  return title !== null ? title.height + TITLE_GAP : 0;
}

function relayout(container: SectionNode, rows: SectionNode[]): void {
  const title = findTitle(container);
  const titleBlock = titleBlockOf(container);

  let neededWidth = 0;
  let neededHeight = titleBlock;
  for (const row of rows) {
    neededWidth = Math.max(neededWidth, row.width);
    neededHeight += row.height + ROW_GAP;
  }
  if (rows.length > 0) {
    neededHeight -= ROW_GAP;
  }
  if (neededWidth === 0) {
    neededWidth = ROW_WIDTH;
  }
  neededHeight = Math.max(neededHeight, 1);

  // Grow before placing, shrink after. Shrinking first drops whatever now sticks out
  // of the section.
  const grownWidth = Math.max(container.width, neededWidth);
  const grownHeight = Math.max(container.height, neededHeight);
  if (grownWidth !== container.width || grownHeight !== container.height) {
    container.resizeWithoutConstraints(grownWidth, grownHeight);
  }

  if (title !== null) {
    title.x = 0;
    title.y = 0;
    remember(title);
  }
  const palette = paletteFor(boardThemeOf(container));
  const containerFill = hexToRgb(palette.content);
  container.fills = [{ type: 'SOLID', color: containerFill }];

  const positions = stackPositions(
    rows.map((row) => row.height),
    ROW_GAP,
    titleBlock,
  );
  rows.forEach((row, index) => {
    row.x = 0;
    row.y = positions[index];
    remember(row);
  });

  if (neededWidth !== container.width || neededHeight !== container.height) {
    container.resizeWithoutConstraints(neededWidth, neededHeight);
  }
  container.setPluginData(BOARD_SIZE_KEY, `${container.width}:${container.height}`);
  remember(container);
}

interface BoardSizing {
  width: number;
  rowHeight: number;
}

function storedPair(container: SectionNode, key: string): number[] | null {
  const parts = container.getPluginData(key).split(':').map(parseFloat);
  return parts.length === 2 && parts.every(isFinite) ? parts : null;
}

// The board's own size wins over the per-row width, because dragging the board's
// corner is the more direct gesture; the row edge still works when that is what
// the user happened to grab.
//
// Height is spread evenly across the rows. Rows never go below MIN_ROW_HEIGHT,
// and layoutRow keeps whatever its contents need, so shrinking has a floor.
function boardSizing(board: Board, titleBlock: number): BoardSizing {
  const container = board.container;
  const rowCount = Math.max(board.rows.length, 1);

  const storedRowHeight = parseFloat(container.getPluginData(ROW_HEIGHT_KEY));
  let rowHeight = isFinite(storedRowHeight) ? storedRowHeight : ROW_HEIGHT;
  let width = boardWidth(board.rows);

  const stored = storedPair(container, BOARD_SIZE_KEY);
  const dragged = resizedBoards[board.id];
  const actual = dragged !== undefined ? dragged : { width: container.width, height: container.height };
  if (stored !== null) {
    if (Math.abs(stored[0] - actual.width) > 0.5) {
      width = actual.width;
    }
    if (Math.abs(stored[1] - actual.height) > 0.5) {
      const available = actual.height - titleBlock - ROW_GAP * (rowCount - 1);
      rowHeight = available / rowCount;
    }
  }

  // Rows stay uniform, so the floor is whatever the tallest row's contents need.
  let contentFloor = MIN_ROW_HEIGHT;
  for (const row of board.rows) {
    for (const item of itemsOf(row)) {
      contentFloor = Math.max(contentFloor, ITEM_PADDING * 2 + item.height);
    }
  }

  rowHeight = Math.max(Math.round(rowHeight), contentFloor);
  return { width: Math.max(Math.round(width), minBoardWidth(rowHeight)), rowHeight };
}

function boardWidth(rows: SectionNode[]): number {
  return resolveBoardWidth(
    rows.map((row) => {
      const stored = parseFloat(row.getPluginData(TIER_WIDTH_KEY));
      return { width: row.width, stored: isFinite(stored) ? stored : null };
    }),
    ROW_WIDTH,
  );
}

// Packs a row from the top left in reading order, so where a sticky was dropped is
// its rank and it trades places with whatever it landed on.
async function arrangeRow(
  row: SectionNode,
  targetWidth: number,
  theme: BoardTheme,
  metrics: RowMetrics,
): Promise<void> {
  applyRowChrome(row, theme);
  const label = await ensureLabel(row);
  const layout = layoutRow(itemsOf(row), targetWidth, metrics);
  const needed = layout.height;

  // Grow before placing, shrink after. Shrinking first drops stickies and labels
  // that stick out of the section.
  const grownWidth = Math.max(row.width, targetWidth);
  const grownHeight = Math.max(row.height, needed);
  if (grownWidth !== row.width || grownHeight !== row.height) {
    row.resizeWithoutConstraints(grownWidth, grownHeight);
  }

  label.resize(metrics.labelWidth, needed);
  label.x = 0;
  label.y = 0;
  await fitLabelText(label, metrics.labelWidth);

  layout.items.forEach((item, index) => {
    item.x = layout.placements[index].x;
    item.y = layout.placements[index].y;
    // Written to the node as well: held only in memory, the row a sticky came from is
    // unknown right after the plugin reopens and the gap it left never closes.
    itemHome[item.id] = row.id;
    if (item.getPluginData(ITEM_HOME_KEY) !== row.id) {
      item.setPluginData(ITEM_HOME_KEY, row.id);
    }
    remember(item);
  });

  if (targetWidth !== row.width || needed !== row.height) {
    row.resizeWithoutConstraints(targetWidth, needed);
  }
  row.setPluginData(TIER_WIDTH_KEY, String(targetWidth));
  remember(label);
  remember(row);
}

// Arranges each board on its own; neither width nor order crosses boards.
//
// A null `targets` means every row. Rearranging untouched rows makes ranks look
// like they reshuffle themselves whenever a different row is touched. Two cases
// still take the whole board:
//   - the width changed, and every row has to match it
//   - some row has no tier label yet, which also moves its contents
async function arrangeBoards(targets: string[] | null, rowDragged: boolean): Promise<void> {
  for (const board of getBoards()) {
    const theme = boardThemeOf(board.container);
    const returnedLabels = repatriateLabels(board);
    const returnedItems = rowDragged ? repatriateItems(board) : [];
    const adopted = adoptStrays(board);
    const sizing = boardSizing(board, titleBlockOf(board.container));
    const metrics = metricsFor(sizing.rowHeight);
    const width = sizing.width;
    let forceWhole = false;
    for (const row of board.rows) {
      if (
        Math.abs(row.width - width) > 0.5 ||
        Math.abs(row.height - sizing.rowHeight) > 0.5 ||
        findLabel(row) === null
      ) {
        forceWhole = true;
      }
    }
    let touched = false;
    for (const row of board.rows) {
      if (
        targets === null ||
        forceWhole ||
        adopted.indexOf(row) >= 0 ||
        returnedLabels.indexOf(row) >= 0 ||
        returnedItems.indexOf(row) >= 0 ||
        targets.indexOf(row.id) >= 0
      ) {
        await arrangeRow(row, width, theme, metrics);
        touched = true;
      }
    }
    if (touched) {
      board.container.setPluginData(ROW_HEIGHT_KEY, String(sizing.rowHeight));
      relayout(board.container, board.rows);
    }
  }
}

async function runArrange(): Promise<void> {
  const request = queue.take();
  await arrangeBoards(request.targets, request.rowDragged);
  resizedBoards = {};
  postRows();
}

// Includes the parent. Rows are stacked at identical sizes, so position and size
// alone give (324,24)-in-A and (324,24)-in-S the same stamp; a sticky dragged
// exactly one row straight up would then pass as this plugin's own echo and never
// be rearranged.
// Deleted nodes arrive as RemovedNode.
//
// Never test with `'removed' in node`: BaseNodeMixin declares
// `readonly removed: boolean` too, so it is true for live nodes as well, every
// change is taken for a deletion and no arrange ever runs. Read the value, not
// the presence of the property.
function liveNode(node: SceneNode | RemovedNode): SceneNode | null {
  if (node.removed) {
    return null;
  }
  return node as SceneNode;
}

function stamp(node: SceneNode): string {
  const parentId = node.parent !== null ? node.parent.id : '';
  return `${parentId}:${node.x}:${node.y}:${node.width}:${node.height}`;
}

function remember(node: SceneNode): void {
  written[node.id] = stamp(node);
}

function markRow(rowId: string | null): void {
  if (rowId !== null) {
    queue.markRow(rowId);
  }
}

function rowIdOf(node: BaseNode): string | null {
  let cursor: BaseNode | null = node;
  while (cursor !== null) {
    if (isTierRow(cursor)) {
      return cursor.id;
    }
    cursor = cursor.parent;
  }
  return null;
}

function scheduleArrange(delay: number): void {
  queue.requestDelay(delay);
  if (arrangeTimer !== null) {
    clearTimeout(arrangeTimer);
  }
  arrangeTimer = setTimeout(() => {
    arrangeTimer = null;
    void runArrange();
  }, queue.pendingDelay);
}

function postRows(): void {
  const boards = getBoards();
  const active = activeBoard(boards);
  activeBoardId = active !== null ? active.id : null;
  const rows = (active !== null ? active.rows : []).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.getPluginData(TIER_COLOR_KEY) || FALLBACK_COLOR_KEY,
    count: itemsOf(row).length,
  }));
  const state: PanelState = {
    boards: boards.map((board, index) => ({
      id: board.id,
      name: boardName(board),
      label: boardName(board) || `Board ${index + 1}`,
      rowCount: board.rows.length,
    })),
    activeBoardId,
    boardTheme: active !== null ? boardThemeOf(active.container) : DEFAULT_BOARD_THEME,
    rows,
    presets: COLOR_PRESETS,
    autoArrange,
    subscriptions,
  };
  emit<StateHandler>('STATE', state);
}

async function getRowById(id: string): Promise<SectionNode | null> {
  const node = await figma.getNodeByIdAsync(id);
  if (node === null || !isTierRow(node)) {
    return null;
  }
  return node;
}

// Placed below existing content. At the viewport centre the rows would land on top
// of existing stickies and the sections would adopt them.
function boardOrigin(totalHeight: number): { x: number; y: number } {
  const siblings = figma.currentPage.children;
  if (siblings.length === 0) {
    const center = figma.viewport.center;
    return {
      x: Math.round(center.x - ROW_WIDTH / 2),
      y: Math.round(center.y - totalHeight / 2),
    };
  }
  let minX = Infinity;
  let maxY = -Infinity;
  for (const node of siblings) {
    minX = Math.min(minX, node.x);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return { x: Math.round(minX), y: Math.round(maxY + BOARD_MARGIN) };
}

async function createBoard(): Promise<void> {
  const totalHeight = DEFAULT_TIERS.length * ROW_HEIGHT + (DEFAULT_TIERS.length - 1) * ROW_GAP;
  const origin = boardOrigin(totalHeight);
  const boardId = newBoardId();
  const container = makeContainer(
    boardId,
    origin.x,
    origin.y,
    ROW_WIDTH,
    totalHeight,
    themeForCanvas(),
  );

  const created: SectionNode[] = [];
  for (let i = 0; i < DEFAULT_TIERS.length; i++) {
    const tier = DEFAULT_TIERS[i];
    created.push(await createRow(container, tier.name, tier.color, i * (ROW_HEIGHT + ROW_GAP)));
  }
  activeBoardId = boardId;
  for (const row of created) {
    markRow(row.id);
  }
  scheduleArrange(ARRANGE_DEBOUNCE_MS);
  figma.viewport.scrollAndZoomIntoView([container]);
}

async function addRow(): Promise<void> {
  const board = activeBoard(getBoards());
  if (board === null) {
    await createBoard();
    return;
  }
  const last = board.rows[board.rows.length - 1];
  const y = last !== undefined ? last.y + last.height + ROW_GAP : 0;
  const sizing = boardSizing(board, titleBlockOf(board.container));
  const row = await createRow(
    board.container,
    nextRowName(
      board.rows.map((candidate) => candidate.name),
      board.rows.length + 1,
    ),
    FALLBACK_COLOR_KEY,
    y,
    sizing,
  );
  markRow(row.id);
  scheduleArrange(ARRANGE_DEBOUNCE_MS);
  figma.viewport.scrollAndZoomIntoView([row]);
}

function rescueDropY(): number {
  let bottom = -Infinity;
  for (const node of figma.currentPage.children) {
    bottom = Math.max(bottom, node.y + node.height);
  }
  return (isFinite(bottom) ? bottom : 0) + RESCUE_MARGIN;
}

// Removing a section takes its children with it, so the contents move out first —
// onto the page, not inside the board, where a restacked row would land on them
// and adopt them.
function rescueItems(row: SectionNode, dropY: number): number {
  const items = itemsOf(row);
  for (const item of items) {
    const pos = pagePosition(item);
    figma.currentPage.appendChild(item);
    item.x = pos.x;
    item.y = dropY;
  }
  return items.length;
}

async function deleteRow(id: string): Promise<void> {
  const row = await getRowById(id);
  if (row === null) {
    return;
  }
  const board = boardOfRow(getBoards(), id);
  const rescued = rescueItems(row, rescueDropY());
  row.remove();
  if (board === null) {
    return;
  }
  const left = board.rows.filter((candidate) => candidate.id !== id);
  if (left.length === 0) {
    // A board with no rows left goes away entirely, heading included.
    board.container.remove();
  } else {
    relayout(board.container, left);
  }
  if (rescued > 0) {
    figma.notify(`Moved ${rescued} item(s) below the board`);
  }
}

async function renameRow(id: string, name: string): Promise<void> {
  const row = await getRowById(id);
  if (row === null) {
    return;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return;
  }
  row.name = trimmed;
  const label = await ensureLabel(row);
  await writeLabelText(label, trimmed, row.height);
}

async function setRowColor(id: string, colorKey: string): Promise<void> {
  const row = await getRowById(id);
  if (row === null) {
    return;
  }
  await ensureLabel(row);
  applyColor(row, colorKey);
}

async function moveRow(id: string, direction: 'up' | 'down'): Promise<void> {
  const board = boardOfRow(getBoards(), id);
  if (board === null) {
    return;
  }
  const rows = board.rows;
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) {
    return;
  }
  relayout(board.container, swapNeighbour(rows, index, direction));
}

// Applies the order the panel dragged into place, within that row's board only.
function reorderRows(ids: string[]): void {
  if (ids.length === 0) {
    return;
  }
  const board = boardOfRow(getBoards(), ids[0]);
  if (board === null) {
    return;
  }
  const ordered = applyOrder(board.rows, ids);
  relayout(board.container, ordered);
}

async function setBoardName(boardId: string, rawName: string): Promise<void> {
  const board = findBoard(getBoards(), boardId);
  if (board === null) {
    return;
  }
  const name = rawName.trim();
  board.container.setPluginData(TIER_BOARD_NAME_KEY, name);
  for (const row of board.rows) {
    row.setPluginData(TIER_BOARD_NAME_KEY, '');
  }
  board.container.name = name !== '' ? name : 'Tier Board';

  const existing = findTitle(board.container);
  if (name === '') {
    if (existing !== null) {
      existing.remove();
    }
    relayout(board.container, board.rows);
    return;
  }

  let title = existing;
  if (title === null) {
    title = figma.createText();
    title.setPluginData(TIER_TITLE_KEY, '1');
    board.container.appendChild(title);
    title.x = 0;
    title.y = 0;
  }
  const fontName = title.fontName;
  if (typeof fontName !== 'symbol') {
    await figma.loadFontAsync(fontName);
    title.characters = name;
    title.fontSize = TITLE_FONT_SIZE;
  }
  title.fills = [{ type: 'SOLID', color: hexToRgb(paletteFor(boardThemeOf(board.container)).title) }];
  relayout(board.container, board.rows);
}

// Canvas colours are document data, so this is a per-board setting that everyone
// sees, not a per-viewer preference.
function setBoardTheme(boardId: string, theme: BoardTheme): void {
  const board = findBoard(getBoards(), boardId);
  if (board === null) {
    return;
  }
  board.container.setPluginData(TIER_THEME_KEY, theme);
  for (const row of board.rows) {
    markRow(row.id);
  }
  queue.markAll();
  void runArrange();
}

async function setAutoArrange(enabled: boolean): Promise<void> {
  autoArrange = enabled;
  await figma.clientStorage.setAsync(AUTO_ARRANGE_KEY, enabled);
  if (enabled) {
    queue.markAll();
    await runArrange();
  }
}


// Event names and payloads are declared in events.ts, so a misspelling or a
// swapped argument fails to compile.
function registerUiHandlers(): void {
  const refresh = (): void => {
    postRows();
  };

  on<RequestStateHandler>('REQUEST_STATE', refresh);
  on<CreateBoardHandler>('CREATE_BOARD', () => {
    void createBoard().then(refresh);
  });
  on<AddRowHandler>('ADD_ROW', () => {
    void addRow().then(refresh);
  });
  on<DeleteRowHandler>('DELETE_ROW', (rowId) => {
    void deleteRow(rowId).then(refresh);
  });
  on<RenameRowHandler>('RENAME_ROW', (rowId, name) => {
    void renameRow(rowId, name).then(refresh);
  });
  on<SetRowColorHandler>('SET_ROW_COLOR', (rowId, colorKey) => {
    void setRowColor(rowId, colorKey).then(refresh);
  });
  on<MoveRowHandler>('MOVE_ROW', (rowId, direction) => {
    void moveRow(rowId, direction).then(refresh);
  });
  on<ReorderRowsHandler>('REORDER_ROWS', (rowIds) => {
    reorderRows(rowIds);
    refresh();
  });
  on<SelectBoardHandler>('SELECT_BOARD', (boardId) => {
    activeBoardId = boardId;
    refresh();
  });
  on<SetBoardNameHandler>('SET_BOARD_NAME', (boardId, name) => {
    void setBoardName(boardId, name).then(refresh);
  });
  on<ArrangeNowHandler>('ARRANGE_NOW', () => {
    queue.markAll();
    void runArrange();
  });
  on<SetBoardThemeHandler>('SET_BOARD_THEME', (boardId, theme) => {
    setBoardTheme(boardId, theme);
  });
  on<SetAutoArrangeHandler>('SET_AUTO_ARRANGE', (enabled) => {
    void setAutoArrange(enabled).then(refresh);
  });
}

// Only LOCAL changes are acted on. Reacting to REMOTE would have every
// collaborator fighting over the same rows.
//
function handleChanges(changes: ReadonlyArray<DocumentChange | NodeChange>): void {
  if (!autoArrange) {
    return;
  }
  let marked = false;
  let delay = ARRANGE_DEBOUNCE_MS;
  for (const change of changes) {
    if (change.origin !== 'LOCAL') {
      continue;
    }
    // Only these three carry a node; style changes do not. Testing for the property
    // with `'node' in change` would trip over the same trap as `removed` above.
    if (change.type !== 'CREATE' && change.type !== 'DELETE' && change.type !== 'PROPERTY_CHANGE') {
      continue;
    }
    const live = liveNode(change.node);

    // Unchanged from what the arrange wrote means this is its own echo.
    if (live !== null && written[change.id] === stamp(live)) {
      continue;
    }

    // The destination alone does not reveal the row a sticky left, so its previous row
    // is targeted too; without it the gap it left stays open.
    let previous = live !== null ? live.getPluginData(ITEM_HOME_KEY) : '';
    if (previous === '') {
      const remembered = itemHome[change.id];
      previous = remembered !== undefined ? remembered : '';
    }
    if (previous !== '') {
      markRow(previous);
      marked = true;
    }

    const current = live !== null ? rowIdOf(live) : null;
    if (current !== null) {
      markRow(current);
      marked = true;
    }

    // A row itself moved. Its dropped position decides the order, so the whole board
    // is targeted — after the hand lets go.
    if (live !== null && isTierRow(live)) {
      delay = Math.max(delay, ROW_SETTLE_MS);
      queue.markRowDragged();
      const container = boardContainerOf(live);
      if (container !== null) {
        for (const child of container.children) {
          if (isTierRow(child)) {
            markRow(child.id);
          }
        }
      }
      marked = true;
    }

    if (live !== null && isBoardContainer(live)) {
      const boardId = live.getPluginData(TIER_BOARD_KEY);
      if (boardId !== '') {
        resizedBoards[boardId] = { width: live.width, height: live.height };
      }
    }

    // For a node inside the board but in no row, and for a sticky that crossed parents
    // with no known home, there is no way to tell which row changed, so the whole
    // board is targeted.
    const reparented = change.type === 'PROPERTY_CHANGE' && change.properties.indexOf('parent') >= 0;
    if (live !== null && (current === null || (previous === '' && reparented))) {
      const container = boardContainerOf(live);
      if (container !== null) {
        for (const child of container.children) {
          if (isTierRow(child)) {
            markRow(child.id);
            marked = true;
          }
        }
      }
    }
  }
  if (marked) {
    scheduleArrange(delay);
  }
}

// Both channels are subscribed so that one going silent cannot kill auto-arrange.
// Duplicate deliveries are harmless: targets dedupe and the debounce coalesces.
function subscribeToCanvas(): void {
  try {
    figma.currentPage.on('nodechange', (event: NodeChangeEvent) => {
      handleChanges(event.nodeChanges);
    });
    subscriptions.push('nodechange');
  } catch (error) {
    subscriptions.push(`nodechange failed (${String(error)})`);
  }

  // Under documentAccess: dynamic-page, documentchange only arrives once every
  // page is loaded. nodechange is already live by then, so nothing is missed
  // while waiting — and a FigJam file has one page, so there is little to wait
  // for.
  void figma.loadAllPagesAsync().then(
    () => {
      try {
        figma.on('documentchange', (event: DocumentChangeEvent) => {
          handleChanges(event.documentChanges);
        });
        subscriptions.push('documentchange');
      } catch (error) {
        subscriptions.push(`documentchange failed (${String(error)})`);
      }
      postRows();
    },
    (error: unknown) => {
      subscriptions.push(`documentchange failed (${String(error)})`);
      postRows();
    },
  );
}

// Following the selection saves reaching for the board selector.
function boardIdFromSelection(): string | null {
  for (const node of figma.currentPage.selection) {
    let cursor: BaseNode | null = node;
    while (cursor !== null) {
      if (isBoardContainer(cursor)) {
        const id = cursor.getPluginData(TIER_BOARD_KEY);
        return id === '' ? null : id;
      }
      cursor = cursor.parent;
    }
  }
  return null;
}

function handleSelectionChange(): void {
  const id = boardIdFromSelection();
  if (id !== null && id !== activeBoardId) {
    activeBoardId = id;
    postRows();
  }
}

async function restoreSettings(): Promise<void> {
  const stored = await figma.clientStorage.getAsync(AUTO_ARRANGE_KEY);
  autoArrange = stored !== false;
  postRows();
}

// create-figma-plugin invokes this default export.
export default function main(): void {
  showUI({ width: 340, height: 560, themeColors: true });
  registerUiHandlers();
  // Subscribed synchronously; waiting on anything first would drop the edits made
  // in the meantime.
  subscribeToCanvas();
  figma.on('selectionchange', handleSelectionChange);
  void restoreSettings();
}

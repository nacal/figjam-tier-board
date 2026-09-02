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

// FigJam Tier表プラグイン
//
// 行（ティア）は SectionNode で表現する。セクションは幾何的に内包したノードを
// 自動的に子にするため、付箋の所属判定は parent を見るだけで済む。
// 行の順序はキャンバス上の y 座標を唯一の正とし、順序リストは保存しない。
// 行の中の順位は付箋の中心 x を唯一の正とし、左から詰めて整列する。
//
// 各行の左端には、ティア名を表示する色付きのセル（ShapeWithText）を子として
// 置く。これはランキング対象ではないので整列からは除外し、ロックして
// キャンバス上で掴めないようにしてある。

const TIER_FLAG_KEY = 'figjamTierRow';
const TIER_COLOR_KEY = 'figjamTierColor';
const TIER_WIDTH_KEY = 'figjamTierWidth';
const TIER_BOARD_KEY = 'figjamTierBoard';
const TIER_BOARD_NAME_KEY = 'figjamTierBoardName';
const TIER_TITLE_KEY = 'figjamTierTitle';
// 盤面をまるごと包むセクション。これを掴めば表ごと動かせる。
const BOARD_FLAG_KEY = 'figjamTierBoardSection';
// 盤面の配色。ライト/ダークを盤面ごとに持つ。
const TIER_THEME_KEY = 'figjamTierTheme';
// 付箋が最後にいた行。行から出ていった付箋の元の行を知るために使う。
const ITEM_HOME_KEY = 'figjamTierHome';
const TIER_LABEL_KEY = 'figjamTierLabel';
const AUTO_ARRANGE_KEY = 'autoArrange';

const ITEM_PADDING = 24;
const ITEM_GAP = 24;
const ITEM_WIDTH = 240; // FigJam の付箋の既定幅
// 上端がこれだけ離れていたら別の段とみなす（付箋の高さの半分）。
const LINE_TOLERANCE = 120;

const DEFAULT_COLUMNS = 10;

const LABEL_WIDTH = 300;
const ROW_HEIGHT = 300;
// 行同士は隙間なく積む。tiermaker と同じ見た目にするため。
const ROW_GAP = 0;
// 既定幅は 240px の付箋がちょうど 10 枚入る値。
const ROW_WIDTH =
  LABEL_WIDTH + ITEM_PADDING * 2 + ITEM_WIDTH * DEFAULT_COLUMNS + ITEM_GAP * (DEFAULT_COLUMNS - 1);
const BOARD_MARGIN = 160;
const ROW_METRICS: RowMetrics = {
  labelWidth: LABEL_WIDTH,
  padding: ITEM_PADDING,
  gap: ITEM_GAP,
  minHeight: ROW_HEIGHT,
  lineTolerance: LINE_TOLERANCE,
};

// 行を削除したとき、中身を盤面の下へ逃がす距離。
const RESCUE_MARGIN = 80;
// 盤面の名前を出す見出しの大きさと、いちばん上の行との間隔。
const TITLE_FONT_SIZE = 72;
const TITLE_GAP = 32;



// ドラッグ中に整列が割り込むと掴んでいる付箋が飛ぶので、変更が落ち着いてから走らせる。
const ARRANGE_DEBOUNCE_MS = 320;
// 行を掴んで動かしているあいだに並べ替えが割り込むと、掴んでいる行の下で
// 順番が入れ替わって手に負えなくなる。付箋より長く待って、手を離してから
// 並べ替える。
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

// 次の整列で触る行。触っていない行の中身まで並び直さないための的。
const queue = new ArrangeQueue(ARRANGE_DEBOUNCE_MS);
// 前回の整列時点で、どの付箋がどの行にいたか。付箋が行から出ていったとき、
// 出ていった先の情報だけでは元の行が分からないので覚えておく。
// 消えた付箋のぶんだけメモリに持つ。生きている付箋は plugin data 側が正。
let itemHome: { [nodeId: string]: string } = {};
// キャンバスの変更をどの経路で購読できたか。パネルに出して切り分けに使う。
let subscriptions: string[] = [];
// 整列が最後に書き込んだ位置と大きさ。整列そのものが nodechange を起こすので、
// その反響と人の操作を見分けるために使う。時間で無視する窓にすると、整列の
// 直後に動かした付箋がまるごと取りこぼされる。
let written: { [nodeId: string]: string } = {};

function isTierRow(node: BaseNode): node is SectionNode {
  return node.type === 'SECTION' && node.getPluginData(TIER_FLAG_KEY) === '1';
}

// 色セルは持ち主の行 ID を持つ。行を別の行に重ねると、セクションが相手の
// 中身を取り込んでしまう（色セルも付箋も）。持ち主が分からないと、盗られた
// 色セルをその行のものと見なしてしまい、盗られた側は色セルを作り直す
// ── 同じ名前の行が2つに見える。
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

// ページ座標。盤面のセクションの中にいる行や付箋は、親からの相対で持っている。
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
  container.name = 'Tier表';
  container.resizeWithoutConstraints(Math.max(width, 1), Math.max(height, 1));
  container.x = x;
  container.y = y;
  container.fills = [{ type: 'SOLID', color: hexToRgb(paletteFor(theme).content) }];
  figma.currentPage.appendChild(container);
  return container;
}

// 盤面の配色。持っていない盤面（配色を持たせる前に作られたもの）は既定のまま。
// 開いた途端に色が変わるのは避ける。
function boardThemeOf(container: SectionNode): BoardTheme {
  return parseTheme(container.getPluginData(TIER_THEME_KEY), DEFAULT_BOARD_THEME);
}

// このページのキャンバス背景に合う配色。エディタのテーマ設定ではなく、実際に
// 画面に映っている背景を見る。テーマは main スレッドからは読めないし、背景を
// 手で変えている場合もそちらに合うため。
function themeForCanvas(): BoardTheme {
  for (const paint of figma.currentPage.backgrounds) {
    if (paint.type === 'SOLID') {
      return themeForBackground(paint.color, DEFAULT_BOARD_THEME);
    }
  }
  return DEFAULT_BOARD_THEME;
}

// 盤面のセクションに入っていないティア行を拾う。
//
// 行だけをキャンバスへ持ち出せてしまうと表が壊れるので、元の盤面が残っていれば
// そこへ戻す。行はロックできない ── ロックは子にも効くので、行をロックすると
// 中の付箋を掴めなくなり、並べる操作そのものができなくなる。
//
// 戻すときの高さは落とした位置のまま。行の順序はキャンバス上の並びが正なので、
// 行を上下へドラッグすれば、そのまま並べ替えになる。
//
// 元の盤面が無い行（盤面を包む前のバージョンで作られた表）は、新しく器を作って
// まとめて包む。
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
    // 落とした高さを保つ。ここで順番が決まる。
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
  // 盤面 ID を持たない行は、複数盤面に対応する前に作られたもの。当時は
  // ページにひとつしか作れなかったので、まとめてひとつの盤面として扱う。
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
    // 盤面の見出しも一緒に動くよう、中へ入れる
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

// 盤面には落ちたが、どの行にも入らなかったアイテムを、重なっている行へ引き取る。
//
// FigJam がセクションの入れ子のうち外側（盤面）に付けることがある。プラグイン
// API で座標を動かしてもセクションは取り込まないので、どちらに付くかはエディタ
// 側の挙動でしか決まらない。どちらでも動くようにしておく。
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

// 行の順番はキャンバス上の並びを正とする。中心で比べる ── 上端で比べると、
// 行の高さぶん以上動かさないと入れ替わらない。
function rowsOfContainer(container: SectionNode): SectionNode[] {
  const rows: SectionNode[] = [];
  for (const child of container.children) {
    if (isTierRow(child)) {
      rows.push(child);
    }
  }
  return byVerticalCenter(rows);
}

// 盤面ごとのまとまり。並びは、上にある盤面から。
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
      // 別の盤面へドラッグされた行は、移した先の盤面のものになる
      if (row.getPluginData(TIER_BOARD_KEY) !== id) {
        row.setPluginData(TIER_BOARD_KEY, id);
      }
      // 持ち主を持たせる前に作られた色セルは、今いる行のものとして扱う
      for (const child of row.children) {
        if (child.type === 'SHAPE_WITH_TEXT' && child.getPluginData(TIER_LABEL_KEY) === '1') {
          child.setPluginData(TIER_LABEL_KEY, row.id);
        }
      }
    }
    return { id, container, rows };
  });
}

// 盤面の名前は器に持たせる。行に持たせると、行を別の盤面へ移したときに
// 名前まで付いていってしまう。
function boardName(board: Board): string {
  const stored = board.container.getPluginData(TIER_BOARD_NAME_KEY);
  if (stored !== '') {
    return stored;
  }
  // 器に名前を持たせる前のバージョンで付けた名前を拾う
  for (const row of board.rows) {
    const name = row.getPluginData(TIER_BOARD_NAME_KEY);
    if (name !== '') {
      board.container.setPluginData(TIER_BOARD_NAME_KEY, name);
      return name;
    }
  }
  return '';
}

// 盤面の名前はキャンバス上にも見出しとして出す。パネルの中だけに持っていても
// 一緒に見ている人には見えないため。見出しは盤面のセクションの子にしてあるので
// 表ごと動かせば一緒に動く。名前が空のときは見出しを置かない。
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

// パネルが操作している盤面。指定が無い／消えていたら、いちばん上の盤面。
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

// 他の行に盗られた付箋を元の行へ返す。行が動かされた直後だけ呼ぶ。
// 人が付箋そのものを動かしたときは返してはいけない ── そのときは行は
// 動いていないので、この関数は呼ばれない。
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

// 他の行に盗られた色セルを持ち主へ返す。持ち主が消えていれば捨てる。
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

// ランキング対象。左端のティア名セルは含めない。
//
// 行や盤面のセクションも除く。行を別の行の上にドロップすると FigJam が行を
// 行の子にすることがあり、そのまま数えると行そのものを付箋として左寄せに
// 詰めはじめる。
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

// 行そのものの見た目（暗い中身の面と境界線）。整列のたびに当て直すので、
// 色セルが無かった頃に作られた盤面も、次の整列で新しい見た目に移行する。
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
  // キャンバス上で掴めるとランキング対象と紛らわしいので固定する。
  label.locked = true;
  await writeLabelText(label, row.name);
  applyColor(row, row.getPluginData(TIER_COLOR_KEY) || FALLBACK_COLOR_KEY);
  return label;
}

async function writeLabelText(label: ShapeWithTextNode, text: string): Promise<void> {
  const fontName = label.text.fontName;
  if (typeof fontName === 'symbol') {
    return;
  }
  await figma.loadFontAsync(fontName);
  label.text.characters = text;
  label.text.fontSize = 96;
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
): Promise<SectionNode> {
  const boardId = container.getPluginData(TIER_BOARD_KEY);
  const row = figma.createSection();
  row.name = name;
  row.setPluginData(TIER_FLAG_KEY, '1');
  row.setPluginData(TIER_BOARD_KEY, boardId);
  row.setPluginData(TIER_COLOR_KEY, colorKey);
  row.resizeWithoutConstraints(ROW_WIDTH, ROW_HEIGHT);
  applyRowChrome(row, boardThemeOf(container));
  container.appendChild(row);
  row.x = 0;
  row.y = y;
  await ensureLabel(row);
  return row;
}

// 与えられた順序で、盤面のセクションの中に上から詰め直す。行の高さは整列や
// ユーザー操作で変わっているので、実際の高さを積み上げて配置する。
//
// 位置はすべて盤面のセクションからの相対。盤面そのものの場所には触らないので、
// 並べ替えても表は動かないし、ユーザーが表を掴んで動かした場所も保たれる。
function relayout(container: SectionNode, rows: SectionNode[]): void {
  const title = findTitle(container);
  const titleBlock = title !== null ? title.height + TITLE_GAP : 0;

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

  // 広げるのは配置の前、縮めるのは配置の後。先に縮めると、はみ出した行が
  // 盤面のセクションから抜けてしまう。
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
  remember(container);
}

// 盤面の幅。ユーザーがどれか1行の幅を変えたら、それを全行に広げる。
// 「変えた行」は、前回書き込んでおいた幅と実際の幅が食い違う行として見つける。
function boardWidth(rows: SectionNode[]): number {
  return resolveBoardWidth(
    rows.map((row) => {
      const stored = parseFloat(row.getPluginData(TIER_WIDTH_KEY));
      return { width: row.width, stored: isFinite(stored) ? stored : null };
    }),
    ROW_WIDTH,
  );
}

// 行の中身を左上から詰め直す。順位は読み順（上の段が先、同じ段では左が先）
// なので、ドラッグして落とした位置がそのまま順位になり、落とした先の付箋と
// 場所が入れ替わる。横幅に収まらない分は折り返し、必要なら行の高さを伸ばす。
async function arrangeRow(row: SectionNode, targetWidth: number, theme: BoardTheme): Promise<void> {
  applyRowChrome(row, theme);
  const label = await ensureLabel(row);
  const layout = layoutRow(itemsOf(row), targetWidth, ROW_METRICS);
  const needed = layout.height;

  // 広げるのは配置の前、縮めるのは配置の後。先に縮めると、セクションの外に
  // はみ出した付箋やラベルが行から抜けてしまう。
  const grownWidth = Math.max(row.width, targetWidth);
  const grownHeight = Math.max(row.height, needed);
  if (grownWidth !== row.width || grownHeight !== row.height) {
    row.resizeWithoutConstraints(grownWidth, grownHeight);
  }

  label.resize(LABEL_WIDTH, needed);
  label.x = 0;
  label.y = 0;

  layout.items.forEach((item, index) => {
    item.x = layout.placements[index].x;
    item.y = layout.placements[index].y;
    // 所属はノード自身にも書く。メモリだけに持つと、プラグインを開き直した
    // 直後に「付箋が出ていった元の行」が分からず、穴が詰まらない。
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

// 盤面ごとに幅を決めて整列し、その盤面のなかだけで詰め直す。
// 幅も並びも盤面をまたがない。
//
// targets が null なら全部、そうでなければその行だけを並べ直す。触っていない
// 行の中身まで並び直すと、別の行を触っただけで順位が勝手に組み替わって見える。
// ただし次の場合は、指定が無くてもその盤面の行を全部並べ直す:
//   - 盤面の幅が変わった（全行を同じ幅に揃える必要がある）
//   - 色セルを持たない行がある（古い盤面の移行。中身の置き場所も変わる）
async function arrangeBoards(targets: string[] | null, rowDragged: boolean): Promise<void> {
  for (const board of getBoards()) {
    const theme = boardThemeOf(board.container);
    const returnedLabels = repatriateLabels(board);
    const returnedItems = rowDragged ? repatriateItems(board) : [];
    const adopted = adoptStrays(board);
    const width = boardWidth(board.rows);
    let forceWhole = false;
    for (const row of board.rows) {
      if (Math.abs(row.width - width) > 0.5 || findLabel(row) === null) {
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
        await arrangeRow(row, width, theme);
        touched = true;
      }
    }
    if (touched) {
      relayout(board.container, board.rows);
    }
  }
}

async function runArrange(): Promise<void> {
  const request = queue.take();
  await arrangeBoards(request.targets, request.rowDragged);
  postRows();
}

// 親も入れる。行はどれも同じ幅・同じ高さで縦に並んでいるので、位置と大きさ
// だけだと「A の中の (324,24)」と「S の中の (324,24)」が同じ印になる。
// 真上へ1行ぶんドラッグした付箋が自分の書き込みの反響と区別できなくなり、
// 人が動かしたのに整列が走らない。
// 消えたノードは RemovedNode で届く。生きているノードだけを取り出す。
//
// `'removed' in node` で判定してはいけない。BaseNodeMixin にも
// `readonly removed: boolean` があるので、生きているノードでも true になり、
// すべての変更が「消えたノード」扱いになって整列が一切走らなくなる。
// 見るのはプロパティの有無ではなく値。
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

// ノードが今いる行。付箋そのものでも、行そのものでも辿れる。
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

// 待ち時間はいちばん長いものに合わせる。行が動いているあいだに付箋の変更が
// 混ざっても、行の並べ替えが割り込まないようにする。
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
      label: boardName(board) || `盤面 ${index + 1}`,
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

// 盤面の置き場所。既存コンテンツがあればその下に置く。ビューポート中央に置くと
// 既存の付箋の上に行が重なり、セクションがそれを自動的に子にしてしまうため。
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

// 盤面はいくつでも作れる。新しい盤面は既存のコンテンツの下に置く。
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
  const row = await createRow(board.container, nextRowName(
      board.rows.map((row) => row.name),
      board.rows.length + 1,
    ), FALLBACK_COLOR_KEY, y);
  row.resizeWithoutConstraints(boardWidth(board.rows), ROW_HEIGHT);
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

// セクションを消すと中の子ごと消えるため、先に中身を外へ逃がす。行き先は
// 盤面のセクションの外（ページ直下）。中に残すと、詰め直した行がそれを踏んで
// 自動的に子にしてしまう。
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
    // 行が一枚も無い盤面は器ごと片付ける。見出しも一緒に消える。
    board.container.remove();
  } else {
    relayout(board.container, left);
  }
  if (rescued > 0) {
    figma.notify(`${rescued} 個のアイテムをキャンバスの下に移しました`);
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
  await writeLabelText(label, trimmed);
}

async function setRowColor(id: string, colorKey: string): Promise<void> {
  const row = await getRowById(id);
  if (row === null) {
    return;
  }
  await ensureLabel(row);
  applyColor(row, colorKey);
}

// 配列上で順序を入れ替えたあと、その盤面の行の y を詰め直す。
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

// パネル上でドラッグ&ドロップされた順序をそのまま反映する。対象は渡された
// 行が属する盤面だけ。パネルが把握していない行がその盤面にあってもいいように、
// 渡された ID の順に並べ、残りは現在の順序のまま後ろへ回す。
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
  board.container.name = name !== '' ? name : 'Tier表';

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

// 配色の切り替え。キャンバスの色はドキュメントのデータなので、これは
// 見ている人ごとの設定ではなく盤面ごとの設定（全員に反映される）。
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


// UI からのイベント。名前とペイロードは events.ts で宣言してあるので、
// 綴り違いも引数の取り違えもコンパイルで落ちる。
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

// キャンバス側の操作を拾って整列する。REMOTE（他の参加者の操作）に反応すると
// 全員が同じ行を奪い合って動かし続けるので、自分の操作だけを見る。
//
// 変更は node を持つものだけを見る。documentchange にはスタイルの変更も
// 混ざってきて、そちらには node が無い。
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
    // node を持つのはこの3種だけ。スタイルの変更には node が無い。
    // ここも `'node' in change` で判定しない ── プロパティの有無に頼ると、
    // 上の removed と同じ形で足をすくわれる。
    if (change.type !== 'CREATE' && change.type !== 'DELETE' && change.type !== 'PROPERTY_CHANGE') {
      continue;
    }
    const live = liveNode(change.node);

    // 整列が書いた親・位置・大きさのままなら、それは自分の書き込みの反響。
    if (live !== null && written[change.id] === stamp(live)) {
      continue;
    }

    // 出ていった先だけでは元の行が分からないので、前回いた行も的に入れる。
    // これが無いと、付箋を行の外へ出したあと元の行に穴が残る。
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

    // 行そのものが動かされた。落とした位置で順番が決まるので、その盤面の行を
    // まとめて的にする。並べ替えは手を離してから。
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

    // 行には入らなかったが盤面の中にはいるノード（FigJam が外側のセクションに
    // 付けた付箋）と、元の行が分からないまま親をまたいだ付箋は、どこの行が
    // 変わったのか特定できない。その盤面の行をまとめて的にする。
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

// 経路はひとつに賭けない。片方が黙って何も届けなくても整列が止まらないように
// 両方張る。二重に届いても、的は重複を除くしデバウンスでまとめられる。
function subscribeToCanvas(): void {
  try {
    figma.currentPage.on('nodechange', (event: NodeChangeEvent) => {
      handleChanges(event.nodeChanges);
    });
    subscriptions.push('nodechange');
  } catch (error) {
    subscriptions.push(`nodechange失敗(${String(error)})`);
  }
  try {
    figma.on('documentchange', (event: DocumentChangeEvent) => {
      handleChanges(event.documentChanges);
    });
    subscriptions.push('documentchange');
  } catch (error) {
    subscriptions.push(`documentchange失敗(${String(error)})`);
  }
}

// キャンバスで盤面の中の何かを選んだら、パネルの操作対象をその盤面に移す。
// 盤面が複数あるとき、いちいちセレクタを触らずに済む。
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

// プラグインのエントリ。create-figma-plugin はこのデフォルトエクスポートを呼ぶ。
export default function main(): void {
  showUI({ width: 340, height: 560, themeColors: true });
  registerUiHandlers();
  // 購読は同期で張る。読み込みを待ってから張ると、待っているあいだの操作を
  // 取りこぼす。
  subscribeToCanvas();
  figma.on('selectionchange', handleSelectionChange);
  void restoreSettings();
}

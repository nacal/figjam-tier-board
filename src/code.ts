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
const TIER_LABEL_KEY = 'figjamTierLabel';
const AUTO_ARRANGE_KEY = 'autoArrange';

const ITEM_PADDING = 24;
const ITEM_GAP = 24;
const ITEM_WIDTH = 240; // FigJam の付箋の既定幅
const DEFAULT_COLUMNS = 10;

const LABEL_WIDTH = 300;
const ROW_HEIGHT = 300;
// 行同士は隙間なく積む。tiermaker と同じ見た目にするため。
const ROW_GAP = 0;
// 既定幅は 240px の付箋がちょうど 10 枚入る値。
const ROW_WIDTH =
  LABEL_WIDTH + ITEM_PADDING * 2 + ITEM_WIDTH * DEFAULT_COLUMNS + ITEM_GAP * (DEFAULT_COLUMNS - 1);
const BOARD_MARGIN = 160;
// 行を削除したとき、中身を盤面の下へ逃がす距離。
const RESCUE_MARGIN = 80;

const CONTENT_FILL: RGB = { r: 0.106, g: 0.106, b: 0.106 };
const BORDER_STROKE: RGB = { r: 0.24, g: 0.24, b: 0.24 };

// ドラッグ中に整列が割り込むと掴んでいる付箋が飛ぶので、変更が落ち着いてから走らせる。
const ARRANGE_DEBOUNCE_MS = 320;
// 整列そのものが nodechange を起こす。その反響を無視するための窓。
const ARRANGE_SUPPRESS_MS = 400;

const DEFAULT_TIERS: Array<{ name: string; color: string }> = [
  { name: 'S', color: 'red' },
  { name: 'A', color: 'orange' },
  { name: 'B', color: 'yellow' },
  { name: 'C', color: 'lemon' },
  { name: 'D', color: 'green' },
];

interface ColorPreset {
  key: string;
  label: string;
  hex: string;
}

const COLOR_PRESETS: ColorPreset[] = [
  { key: 'red', label: 'レッド', hex: '#F19A9A' },
  { key: 'orange', label: 'オレンジ', hex: '#F5BC85' },
  { key: 'yellow', label: 'イエロー', hex: '#F8DE94' },
  { key: 'lemon', label: 'レモン', hex: '#FBFB9C' },
  { key: 'green', label: 'グリーン', hex: '#CBF6A0' },
  { key: 'blue', label: 'ブルー', hex: '#A8DAFF' },
  { key: 'purple', label: 'パープル', hex: '#D3BDFF' },
  { key: 'gray', label: 'グレー', hex: '#D9D9D9' },
];

const FALLBACK_COLOR_KEY = 'gray';

let autoArrange = true;
let arrangeTimer: number | null = null;
let suppressUntil = 0;

function hexToRgb(hex: string): RGB {
  const value = parseInt(hex.slice(1), 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

function findPreset(key: string): ColorPreset {
  for (const preset of COLOR_PRESETS) {
    if (preset.key === key) {
      return preset;
    }
  }
  for (const preset of COLOR_PRESETS) {
    if (preset.key === FALLBACK_COLOR_KEY) {
      return preset;
    }
  }
  throw new Error('color preset table is broken');
}

function isTierRow(node: BaseNode): node is SectionNode {
  return node.type === 'SECTION' && node.getPluginData(TIER_FLAG_KEY) === '1';
}

function isTierLabel(node: SceneNode): node is ShapeWithTextNode {
  return node.type === 'SHAPE_WITH_TEXT' && node.getPluginData(TIER_LABEL_KEY) === '1';
}

// ページ上のティア行を y の昇順で読む。プラグインが付けたフラグを持つ
// セクションだけを対象にするので、無関係なセクションは巻き込まない。
function getRows(): SectionNode[] {
  const sections = figma.currentPage.findAllWithCriteria({ types: ['SECTION'] });
  const rows: SectionNode[] = [];
  for (const section of sections) {
    if (isTierRow(section)) {
      rows.push(section);
    }
  }
  rows.sort((a, b) => a.y - b.y);
  return rows;
}

function findLabel(row: SectionNode): ShapeWithTextNode | null {
  for (const child of row.children) {
    if (isTierLabel(child)) {
      return child;
    }
  }
  return null;
}

// ランキング対象。左端のティア名セルは含めない。
function itemsOf(row: SectionNode): SceneNode[] {
  const items: SceneNode[] = [];
  for (const child of row.children) {
    if (!isTierLabel(child)) {
      items.push(child);
    }
  }
  return items;
}

// 行そのものの見た目（暗い中身の面と境界線）。整列のたびに当て直すので、
// 色セルが無かった頃に作られた盤面も、次の整列で新しい見た目に移行する。
function applyRowChrome(row: SectionNode): void {
  const fills = row.fills;
  if (typeof fills !== 'symbol' && fills.length === 1) {
    const paint = fills[0];
    if (
      paint.type === 'SOLID' &&
      Math.abs(paint.color.r - CONTENT_FILL.r) < 0.002 &&
      Math.abs(paint.color.g - CONTENT_FILL.g) < 0.002 &&
      Math.abs(paint.color.b - CONTENT_FILL.b) < 0.002
    ) {
      return;
    }
  }
  row.fills = [{ type: 'SOLID', color: CONTENT_FILL }];
  row.strokes = [{ type: 'SOLID', color: BORDER_STROKE }];
  row.strokeWeight = 1;
}

async function ensureLabel(row: SectionNode): Promise<ShapeWithTextNode> {
  const existing = findLabel(row);
  if (existing !== null) {
    return existing;
  }
  const label = figma.createShapeWithText();
  label.shapeType = 'SQUARE';
  label.setPluginData(TIER_LABEL_KEY, '1');
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

async function createRow(name: string, colorKey: string, x: number, y: number): Promise<SectionNode> {
  const row = figma.createSection();
  row.name = name;
  row.setPluginData(TIER_FLAG_KEY, '1');
  row.setPluginData(TIER_COLOR_KEY, colorKey);
  row.resizeWithoutConstraints(ROW_WIDTH, ROW_HEIGHT);
  row.x = x;
  row.y = y;
  applyRowChrome(row);
  figma.currentPage.appendChild(row);
  await ensureLabel(row);
  return row;
}

// 与えられた順序で全行の y を上から詰め直す。行の高さは整列やユーザー操作で
// 変わっているので、実際の高さを積み上げて配置する。
//
// 基準は「今いちばん上にある行の左上」であって、新しい順序の先頭に来た行が
// 今いる場所ではない。後者を基準にすると、並べ替えのたびに盤面ごとその行の
// 位置へ飛んでいく。全行の最小 x でもないのは、誰かが1行だけ横へずらした
// ときに盤面全体がそちらへ引っ張られてしまうため。
function relayout(rows: SectionNode[]): void {
  if (rows.length === 0) {
    return;
  }
  let top = rows[0];
  for (const row of rows) {
    if (row.y < top.y) {
      top = row;
    }
  }
  const anchorX = top.x;
  let cursorY = top.y;
  for (const row of rows) {
    row.x = anchorX;
    row.y = cursorY;
    cursorY += row.height + ROW_GAP;
  }
}

// 盤面の幅。ユーザーがどれか1行の幅を変えたら、それを全行に広げる。
// 「変えた行」は、前回書き込んでおいた幅と実際の幅が食い違う行として見つける。
function boardWidth(rows: SectionNode[]): number {
  for (const row of rows) {
    const stored = parseFloat(row.getPluginData(TIER_WIDTH_KEY));
    if (isFinite(stored) && Math.abs(stored - row.width) > 0.5) {
      return row.width;
    }
  }
  for (const row of rows) {
    const stored = parseFloat(row.getPluginData(TIER_WIDTH_KEY));
    if (isFinite(stored)) {
      return stored;
    }
  }
  let widest = ROW_WIDTH;
  for (const row of rows) {
    widest = Math.max(widest, row.width);
  }
  return widest;
}

// 行の中身を左上から詰め直す。順位は中心 x の昇順なので、ドラッグして
// 落とした位置がそのまま順位になり、落とした先の付箋と場所が入れ替わる。
// 横幅に収まらない分は折り返し、必要なら行の高さを伸ばす。
async function arrangeRow(row: SectionNode, targetWidth: number): Promise<void> {
  applyRowChrome(row);
  const label = await ensureLabel(row);
  const items = itemsOf(row);
  items.sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));

  const contentWidth = Math.max(targetWidth - LABEL_WIDTH - ITEM_PADDING * 2, 1);
  const lines: SceneNode[][] = [];
  let line: SceneNode[] = [];
  let lineWidth = 0;
  for (const item of items) {
    const widthWithItem = line.length === 0 ? item.width : lineWidth + ITEM_GAP + item.width;
    if (line.length > 0 && widthWithItem > contentWidth) {
      lines.push(line);
      line = [item];
      lineWidth = item.width;
    } else {
      line.push(item);
      lineWidth = widthWithItem;
    }
  }
  if (line.length > 0) {
    lines.push(line);
  }

  let needed = ROW_HEIGHT;
  const lineHeights: number[] = [];
  if (lines.length > 0) {
    let stacked = ITEM_PADDING * 2 + (lines.length - 1) * ITEM_GAP;
    for (const nodes of lines) {
      let tallest = 0;
      for (const node of nodes) {
        tallest = Math.max(tallest, node.height);
      }
      lineHeights.push(tallest);
      stacked += tallest;
    }
    needed = Math.max(Math.round(stacked), ROW_HEIGHT);
  }

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

  let cursorY = ITEM_PADDING;
  for (let i = 0; i < lines.length; i++) {
    let cursorX = LABEL_WIDTH + ITEM_PADDING;
    for (const item of lines[i]) {
      item.x = cursorX;
      item.y = cursorY;
      cursorX += item.width + ITEM_GAP;
    }
    cursorY += lineHeights[i] + ITEM_GAP;
  }

  if (targetWidth !== row.width || needed !== row.height) {
    row.resizeWithoutConstraints(targetWidth, needed);
  }
  row.setPluginData(TIER_WIDTH_KEY, String(targetWidth));
}

async function arrangeAll(): Promise<void> {
  const rows = getRows();
  const width = boardWidth(rows);
  for (const row of rows) {
    await arrangeRow(row, width);
  }
  relayout(rows);
}

async function runArrange(): Promise<void> {
  suppressUntil = Date.now() + ARRANGE_SUPPRESS_MS;
  await arrangeAll();
  suppressUntil = Date.now() + ARRANGE_SUPPRESS_MS;
  postRows();
}

function scheduleArrange(): void {
  if (arrangeTimer !== null) {
    clearTimeout(arrangeTimer);
  }
  arrangeTimer = setTimeout(() => {
    arrangeTimer = null;
    void runArrange();
  }, ARRANGE_DEBOUNCE_MS);
}

function postRows(): void {
  const rows = getRows().map((row) => ({
    id: row.id,
    name: row.name,
    color: row.getPluginData(TIER_COLOR_KEY) || FALLBACK_COLOR_KEY,
    count: itemsOf(row).length,
  }));
  figma.ui.postMessage({ type: 'rows', rows, presets: COLOR_PRESETS, autoArrange });
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

async function createBoard(): Promise<void> {
  if (getRows().length > 0) {
    figma.notify('このページには既に Tier 表があります');
    return;
  }
  const totalHeight = DEFAULT_TIERS.length * ROW_HEIGHT + (DEFAULT_TIERS.length - 1) * ROW_GAP;
  const origin = boardOrigin(totalHeight);

  const created: SectionNode[] = [];
  for (let i = 0; i < DEFAULT_TIERS.length; i++) {
    const tier = DEFAULT_TIERS[i];
    created.push(await createRow(tier.name, tier.color, origin.x, origin.y + i * (ROW_HEIGHT + ROW_GAP)));
  }
  figma.viewport.scrollAndZoomIntoView(created);
}

function nextRowName(rows: SectionNode[]): string {
  const used: { [name: string]: true } = {};
  for (const row of rows) {
    used[row.name] = true;
  }
  const alphabet = 'SABCDEFGHIJKLMNOPQRTUVWXYZ';
  for (const letter of alphabet) {
    if (used[letter] !== true) {
      return letter;
    }
  }
  return `Tier ${rows.length + 1}`;
}

async function addRow(): Promise<void> {
  const rows = getRows();
  if (rows.length === 0) {
    await createBoard();
    return;
  }
  const last = rows[rows.length - 1];
  const row = await createRow(nextRowName(rows), FALLBACK_COLOR_KEY, last.x, last.y + last.height + ROW_GAP);
  row.resizeWithoutConstraints(boardWidth(rows), ROW_HEIGHT);
  figma.viewport.scrollAndZoomIntoView([row]);
}

// セクションを消すと中の子ごと消えるため、先に中身を盤面の下へ逃がす。
// その場に残すと、隙間を詰めた行がそれを踏んで自動的に子にしてしまう。
function rescueItems(row: SectionNode, dropY: number): number {
  const destination = row.parent !== null ? row.parent : figma.currentPage;
  const items = itemsOf(row);
  for (const item of items) {
    const itemX = item.x;
    destination.appendChild(item);
    item.x = row.x + itemX;
    item.y = dropY;
  }
  return items.length;
}

async function deleteRow(id: string): Promise<void> {
  const row = await getRowById(id);
  if (row === null) {
    return;
  }
  const rows = getRows();
  let bottom = row.y + row.height;
  for (const other of rows) {
    bottom = Math.max(bottom, other.y + other.height);
  }
  const rescued = rescueItems(row, bottom + RESCUE_MARGIN);
  row.remove();
  relayout(getRows());
  if (rescued > 0) {
    figma.notify(`${rescued} 個のアイテムを盤面の下に移しました`);
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

// 配列上で順序を入れ替えたあと、全行の y を詰め直す。
async function moveRow(id: string, direction: 'up' | 'down'): Promise<void> {
  const rows = getRows();
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) {
    return;
  }
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= rows.length) {
    return;
  }
  const swapped = rows[index];
  rows[index] = rows[target];
  rows[target] = swapped;
  relayout(rows);
}

// パネル上でドラッグ&ドロップされた順序をそのまま反映する。パネルが把握して
// いない行がページにあってもいいように、渡された ID の順に並べ、残りは
// 現在の順序のまま後ろへ回す。
function reorderRows(ids: string[]): void {
  const rows = getRows();
  const ordered: SectionNode[] = [];
  for (const id of ids) {
    const row = rows.find((candidate) => candidate.id === id);
    if (row !== undefined && ordered.indexOf(row) < 0) {
      ordered.push(row);
    }
  }
  for (const row of rows) {
    if (ordered.indexOf(row) < 0) {
      ordered.push(row);
    }
  }
  relayout(ordered);
}

async function setAutoArrange(enabled: boolean): Promise<void> {
  autoArrange = enabled;
  await figma.clientStorage.setAsync(AUTO_ARRANGE_KEY, enabled);
  if (enabled) {
    await runArrange();
  }
}

interface UiMessage {
  type: string;
  id?: string;
  ids?: string[];
  name?: string;
  color?: string;
  direction?: 'up' | 'down';
  enabled?: boolean;
}

figma.showUI(__html__, { width: 340, height: 520, themeColors: true });

figma.ui.onmessage = async (message: UiMessage) => {
  switch (message.type) {
    case 'init':
      break;
    case 'create-board':
      await createBoard();
      break;
    case 'add-row':
      await addRow();
      break;
    case 'delete-row':
      await deleteRow(message.id as string);
      break;
    case 'rename-row':
      await renameRow(message.id as string, message.name as string);
      break;
    case 'set-color':
      await setRowColor(message.id as string, message.color as string);
      break;
    case 'move-row':
      await moveRow(message.id as string, message.direction as 'up' | 'down');
      break;
    case 'reorder-rows':
      reorderRows(message.ids as string[]);
      break;
    case 'arrange-now':
      await runArrange();
      return;
    case 'set-auto-arrange':
      await setAutoArrange(message.enabled === true);
      break;
    default:
      break;
  }
  if (autoArrange) {
    scheduleArrange();
  }
  postRows();
};

// キャンバス側の操作を拾って整列する。REMOTE（他の参加者の操作）に反応すると
// 全員が同じ行を奪い合って動かし続けるので、自分の操作だけを見る。
figma.currentPage.on('nodechange', (event: NodeChangeEvent) => {
  if (!autoArrange || Date.now() < suppressUntil) {
    return;
  }
  for (const change of event.nodeChanges) {
    if (change.origin === 'LOCAL') {
      scheduleArrange();
      return;
    }
  }
});

(async () => {
  const stored = await figma.clientStorage.getAsync(AUTO_ARRANGE_KEY);
  autoArrange = stored !== false;
  postRows();
})();

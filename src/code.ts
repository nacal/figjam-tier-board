// FigJam Tier表プラグイン
//
// 行（ティア）は SectionNode で表現する。セクションは幾何的に内包したノードを
// 自動的に子にするため、付箋の所属判定は parent を見るだけで済む。
// 行の順序はキャンバス上の y 座標を唯一の正とし、順序リストは保存しない。
// 行の中の順位は付箋の中心 x を唯一の正とし、左から詰めて整列する。

const TIER_FLAG_KEY = 'figjamTierRow';
const TIER_COLOR_KEY = 'figjamTierColor';
const AUTO_ARRANGE_KEY = 'autoArrange';

// 既定幅は 240px の付箋がちょうど 6 枚入る値。
// ITEM_PADDING * 2 + 240 * 6 + ITEM_GAP * 5 = 1608
const ROW_WIDTH = 1608;
const ROW_HEIGHT = 300;
const ROW_GAP = 40;
const BOARD_MARGIN = 160;

const ITEM_PADDING = 24;
const ITEM_GAP = 24;

// ドラッグ中に整列が割り込むと掴んでいる付箋が飛ぶので、変更が落ち着いてから走らせる。
const ARRANGE_DEBOUNCE_MS = 320;
// 整列そのものが nodechange を起こす。その反響を無視するための窓。
const ARRANGE_SUPPRESS_MS = 400;

const DEFAULT_TIERS: Array<{ name: string; color: string }> = [
  { name: 'S', color: 'red' },
  { name: 'A', color: 'orange' },
  { name: 'B', color: 'yellow' },
  { name: 'C', color: 'green' },
  { name: 'D', color: 'blue' },
];

interface ColorPreset {
  key: string;
  label: string;
  hex: string;
}

const COLOR_PRESETS: ColorPreset[] = [
  { key: 'red', label: 'レッド', hex: '#FFB3B3' },
  { key: 'orange', label: 'オレンジ', hex: '#FFD3A6' },
  { key: 'yellow', label: 'イエロー', hex: '#FFEFA8' },
  { key: 'green', label: 'グリーン', hex: '#BCE6B4' },
  { key: 'blue', label: 'ブルー', hex: '#AFD6F5' },
  { key: 'purple', label: 'パープル', hex: '#D6C3F2' },
  { key: 'gray', label: 'グレー', hex: '#E4E4E4' },
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

function applyColor(row: SectionNode, key: string): void {
  const preset = findPreset(key);
  row.fills = [{ type: 'SOLID', color: hexToRgb(preset.hex) }];
  row.setPluginData(TIER_COLOR_KEY, preset.key);
}

function createRow(name: string, colorKey: string, x: number, y: number): SectionNode {
  const row = figma.createSection();
  row.name = name;
  row.setPluginData(TIER_FLAG_KEY, '1');
  row.resizeWithoutConstraints(ROW_WIDTH, ROW_HEIGHT);
  row.x = x;
  row.y = y;
  applyColor(row, colorKey);
  figma.currentPage.appendChild(row);
  return row;
}

// 与えられた順序で全行の y を上から詰め直す。行の高さは整列やユーザー操作で
// 変わっているので、実際の高さを積み上げて配置する。
//
// 基準は「今ある行の左上」であって、新しい順序の先頭に来た行が今いる場所では
// ない。後者を基準にすると、並べ替えのたびに盤面ごとその行の位置へ飛んでいく。
function relayout(rows: SectionNode[]): void {
  if (rows.length === 0) {
    return;
  }
  // 盤面の原点は「今いちばん上にある行」の左上。全行の最小 x を取ると、
  // 誰かが1行だけ横へずらしたときに盤面ごとそちらへ引っ張られてしまう。
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

// 行の中身を左上から詰め直す。順位は中心 x の昇順なので、ドラッグして
// 落とした位置がそのまま順位になり、落とした先の付箋と場所が入れ替わる。
// 横幅に収まらない分は折り返し、必要なら行の高さを伸ばす。
function arrangeRow(row: SectionNode): void {
  const items = row.children.slice();
  if (items.length === 0) {
    if (row.height !== ROW_HEIGHT) {
      row.resizeWithoutConstraints(row.width, ROW_HEIGHT);
    }
    return;
  }

  items.sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));

  const contentWidth = Math.max(row.width - ITEM_PADDING * 2, 1);
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
  lines.push(line);

  const lineHeights = lines.map((nodes) => {
    let tallest = 0;
    for (const node of nodes) {
      tallest = Math.max(tallest, node.height);
    }
    return tallest;
  });

  let needed = ITEM_PADDING * 2 + (lines.length - 1) * ITEM_GAP;
  for (const height of lineHeights) {
    needed += height;
  }
  needed = Math.max(Math.round(needed), ROW_HEIGHT);

  // 縮めるのは配置後。先に縮めるとセクションの外に出た付箋が行から抜けてしまう。
  if (needed > row.height) {
    row.resizeWithoutConstraints(row.width, needed);
  }

  let cursorY = ITEM_PADDING;
  for (let i = 0; i < lines.length; i++) {
    let cursorX = ITEM_PADDING;
    for (const item of lines[i]) {
      item.x = cursorX;
      item.y = cursorY;
      cursorX += item.width + ITEM_GAP;
    }
    cursorY += lineHeights[i] + ITEM_GAP;
  }

  if (needed < row.height) {
    row.resizeWithoutConstraints(row.width, needed);
  }
}

function arrangeAll(): void {
  const rows = getRows();
  for (const row of rows) {
    arrangeRow(row);
  }
  relayout(rows);
}

function runArrange(): void {
  suppressUntil = Date.now() + ARRANGE_SUPPRESS_MS;
  arrangeAll();
  postRows();
}

function scheduleArrange(): void {
  if (arrangeTimer !== null) {
    clearTimeout(arrangeTimer);
  }
  arrangeTimer = setTimeout(() => {
    arrangeTimer = null;
    runArrange();
  }, ARRANGE_DEBOUNCE_MS);
}

function postRows(): void {
  const rows = getRows().map((row) => ({
    id: row.id,
    name: row.name,
    color: row.getPluginData(TIER_COLOR_KEY) || FALLBACK_COLOR_KEY,
    count: row.children.length,
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

function createBoard(): void {
  if (getRows().length > 0) {
    figma.notify('このページには既に Tier 表があります');
    return;
  }
  const totalHeight = DEFAULT_TIERS.length * ROW_HEIGHT + (DEFAULT_TIERS.length - 1) * ROW_GAP;
  const origin = boardOrigin(totalHeight);

  const created: SectionNode[] = [];
  DEFAULT_TIERS.forEach((tier, index) => {
    created.push(createRow(tier.name, tier.color, origin.x, origin.y + index * (ROW_HEIGHT + ROW_GAP)));
  });
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

function addRow(): void {
  const rows = getRows();
  if (rows.length === 0) {
    createBoard();
    return;
  }
  const last = rows[rows.length - 1];
  const row = createRow(nextRowName(rows), FALLBACK_COLOR_KEY, last.x, last.y + last.height + ROW_GAP);
  figma.viewport.scrollAndZoomIntoView([row]);
}

// セクションを消すと中の子ごと消えるため、先に子を絶対座標を保ったまま
// セクションの親（通常はページ）へ退避させる。
function detachChildren(row: SectionNode): void {
  const destination = row.parent !== null ? row.parent : figma.currentPage;
  const offsetX = row.x;
  const offsetY = row.y;
  for (const child of row.children.slice()) {
    const childX = child.x;
    const childY = child.y;
    destination.appendChild(child);
    child.x = offsetX + childX;
    child.y = offsetY + childY;
  }
}

// 削除後は詰め直さない。退避した付箋の上に下の行がずり上がってくると、
// セクションがそれを自動的に子にしてしまい、意図しないティアへ移ってしまうため。
// 空いた隙間は、ユーザーが付箋をどけたあと並び替え操作をすれば詰まる。
async function deleteRow(id: string): Promise<void> {
  const row = await getRowById(id);
  if (row === null) {
    return;
  }
  const rescued = row.children.length;
  detachChildren(row);
  row.remove();
  if (rescued > 0) {
    figma.notify(`${rescued} 個のアイテムをキャンバスに残しました`);
  }
}

async function renameRow(id: string, name: string): Promise<void> {
  const row = await getRowById(id);
  if (row === null) {
    return;
  }
  const trimmed = name.trim();
  row.name = trimmed.length > 0 ? trimmed : row.name;
}

async function setRowColor(id: string, colorKey: string): Promise<void> {
  const row = await getRowById(id);
  if (row === null) {
    return;
  }
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
    runArrange();
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
      createBoard();
      break;
    case 'add-row':
      addRow();
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
      runArrange();
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

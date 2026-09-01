// FigJam Tier表プラグイン
//
// 行（ティア）は SectionNode で表現する。セクションは幾何的に内包したノードを
// 自動的に子にするため、付箋の所属判定は parent を見るだけで済む。
// 行の順序はキャンバス上の y 座標を唯一の正とし、順序リストは保存しない。

const TIER_FLAG_KEY = 'figjamTierRow';
const TIER_COLOR_KEY = 'figjamTierColor';

const ROW_WIDTH = 1600;
const ROW_HEIGHT = 300;
const ROW_GAP = 40;

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
  return findPresetOrThrow(FALLBACK_COLOR_KEY);
}

function findPresetOrThrow(key: string): ColorPreset {
  for (const preset of COLOR_PRESETS) {
    if (preset.key === key) {
      return preset;
    }
  }
  throw new Error(`unknown color preset: ${key}`);
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

// 与えられた順序で全行の y を上から詰め直す。行の高さはユーザーが変えている
// 可能性があるため、実際の高さを積み上げて配置する。
function relayout(rows: SectionNode[]): void {
  if (rows.length === 0) {
    return;
  }
  const anchorX = rows[0].x;
  let cursorY = rows[0].y;
  for (const row of rows) {
    row.x = anchorX;
    row.y = cursorY;
    cursorY += row.height + ROW_GAP;
  }
}

function postRows(): void {
  const rows = getRows().map((row) => ({
    id: row.id,
    name: row.name,
    color: row.getPluginData(TIER_COLOR_KEY) || FALLBACK_COLOR_KEY,
  }));
  figma.ui.postMessage({ type: 'rows', rows, presets: COLOR_PRESETS });
}

async function getRowById(id: string): Promise<SectionNode | null> {
  const node = await figma.getNodeByIdAsync(id);
  if (node === null || !isTierRow(node)) {
    return null;
  }
  return node;
}

function createBoard(): void {
  if (getRows().length > 0) {
    figma.notify('このページには既に Tier 表があります');
    return;
  }
  const totalHeight = DEFAULT_TIERS.length * ROW_HEIGHT + (DEFAULT_TIERS.length - 1) * ROW_GAP;
  const center = figma.viewport.center;
  const startX = Math.round(center.x - ROW_WIDTH / 2);
  const startY = Math.round(center.y - totalHeight / 2);

  const created: SectionNode[] = [];
  DEFAULT_TIERS.forEach((tier, index) => {
    created.push(createRow(tier.name, tier.color, startX, startY + index * (ROW_HEIGHT + ROW_GAP)));
  });
  figma.viewport.scrollAndZoomIntoView(created);
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

figma.showUI(__html__, { width: 320, height: 460, themeColors: true });

figma.ui.onmessage = async (message: { type: string; id?: string; name?: string; color?: string; direction?: 'up' | 'down' }) => {
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
    default:
      break;
  }
  postRows();
};

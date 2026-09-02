// 行の並び順。Figma のノードには触らない。

export interface Sized {
  y: number;
  height: number;
}

export interface Identified {
  id: string;
}

// 行の順番はキャンバス上の並びを正とする。中心で比べる ── 上端で比べると、
// 行の高さぶん以上動かさないと入れ替わらない。
export function byVerticalCenter<T extends Sized>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
}

// 上から隙間なく積んだときの y。
export function stackPositions(heights: number[], gap: number, offsetY: number): number[] {
  const positions: number[] = [];
  let cursor = offsetY;
  for (const height of heights) {
    positions.push(cursor);
    cursor += height + gap;
  }
  return positions;
}

// ひとつ上／下と入れ替える。端なら何もしない。
export function swapNeighbour<T>(items: T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return items.slice();
  }
  const next = items.slice();
  const swapped = next[index];
  next[index] = next[target];
  next[target] = swapped;
  return next;
}

// 渡された ID の順に並べ、残りは現在の順序のまま後ろへ回す。パネルが把握して
// いない行が盤面にあってもいいようにするため。
export function applyOrder<T extends Identified>(items: T[], ids: string[]): T[] {
  const ordered: T[] = [];
  for (const id of ids) {
    const item = items.find((candidate) => candidate.id === id);
    if (item !== undefined && ordered.indexOf(item) < 0) {
      ordered.push(item);
    }
  }
  for (const item of items) {
    if (ordered.indexOf(item) < 0) {
      ordered.push(item);
    }
  }
  return ordered;
}

// 盤面の幅。ユーザーがどれか1行の幅を変えたら、それを全行に広げる。
// 「変えた行」は、前回書き込んでおいた幅と実際の幅が食い違う行として見つける。
export function resolveBoardWidth(
  rows: Array<{ width: number; stored: number | null }>,
  fallback: number,
): number {
  for (const row of rows) {
    if (row.stored !== null && Math.abs(row.stored - row.width) > 0.5) {
      return row.width;
    }
  }
  for (const row of rows) {
    if (row.stored !== null) {
      return row.stored;
    }
  }
  let widest = fallback;
  for (const row of rows) {
    widest = Math.max(widest, row.width);
  }
  return widest;
}

// 追加する行の名前。S から順に、使われていない文字を採る。
export function nextRowName(used: string[], fallbackIndex: number): string {
  const alphabet = 'SABCDEFGHIJKLMNOPQRTUVWXYZ';
  for (const letter of alphabet) {
    if (used.indexOf(letter) < 0) {
      return letter;
    }
  }
  return `Tier ${fallbackIndex}`;
}

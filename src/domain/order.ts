export interface Sized {
  y: number;
  height: number;
}

export interface Identified {
  id: string;
}

// Rows are ordered by vertical centre. Comparing top edges would require
// dragging a row further than its own height before it changed places.
export function byVerticalCenter<T extends Sized>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
}

export function stackPositions(heights: number[], gap: number, offsetY: number): number[] {
  const positions: number[] = [];
  let cursor = offsetY;
  for (const height of heights) {
    positions.push(cursor);
    cursor += height + gap;
  }
  return positions;
}

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

// Items not named in `ids` keep their relative order at the end, so a row the
// panel does not know about still survives a reorder.
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

// The row the user resized is the one whose actual width no longer matches the
// width last written to it; that width becomes the width of the whole board.
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

export function nextRowName(used: string[], fallbackIndex: number): string {
  const alphabet = 'SABCDEFGHIJKLMNOPQRTUVWXYZ';
  for (const letter of alphabet) {
    if (used.indexOf(letter) < 0) {
      return letter;
    }
  }
  return `Tier ${fallbackIndex}`;
}

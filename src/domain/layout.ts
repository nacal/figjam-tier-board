export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
}

export interface RowMetrics {
  labelWidth: number;
  padding: number;
  gap: number;
  minHeight: number;
  /** Items whose top edges are farther apart than this belong to different lines. */
  lineTolerance: number;
}

export interface RowLayout<T> {
  /** Items in reading order. */
  items: T[];
  /** Where to put each item, relative to the row's top left. Parallel to `items`. */
  placements: Placement[];
  height: number;
}

// Reading order: upper line first, leftmost first within a line.
//
// Never order by horizontal centre alone. Once a row wraps, the leftmost item of
// the second line sits at the same x as the leftmost item of the first, so the
// lines interleave differently on every pass. A different order means different
// positions, and different positions trigger another arrange — a wrapped row
// then reflows forever.
//
// Lines are detected by top edge, not centre. Items on a line share a top edge
// once arranged, whereas a tall sticky shifts the centre far enough to be read
// as its own line, which brings back the same endless reflow.
export function readingOrder<T extends Box>(items: T[], lineTolerance: number): T[] {
  const byLine = items.slice().sort((a, b) => a.y - b.y);
  const lines: T[][] = [];
  let lineTop = 0;
  for (const item of byLine) {
    if (lines.length > 0 && Math.abs(item.y - lineTop) <= lineTolerance) {
      lines[lines.length - 1].push(item);
    } else {
      lines.push([item]);
      lineTop = item.y;
    }
  }
  const ordered: T[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));
    for (const item of line) {
      ordered.push(item);
    }
  }
  return ordered;
}

export function layoutRow<T extends Box>(
  items: T[],
  targetWidth: number,
  metrics: RowMetrics,
): RowLayout<T> {
  const ordered = readingOrder(items, metrics.lineTolerance);
  const contentWidth = Math.max(targetWidth - metrics.labelWidth - metrics.padding * 2, 1);

  // Break the reading order into lines that fit the content width.
  const lines: T[][] = [];
  let line: T[] = [];
  let lineWidth = 0;
  for (const item of ordered) {
    const widthWithItem = line.length === 0 ? item.width : lineWidth + metrics.gap + item.width;
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

  const lineHeights = lines.map((nodes) => {
    let tallest = 0;
    for (const node of nodes) {
      tallest = Math.max(tallest, node.height);
    }
    return tallest;
  });

  let height = metrics.minHeight;
  if (lines.length > 0) {
    let stacked = metrics.padding * 2 + (lines.length - 1) * metrics.gap;
    for (const lineHeight of lineHeights) {
      stacked += lineHeight;
    }
    height = Math.max(Math.round(stacked), metrics.minHeight);
  }

  // Pack each line from the right edge of the tier label.
  const placements: Placement[] = [];
  let cursorY = metrics.padding;
  lines.forEach((nodes, index) => {
    let cursorX = metrics.labelWidth + metrics.padding;
    for (const item of nodes) {
      placements.push({ x: cursorX, y: cursorY });
      cursorX += item.width + metrics.gap;
    }
    cursorY += lineHeights[index] + metrics.gap;
  });

  return { items: ordered, placements, height };
}

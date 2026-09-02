// 行の中身の並べ方。Figma のノードには触らない ── 矩形の並びを受け取って、
// 矩形の置き場所を返すだけ。ここが正しいことはモックなしで確かめられる。

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
  /** 色セルの幅 */
  labelWidth: number;
  /** 行の内側の余白 */
  padding: number;
  /** アイテムどうしの間隔 */
  gap: number;
  /** 行の最小の高さ */
  minHeight: number;
  /** 上端がこれだけ離れていたら別の段とみなす */
  lineTolerance: number;
}

export interface RowLayout<T> {
  /** 読み順に並べ直したアイテム */
  items: T[];
  /** items と同じ順の置き場所（行の左上からの相対） */
  placements: Placement[];
  /** 中身を収めるのに必要な行の高さ */
  height: number;
}

// 行の中の読み順。上の段が先、同じ段では左が先。
//
// 中心 x だけで並べてはいけない。折り返すと2段目の左端と1段目の左端が同じ x
// になり、並べるたびに段が混ざって順序が変わる。順序が変われば位置も変わり、
// 位置が変われば整列がまた走る ── 2段以上ある行が延々と並び直し続ける。
//
// 段の判定は上端で行う。整列後は同じ段の上端が揃うため。中心で見ると、文字が
// 多くて背の高い付箋が同じ段にいるだけで中心がずれ、別の段と判定されて上と
// 同じ無限ループになる。
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

// 読み順に読んで、色セルの右から左上に詰める。横幅に収まらない分は折り返す。
export function layoutRow<T extends Box>(
  items: T[],
  targetWidth: number,
  metrics: RowMetrics,
): RowLayout<T> {
  const ordered = readingOrder(items, metrics.lineTolerance);
  const contentWidth = Math.max(targetWidth - metrics.labelWidth - metrics.padding * 2, 1);

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

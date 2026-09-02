// 次の整列で何をどれだけ待って並べ直すか。module 変数に散らすとステートマシンが
// 見えなくなるので、ひとつのオブジェクトに閉じる。Figma のノードには触らない。

export interface ArrangeRequest {
  /** 並べ直す行。null なら全部 */
  targets: string[] | null;
  /** 行そのものが動かされたか（迷子の付箋を元の行へ返すかの判断に使う） */
  rowDragged: boolean;
}

export class ArrangeQueue {
  private rowIds: string[] = [];
  private all = false;
  private rowDragged = false;
  private delay: number;

  constructor(private readonly defaultDelay: number) {
    this.delay = defaultDelay;
  }

  markRow(rowId: string): void {
    if (this.rowIds.indexOf(rowId) < 0) {
      this.rowIds.push(rowId);
    }
  }

  markAll(): void {
    this.all = true;
  }

  markRowDragged(): void {
    this.rowDragged = true;
  }

  // 待ち時間はいちばん長いものに合わせる。行が動いているあいだに付箋の変更が
  // 混ざっても、行の並べ替えが割り込まないようにする。
  requestDelay(delay: number): void {
    this.delay = Math.max(this.delay, delay);
  }

  get pendingDelay(): number {
    return this.delay;
  }

  get isEmpty(): boolean {
    return this.all === false && this.rowIds.length === 0;
  }

  take(): ArrangeRequest {
    const request: ArrangeRequest = {
      targets: this.all ? null : this.rowIds,
      rowDragged: this.rowDragged,
    };
    this.rowIds = [];
    this.all = false;
    this.rowDragged = false;
    this.delay = this.defaultDelay;
    return request;
  }
}

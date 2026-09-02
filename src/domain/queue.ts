export interface ArrangeRequest {
  /** Rows to rearrange, or null for every row. */
  targets: string[] | null;
  /** Whether a row itself was moved, which decides if stray stickies go home. */
  rowDragged: boolean;
}

// Holds what the next arrange should touch and how long to wait for it. Kept in
// one object because spread across module variables the state machine is
// invisible and untestable.
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

  // Takes the longest requested delay, so a sticky change arriving mid row-drag
  // cannot make the reorder cut in early.
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

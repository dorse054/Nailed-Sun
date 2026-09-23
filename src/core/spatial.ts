/**
 * Uniform-grid spatial hash over item indices, rebuilt every tick.
 * Linked lists in typed arrays keep it allocation-free.
 */
export class SpatialHash {
  readonly cols: number;
  readonly rows: number;
  /** Cell list heads and per-item links; exposed for tight loops. */
  head: Int32Array;
  next: Int32Array;
  /** Cell index of each inserted item. */
  cellOfItem: Int32Array;
  private touched: Int32Array;
  private touchedCount = 0;
  private xs: Float64Array;
  private ys: Float64Array;
  private readonly inv: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cellSize: number,
    capacity: number,
  ) {
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
    this.cellOfItem = new Int32Array(capacity).fill(-1);
    this.touched = new Int32Array(this.cols * this.rows);
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
    this.inv = 1 / cellSize;
  }

  ensureCapacity(n: number): void {
    if (n <= this.next.length) return;
    const cap = Math.max(n, this.next.length * 2);
    this.next = new Int32Array(cap).fill(-1);
    this.cellOfItem = new Int32Array(cap).fill(-1);
    this.xs = new Float64Array(cap);
    this.ys = new Float64Array(cap);
  }

  /** Reset only the cells used since the last clear. */
  clear(): void {
    const head = this.head;
    const t = this.touched;
    for (let k = 0; k < this.touchedCount; k++) head[t[k]!] = -1;
    this.touchedCount = 0;
    this.cellOfItem.fill(-1);
  }

  private cellOf(x: number, y: number): number {
    let cx = Math.floor(x * this.inv);
    let cy = Math.floor(y * this.inv);
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  insert(i: number, x: number, y: number): void {
    const c = this.cellOf(x, y);
    this.xs[i] = x;
    this.ys[i] = y;
    const h = this.head[c]!;
    if (h === -1) this.touched[this.touchedCount++] = c;
    this.next[i] = h;
    this.head[c] = i;
    this.cellOfItem[i] = c;
  }

  /**
   * Visit every item within radius r of (x, y). Return true from the visitor
   * to stop early. Visiting order is deterministic.
   */
  query(x: number, y: number, r: number, visit: (i: number, d2: number) => boolean | void): void {
    const r2 = r * r;
    let x0 = Math.floor((x - r) * this.inv);
    let x1 = Math.floor((x + r) * this.inv);
    let y0 = Math.floor((y - r) * this.inv);
    let y1 = Math.floor((y + r) * this.inv);
    // Items outside the grid are stored in its edge cells (see cellOf), so clamp both ends of the
    // cell range into the grid: a query lying wholly outside must still scan the nearest edge cells.
    const cmax = this.cols - 1;
    const rmax = this.rows - 1;
    x0 = x0 < 0 ? 0 : x0 > cmax ? cmax : x0;
    x1 = x1 < 0 ? 0 : x1 > cmax ? cmax : x1;
    y0 = y0 < 0 ? 0 : y0 > rmax ? rmax : y0;
    y1 = y1 < 0 ? 0 : y1 > rmax ? rmax : y1;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.head[cy * this.cols + cx]!;
        while (i !== -1) {
          const dx = this.xs[i]! - x;
          const dy = this.ys[i]! - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2 && visit(i, d2) === true) return;
          i = this.next[i]!;
        }
      }
    }
  }
}

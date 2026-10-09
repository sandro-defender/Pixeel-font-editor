/**
 * Mutable pixel bitmap used by the matrix editor.
 * Row 0 is the BOTTOM row (font-coordinate friendly). cells[y*width + x] ∈ {0,1}.
 */
export const MAX_GRID = 128; // hard performance limit for custom grids

export class Bitmap {
  width: number;
  height: number;
  cells: Uint8Array;

  constructor(width: number, height: number, cells?: Uint8Array) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Bitmap dimensions must be positive integers');
    }
    if (width > MAX_GRID || height > MAX_GRID) {
      throw new Error(`Grid size is limited to ${MAX_GRID}×${MAX_GRID} for performance`);
    }
    this.width = width;
    this.height = height;
    this.cells = cells ? cells : new Uint8Array(width * height);
    if (this.cells.length !== width * height) throw new Error('Cell data size mismatch');
  }

  static fromB64(width: number, height: number, b64: string): Bitmap {
    return new Bitmap(width, height, b64ToBytes(b64));
  }

  toB64(): string {
    return bytesToB64(this.cells);
  }

  clone(): Bitmap {
    return new Bitmap(this.width, this.height, this.cells.slice());
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.cells[y * this.width + x];
  }

  set(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cells[y * this.width + x] = v ? 1 : 0;
  }

  toggle(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    this.cells[i] = this.cells[i] ? 0 : 1;
  }

  clear(value = 0): void {
    this.cells.fill(value ? 1 : 0);
  }

  invert(): void {
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = this.cells[i] ? 0 : 1;
  }

  /** Bresenham line between two cells (sets `value`). */
  line(x0: number, y0: number, x1: number, y1: number, value: number): void {
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.set(x, y, value);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Rectangle outline (or filled when `filled`). Coordinates inclusive. */
  rect(x0: number, y0: number, x1: number, y1: number, value: number, filled = false): void {
    const xa = Math.min(x0, x1);
    const xb = Math.max(x0, x1);
    const ya = Math.min(y0, y1);
    const yb = Math.max(y0, y1);
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        if (filled || x === xa || x === xb || y === ya || y === yb) this.set(x, y, value);
      }
    }
  }

  /** 4-neighbour flood fill starting at (x, y). */
  floodFill(x: number, y: number, value: number): void {
    const target = this.get(x, y);
    if (target === value) return;
    const stack: Array<[number, number]> = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (this.get(cx, cy) !== target) continue;
      this.set(cx, cy, value);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  /** Shift all pixels by (dx, dy); vacated cells become 0. Returns this. */
  shift(dx: number, dy: number): Bitmap {
    const src = this.cells.slice();
    this.cells.fill(0);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < this.width && ny < this.height) {
          this.cells[ny * this.width + nx] = src[y * this.width + x];
        }
      }
    }
    return this;
  }

  flipHorizontal(): Bitmap {
    const src = this.cells.slice();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.cells[y * this.width + (this.width - 1 - x)] = src[y * this.width + x];
      }
    }
    return this;
  }

  flipVertical(): Bitmap {
    const src = this.cells.slice();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.cells[(this.height - 1 - y) * this.width + x] = src[y * this.width + x];
      }
    }
    return this;
  }

  /** Rotate 90° counter-clockwise. Result has swapped dimensions. */
  rotate90(): Bitmap {
    const out = new Bitmap(this.height, this.width);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // (x, y) -> (y, width-1-x) for CCW rotation
        out.set(y, this.width - 1 - x, this.get(x, y));
      }
    }
    this.width = out.width;
    this.height = out.height;
    this.cells = out.cells;
    return this;
  }

  count(): number {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) n += this.cells[i];
    return n;
  }

  isEmpty(): boolean {
    return this.count() === 0;
  }

  /** Bounding box of filled pixels, or null when empty. */
  bounds(): { x: number; y: number; w: number; h: number } | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.get(x, y)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minX === Infinity) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /** Paste `other` with its top-left at (dx, dy), clipped to this grid. */
  paste(other: Bitmap, dx: number, dy: number, mode: 'replace' | 'or' = 'replace'): void {
    for (let y = 0; y < other.height; y++) {
      for (let x = 0; x < other.width; x++) {
        const v = other.get(x, y);
        if (!v) continue;
        const tx = dx + x;
        const ty = dy + y;
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
        if (mode === 'or') this.set(tx, ty, 1);
        else {
          // replace mode clears destination area first (handled by caller via eraseRect)
          this.set(tx, ty, 1);
        }
      }
    }
  }

  extract(x: number, y: number, w: number, h: number): Bitmap {
    const out = new Bitmap(Math.max(1, w), Math.max(1, h));
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) out.set(xx, yy, this.get(x + xx, y + yy));
    }
    return out;
  }

  /**
   * Resize to a new size.
   *  - 'crop': keep the bottom-left anchored region (baseline-stable); pad with 0.
   *  - 'center': crop/pad anchored to the center.
   *  - 'resample': nearest-neighbour resample (may alias, never distorts aspect).
   */
  resized(newW: number, newH: number, mode: 'crop' | 'center' | 'resample'): Bitmap {
    if (newW < 1 || newH < 1 || newW > MAX_GRID || newH > MAX_GRID) {
      throw new Error(`Target size must be 1..${MAX_GRID}`);
    }
    const out = new Bitmap(newW, newH);
    if (mode === 'resample') {
      for (let y = 0; y < newH; y++) {
        for (let x = 0; x < newW; x++) {
          const sx = Math.min(this.width - 1, Math.floor((x * this.width) / newW));
          const sy = Math.min(this.height - 1, Math.floor((y * this.height) / newH));
          out.set(x, y, this.get(sx, sy));
        }
      }
      return out;
    }
    // crop / pad
    const srcX = mode === 'center' ? Math.floor((this.width - newW) / 2) : 0;
    const srcY = mode === 'center' ? Math.floor((this.height - newH) / 2) : 0;
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        out.set(x, y, this.get(srcX + x, srcY + y));
      }
    }
    return out;
  }

  equals(other: Bitmap): boolean {
    if (this.width !== other.width || this.height !== other.height) return false;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] !== other.cells[i]) return false;
    return true;
  }
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  if (typeof btoa === 'function') return btoa(bin);
  return Buffer.from(bytes).toString('base64');
}

export function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** World (meters) to screen (CSS pixels) camera with pan and zoom. */
export class Camera {
  x = 700;
  y = 500;
  zoom = 1;
  minZoom = 0.35;
  maxZoom = 14;
  width = 800;
  height = 600;

  toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom + this.width / 2, y: (wy - this.y) * this.zoom + this.height / 2 };
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.width / 2) / this.zoom + this.x, y: (sy - this.height / 2) / this.zoom + this.y };
  }

  /** Zoom about a screen point, keeping the world point under it fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  fit(w: number, h: number, margin = 1.04): void {
    this.zoom = Math.min(this.width / (w * margin), this.height / (h * margin));
    this.minZoom = Math.min(0.35, this.zoom * 0.8);
    this.x = w / 2;
    this.y = h / 2;
  }

  clamp(w: number, h: number): void {
    const pad = 200;
    this.x = Math.max(-pad, Math.min(w + pad, this.x));
    this.y = Math.max(-pad, Math.min(h + pad, this.y));
  }

  visible(wx: number, wy: number, r: number): boolean {
    const hw = this.width / 2 / this.zoom + r;
    const hh = this.height / 2 / this.zoom + r;
    return wx > this.x - hw && wx < this.x + hw && wy > this.y - hh && wy < this.y + hh;
  }
}

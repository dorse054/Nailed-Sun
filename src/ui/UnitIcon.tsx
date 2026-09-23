import { useEffect, useRef } from 'preact/hooks';
import type { UnitDef } from '../data/schema';
import { factionDef } from '../data/index';
import { drawRoleIcon, spriteFor } from '../render/sprites';

/** Role icon on a faction-colored disc, or the unit's sprite. */
export function UnitIcon({ def, size = 36, side = 0, sprite = false }: { def: UnitDef; size?: number; side?: 0 | 1; sprite?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const pal = factionDef(def.faction).palette;
    if (sprite) {
      const sp = spriteFor(def, side);
      const scale = Math.min((size * 0.9) / sp.canvas.width, (size * 0.9) / sp.canvas.height);
      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.scale(scale, scale);
      ctx.drawImage(sp.canvas, -sp.canvas.width / 2, -sp.canvas.height / 2);
      ctx.restore();
      return;
    }
    const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    g.addColorStop(0, pal.secondary);
    g.addColorStop(1, pal.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pal.glow;
    ctx.lineWidth = 1;
    ctx.stroke();
    drawRoleIcon(ctx, def, size / 2, size / 2, size * 0.55, '#f5eedd');
  }, [def, size, side, sprite]);
  return <canvas ref={ref} style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" />;
}

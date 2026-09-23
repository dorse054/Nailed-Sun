import { useEffect, useRef } from 'preact/hooks';
import type { BattleSession } from './session';
import { saveSettings, settings } from '../store';

/** CSS width of the minimap; its height follows the field. */
const WIDTH = 200;

/**
 * The whole field at a glance: the ground, your units and the enemies you
 * can see, and the view. Click or drag to move the view. Large screens only.
 */
export function Minimap({ s }: { s: BattleSession }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 200) return;
      last = now;
      // The battle is rebuilt when it starts: read it fresh every time.
      const b = s.battle;
      const t = b.terrain;
      const r = s.renderer;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const h = Math.round((WIDTH * t.height) / t.width);
      if (c.width !== Math.round(WIDTH * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(WIDTH * dpr);
        c.height = Math.round(h * dpr);
        c.style.height = `${h}px`;
      }
      const k = (WIDTH * dpr) / t.width;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.drawImage(r.art.canvas, 0, 0, t.width, t.height);
      ctx.fillStyle = 'rgba(8, 6, 16, 0.3)';
      ctx.fillRect(0, 0, t.width, t.height);
      for (const u of b.units) {
        if (!r.shouldDraw(u)) continue;
        const size = u.def.category === 'colossus' ? 30 : u.def.category === 'character' ? 16 : 22;
        ctx.fillStyle = u.side === s.side ? '#7cc4ff' : '#ff6f5e';
        ctx.globalAlpha = u.state === 'routing' || u.state === 'shattered' ? 0.45 : 1;
        ctx.fillRect(u.x - size / 2, u.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      const cam = r.camera;
      const a = cam.toWorld(0, 0);
      const z = cam.toWorld(cam.width, cam.height);
      ctx.strokeStyle = 'rgba(255, 230, 160, 0.95)';
      ctx.lineWidth = 2.5 / k;
      ctx.strokeRect(a.x, a.y, z.x - a.x, z.y - a.y);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [s]);
  const look = (e: PointerEvent) => {
    const c = ref.current;
    if (!c) return;
    const box = c.getBoundingClientRect();
    const t = s.battle.terrain;
    const cam = s.renderer.camera;
    cam.x = Math.max(0, Math.min(t.width, ((e.clientX - box.left) / box.width) * t.width));
    cam.y = Math.max(0, Math.min(t.height, ((e.clientY - box.top) / box.height) * t.height));
  };
  return (
    <div class="panel minimap">
      <canvas
        ref={ref}
        aria-label="Minimap: click to move the view"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
          look(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) look(e);
        }}
      />
      <button class="btn small ghost minimap-hide" onClick={() => saveSettings({ ...settings.value, minimap: false })} title="Hide the minimap (Settings brings it back)" aria-label="Hide the minimap">
        ×
      </button>
    </div>
  );
}

/**
 * The Sun-and-Wind Rose: the compass shown at deployment and in battle.
 * Sun bearing, light level, wind (always sunward) and the long shadows.
 */
import { useEffect, useRef } from 'preact/hooks';
import type { LightLevel, WindLevel } from '../data/schema';
import { LIGHT_NAMES, WIND_NAMES } from '../data/schema';
import { LIGHT_RULES, WIND_RULES } from '../data/rules';

export interface RoseProps {
  sunBearing: number;
  light: LightLevel;
  wind: WindLevel;
  /** Direction your army faces, to show glare and wind at a glance. */
  facing?: number;
  size?: number;
}

export function Rose({ sunBearing, light, wind, facing, size = 84 }: RoseProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const R = size / 2 - 6;
      // Face.
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, light === 0 ? '#1a1e3a' : light === 1 ? '#2a2233' : light === 2 ? '#3a2a3c' : light === 3 ? '#4a3c2a' : '#5a5236');
      g.addColorStop(1, '#141020');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,226,180,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Ticks.
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const r0 = k % 4 === 0 ? R - 7 : R - 4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,226,180,0.7)';
      ctx.font = '600 9px "Alegreya Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('N', cx, cy - R + 16);
      const hasGlare = light === 2 || light === 3;
      // Glare cone: 45 degrees either side of the sun.
      if (hasGlare) {
        ctx.fillStyle = light === 2 ? 'rgba(255,150,60,0.22)' : 'rgba(255,240,190,0.18)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R - 1, sunBearing - Math.PI / 4, sunBearing + Math.PI / 4);
        ctx.closePath();
        ctx.fill();
      }
      // Shadows fall away from the sun.
      if (hasGlare) {
        ctx.strokeStyle = 'rgba(90,80,160,0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(sunBearing) * 6, cy - Math.sin(sunBearing) * 6);
        ctx.lineTo(cx - Math.cos(sunBearing) * (R - 10), cy - Math.sin(sunBearing) * (R - 10));
        ctx.stroke();
      }
      // Wind: always blows sunward; chevrons show strength.
      const wx = Math.cos(sunBearing);
      const wy = Math.sin(sunBearing);
      ctx.strokeStyle = '#dff1ff';
      ctx.lineWidth = 1.6;
      const phase = ((t / 1000) * (wind === 0 ? 0.2 : wind === 1 ? 0.6 : 1.2)) % 1;
      const n = wind + 1;
      for (let i = 0; i < n; i++) {
        const d = -R * 0.5 + ((i / n + phase) % 1) * R;
        const px = cx + wx * d;
        const py = cy + wy * d;
        ctx.beginPath();
        ctx.moveTo(px - wx * 5 - wy * 5, py - wy * 5 + wx * 5);
        ctx.lineTo(px, py);
        ctx.lineTo(px - wx * 5 + wy * 5, py - wy * 5 - wx * 5);
        ctx.stroke();
      }
      // Your army's facing.
      if (facing !== undefined) {
        ctx.strokeStyle = '#5aa9ff';
        ctx.fillStyle = '#5aa9ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(facing) * (R - 12), cy + Math.sin(facing) * (R - 12));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + Math.cos(facing) * (R - 12), cy + Math.sin(facing) * (R - 12), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // The sun: on the rim at dusk, overhead in the Glare, hidden below the rim in the dark.
      if (light === 4) {
        const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 12);
        sg.addColorStop(0, '#fffef0');
        sg.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const sx = cx + Math.cos(sunBearing) * (R - 1);
        const sy = cy + Math.sin(sunBearing) * (R - 1);
        const col = light === 0 ? '90,90,140' : light === 1 ? '220,70,50' : light === 2 ? '255,170,70' : '255,240,200';
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 11);
        sg.addColorStop(0, `rgba(${col},1)`);
        sg.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(sx, sy, 11, 0, Math.PI * 2);
        ctx.fill();
        if (light >= 2) {
          ctx.fillStyle = light === 2 ? '#ffc070' : '#fffbe6';
          ctx.beginPath();
          ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sunBearing, light, wind, facing, size]);
  return <canvas ref={ref} style={{ width: `${size}px`, height: `${size}px`, display: 'block' }} aria-label="Sun-and-Wind Rose" />;
}

/** Plain-language effects of the light and wind, with exact numbers. */
export function roseLines(light: LightLevel, wind: WindLevel): { light: string; lightFx: string; wind: string; windFx: string } {
  const L = LIGHT_RULES[light];
  const W = WIND_RULES[wind];
  const glare = L.glareAccuracyPct ? `Facing the sun: ${L.glareAccuracyPct}% accuracy${L.glareMa ? `, ${L.glareMa} melee attack` : ''}` : light === 4 ? 'Sun overhead: no glare; non-Choir tire 50% faster' : L.spotMult < 1 ? `Spotting ${Math.round((L.spotMult - 1) * 100)}%` : 'No glare';
  const beams = `Beams ${Math.round(L.beamMult * 100)}%`;
  return {
    light: LIGHT_NAMES[light],
    lightFx: `${glare}. ${beams}.`,
    wind: `${WIND_NAMES[wind]}, blowing sunward`,
    windFx: W.rangePct ? `Downwind +${W.rangePct}% range, upwind -${W.rangePct}%${W.accuracyPct ? `, ${W.accuracyPct}% accuracy` : ''}` : 'No effect on range',
  };
}

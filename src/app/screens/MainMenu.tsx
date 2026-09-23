import { useEffect, useRef, useState } from 'preact/hooks';
import { SettingsPanel } from './Settings';
import { go, settings } from '../store';
import { book } from '../book';
import { LEGENDS } from '../legends';

/** The Legends item's line: what they are, or how many are won. */
function legendLine(): string {
  const won = Object.keys(book.value.legends ?? {}).length;
  const todayWon = !!book.value.daily?.[dayKey()];
  if (!won) return todayWon ? 'Today’s battle won · six Legends wait' : 'Six great battles, and one each day';
  return `${won} of ${LEGENDS.length} won${todayWon ? '' : ' · today’s battle'}`;
}
import { dayKey } from '../daily';
import { claudeStatus } from '../claude';
import { TAGLINE } from '../../data/lore';
import { audio } from '../../audio/audio';
import { quickBattle, demoBattle } from '../quick';
import { completedTutorials } from '../tutorial/progress';
import { active, continueCampaign, savedCampaign } from '../campaign/session';
import { factionDef } from '../../data/index';

/**
 * The stopped sun: a horizon of eternal sunset with long, still shadows.
 * Every so often the Shudder: the sun slips and every shadow twitches.
 */
function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const spires = Array.from({ length: 26 }, (_, i) => ({
      x: (i / 26) * 1.1 - 0.05 + (Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.03,
      h: 0.05 + (Math.sin(i * 78.233) * 0.5 + 0.5) * 0.18,
      w: 0.006 + (Math.sin(i * 3.1) * 0.5 + 0.5) * 0.012,
    }));
    const start = performance.now();
    let last = -1e9;
    const draw = (now: number) => {
      // Slow twinkles and haze: 30 fps looks the same and costs half.
      if (now - last < 30) {
        raf = requestAnimationFrame(draw);
        return;
      }
      last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== Math.floor(W * dpr)) {
        c.width = Math.floor(W * dpr);
        c.height = Math.floor(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = (now - start) / 1000;
      // The Shudder: a brief twitch every 24 seconds.
      const phase = t % 24;
      const shudder = phase > 21.5 && phase < 22.3 ? Math.sin((phase - 21.5) * 40) * (1 - (phase - 21.5) / 0.8) : 0;
      const horizon = H * 0.66;
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, '#0b0918');
      sky.addColorStop(0.45, '#2a1838');
      sky.addColorStop(0.8, '#8a3a3a');
      sky.addColorStop(1, '#f0a050');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, horizon);
      // Stars on the night side.
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 90; i++) {
        const x = ((Math.sin(i * 91.3) * 0.5 + 0.5) * W) * 0.6;
        const y = (Math.sin(i * 47.7) * 0.5 + 0.5) * horizon * 0.5;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.7 + i));
        ctx.globalAlpha = tw * (1 - x / (W * 0.6));
        ctx.fillRect(x, y, 1.2, 1.2);
      }
      ctx.globalAlpha = 1;
      // The sun, half-set, pierced by the Nail.
      const sx = W * 0.72 + shudder * 6;
      const sy = horizon + H * 0.01;
      const R = Math.min(W, H) * 0.16;
      const glow = ctx.createRadialGradient(sx, sy, R * 0.2, sx, sy, R * 4);
      glow.addColorStop(0, 'rgba(255,210,120,0.55)');
      glow.addColorStop(0.3, 'rgba(255,140,60,0.2)');
      glow.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, horizon);
      const disc = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
      disc.addColorStop(0, '#fff3c8');
      disc.addColorStop(0.7, '#ffc46a');
      disc.addColorStop(1, '#f08a3a');
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(sx, sy, R, Math.PI, 0);
      ctx.fill();
      // The Nail: a spike of light driven through the sun.
      const nail = ctx.createLinearGradient(sx, sy - R * 2.6, sx, sy);
      nail.addColorStop(0, 'rgba(255,255,240,0)');
      nail.addColorStop(0.6, 'rgba(255,250,220,0.9)');
      nail.addColorStop(1, 'rgba(255,250,220,0.2)');
      ctx.fillStyle = nail;
      ctx.beginPath();
      ctx.moveTo(sx - 3, sy - R * 2.6);
      ctx.lineTo(sx + 3, sy - R * 2.6);
      ctx.lineTo(sx + 1, sy);
      ctx.lineTo(sx - 1, sy);
      ctx.fill();
      // Ground and long still shadows cast from spires, away from the sun.
      const ground = ctx.createLinearGradient(0, horizon, 0, H);
      ground.addColorStop(0, '#6a4630');
      ground.addColorStop(0.35, '#3a2a30');
      ground.addColorStop(1, '#141020');
      ctx.fillStyle = ground;
      ctx.fillRect(0, horizon, W, H - horizon);
      for (const sp of spires) {
        const x = sp.x * W;
        const h = sp.h * H;
        const w = sp.w * W;
        // Shadow: thrown away from the sun across the ground.
        const dx = x - sx;
        const len = H * 0.8;
        const ang = Math.atan2(len, dx) + shudder * 0.01;
        ctx.fillStyle = 'rgba(20,14,40,0.55)';
        ctx.beginPath();
        ctx.moveTo(x - w / 2, horizon);
        ctx.lineTo(x + w / 2, horizon);
        ctx.lineTo(x + Math.cos(ang) * len * 1.2 + w, horizon + Math.sin(ang) * len);
        ctx.lineTo(x + Math.cos(ang) * len * 1.2 - w * 2, horizon + Math.sin(ang) * len);
        ctx.fill();
        ctx.fillStyle = '#140e1e';
        ctx.beginPath();
        ctx.moveTo(x - w / 2, horizon);
        ctx.lineTo(x, horizon - h);
        ctx.lineTo(x + w / 2, horizon);
        ctx.fill();
        // Rim light on the sunward edge.
        ctx.strokeStyle = 'rgba(255,170,90,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + (dx < 0 ? w / 2 : -w / 2), horizon);
        ctx.lineTo(x, horizon - h);
        ctx.stroke();
      }
      // Heat haze band at the horizon.
      ctx.fillStyle = 'rgba(255,190,120,0.08)';
      for (let i = 0; i < 6; i++) ctx.fillRect(0, horizon - 2 + Math.sin(t * 2 + i) * 2 + i * 3, W, 1);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} class="backdrop" aria-hidden="true" />;
}

export function MainMenu() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // New players (no tutorial finished, no campaign begun) are pointed at the tutorials.
  const saved = active?.s ?? savedCampaign();
  const fresh = completedTutorials().size === 0 && !saved;
  const click = (f: () => void) => () => {
    audio.unlock();
    audio.ui('click');
    f();
  };
  return (
    <div class="screen">
      <Backdrop />
      <div class="menu">
        <h1 class="menu-title">Nailed Sun</h1>
        <p class="menu-tag">{TAGLINE}</p>
        <div class="menu-items">
          {saved && !saved.winner && saved.factions[saved.player].alive && (
            <button
              class="menu-item fresh"
              onClick={click(() => {
                if (!active) continueCampaign();
                go({ name: 'campaign' });
              })}
            >
              <b>Continue</b>
              <span>
                {factionDef(saved.player).name}, Toll {saved.turn}
              </span>
            </button>
          )}
          <button class="menu-item" onClick={click(() => go({ name: 'campaign' }))}>
            <b>Campaign</b>
            <span>{saved ? 'A new campaign, or your saved one' : 'Thirty regions and the Tilt'}</span>
          </button>
          <button class={`menu-item ${fresh ? 'fresh' : ''}`} onClick={click(() => go({ name: 'tutorials' }))}>
            <b>Tutorials</b>
            <span>{fresh ? 'New here? Start here' : 'One core idea per faction'}</span>
          </button>
          <button class="menu-item" onClick={click(() => quickBattle())}>
            <b>Quick Battle</b>
            <span>A random fight, right now</span>
          </button>
          <button class="menu-item" onClick={click(() => go({ name: 'legends' }))}>
            <b>Legends</b>
            <span>{legendLine()}</span>
          </button>
          <button class="menu-item" onClick={click(() => go({ name: 'custom' }))}>
            <b>Custom Battle</b>
            <span>Your armies, sun and wind</span>
          </button>
          <button class="menu-item" onClick={click(() => demoBattle())}>
            <b>Watch a Battle</b>
            <span>{settings.value.claudeAI && claudeStatus.value === 'ready' ? 'Two generals, advised by Claude' : 'Two scripted generals'}</span>
          </button>
          <button class="menu-item" onClick={click(() => go({ name: 'codex' }))}>
            <b>Codex</b>
            <span>How to play, the world and every unit</span>
          </button>
          <button class="menu-item" onClick={click(() => go({ name: 'chronicles' }))}>
            <b>Chronicles</b>
            <span>{book.value.tales.length ? `Your record and ${book.value.tales.length} ${book.value.tales.length === 1 ? 'tale' : 'tales'}` : 'Your record and your tales'}</span>
          </button>
          {import.meta.env.VITE_LAB !== 'off' && (
            <button class="menu-item" onClick={click(() => go({ name: 'lab' }))}>
              <b>Balance Lab</b>
              <span>Run the balance simulator</span>
            </button>
          )}
          <button class="menu-item" onClick={click(() => setSettingsOpen(true))}>
            <b>Settings</b>
            <span>{claudeStatus.value === 'ready' && !settings.value.claudeAI ? '✦ Let Claude play your rivals' : 'Sound, unit size and AI'}</span>
          </button>
        </div>
        <div class="menu-foot">A strategy prototype: a turn-based campaign and real-time battles under a sun that never moves. Every battle can be replayed exactly.</div>
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

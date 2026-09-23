/**
 * Colossi are drawn by hand: each breaks the skyline and reads at any zoom.
 * Coordinates are world meters; the caller has applied the camera transform.
 */
import type { Unit } from '../sim/types';
import { TEAM } from './color';

export function drawColossus(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, facing: number, t: number, altitude: number): void {
  switch (u.def.id) {
    case 'choir.nailbearer':
      return nailbearer(ctx, u, x, y, facing, t);
    case 'hush.umbralMother':
      return umbralMother(ctx, u, x, y, facing, t, altitude);
    case 'vesperate.oldMidnight':
      return oldMidnight(ctx, u, x, y, facing, t);
    case 'drift.dreadsail':
      return dreadsail(ctx, u, x, y, facing, t);
  }
}

function nailbearer(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, f: number, t: number): void {
  const open = u.special.coreExposed ? 1 : 0;
  const dark = u.special.noonOffUntil ? 1 : 0;
  ctx.save();
  ctx.translate(x, y);
  // Long shadow of a 25-meter giant.
  ctx.fillStyle = 'rgba(20,10,30,0.28)';
  ctx.beginPath();
  ctx.ellipse(-4, 5, 9, 6, f, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(f);
  // Arms hanging with chains of mirrors.
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#e9e3d2';
    ctx.beginPath();
    ctx.ellipse(1, s * 7.2, 3.2, 1.6, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 5; k++) {
      const gl = 0.5 + 0.5 * Math.sin(t * 3 + k + s);
      ctx.fillStyle = `rgba(255,255,255,${0.4 + gl * 0.6})`;
      ctx.fillRect(-1 + k * 0.9, s * (8.6 + (k % 2) * 0.4) - 0.3, 0.6, 0.6);
    }
  }
  // The censer-mace swinging on its chain.
  const sw = Math.sin(t * 1.4) * 0.5;
  ctx.strokeStyle = '#a8864e';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(3, 8);
  ctx.lineTo(3 + Math.cos(sw) * 6, 8 + Math.sin(sw) * 3 + 2);
  ctx.stroke();
  ctx.fillStyle = '#b8945a';
  ctx.beginPath();
  ctx.arc(3 + Math.cos(sw) * 6, 10 + Math.sin(sw) * 3, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,150,60,0.8)';
  ctx.beginPath();
  ctx.arc(3 + Math.cos(sw) * 6, 10 + Math.sin(sw) * 3, 0.7, 0, Math.PI * 2);
  ctx.fill();
  // Shoulders and body: white-glazed ceramic.
  const body = ctx.createRadialGradient(1, -1, 1, 0, 0, 8);
  body.addColorStop(0, '#fbf8ef');
  body.addColorStop(1, '#d8cfb8');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, 5.5, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Balconies of choristers around the waist.
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.ellipse(0, 0, 6.2, 8.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    ctx.fillStyle = '#f1e9d6';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 6.2, Math.sin(a) * 8.2, 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  // The bronze rib cage around a blinding star.
  const coreR = open ? 3.2 : 2.2;
  const pulse = 0.85 + 0.15 * Math.sin(t * 5);
  if (!dark) {
    const g = ctx.createRadialGradient(2.2, 0, 0, 2.2, 0, coreR * 3.2);
    g.addColorStop(0, 'rgba(255,255,245,1)');
    g.addColorStop(0.25, `rgba(255,236,160,${0.95 * pulse})`);
    g.addColorStop(1, 'rgba(255,200,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(2.2, 0, coreR * 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#b08d57';
  ctx.lineWidth = 0.45;
  for (let k = -3; k <= 3; k++) {
    ctx.beginPath();
    ctx.arc(2.2, 0, coreR + 0.4, (k * Math.PI) / 9 - 0.12 - (open ? 0.9 : 0), (k * Math.PI) / 9 + 0.12 + (open ? 0.9 : 0));
    ctx.stroke();
  }
  ctx.fillStyle = dark ? '#6a5a40' : '#fffef4';
  ctx.beginPath();
  ctx.arc(2.2, 0, coreR * 0.55, 0, Math.PI * 2);
  ctx.fill();
  // The faceless visored head.
  ctx.fillStyle = '#f6f1e4';
  ctx.beginPath();
  ctx.arc(-1.4, 0, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a2018';
  ctx.fillRect(-0.4, -1.3, 0.35, 2.6);
  // Team mark on the shoulder.
  ctx.fillStyle = TEAM[u.side];
  ctx.beginPath();
  ctx.arc(-3.5, -4.5, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function umbralMother(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, f: number, t: number, altitude: number): void {
  const flap = Math.sin(t * 2.2) * 0.12;
  const grounded = u.grounded > 0;
  const lift = grounded ? 0 : altitude;
  ctx.save();
  // Shadow on the ground far below: the moth flies in total silence.
  ctx.save();
  ctx.translate(x + lift * 0.6, y + lift * 0.9);
  ctx.rotate(f);
  ctx.fillStyle = 'rgba(8,4,20,0.35)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(0, s * 13, 11, 14 * (1 - flap), s * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.translate(x, y);
  ctx.rotate(f);
  // Four wings: fore and hind, each with a great eye-spot.
  const wing = (sx: number, sy: number, rx: number, ry: number, rot: number, eye: number) => {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(-rx, 0, rx, 0);
    g.addColorStop(0, '#d9cfbe');
    g.addColorStop(0.5, '#f1ebdf');
    g.addColorStop(1, '#cfc3ad');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,100,90,0.35)';
    ctx.lineWidth = 0.3;
    for (let k = 1; k < 5; k++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * (k / 5), ry * (k / 5), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Eye-spot: opens like a waking eye.
    const open = 0.7 + 0.3 * Math.sin(t * 0.7 + eye);
    ctx.fillStyle = '#2a1a3a';
    ctx.beginPath();
    ctx.ellipse(0, 0, ry * 0.55, ry * 0.55 * open, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6a4a9a';
    ctx.beginPath();
    ctx.ellipse(0, 0, ry * 0.36, ry * 0.36 * open, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9a8ff';
    ctx.beginPath();
    ctx.arc(ry * 0.08, -ry * 0.08, ry * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  for (const s of [-1, 1]) {
    wing(2, s * (14 + flap * 10), 10, 13 * (1 - flap), s * 0.3, s);
    wing(-7, s * (10 + flap * 6), 7, 9 * (1 - flap), -s * 0.4, s * 2);
  }
  // Body furred like frost.
  ctx.fillStyle = '#e8e2d6';
  ctx.beginPath();
  ctx.ellipse(-1, 0, 9, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,150,140,0.5)';
  ctx.lineWidth = 0.3;
  for (let k = -3; k <= 3; k++) {
    ctx.beginPath();
    ctx.moveTo(k * 2, -2.2);
    ctx.lineTo(k * 2 + 0.6, 2.2);
    ctx.stroke();
  }
  // Feathered antennae glowing violet.
  ctx.strokeStyle = '#b58cff';
  ctx.lineWidth = 0.4;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(8, s * 0.8);
    ctx.quadraticCurveTo(12, s * 3, 13, s * 6);
    ctx.stroke();
    for (let k = 0; k < 6; k++) {
      ctx.beginPath();
      ctx.moveTo(9 + k * 0.6, s * (1.4 + k * 0.7));
      ctx.lineTo(9.6 + k * 0.6, s * (2.4 + k * 0.7));
      ctx.stroke();
    }
  }
  // The Listener in its bone saddle.
  ctx.fillStyle = '#221e40';
  ctx.beginPath();
  ctx.arc(2.5, 0, 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = TEAM[u.side];
  ctx.beginPath();
  ctx.arc(-6, 0, 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function oldMidnight(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, f: number, t: number): void {
  const elkDead = u.special.elkHp !== undefined && u.special.elkHp <= 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(15,5,20,0.35)';
  ctx.beginPath();
  ctx.ellipse(-3, 4, 10, 8, f, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(f);
  // Twelve giant elk in six pairs, hung with bells.
  for (let r = 0; r < 6; r++) {
    for (const s of [-1, 1]) {
      const ex = 10 + r * 3.6;
      const ey = s * 2.2;
      const bob = elkDead ? 0 : Math.sin(t * 5 + r + s) * 0.2;
      ctx.fillStyle = elkDead ? '#3a2a22' : '#7a5236';
      ctx.beginPath();
      ctx.ellipse(ex, ey + bob, 1.6, 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!elkDead) {
        ctx.strokeStyle = '#d8c8a0';
        ctx.lineWidth = 0.15;
        ctx.beginPath();
        ctx.moveTo(ex + 1.4, ey - 0.3);
        ctx.lineTo(ex + 2.2, ey - 1);
        ctx.moveTo(ex + 1.4, ey + 0.3);
        ctx.lineTo(ex + 2.2, ey + 1);
        ctx.stroke();
        ctx.fillStyle = '#c9a227';
        ctx.beginPath();
        ctx.arc(ex, ey + bob, 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.strokeStyle = '#4a3a2a';
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  ctx.moveTo(8, -2.2);
  ctx.lineTo(29, -2.2);
  ctx.moveTo(8, 2.2);
  ctx.lineTo(29, 2.2);
  ctx.stroke();
  // The wheeled base and tiers of dark-lacquered oak and brass.
  ctx.fillStyle = '#1e1216';
  for (const wx of [-6, 0, 6]) for (const s of [-1, 1]) ctx.fillRect(wx - 1.4, s * 8.4 - 0.6, 2.8, 1.2);
  const tiers = ['#3a2230', '#4a2c3a', '#5a3444'];
  for (let k = 0; k < 3; k++) {
    const w = 18 - k * 4;
    const h = 16 - k * 3.5;
    ctx.fillStyle = tiers[k]!;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 0.3;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
  }
  // Lanterns on every tier.
  for (const [lx, ly] of [
    [-8.5, -7.5],
    [8.5, -7.5],
    [-8.5, 7.5],
    [8.5, 7.5],
    [-6.5, -5.8],
    [6.5, 5.8],
  ] as const) {
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 2);
    g.addColorStop(0, 'rgba(255,220,140,1)');
    g.addColorStop(1, 'rgba(255,190,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lx, ly, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // The great bell, green with age.
  const swing = u.special.channelStill ? Math.sin(t * 6) * 0.6 : Math.sin(t * 0.8) * 0.08;
  ctx.fillStyle = '#5f7f62';
  ctx.beginPath();
  ctx.ellipse(swing, 0, 4.2, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8fb08a';
  ctx.lineWidth = 0.4;
  for (let k = 1; k <= 3; k++) {
    ctx.beginPath();
    ctx.arc(swing, 0, k * 1.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Clock face with one stopped hand.
  ctx.fillStyle = '#efe4c4';
  ctx.beginPath();
  ctx.arc(8.5, 0, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a1a10';
  ctx.lineWidth = 0.2;
  ctx.beginPath();
  ctx.moveTo(8.5, 0);
  ctx.lineTo(8.5, -1.1);
  ctx.stroke();
  // Banners streaming sunward.
  ctx.fillStyle = TEAM[u.side];
  ctx.fillRect(-9, -9.5, 3, 0.8);
  ctx.restore();
}

function dreadsail(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, f: number, t: number): void {
  const burning = !!u.special.sailsBurning;
  const anchored = !!u.special.anchored;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(20,10,20,0.3)';
  ctx.beginPath();
  ctx.ellipse(-3, 5, 40, 12, f, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(f);
  // Six wheels taller than houses.
  ctx.fillStyle = '#2a1a10';
  for (const wx of [-26, 0, 24]) {
    for (const s of [-1, 1]) {
      ctx.fillRect(wx - 5, s * 12.5 - 1.2, 10, 2.4);
      ctx.fillStyle = '#4a3020';
      for (let k = -2; k <= 2; k++) ctx.fillRect(wx + k * 2 - 0.2, s * 12.5 - 1.2, 0.4, 2.4);
      ctx.fillStyle = '#2a1a10';
    }
  }
  // Hull of lashed timber and gale-reed, bow forward.
  ctx.fillStyle = '#8a5a2a';
  ctx.beginPath();
  ctx.moveTo(40, 0);
  ctx.quadraticCurveTo(30, -11, 10, -11.5);
  ctx.lineTo(-38, -10);
  ctx.quadraticCurveTo(-42, 0, -38, 10);
  ctx.lineTo(10, 11.5);
  ctx.quadraticCurveTo(30, 11, 40, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,20,10,0.55)';
  ctx.lineWidth = 0.35;
  for (let k = -4; k <= 4; k++) {
    ctx.beginPath();
    ctx.moveTo(-38, k * 2.2);
    ctx.lineTo(30 - Math.abs(k) * 2, k * 2.2);
    ctx.stroke();
  }
  // Screaming-bird figurehead.
  ctx.fillStyle = '#c4153a';
  ctx.beginPath();
  ctx.moveTo(44, 0);
  ctx.lineTo(39, -2.2);
  ctx.lineTo(39, 2.2);
  ctx.closePath();
  ctx.fill();
  // Four masts carrying patchwork sails, bellied toward the sun (downwind).
  const colors = ['#f4a300', '#1fa3a3', '#c4153a', '#3b3f9c'];
  for (let m = 0; m < 4; m++) {
    const mx = 24 - m * 16;
    const belly = 2.5 + Math.sin(t * 1.5 + m) * 0.4;
    for (let p = 0; p < 4; p++) {
      const y0 = -16 + p * 8;
      ctx.fillStyle = burning ? (p % 2 ? '#4a2a1a' : '#2a1a10') : colors[(m + p) % 4]!;
      ctx.beginPath();
      ctx.moveTo(mx, y0);
      ctx.quadraticCurveTo(mx + belly, y0 + 4, mx, y0 + 8);
      ctx.lineTo(mx - 1.2, y0 + 8);
      ctx.quadraticCurveTo(mx - 1.2 + belly, y0 + 4, mx - 1.2, y0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#3a2410';
    ctx.beginPath();
    ctx.arc(mx - 0.6, 0, 0.9, 0, Math.PI * 2);
    ctx.fill();
    if (burning) {
      for (let k = 0; k < 3; k++) {
        const fl = 0.6 + 0.4 * Math.sin(t * 9 + k + m);
        ctx.fillStyle = `rgba(255,${120 + k * 40},40,${fl})`;
        ctx.beginPath();
        ctx.arc(mx + 1, -12 + k * 10 + Math.sin(t * 7 + k) * 1.5, 1.4 * fl, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Prayer flags.
  for (let k = 0; k < 18; k++) {
    ctx.fillStyle = colors[k % 4]!;
    const fx = -34 + k * 4;
    ctx.beginPath();
    ctx.moveTo(fx, -10.5);
    ctx.lineTo(fx + 1.2, -9.5 + Math.sin(t * 6 + k) * 0.3);
    ctx.lineTo(fx, -8.8);
    ctx.fill();
  }
  if (anchored) {
    ctx.strokeStyle = '#8a8a8a';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(34, 5);
    ctx.lineTo(38, 12);
    ctx.stroke();
    ctx.fillStyle = '#6a6a6a';
    ctx.beginPath();
    ctx.arc(38, 12.5, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = TEAM[u.side];
  ctx.beginPath();
  ctx.arc(-34, 0, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

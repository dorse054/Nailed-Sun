/**
 * The Drift: ride the wind. Get the Firekite Battery upwind of the enemy so
 * its kites fly with the wind, then strike downwind with Strider Lancers and
 * wheel away before they are pinned.
 */
import { effectiveRange, weaponOf } from '../../../sim/missiles';
import type { Unit } from '../../../sim/types';
import type { TutorialContext } from '../context';
import type { Mark, TutorialDef } from '../types';

const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;
const EAST = 0;

/** Upwind of the enemy: from here the kites fly with the wind. */
const SPOT = { x: 630, y: 680, r: 24 };
const FIELD = { x0: 540, y0: 340, x1: 960, y1: 830 };

/** Where the battery can reach, in every direction, as a closed outline. */
function reach(c: TutorialContext, u: Unit | undefined): { x: number; y: number }[] {
  const w = u && weaponOf(u);
  if (!u || !w || u.alive <= 0) return [];
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r = effectiveRange(c.b, u, w, a);
    pts.push({ x: u.x + Math.cos(a) * r, y: u.y + Math.sin(a) * r });
  }
  return pts;
}

/** Range of the battery toward a unit, and how far away it is. */
function shot(c: TutorialContext, from: Unit | undefined, to: Unit | undefined): { d: number; r: number } | null {
  const w = from && weaponOf(from);
  if (!from || !to || !w || to.alive <= 0) return null;
  const dir = Math.atan2(to.y - from.y, to.x - from.x);
  return { d: Math.hypot(to.x - from.x, to.y - from.y), r: effectiveRange(c.b, from, w, dir) };
}

/** The battery's reach, labeled where it points at the Arbalests. */
function reachMark(c: TutorialContext): Mark {
  const u = c.unit('kites');
  const pts = reach(c, u);
  const t = c.unit('arbs');
  let at = pts[0];
  if (u && t && pts.length) {
    const i = Math.round((((Math.atan2(t.y - u.y, t.x - u.x) / (Math.PI * 2)) * pts.length) % pts.length) + pts.length) % pts.length;
    at = pts[i];
  }
  return { kind: 'shape', pts, label: 'Firekite reach', at };
}

/** What the Strider Lancers should charge: the Arbalests, or the enemy unit most downwind of them. */
function strikeTarget(c: TutorialContext): Unit | undefined {
  if (c.ready('arbs')) return c.unit('arbs');
  const s = c.unit('striders');
  if (!s) return undefined;
  let best: Unit | undefined;
  let score = -Infinity;
  for (const e of c.seenFoes()) {
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    const v = dx / d - d / 600;
    if (v > score) {
      score = v;
      best = e;
    }
  }
  return best;
}

export const DRIFT_TUTORIAL: TutorialDef = {
  id: 'drift',
  faction: 'drift',
  title: 'Ride the Wind',
  idea: 'The wind always blows toward the sun. Stand upwind and your missiles fly farther; strike downwind, then wheel away.',
  blurb: 'On the salt flats, roll a Firekite Battery upwind of a Vesperate line to outrange it, then hit them with Strider Lancers on the wind.',
  learn: ['Reading the wind on the Rose', 'Range downwind and upwind', 'The Firekite Battery', 'Strike and wheel away'],
  minutes: 5,
  field: { light: 3, wind: 2, sunBearing: EAST, note: 'Bright, a Gale, the sun in the east' },
  setup: () => ({
    seed: 'tutorial-drift',
    map: { seed: 13, band: 'longAfternoon', wind: 2, sunBearing: EAST, preset: 'open' },
    unitScale: 0.5,
    timeLimit: 15 * 60,
    armies: [
      {
        faction: 'drift',
        controller: 'player',
        units: [
          { def: 'drift.anchorGuard', x: 800, y: 730, facing: UP, tag: 'anchor' },
          { def: 'drift.reedspears', x: 870, y: 730, facing: UP, tag: 'spears' },
          { def: 'drift.windbows', x: 835, y: 775, facing: UP, tag: 'bows' },
          { def: 'drift.firekiteBattery', x: 710, y: 790, facing: UP, tag: 'kites' },
          { def: 'drift.striderLancers', x: 600, y: 520, facing: EAST, tag: 'striders' },
        ],
      },
      {
        faction: 'vesperate',
        controller: 'ai',
        units: [
          { def: 'vesperate.hourLevy', x: 780, y: 440, facing: DOWN, tag: 'levyA' },
          { def: 'vesperate.hourLevy', x: 870, y: 440, facing: DOWN, tag: 'levyB' },
          { def: 'vesperate.vesperArbalests', x: 825, y: 400, facing: DOWN, tag: 'arbs' },
        ],
      },
    ],
  }),
  steps: [
    {
      id: 'welcome',
      title: 'The Drift',
      text: 'You lead the Drift, nomads of the Gale Roads. The wind is your weapon. It always blows **toward the sun**, and your missiles fly farther with it at their backs.',
      pause: true,
      view: FIELD,
    },
    {
      id: 'rose',
      title: 'Read the wind',
      text: 'The Rose shows a **Gale** blowing toward the sun in the east: left to right across the field. Shots downwind fly 20% farther; shots into the wind fall 20% short. In a Breeze or a Gale the Drift add 10% more range.',
      hud: '.rose-wrap',
      pause: true,
    },
    {
      id: 'kites',
      title: 'The Firekite Battery',
      text: (c) =>
        `${c.click} the **Firekite Battery**. The dashed outline shows its reach in every direction: its burning kites ride the wind far to the east, but only a short way into it.`,
      marks: (c) => [reachMark(c), { kind: 'unit', unit: c.unit('kites'), label: 'Firekite Battery' }],
      done: (c) => c.isSelected('kites'),
      doneText: 'Selected.',
      auto: (c) => c.select('kites'),
    },
    {
      id: 'upwind',
      title: 'Get upwind',
      text: (c) =>
        `From here the Vesperate are out of reach. ${c.order} inside the marked circle to roll the battery upwind of them, west of their line, where it shoots with the wind. Speed up time while it rolls.`,
      marks: (c) => [
        reachMark(c),
        { kind: 'area', ...SPOT, label: 'Upwind spot', done: c.inSpot('kites', SPOT) },
        { kind: 'unit', unit: c.unit('arbs'), label: 'Vesper Arbalests', tone: 'foe' },
      ],
      live: (c) => {
        const s = shot(c, c.unit('kites'), c.unit('arbs'));
        return s ? `Arbalests ${Math.round(s.d)} m away. Reach that way: ${Math.round(s.r)} m.` : null;
      },
      done: (c) => c.inSpot('kites', SPOT) || !c.ready('kites'),
      doneText: 'Upwind. The wind will carry the kites.',
      auto: (c) => {
        c.select('kites');
        c.move('kites', SPOT.x, SPOT.y, -0.6);
      },
    },
    {
      id: 'fire',
      title: 'Loose the kites',
      text: (c) =>
        `${c.order} the **Vesper Arbalests** to aim the battery at them. Their crossbows would shoot into the wind, 120 m at best. They cannot answer.`,
      hud: (c) => (c.isSelected('kites') ? null : c.card('kites')),
      marks: (c) => [reachMark(c), { kind: 'unit', unit: c.unit('arbs'), label: 'Vesper Arbalests', tone: 'foe' }],
      live: (c) => {
        const s = shot(c, c.unit('kites'), c.unit('arbs'));
        return s ? `Arbalests ${Math.round(s.d)} m away. Reach that way: ${Math.round(s.r)} m.` : null;
      },
      done: (c) => {
        const u = c.unit('kites');
        if (!u || !c.ready('kites')) return true;
        return !!c.attacked('kites') && u.lastFireTime >= c.time - c.elapsed;
      },
      doneText: 'The kites ride the wind onto them.',
      auto: (c) => {
        c.select('kites');
        c.attack('kites', c.ready('arbs') ? c.unit('arbs') : c.foes()[0]);
      },
    },
    {
      id: 'strike',
      title: 'Strike downwind',
      text: (c) =>
        `Strider Lancers charging downwind leap obstacles and ignore half of a braced enemy's bonus. Select them and ${c.order.toLowerCase()} the **Vesper Arbalests**, east of them, so they charge with the wind at their backs.`,
      hud: (c) => (c.isSelected('striders') ? null : c.card('striders')),
      view: FIELD,
      marks: (c) => [
        { kind: 'unit', unit: c.unit('striders'), label: 'Strider Lancers' },
        { kind: 'unit', unit: strikeTarget(c), label: 'Charge downwind', tone: 'foe' },
      ],
      done: (c) => {
        const u = c.unit('striders');
        if (!u || !c.ready('striders')) return true;
        return u.engaged > 0 && u.chargeStart >= c.time - c.elapsed;
      },
      doneText: 'They hit with the wind behind them.',
      auto: (c) => {
        c.select('striders');
        c.attack('striders', strikeTarget(c));
      },
    },
    {
      id: 'wheel',
      title: 'Wheel away',
      text: (c) =>
        `Don't get pinned. ${c.order} the ground well behind the Strider Lancers to pull them out. The Drift's Feigned Flight costs them no leadership, and they can charge again at once.`,
      marks: (c) => [{ kind: 'unit', unit: c.unit('striders'), label: 'Strider Lancers' }],
      done: (c) => {
        const u = c.unit('striders');
        if (!u || !c.ready('striders')) return true;
        const pulled = c.orders().some((o) => o.type === 'move' && o.unit === u.id);
        return pulled && u.engaged === 0;
      },
      doneText: 'Clear, and ready to charge again.',
      auto: (c) => {
        const u = c.unit('striders');
        if (!u) return;
        c.select('striders');
        c.move('striders', u.x - 100, u.y + 20, EAST);
      },
    },
    {
      id: 'win',
      title: 'Ride them down',
      text: 'Stung, the Vesperate will soon march on you. Keep the kites burning them, hold them with the Anchor Guard and Reedspears, keep the battery out of their reach, and charge again downwind. Win the battle.',
      // They stand under the kites a while longer, then come.
      enter: (c) => c.enemyFight({ stance: 'defend', patience: 40, abilityUse: 0 }),
      live: (c) => `Enemy army still fighting: ${Math.round(c.b.remainingValue(1) * 100)}%`,
      marks: (c) => c.seenFoes().map((u): Mark => ({ kind: 'unit', unit: u, tone: 'foe' })),
      done: (c) => c.s.phase === 'over',
    },
  ],
  recap: [
    'The wind always blows toward the sun. Downwind shots fly farther; shots into the wind fall short.',
    'Get upwind of the enemy before you shoot. In a Gale the Firekite Battery reaches about 420 m downwind but under 200 m into the wind.',
    'Charge downwind, then wheel away before you are pinned. Feigned Flight costs the Drift nothing.',
    'On lit fields, shooting downwind means facing the sun: you trade some glare for the range.',
  ],
};

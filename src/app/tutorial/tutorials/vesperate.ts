/**
 * The Vesperate: keep the Hour. Hold the line on the Hour of Iron, then
 * launch the Antlered Lancers on the bell for a double charge bonus.
 */
import { TOLL } from '../../../data/rules';
import { tollActive } from '../../../sim/stats';
import type { Unit } from '../../../sim/types';
import type { TutorialContext } from '../context';
import type { TutorialDef } from '../types';

const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;

/** Cavalry start their charge this close to the target (see chargeRange). */
const CHARGE_RANGE = 75;
/** Prompt for Call the Hour once the Lancers are this close. */
const RING_AT = 122;
const FIELD = { x0: 420, y0: 340, x1: 860, y1: 850 };

function nextToll(c: TutorialContext): string {
  const st = c.b.sides[c.s.side];
  if (!Number.isFinite(st.tollInterval)) return 'The bells are silent.';
  if (c.time - st.lastToll < TOLL.window) return 'The Toll is ringing!';
  return `Next Toll in ${Math.max(0, Math.ceil(st.tollInterval - st.tollTimer))} s`;
}

/** The unit the Lancers were ordered to attack. */
function lancerTarget(c: TutorialContext): Unit | undefined {
  const l = c.unit('lancers');
  if (!l || l.order.kind !== 'attack') return undefined;
  const t = c.b.units[l.order.target];
  return t && t.alive > 0 ? t : undefined;
}

/** How far the Lancers are from the nearest soldier of their target. */
function gap(c: TutorialContext): number {
  const l = c.unit('lancers');
  const t = lancerTarget(c);
  if (!l || !t) return Infinity;
  let best = Infinity;
  for (const s of t.soldiers) if (s.alive) best = Math.min(best, Math.hypot(s.x - l.x, s.y - l.y));
  return best;
}

/** A Choir unit fighting our line, the best target for a flank charge. */
function anvilFoe(c: TutorialContext): Unit | undefined {
  return c.foeFighting('guard') ?? c.foeFighting('guard2') ?? c.seenFoes()[0];
}

/** The Lancers started a charge since they were ordered in. */
function charged(c: TutorialContext): boolean {
  const l = c.unit('lancers');
  return !!l && l.chargeStart >= (c.mem.orderedAt ?? Infinity);
}

function onBell(c: TutorialContext): boolean {
  const l = c.unit('lancers');
  return !!l && charged(c) && l.chargeStart < l.tollUntil && l.chargeStart >= l.tollUntil - TOLL.window;
}

export const VESPERATE_TUTORIAL: TutorialDef = {
  id: 'vesperate',
  faction: 'vesperate',
  title: 'Charge on the Bell',
  idea: 'A Toll rings on a timer and grants the Hour you choose for a few seconds. Time your holds and charges to it.',
  blurb: 'Hold a Vesperate line on the Hour of Iron, then launch the Antlered Lancers as the bell rings for a double charge bonus.',
  learn: ['The Toll and its timer', 'Choosing the Hour', 'Charging on the bell', "Keeper Maren's Call the Hour"],
  minutes: 6,
  field: { light: 2, wind: 0, sunBearing: DOWN, note: 'Dusk, Calm, the sun behind you' },
  setup: () => ({
    seed: 'tutorial-vesperate',
    map: { seed: 11, band: 'gloaming', wind: 0, sunBearing: DOWN, preset: 'open' },
    unitScale: 0.5,
    timeLimit: 15 * 60,
    armies: [
      {
        faction: 'vesperate',
        controller: 'player',
        hour: 'charge',
        units: [
          { def: 'vesperate.lanternGuard', x: 565, y: 700, facing: UP, tag: 'guard' },
          { def: 'vesperate.lanternGuard', x: 630, y: 700, facing: UP, tag: 'guard2' },
          { def: 'vesperate.antleredLancers', x: 760, y: 730, facing: UP, tag: 'lancers' },
          { def: 'vesperate.belfryWagon', x: 595, y: 770, facing: UP, tag: 'belfry' },
          { def: 'vesperate.maren', x: 640, y: 800, facing: UP, tag: 'maren' },
        ],
      },
      {
        faction: 'choir',
        controller: 'ai',
        units: [
          { def: 'choir.kilnAcolytes', x: 560, y: 540, facing: DOWN, tag: 'acoA' },
          { def: 'choir.kilnAcolytes', x: 640, y: 540, facing: DOWN, tag: 'acoB' },
          { def: 'choir.shardbows', x: 600, y: 500, facing: DOWN, tag: 'bows' },
        ],
      },
    ],
  }),
  steps: [
    {
      id: 'welcome',
      title: 'The Vesperate',
      text: 'You lead the Vesperate, and their battles run on bells. A **Toll** rings on a timer. For 6 s after each Toll, your units gain the bonus of the **Hour** you have chosen. Strike on the bell.',
      pause: true,
      view: FIELD,
    },
    {
      id: 'toll',
      title: 'The Toll',
      text: 'The Toll panel counts down to the next bell. Your Belfry Wagon rings it every 30 s for every unit within 320 m. Below the timer are the three Hours: the **Charge** (+12 charge bonus), **Iron** (+10 melee defense, no knockback) and **Rest** (+8% leadership, faster recovery).',
      hud: '[data-tut="hours"]',
      pause: true,
    },
    {
      id: 'listen',
      title: 'Listen for the bell',
      text: 'The Choir are marching on you. Wait for the next Toll: when it rings, a gold ring circles the banner of every unit that hears it, and the Toll panel says so. Press + or click 2× to speed up the wait.',
      enter: (c) => c.enemyFight({ stance: 'attack', abilityUse: 0 }),
      hud: '[data-tut="hours"]',
      marks: (c) => [{ kind: 'unit', unit: c.unit('belfry'), label: 'Belfry Wagon' }],
      live: nextToll,
      done: (c) => c.b.sides[c.s.side].lastToll >= c.time - c.elapsed,
      doneText: 'The Toll rings.',
    },
    {
      id: 'iron',
      title: 'The Hour of Iron',
      text: (c) =>
        `Before the Choir reach your line, ${c.click.toLowerCase()} the **Hour of Iron**: on every Toll your line gets +10 melee defense and cannot be knocked back.`,
      hud: '[data-tut="hour-iron"]',
      live: nextToll,
      done: (c) => c.b.sides[c.s.side].hour === 'iron',
      doneText: 'The Hour of Iron.',
      auto: (c) => c.hour('iron'),
    },
    {
      id: 'hold',
      title: 'Hold on the bell',
      text: 'Hold your ground. When the Choir hit your two Lantern Guard units, each Toll steels them for 6 s. Wait for a Toll during the fight.',
      view: FIELD,
      marks: (c) => [
        { kind: 'unit', unit: c.unit('guard'), label: 'Lantern Guard' },
        { kind: 'unit', unit: c.unit('guard2'), label: 'Lantern Guard' },
      ],
      live: (c) => {
        const fighting = (c.unit('guard')?.engaged ?? 0) > 0 || (c.unit('guard2')?.engaged ?? 0) > 0;
        return `${fighting ? 'Your line is fighting.' : 'The Choir are coming.'} ${nextToll(c)}`;
      },
      done: (c) => {
        const fighting = (c.unit('guard')?.engaged ?? 0) > 0 || (c.unit('guard2')?.engaged ?? 0) > 0;
        if (fighting && c.mem.contact === undefined) c.mem.contact = c.time;
        const contact = c.mem.contact;
        return contact !== undefined && c.b.sides[c.s.side].lastToll >= contact;
      },
      doneText: 'Iron on the bell: the line holds.',
    },
    {
      id: 'chargeHour',
      title: 'The Hour of the Charge',
      text: (c) => `Now the hammer. ${c.click} the **Hour of the Charge**: +12 charge bonus on every Toll.`,
      hud: '[data-tut="hour-charge"]',
      live: nextToll,
      done: (c) => c.b.sides[c.s.side].hour === 'charge',
      doneText: 'The Hour of the Charge.',
      auto: (c) => c.hour('charge'),
    },
    {
      id: 'order',
      title: 'Order the charge',
      text: (c) =>
        `Select the **Antlered Lancers** and ${c.order.toLowerCase()} a Choir unit fighting your line. Hit it from the side. Cavalry start their charge ${CHARGE_RANGE} m out.`,
      hud: (c) => (c.isSelected('lancers') ? null : c.card('lancers')),
      marks: (c) => [
        { kind: 'unit', unit: c.unit('lancers'), label: 'Antlered Lancers' },
        { kind: 'unit', unit: anvilFoe(c), label: 'Charge this', tone: 'foe' },
      ],
      done: (c) => {
        if (lancerTarget(c) && c.attacked('lancers')) {
          c.mem.orderedAt = c.time;
          return true;
        }
        return !c.ready('lancers');
      },
      doneText: 'The Lancers ride.',
      auto: (c) => {
        c.select('lancers');
        c.attack('lancers', anvilFoe(c));
        c.mem.orderedAt = c.time;
      },
    },
    {
      id: 'approach',
      title: 'Wait for it',
      text: 'Antlered Lancers **double their charge bonus** when the charge starts on a Toll. Watch them close in.',
      marks: (c) => [
        { kind: 'unit', unit: c.unit('lancers'), label: 'Antlered Lancers' },
        { kind: 'unit', unit: lancerTarget(c), tone: 'foe' },
      ],
      live: (c) => {
        const g = gap(c);
        return Number.isFinite(g) ? `Lancers: ${Math.round(g)} m from the target. ${nextToll(c)}` : 'Order the Lancers to attack an enemy unit.';
      },
      done: (c) => gap(c) <= RING_AT || charged(c) || !c.ready('lancers'),
      noSkip: true,
    },
    {
      id: 'ring',
      title: 'Ring the bell now',
      text: (c) =>
        `Now! Select **Keeper Maren** and ${c.click.toLowerCase()} **Call the Hour** (or press 1). She rings a Toll at once, just as the Lancers launch their charge. The battle waits for you.`,
      pause: true,
      skip: (c) => {
        // The bell is already ringing and will still ring when they reach charge range.
        const l = c.unit('lancers');
        if (!l || charged(c) || !c.ready('lancers') || !c.ready('maren')) return true;
        const secs = Math.max(0, gap(c) - CHARGE_RANGE) / Math.max(1, l.def.speed);
        return tollActive(c.b, l) && l.tollUntil - c.time > secs + 0.5;
      },
      hud: (c) => (c.isSelected('maren') ? c.ability('callTheHour') : c.card('maren')),
      marks: (c) => [{ kind: 'unit', unit: c.unit('maren'), label: 'Keeper Maren' }],
      done: (c) => c.used('callTheHour') || !c.ready('maren'),
      doneText: 'The bell rings!',
      auto: (c) => c.cast('maren', 'callTheHour'),
    },
    {
      id: 'impact',
      title: 'Charge on the bell',
      text: 'Watch the charge. On the Toll the Hour of the Charge adds +12 to the charge bonus, and Antlered Lancers double the total.',
      marks: (c) => [{ kind: 'unit', unit: c.unit('lancers'), label: 'Antlered Lancers' }],
      live: (c) => (charged(c) ? (onBell(c) ? 'Charge on the bell! Double charge bonus.' : 'They charged off the bell: a normal charge.') : nextToll(c)),
      done: (c) => charged(c) || !c.ready('lancers'),
      doneText: (c) => (onBell(c) ? 'Charge on the bell!' : 'They charged off the bell. Next time, ring it just before they hit.'),
    },
    {
      id: 'win',
      title: 'Break them',
      text: (c) =>
        `Pull the Lancers out (${c.order.toLowerCase()} the ground behind them) and charge again on the next Toll, or let your line grind on the Hour of Iron. Win the battle.`,
      live: (c) => `${nextToll(c)} Enemy army still fighting: ${Math.round(c.b.remainingValue(1) * 100)}%`,
      hud: '[data-tut="hours"]',
      marks: (c) => c.seenFoes().map((u) => ({ kind: 'unit' as const, unit: u, tone: 'foe' as const })),
      done: (c) => c.s.phase === 'over',
    },
  ],
  recap: [
    'The Toll rings on a timer. For 6 s after it, every unit in earshot gains the Hour you chose.',
    'Hold on the Hour of Iron. Charge on the Hour of the Charge.',
    "Antlered Lancers double their charge bonus when they launch on the bell. Keeper Maren's Call the Hour rings it when you need it.",
    'Guard the Belfry Wagon: silence the bells and the Vesperate lose their rhythm.',
  ],
};


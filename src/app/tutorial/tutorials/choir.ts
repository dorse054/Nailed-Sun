/**
 * Choir of the Nail: the controls, then the sun at your back. The Vesperate
 * must march into the glare to reach a Choir line that never suffers it.
 */
import { LIGHT_NAMES } from '../../../data/schema';
import { beamMult } from '../../../data/rules';
import { lineFormation } from '../../battle/orders';
import type { Unit } from '../../../sim/types';
import type { TutorialContext } from '../context';
import type { Mark, TutorialDef } from '../types';

const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;

/** Where the Mirror Wardens march in the move lesson. */
const MOVE = { x: 760, y: 652, r: 24 };
/** The line to right-drag along. */
const LINE = { x1: 672, y1: 640, x2: 842, y2: 640 };
const FIELD = { x0: 560, y0: 330, x1: 960, y1: 820 };
const HOME = { x0: 640, y0: 600, x1: 880, y1: 800 };

/** Lenswrights' beam range (they ignore the wind). */
const LENS_RANGE = 190;

/** The enemy unit closest to the Lenswrights. */
function nearestFoe(c: TutorialContext): Unit | undefined {
  const lens = c.unit('lens');
  return c.seenFoes().sort((a, b) => c.dist(a, lens) - c.dist(b, lens))[0];
}

function glareBadges(c: TutorialContext): Mark[] {
  return c.glared().map((u) => ({ kind: 'badge', unit: u, text: '☀', title: 'In the glare' }) as Mark);
}

export const CHOIR_TUTORIAL: TutorialDef = {
  id: 'choir',
  faction: 'choir',
  title: 'The Sun at Your Back',
  idea: 'Fight with the sun behind you. The enemy has to face it, and the glare half-blinds them.',
  blurb: 'Learn the controls, then hold a Choir line with the sun at your back while a Vesperate war band marches into the glare.',
  learn: ['Select, move and attack', 'Read the Rose: sun and wind', 'Pause and game speed', 'Glare, beams and Sunpatch'],
  minutes: 6,
  field: { light: 2, wind: 1, sunBearing: DOWN, note: 'Dusk, a Breeze, the sun behind you' },
  setup: () => ({
    seed: 'tutorial-choir',
    map: { seed: 10, band: 'gloaming', wind: 1, sunBearing: DOWN, preset: 'open' },
    unitScale: 0.5,
    timeLimit: 15 * 60,
    armies: [
      {
        faction: 'choir',
        controller: 'player',
        units: [
          { def: 'choir.kilnAcolytes', x: 700, y: 700, facing: UP, tag: 'acolytes' },
          { def: 'choir.mirrorWardens', x: 760, y: 700, facing: UP, tag: 'wardens' },
          { def: 'choir.lenswrights', x: 730, y: 745, facing: UP, tag: 'lens' },
          { def: 'choir.glasswright', x: 730, y: 775, facing: UP, tag: 'glasswright' },
        ],
      },
      {
        faction: 'vesperate',
        controller: 'ai',
        units: [
          { def: 'vesperate.hourLevy', x: 690, y: 450, facing: DOWN, tag: 'levyA' },
          { def: 'vesperate.hourLevy', x: 810, y: 450, facing: DOWN, tag: 'levyB' },
          { def: 'vesperate.vesperArbalests', x: 750, y: 410, facing: DOWN, tag: 'arbalests' },
        ],
      },
    ],
  }),
  steps: [
    {
      id: 'welcome',
      title: 'The Choir of the Nail',
      text: "You lead the Choir of the Nail against a Vesperate war band. First the controls, then the Choir's first rule: **fight with the sun at your back**.",
      pause: true,
      view: FIELD,
    },
    {
      id: 'rose',
      title: 'The Rose',
      text: 'The Rose in the top-left is your compass. The glowing dot on its rim is the **sun**, and it never moves. The blue line shows which way your army faces. Right now the sun is behind you.',
      hud: '.rose-wrap',
      pause: true,
    },
    {
      id: 'wind',
      title: 'The wind',
      text: "The wind always blows **toward the sun**. The white chevrons on the Rose show its way and strength. Today a Breeze carries arrows 10% farther downwind. Your Lenswrights' beams ignore the wind.",
      hud: '.rose-wrap',
      pause: true,
    },
    {
      id: 'select',
      title: 'Select a unit',
      text: (c) => `${c.click} the **Mirror Wardens**, the shield wall marked on the field. A selected unit glows gold, and its details open at the bottom.`,
      view: HOME,
      marks: (c) => [{ kind: 'unit', unit: c.unit('wardens'), label: 'Mirror Wardens' }],
      done: (c) => c.isSelected('wardens'),
      doneText: 'Selected.',
      auto: (c) => c.select('wardens'),
    },
    {
      id: 'move',
      title: 'Move',
      text: (c) =>
        `With the Mirror Wardens selected, ${c.touch ? 'tap' : '**right-click**'} inside the marked circle. They march there. (${c.click} them first if they are not selected.)`,
      marks: (c) => [
        { kind: 'area', ...MOVE, label: 'Move here', done: c.inSpot('wardens', MOVE) },
        { kind: 'unit', unit: c.unit('wardens') },
      ],
      done: (c) => c.inSpot('wardens', MOVE),
      doneText: 'On the march.',
      auto: (c) => {
        c.select('wardens');
        c.move('wardens', MOVE.x, MOVE.y, UP);
      },
    },
    {
      id: 'card',
      title: 'Unit cards',
      text: (c) => `Every unit has a card along the bottom of the screen. ${c.click} the **Lenswrights'** card to select them.`,
      hud: (c) => c.card('lens'),
      done: (c) => c.isSelected('lens'),
      doneText: 'Selected from the card.',
      auto: (c) => c.select('lens'),
    },
    {
      id: 'box',
      title: 'Select several',
      text: 'Hold the left mouse button and **drag a box** around the Kiln Acolytes and the Mirror Wardens to select both. Shift-click adds or drops one unit; Ctrl+A selects your whole army.',
      marks: (c) => [
        { kind: 'unit', unit: c.unit('acolytes'), label: 'Kiln Acolytes', tone: c.isSelected('acolytes') ? 'good' : 'gold' },
        { kind: 'unit', unit: c.unit('wardens'), label: 'Mirror Wardens', tone: c.isSelected('wardens') ? 'good' : 'gold' },
      ],
      skip: (c) => c.touch,
      done: (c) => c.isSelected('acolytes') && c.isSelected('wardens'),
      doneText: 'Both selected.',
      auto: (c) => c.select('acolytes', 'wardens'),
    },
    {
      id: 'line',
      title: 'Form a line',
      text: 'Now **right-drag** along the marked line: press the right mouse button at its left end, drag to the right end, and let go. Your units spread along it. A line drawn left to right faces up the field, toward the enemy.',
      marks: () => [{ kind: 'line', ...LINE, label: 'Right-drag along here' }],
      skip: (c) => c.touch,
      done: (c) => c.lineOrders > 0 || !!c.mem.lined,
      doneText: 'Line formed.',
      auto: (c) => {
        c.mem.lined = 1;
        c.select('acolytes', 'wardens');
        const us = ['acolytes', 'wardens'].map((t) => c.unit(t)!).filter((u) => u && u.alive > 0);
        for (const p of lineFormation(us, LINE.x1, LINE.y1, LINE.x2, LINE.y2)) {
          c.s.issue({ type: 'move', unit: p.unit, x: p.x, y: p.y, facing: p.facing, files: p.files, run: true });
        }
      },
    },
    {
      id: 'pause',
      title: 'Pause',
      text: (c) =>
        c.touch
          ? 'Tap the pause button at the top of the screen. While paused you can still select units and give orders.'
          : 'Press **Space**, or click the pause button at the top, to pause the battle. While paused you can still select units and give orders.',
      hud: '[data-tut="pause"]',
      done: (c) => c.s.paused,
      doneText: 'Paused.',
      auto: (c) => {
        c.s.paused = true;
      },
    },
    {
      id: 'speed',
      title: 'Game speed',
      text: (c) =>
        c.touch ? 'Tap **2×** to resume at double speed.' : 'Click **2×** to resume at double speed. The + and − keys change the speed too, and Space resumes.',
      hud: '[data-tut="speed-2"]',
      done: (c) => !c.s.paused && c.s.speed >= 2,
      doneText: 'Double speed.',
      auto: (c) => {
        c.s.speed = 2;
        c.s.paused = false;
      },
    },
    {
      id: 'glare',
      title: 'Into the glare',
      text: 'The Vesperate advance. To reach you they must face the sun. Every enemy marked ☀ fights into the glare: **-20% accuracy and -4 melee attack** in Dusk. Your Choir are Glassblind: glare never touches them. Wait for them to come in range.',
      enter: (c) => c.enemyFight({ stance: 'attack', abilityUse: 0 }),
      view: FIELD,
      live: (c) => {
        const d = Math.round(c.dist(c.unit('lens'), nearestFoe(c)));
        return `Enemy units in the glare: ${c.glared().length} of ${c.seenFoes().length}.${Number.isFinite(d) ? ` Nearest: ${d} m from your Lenswrights.` : ''}`;
      },
      marks: glareBadges,
      done: (c) => c.dist(c.unit('lens'), nearestFoe(c)) <= LENS_RANGE || !c.ready('lens'),
      doneText: 'In range.',
    },
    {
      id: 'attack',
      title: 'Attack',
      text: (c) =>
        `Select the **Lenswrights** and ${c.touch ? 'tap' : 'right-click'} an enemy unit to attack it. Burn the Hour Levy at the front. Beams pierce armor and ignore the wind.`,
      hud: (c) => (c.isSelected('lens') ? null : c.card('lens')),
      marks: (c) => [
        { kind: 'unit', unit: c.unit('lens'), label: 'Lenswrights' },
        { kind: 'unit', unit: nearestFoe(c), label: 'Attack this', tone: 'foe' },
        ...glareBadges(c),
      ],
      done: (c) => !!c.attacked('lens') || !c.ready('lens'),
      doneText: 'Target set. The beams burn.',
      auto: (c) => {
        c.select('lens');
        c.attack('lens', nearestFoe(c));
      },
    },
    {
      id: 'sunpatch',
      title: 'Light feeds the beams',
      text: (c) =>
        `Beams burn by the light where the Lenswrights stand: 100% in Dusk, 115% in Bright. Select the **Glasswright**, ${c.click.toLowerCase()} **Sunpatch** (or press 1), then ${c.click.toLowerCase()} the ground under your Lenswrights to bathe them in Bright light.`,
      hud: (c) => (c.isSelected('glasswright') ? c.ability('sunpatch') : c.card('glasswright')),
      marks: (c) => {
        const lens = c.unit('lens');
        const out: Mark[] = [{ kind: 'unit', unit: c.unit('glasswright'), label: 'Glasswright' }];
        if (lens && lens.alive > 0) out.push({ kind: 'area', x: lens.x, y: lens.y, r: 40, label: 'Sunpatch here', done: lens.light >= 3 });
        return out;
      },
      live: (c) => {
        const u = c.unit('lens');
        if (!u || u.alive <= 0) return null;
        return `Lenswrights stand in ${LIGHT_NAMES[u.light]} light: beams at ${Math.round(beamMult(u.light) * 100)}%`;
      },
      done: (c) => !c.ready('lens') || (c.unit('lens')?.light ?? 0) >= 3,
      doneText: 'Bright light: beams at 115%.',
      auto: (c) => {
        const lens = c.unit('lens');
        if (lens) c.cast('glasswright', 'sunpatch', { x: lens.x, y: lens.y });
      },
    },
    {
      id: 'win',
      title: 'Hold the line',
      text: 'Keep the sun at your back and let them come to you through the glare. Win the battle: break every enemy unit.',
      live: (c) => `Enemy army still fighting: ${Math.round(c.b.remainingValue(1) * 100)}%`,
      marks: (c) => [...glareBadges(c), ...c.seenFoes().map((u): Mark => ({ kind: 'unit', unit: u, tone: 'foe' }))],
      done: (c) => c.s.phase === 'over',
    },
  ],
  recap: [
    'Put the sun behind you: the enemy must face it and fights half-blind.',
    'The Choir never suffer glare, and their beams burn brighter in brighter light.',
    'Sunpatch brings Bright light wherever your beams need it.',
    'If an enemy ever gets the sun at its back, face it with Mirror Wardens: their mirrors throw the glare back.',
  ],
};

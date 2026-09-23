/**
 * The Hush: darkness is armor. Glowing bait draws the Choir in; hidden
 * hunters strike their flank from the dark.
 */
import type { TutorialContext } from '../context';
import type { Mark, TutorialDef } from '../types';

const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;

/** Where The Unlit wait, off the enemy's flank. */
const AMBUSH = { x: 600, y: 610, r: 26 };
/** Where the Glowkin Lurers stand as bait. */
const BAIT = { x: 705, y: 615, r: 26 };
const FIELD = { x0: 520, y0: 400, x1: 880, y1: 790 };

function hiddenNote(c: TutorialContext, tag: string, name: string): string | null {
  const u = c.unit(tag);
  if (!u || u.alive <= 0) return null;
  return u.concealed ? `${name}: hidden ◐` : `${name}: seen by the enemy`;
}

/** The enemy unit the Lurers are fighting, or the nearest one to them. */
function prey(c: TutorialContext) {
  const lurers = c.unit('lurers');
  return c.foeFighting('lurers') ?? c.seenFoes().sort((a, b) => c.dist(a, lurers) - c.dist(b, lurers))[0];
}

export const HUSH_TUTORIAL: TutorialDef = {
  id: 'hush',
  faction: 'hush',
  title: 'Darkness Is Armor',
  idea: 'Hide in the dark, lure the enemy with glowing bait, then strike from where no one is looking.',
  blurb: 'In the dim tundra, show a Choir column your glowing Lurers, then hit its flank with hunters it cannot see.',
  learn: ['Stealth in Dim and Dark light', 'Glowing bait that marks its prey', 'Ambush: +50% damage and fear', "Queen Ysh's Unlit Step"],
  minutes: 5,
  field: { light: 1, wind: 0, sunBearing: 0, note: 'Dim light, Calm, the sun below the rim' },
  setup: () => ({
    seed: 'tutorial-hush',
    map: { seed: 5, band: 'dimmark', wind: 0, sunBearing: 0, preset: 'open' },
    unitScale: 0.5,
    timeLimit: 15 * 60,
    armies: [
      {
        faction: 'hush',
        controller: 'player',
        units: [
          { def: 'hush.glowkinLurers', x: 705, y: 690, facing: UP, tag: 'lurers' },
          { def: 'hush.theUnlit', x: 630, y: 700, facing: UP, tag: 'unlit' },
          { def: 'hush.queenYsh', x: 665, y: 745, facing: UP, tag: 'ysh' },
        ],
      },
      {
        faction: 'choir',
        controller: 'ai',
        units: [
          { def: 'choir.kilnAcolytes', x: 655, y: 490, facing: DOWN, tag: 'acoA', strength: 0.8 },
          { def: 'choir.kilnAcolytes', x: 755, y: 490, facing: DOWN, tag: 'acoB', strength: 0.8 },
        ],
      },
    ],
  }),
  steps: [
    {
      id: 'welcome',
      title: 'The Hush',
      text: 'You lead the Hush, hunters of the endless night. In Dim and Dark light your hunters stay unseen until an enemy comes within **40 m**. Set a trap: show the enemy bait, then strike from the dark.',
      pause: true,
      view: FIELD,
    },
    {
      id: 'dim',
      title: 'Dim light',
      text: 'The Rose shows **Dim** light: the sun has sunk below the rim. Everyone sees 25% less far, the Choir less still, and their beams burn at half strength. No sun means no glare and no shadows to worry about.',
      hud: '.rose-wrap',
      pause: true,
    },
    {
      id: 'hidden',
      title: 'Unseen hunters',
      text: (c) =>
        `${c.click} **The Unlit**, the black blades marked on the field. The ◐ beside their banner and the Hidden tag in their panel mean the enemy cannot see them.`,
      marks: (c) => [{ kind: 'unit', unit: c.unit('unlit'), label: 'The Unlit' }],
      done: (c) => c.isSelected('unlit'),
      doneText: 'Selected.',
      auto: (c) => c.select('unlit'),
    },
    {
      id: 'flank',
      title: 'Move in the dark',
      text: (c) =>
        `${c.order} inside the marked circle to send The Unlit off the enemy's flank. They stay hidden on the move, as long as they keep 40 m from the enemy.`,
      marks: (c) => [
        { kind: 'area', ...AMBUSH, label: 'Wait here', done: c.inSpot('unlit', AMBUSH) },
        { kind: 'unit', unit: c.unit('unlit') },
      ],
      live: (c) => hiddenNote(c, 'unlit', 'The Unlit'),
      done: (c) => c.inSpot('unlit', AMBUSH),
      doneText: 'In position, unseen.',
      auto: (c) => {
        c.select('unlit');
        c.move('unlit', AMBUSH.x, AMBUSH.y, 0);
      },
    },
    {
      id: 'bait',
      title: 'The bait',
      text: (c) =>
        `The **Glowkin Lurers** glow, so they can never hide. That makes them bait. Select them and ${c.order.toLowerCase()} inside the marked circle, in front of the enemy.`,
      marks: (c) => [
        { kind: 'area', ...BAIT, label: 'Bait here', done: c.inSpot('lurers', BAIT) },
        { kind: 'unit', unit: c.unit('lurers'), label: 'Glowkin Lurers' },
      ],
      done: (c) => c.inSpot('lurers', BAIT),
      doneText: 'The bait is out.',
      auto: (c) => {
        c.select('lurers');
        c.move('lurers', BAIT.x, BAIT.y, UP);
      },
    },
    {
      id: 'lure',
      title: 'The hook',
      text: 'The Choir can see only the glowing Lurers, and they march on them. Wait until the Lurers are locked in melee. Every enemy the Lurers fight is **Marked**: The Unlit and Queen Ysh deal it 10% more damage.',
      enter: (c) => c.enemyFight({ stance: 'attack', abilityUse: 0 }),
      view: FIELD,
      marks: (c) => [{ kind: 'unit', unit: c.unit('unlit'), label: 'The Unlit, waiting' }],
      live: (c) => hiddenNote(c, 'unlit', 'The Unlit'),
      done: (c) => !!c.foeFighting('lurers') || !c.ready('lurers'),
      doneText: 'They took the bait.',
    },
    {
      id: 'strike',
      title: 'Strike from the dark',
      text: (c) =>
        `Select **The Unlit** and ${c.order.toLowerCase()} the Choir unit fighting your Lurers. Hit it from the side. The first blow from hiding deals **+50% damage** and spreads fear.`,
      hud: (c) => (c.isSelected('unlit') ? null : c.card('unlit')),
      marks: (c) => [
        { kind: 'unit', unit: c.unit('unlit'), label: 'The Unlit' },
        { kind: 'unit', unit: prey(c), label: 'Strike here', tone: 'foe' },
      ],
      done: (c) => c.foes().some((e) => !!e.special.feared) || (c.unit('unlit')?.engaged ?? 0) > 0 || !c.ready('unlit'),
      doneText: 'Ambush! Their line wavers in fear.',
      auto: (c) => {
        c.select('unlit');
        c.attack('unlit', prey(c));
      },
    },
    {
      id: 'queen',
      title: 'The Unlit Step',
      text: (c) =>
        `Queen Ysh hides like The Unlit, and more. Select her and ${c.click.toLowerCase()} **The Unlit Step** (or press 1): for 12 s she stays hidden even while she fights. Then send her in.`,
      hud: (c) => (c.isSelected('ysh') ? c.ability('unlitStep') : c.card('ysh')),
      marks: (c) => [{ kind: 'unit', unit: c.unit('ysh'), label: 'Queen Ysh' }],
      done: (c) => c.used('unlitStep') || !c.ready('ysh'),
      doneText: 'She vanishes into the fight.',
      auto: (c) => {
        c.select('ysh');
        c.cast('ysh', 'unlitStep');
        c.attack('ysh', prey(c));
      },
    },
    {
      id: 'win',
      title: 'Finish the hunt',
      text: (c) =>
        `Send Queen Ysh into the fight: ${c.order.toLowerCase()} an enemy with her selected. Then hunt down every enemy unit still standing. They cannot see you, so they will not come to you.`,
      live: (c) => `Enemy army still fighting: ${Math.round(c.b.remainingValue(1) * 100)}%`,
      marks: (c) => c.seenFoes().map((u): Mark => ({ kind: 'unit', unit: u, tone: 'foe' })),
      done: (c) => c.s.phase === 'over',
    },
  ],
  recap: [
    'In Dim and Dark light, Hush hunters stay hidden until an enemy is within 40 m, even on the move.',
    'Glowing bait draws the enemy in and Marks it for your hunters.',
    'A blow from hiding deals +50% damage and spreads fear. Strike the flank of an enemy already fighting.',
    'On lit fields, carry the dark with you: Veilweavers and the Listener cast Veils.',
  ],
};

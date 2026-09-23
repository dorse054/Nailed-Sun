/**
 * Legends: six set battles built around the design's signature moments,
 * each with its story, its field and both armies fixed. Win to earn bronze;
 * win cheaply for silver and gold. The best medal is kept in the Chronicles.
 */
import type { FactionId } from '../data/schema';
import type { BattleResult, BattleSetup, Side, UnitSpec } from '../sim/types';
import type { MapSetup } from '../sim/terrain';
import type { BattleRequest } from './store';
import { dailyDay, dailyLegend } from './daily';

export type Medal = 'bronze' | 'silver' | 'gold';

export interface Legend {
  id: string;
  title: string;
  /** One line for the list. */
  hook: string;
  /** The briefing, shown while the player deploys. */
  story: string;
  /** What the battle teaches, shown once it is won or lost. */
  lesson: string;
  me: FactionId;
  foe: FactionId;
  map: Omit<MapSetup, 'seed'>;
  mine: string[];
  theirs: string[];
  /** Share of the player's soldiers that may fall for silver and for gold. */
  silver: number;
  gold: number;
  timeLimit?: number;
  /** A fixed field (the Daily Battle); otherwise each attempt draws its own. */
  seed?: number;
}

const N = Math.PI / 2;

export const LEGENDS: Legend[] = [
  {
    id: 'bellCharge',
    title: 'The Bell Charge',
    hook: 'The Vesperate at the Stopped Dial: launch the lancers on the bell.',
    story:
      'The Choir have marched on the Stopped Dial to light it again, and their pikes stand ready for any horseman. Your lancers are few and precious. Hold the line, watch the Toll, and send the Antlered Lancers in when the Hour of the Charge rings.',
    lesson: 'A Vesperate charge on the bell hits far harder than one off it: the Hours are the rhythm of every Vesperate battle.',
    me: 'vesperate',
    foe: 'choir',
    map: { band: 'gloaming', wind: 1, sunBearing: 0, landmark: 'stoppedDial' },
    mine: ['vesperate.maren', 'vesperate.antleredLancers', 'vesperate.antleredLancers', 'vesperate.lanternGuard', 'vesperate.lanternGuard', 'vesperate.hourLevy', 'vesperate.hourLevy', 'vesperate.oathswornHalberdiers', 'vesperate.knellguard', 'vesperate.vesperArbalests', 'vesperate.vesperArbalests', 'vesperate.belfryWagon'],
    theirs: ['choir.oriel', 'choir.mirrorWardens', 'choir.mirrorWardens', 'choir.gnomonGuard', 'choir.gnomonGuard', 'choir.kilnAcolytes', 'choir.kilnAcolytes', 'choir.shardbows', 'choir.lenswrights', 'choir.heliostatBattery'],
    silver: 0.5,
    gold: 0.3,
  },
  {
    id: 'silentCharge',
    title: 'The Silent Charge',
    hook: 'The Hush in the dark wood: a Vesperate column hears nothing, then everything.',
    story:
      'A Vesperate column is feeling its way through the Dimmark woods with lanterns held high. They cannot see you. Let the Glowkin draw their eyes, keep the Unlit in the shadows, and strike when their line is turned the wrong way.',
    lesson: 'The Hush win by choosing when the fight starts: bait with the glowing, strike from the dark, and never trade blows in the open.',
    me: 'hush',
    foe: 'vesperate',
    map: { band: 'dimmark', wind: 0, sunBearing: Math.PI, preset: 'wooded' },
    mine: ['hush.queenYsh', 'hush.theUnlit', 'hush.theUnlit', 'hush.theUnlit', 'hush.glowkinLurers', 'hush.glowkinLurers', 'hush.glowkinLurers', 'hush.hushbows', 'hush.hushbows', 'hush.rimeguard', 'hush.rimeguard', 'hush.grueHunters', 'hush.veilweavers', 'hush.rimeHounds'],
    theirs: ['vesperate.maren', 'vesperate.lanternGuard', 'vesperate.lanternGuard', 'vesperate.hourLevy', 'vesperate.hourLevy', 'vesperate.oathswornHalberdiers', 'vesperate.vesperArbalests', 'vesperate.vesperArbalests', 'vesperate.lamplighters', 'vesperate.bellOutriders'],
    silver: 0.45,
    gold: 0.25,
  },
  {
    id: 'downwindRun',
    title: 'The Downwind Run',
    hook: 'The Drift storm a walled town with the Dreadsail and a gale at their backs.',
    story:
      'A gale is blowing hard toward the town of Ninefold, and the Dreadsail has the wind. Let it gather speed across the open ground and break the wall, then send your riders through the breach and hold the square before the Vesperate can close it.',
    lesson: 'Downwind, the Dreadsail is at its fastest and its ram at its strongest; the wind always blows toward the sun, so a downwind run means facing the glare.',
    me: 'drift',
    foe: 'vesperate',
    map: { band: 'gloaming', wind: 2, sunBearing: -N, fort: { defender: 1, radius: 170 } },
    mine: ['drift.taviLongwind', 'drift.dreadsail', 'drift.galeDancers', 'drift.galeDancers', 'drift.anchorGuard', 'drift.anchorGuard', 'drift.reedspears', 'drift.windbows', 'drift.windbows', 'drift.striderLancers', 'drift.howlingKites'],
    theirs: ['vesperate.maren', 'vesperate.lanternGuard', 'vesperate.lanternGuard', 'vesperate.hourLevy', 'vesperate.hourLevy', 'vesperate.oathswornHalberdiers', 'vesperate.vesperArbalests', 'vesperate.vesperArbalests', 'vesperate.counterweightEngine', 'vesperate.knellCannon'],
    silver: 0.55,
    gold: 0.35,
    timeLimit: 25 * 60,
  },
  {
    id: 'colossusDuel',
    title: 'Light Against Dark',
    hook: 'At a lit Candle, the Nailbearer meets the Umbral Mother.',
    story:
      'The Hush have come to snuff out the Candle of Aum, and the Umbral Mother flies before them. Bring the Nailbearer to meet her: where light and dark collide they cancel, and the fight returns to steel. Keep your pikes near your colossus, and beware the harpoons of the Whalebreakers.',
    lesson: 'Colossi are won by the armies around them: when two meet, their light and dark cancel, and the side that brings pikes and focus wins the duel.',
    me: 'choir',
    foe: 'hush',
    map: { band: 'evernight', wind: 1, sunBearing: N, landmark: 'candle', glow: true },
    mine: ['choir.oriel', 'choir.nailbearer', 'choir.mirrorWardens', 'choir.mirrorWardens', 'choir.gnomonGuard', 'choir.kilnAcolytes', 'choir.kilnAcolytes', 'choir.lenswrights', 'choir.shardbows', 'choir.glasswright'],
    theirs: ['hush.queenYsh', 'hush.umbralMother', 'hush.theUnlit', 'hush.theUnlit', 'hush.glowkinLurers', 'hush.glowkinLurers', 'hush.hushbows', 'hush.hushbows', 'hush.hushbows', 'hush.rimeguard', 'hush.rimeguard', 'hush.whalebreakerBallista'],
    silver: 0.5,
    gold: 0.3,
  },
  {
    id: 'lightWars',
    title: 'Light Wars',
    hook: 'The Hush at dusk: roll the Veil over the Choir line and their beams die.',
    story:
      'The Choir have lit the Gloaming with Sunpatches, and their Lenswrights burn whatever walks into the light. Walk your Veilweavers forward and put out the sun where you need it, then let the Unlit do what they do in the dark.',
    lesson: 'Light is terrain you can make: a Veil shuts off beams and hides the Hush, a Sunpatch exposes them. Whoever controls the light controls the fight.',
    me: 'hush',
    foe: 'choir',
    map: { band: 'gloaming', wind: 0, sunBearing: Math.PI, preset: 'open' },
    mine: ['hush.queenYsh', 'hush.veilweavers', 'hush.veilweavers', 'hush.theUnlit', 'hush.theUnlit', 'hush.hushbows', 'hush.hushbows', 'hush.glowkinLurers', 'hush.glowkinLurers', 'hush.rimeguard', 'hush.duskMothRiders'],
    theirs: ['choir.oriel', 'choir.glasswright', 'choir.lenswrights', 'choir.lenswrights', 'choir.mirrorWardens', 'choir.mirrorWardens', 'choir.kilnAcolytes', 'choir.kilnAcolytes', 'choir.gnomonGuard', 'choir.heliostatBattery'],
    silver: 0.5,
    gold: 0.3,
  },
  {
    id: 'mirrorTrap',
    title: 'The Mirror Trap',
    hook: 'The Drift against the Choir in the Long Afternoon: the sun at your back is a trap.',
    story:
      'Every army wants the sun at its back, and yours has it. But the Choir want to face the sun: its light feeds their mirrors, and they will turn it on you. Swing wide, come at their line from the side, and let your riders do the rest.',
    lesson: 'Against the Choir the usual rule flips: attack from the side, never with the sun at your back.',
    me: 'drift',
    foe: 'choir',
    map: { band: 'longAfternoon', wind: 1, sunBearing: N, steppe: true },
    mine: ['drift.taviLongwind', 'drift.striderLancers', 'drift.striderLancers', 'drift.striderArchers', 'drift.striderArchers', 'drift.dustrunners', 'drift.dustrunners', 'drift.windbows', 'drift.windbows', 'drift.reedspears', 'drift.reedspears', 'drift.galeDancers', 'drift.galewings', 'drift.firekiteBattery'],
    theirs: ['choir.oriel', 'choir.mirrorWardens', 'choir.mirrorWardens', 'choir.gnomonGuard', 'choir.gnomonGuard', 'choir.kilnAcolytes', 'choir.kilnAcolytes', 'choir.shardbows', 'choir.shardbows', 'choir.cinderglassMangonel'],
    silver: 0.5,
    gold: 0.3,
  },
];

export function legendById(id: string): Legend | undefined {
  const day = dailyDay(id);
  return day ? dailyLegend(day) : LEGENDS.find((l) => l.id === id);
}

/** A legend's battle, the player on side 0. Lords lead, so they are placed first. */
export function legendSetup(l: Legend, seed: number, unitScale: number): BattleSetup {
  const specs = (ids: string[]): UnitSpec[] => ids.map((def) => ({ def }));
  const setup: BattleSetup = {
    seed,
    map: { seed, ...l.map },
    armies: [
      { faction: l.me, controller: 'player', units: specs(l.mine) },
      { faction: l.foe, controller: 'ai', units: specs(l.theirs) },
    ],
    unitScale,
  };
  if (l.map.fort) setup.attacker = l.map.fort.defender === 1 ? 0 : 1;
  if (l.timeLimit) setup.timeLimit = l.timeLimit;
  return setup;
}

export function legendRequest(l: Legend, unitScale: number): BattleRequest {
  const seed = l.seed ?? Math.floor(Math.random() * 1e9);
  return { setup: legendSetup(l, seed, unitScale), playerSide: 0, mode: 'custom', title: l.title, briefing: { title: l.title, text: l.story }, legend: l.id };
}

/** The medal a result earns, or null for a battle not won. */
export function medalFor(l: Legend, r: BattleResult, side: Side): Medal | null {
  if (r.winner !== side) return null;
  const s = r.sides[side];
  const lost = s.soldiersLost / Math.max(1, s.soldiersStart);
  return lost < l.gold ? 'gold' : lost < l.silver ? 'silver' : 'bronze';
}

export const MEDAL_RANK: Record<Medal, number> = { bronze: 1, silver: 2, gold: 3 };

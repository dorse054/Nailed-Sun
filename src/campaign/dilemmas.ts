/**
 * Dilemmas: now and then, as the player's Toll begins, the world asks a
 * choice with a price either way. Effects are modest and immediate (coin,
 * food, the faction's resource, public order, how another faction regards
 * you, pressure on the Tilt) and every one is shown before the choice.
 * Which dilemma comes, and when, follows the campaign's own randomness, so a
 * campaign replays the same.
 */
import type { FactionId } from '../data/schema';
import { FACTION_IDS } from '../data/schema';
import { factionDef } from '../data/index';
import type { CampaignState } from './types';
import { atWar, log, ownedRegions, relation, withRng } from './state';
import { regionDef } from './regions';

export interface DilemmaEffect {
  coin?: number;
  food?: number;
  /** The faction's own resource: Radiance, Dread, Hours or Renown. */
  res?: number;
  /** Public order in the dilemma's place. */
  order?: number;
  /** Public order in every region the faction holds. */
  orderAll?: number;
  /** How another faction regards the player. */
  opinion?: { of: FactionId; by: number };
  /** Pressure on the Tilt: positive sunward, negative nightward. */
  tilt?: number;
  /** The place's garrison, weakened for the next assault (0..1). */
  garrisonLoss?: number;
}

export interface DilemmaChoice {
  label: string;
  effect: DilemmaEffect;
}

interface DilemmaDef {
  id: string;
  title: string;
  /** Who can face it. */
  when: (s: CampaignState, f: FactionId) => boolean;
  /** Where it happens: a region id, or null when there is nowhere fitting. */
  where: (s: CampaignState, f: FactionId, pick: (list: string[]) => string | undefined) => string | null;
  text: (place: string, s: CampaignState, f: FactionId) => string;
  choices: (s: CampaignState, f: FactionId) => [DilemmaChoice, DilemmaChoice];
}

/** The first Toll a dilemma can come, and the gap after one (plus up to 2 more). */
const FIRST = 4;
const GAP = 3;
/** Chance a due dilemma comes this Toll. */
const CHANCE = 0.5;

const alive = (s: CampaignState, f: FactionId) => s.factions[f].alive;
const name = (f: FactionId) => factionDef(f).name;
const short = (f: FactionId) => factionDef(f).short;
/** The settlements a faction holds (the Drift hold none: their sails' regions stand in). */
function places(s: CampaignState, f: FactionId): string[] {
  const own = ownedRegions(s, f).filter((id) => regionDef(id).settlement);
  if (own.length) return own;
  return s.armies.filter((a) => a.faction === f).map((a) => a.region);
}
const anyPlace = (s: CampaignState, f: FactionId, pick: (l: string[]) => string | undefined) => pick(places(s, f)) ?? null;
const enemyOf = (s: CampaignState, f: FactionId) => FACTION_IDS.find((o) => o !== f && alive(s, o) && atWar(s, f, o));

const DILEMMAS: DilemmaDef[] = [
  {
    id: 'pilgrims',
    title: 'Pilgrims at the border',
    when: (s, f) => f !== 'choir' && alive(s, 'choir'),
    where: anyPlace,
    text: (p) => `Choir pilgrims ask leave to cross ${p} on their long road to the Candles, singing as they go.`,
    choices: () => [
      { label: 'Let them pass', effect: { opinion: { of: 'choir', by: 12 }, tilt: 6 } },
      { label: 'Charge a toll and turn the rest back', effect: { coin: 90, opinion: { of: 'choir', by: -10 } } },
    ],
  },
  {
    id: 'mooring',
    title: 'Sails on the horizon',
    when: (s, f) => f !== 'drift' && alive(s, 'drift'),
    where: anyPlace,
    text: (p) => `Drift wind-cities ask to tie a trading post to the walls of ${p}. Their coin is good; their manners are not.`,
    choices: () => [
      { label: 'Welcome them', effect: { coin: 150, opinion: { of: 'drift', by: 12 }, order: -3 } },
      { label: 'Send them on their way', effect: { opinion: { of: 'drift', by: -8 }, order: 2 } },
    ],
  },
  {
    id: 'deserters',
    title: 'Deserters',
    when: (s, f) => !!enemyOf(s, f),
    where: anyPlace,
    text: (p) => `Soldiers who fled the war are caught hiding in the barns around ${p}.`,
    choices: () => [
      { label: 'Make an example of them', effect: { order: 5, orderAll: -1 } },
      { label: 'Pay their wages and send them back', effect: { coin: -60, orderAll: 1 } },
    ],
  },
  {
    id: 'blight',
    title: 'Blight',
    when: (_s, f) => f !== 'drift',
    where: anyPlace,
    text: (p) => `A gray blight creeps through the fields of ${p}. The harvest will be thin.`,
    choices: () => [
      { label: 'Open the granaries', effect: { coin: -150, food: 40 } },
      { label: 'Ration what is left', effect: { order: -6, food: 10 } },
    ],
  },
  {
    id: 'shard',
    title: 'A shard of the Nail',
    when: (_s, f) => f === 'choir',
    where: anyPlace,
    text: (p) => `Miners near ${p} bring up a black shard they swear fell from the Nail itself.`,
    choices: () => [
      { label: 'Enshrine it', effect: { res: 40, coin: -120 } },
      { label: 'Sell it to the Drift', effect: { coin: 260, orderAll: -1 } },
    ],
  },
  {
    id: 'whales',
    title: 'The whales come early',
    when: (_s, f) => f === 'hush',
    where: anyPlace,
    text: () => 'The ice-whale herds come early to the Rime Coast, fat and slow under the aurora.',
    choices: () => [
      { label: 'Hunt them now', effect: { food: 50, order: -2 } },
      { label: 'Keep the Listening instead', effect: { res: 25, tilt: -6 } },
    ],
  },
  {
    id: 'bell',
    title: 'A cracked bell',
    when: (_s, f) => f === 'vesperate',
    where: anyPlace,
    text: (p) => `The great bell of ${p} cracks in the cold. Its Hours ring sour.`,
    choices: () => [
      { label: 'Recast it', effect: { coin: -200, res: 20 } },
      { label: 'Let it ring cracked', effect: { res: -15, order: -2 } },
    ],
  },
  {
    id: 'mast',
    title: 'A broken mast',
    when: (_s, f) => f === 'drift',
    where: anyPlace,
    text: (p) => `A gale snaps the great mast of a wind-city near ${p}. The clans watch to see what you do.`,
    choices: () => [
      { label: 'Refit at once', effect: { coin: -150, res: 10 } },
      { label: 'Sail on crippled', effect: { res: -20, coin: 40 } },
    ],
  },
  {
    id: 'scout',
    title: 'A captured scout',
    when: (s, f) => !!enemyOf(s, f),
    where: anyPlace,
    text: (p, s, f) => `A scout of ${name(enemyOf(s, f)!)} is taken in the hills above ${p}.`,
    choices: (s, f) => {
      const e = enemyOf(s, f)!;
      return [
        { label: 'Hang the spy', effect: { order: 2, opinion: { of: e, by: -10 } } },
        { label: 'Send them home with a message', effect: { opinion: { of: e, by: 10 } } },
      ];
    },
  },
  {
    id: 'caravan',
    title: 'A caravan',
    when: (s, f) => f !== 'drift' && alive(s, 'drift'),
    where: anyPlace,
    text: (p) => `A caravan under Drift pennants winds through ${p}, heavy with silk and glass.`,
    choices: () => [
      { label: 'Tax it heavily', effect: { coin: 120, opinion: { of: 'drift', by: -8 } } },
      { label: 'Let it pass freely', effect: { coin: 30, opinion: { of: 'drift', by: 8 } } },
    ],
  },
  {
    id: 'prophet',
    title: 'A prophet of the Turning',
    when: (_s, f) => f !== 'hush',
    where: anyPlace,
    text: (p) => `A pale prophet preaches in the square of ${p}: the Nail is failing, and the long night is coming.`,
    choices: () => [
      { label: 'Silence him', effect: { order: -3, tilt: 4 } },
      { label: 'Let him preach', effect: { order: 2, tilt: -6 } },
    ],
  },
  {
    id: 'sunspeaker',
    title: 'A sunspeaker',
    when: (s, f) => f !== 'choir' && alive(s, 'choir'),
    where: anyPlace,
    text: (p) => `A Choir sunspeaker climbs the steps of ${p} and calls the people to the light.`,
    choices: () => [
      { label: 'Drive her out', effect: { order: 2, opinion: { of: 'choir', by: -6 } } },
      { label: 'Let her preach', effect: { order: -2, tilt: 6 } },
    ],
  },
  {
    id: 'quake',
    title: 'The walls crack',
    when: (s) => s.turn >= 70 || s.shudder.active,
    where: (s, f, pick) => pick(ownedRegions(s, f).filter((id) => regionDef(id).settlement)) ?? null,
    text: (p) => `The Great Shudder shakes ${p} and opens cracks in its walls.`,
    choices: () => [
      { label: 'Repair them at once', effect: { coin: -200 } },
      { label: 'Leave them for now', effect: { garrisonLoss: 0.3 } },
    ],
  },
  {
    id: 'refugees',
    title: 'Refugees',
    when: (s, f) => f !== 'drift' && FACTION_IDS.some((a) => a !== f && alive(s, a) && FACTION_IDS.some((b) => b !== a && alive(s, b) && atWar(s, a, b))),
    where: anyPlace,
    text: (p) => `Refugees from the wars pour toward the gates of ${p}, carrying what they could.`,
    choices: () => [
      { label: 'Take them in', effect: { food: -25, coin: 60, order: -1 } },
      { label: 'Close the gates', effect: { order: -3 } },
    ],
  },
  {
    id: 'festival',
    title: 'A festival',
    when: (s) => s.turn > 10,
    where: anyPlace,
    text: (p) => `The people of ${p} ask for a festival to mark a thousand years and one of the Nailed Sun.`,
    choices: () => [
      { label: 'Hold it', effect: { coin: -100, order: 6 } },
      { label: 'Not this year', effect: { order: -2 } },
    ],
  },
  {
    id: 'lordsHonour',
    title: 'A lord’s ambition',
    when: (s, f) => s.armies.some((a) => a.faction === f && a.lord.wins >= 2),
    where: (s, f) => s.armies.find((a) => a.faction === f && a.lord.wins >= 2)?.region ?? null,
    text: (_p, s, f) => `${s.armies.find((a) => a.faction === f && a.lord.wins >= 2)!.lord.name}, fresh from victory, asks for lands and a title.`,
    choices: () => [
      { label: 'Grant them', effect: { coin: -150, orderAll: 1 } },
      { label: 'Remind them who rules', effect: { order: -3 } },
    ],
  },
];

export function dilemmaDef(id: string): DilemmaDef | undefined {
  return DILEMMAS.find((d) => d.id === id);
}

/** The pending dilemma, with its words and choices, for the UI. */
export function pendingDilemma(s: CampaignState): { title: string; text: string; region?: string; choices: [DilemmaChoice, DilemmaChoice]; written?: boolean } | null {
  const p = s.dilemma;
  if (p?.written) {
    const w = p.written;
    return { title: w.title, text: w.text, region: p.region, choices: w.choices as [DilemmaChoice, DilemmaChoice], written: true };
  }
  const d = p && dilemmaDef(p.id);
  if (!p || !d) return null;
  const f = s.player;
  const place = p.region ? regionDef(p.region).settlement || regionDef(p.region).name : '';
  return { title: d.title, text: d.text(place, s, f), region: p.region, choices: d.choices(s, f) };
}

/**
 * A new Toll: perhaps a dilemma. One at a time, never before Toll 4, then a
 * few Tolls apart, and none the player has already faced until all have come.
 */
export function maybeDilemma(s: CampaignState): boolean {
  const f = s.player;
  if (s.dilemma || s.winner || !s.factions[f].alive || s.turn < (s.nextDilemma ?? FIRST)) return false;
  return withRng(s, (rng) => {
    if (rng.next() >= CHANCE) return false;
    const seen = new Set(s.dilemmasSeen ?? []);
    let pool = DILEMMAS.filter((d) => d.when(s, f));
    if (pool.every((d) => seen.has(d.id))) seen.clear();
    pool = pool.filter((d) => !seen.has(d.id));
    const pick = <T>(list: T[]): T | undefined => (list.length ? list[rng.int(list.length)] : undefined);
    for (let tries = 0; tries < 4 && pool.length; tries++) {
      const d = pick(pool)!;
      const region = d.where(s, f, pick);
      if (region === null) {
        pool = pool.filter((x) => x !== d);
        continue;
      }
      s.dilemma = { id: d.id, region, turn: s.turn };
      s.nextDilemma = s.turn + GAP + rng.int(3);
      return true;
    }
    return false;
  });
}

/** The player chose: apply it and tell the chronicle. */
export function resolveDilemma(s: CampaignState, choice: 0 | 1): boolean {
  const p = pendingDilemma(s);
  const pend = s.dilemma;
  if (!p || !pend) return false;
  const f = s.player;
  const fs = s.factions[f];
  const c = p.choices[choice];
  const e = c.effect;
  if (e.coin) fs.coin += e.coin;
  if (e.food) fs.food += e.food;
  if (e.res) fs.res = Math.max(0, fs.res + e.res);
  const clampOrder = (o: number) => Math.max(-20, Math.min(20, o));
  if (e.order && pend.region && s.regions[pend.region]!.owner === f) s.regions[pend.region]!.order = clampOrder(s.regions[pend.region]!.order + e.order);
  if (e.orderAll) for (const id of ownedRegions(s, f)) s.regions[id]!.order = clampOrder(s.regions[id]!.order + e.orderAll);
  if (e.opinion && s.factions[e.opinion.of].alive) {
    const r = relation(s, f, e.opinion.of);
    r.opinion = Math.max(-100, Math.min(100, r.opinion + e.opinion.by));
  }
  if (e.tilt) s.tiltProgress += e.tilt;
  if (e.garrisonLoss && pend.region) s.regions[pend.region]!.garrisonLoss = Math.max(s.regions[pend.region]!.garrisonLoss ?? 0, e.garrisonLoss);
  log(s, 'info', `${p.title}: ${c.label.charAt(0).toLowerCase()}${c.label.slice(1)}.`, f, pend.region);
  // A written dilemma stood in for the handwritten one, which the player never saw.
  if (!pend.written) s.dilemmasSeen = [...(s.dilemmasSeen ?? []), pend.id];
  s.dilemma = undefined;
  return true;
}

// -------------------------------------------------------- written dilemmas

/**
 * A dilemma written on the spot (by Claude) picks each choice's boon and
 * cost from these, and the game sets how much: as much as a handwritten
 * dilemma gives or takes, so a written one is never worth more.
 */
const BOON_EFFECT: Record<string, DilemmaEffect> = {
  coin: { coin: 120 },
  food: { food: 30 },
  resource: { res: 20 },
  order: { order: 4 },
  orderEverywhere: { orderAll: 1 },
  sunward: { tilt: 5 },
  nightward: { tilt: -5 },
};
const COST_EFFECT: Record<string, DilemmaEffect> = {
  coin: { coin: -100 },
  food: { food: -20 },
  resource: { res: -15 },
  order: { order: -3 },
  orderEverywhere: { orderAll: -1 },
};
export const WRITTEN_BOONS = [...Object.keys(BOON_EFFECT), 'friendship'];
export const WRITTEN_COSTS = [...Object.keys(COST_EFFECT), 'enmity'];

/**
 * A written choice's effect: one boon and one cost of different kinds, a
 * friendship or enmity naming another living faction. Null when the pair
 * doesn't make a fair choice.
 */
export function writtenEffect(s: CampaignState, boon: unknown, cost: unknown, boonOf?: unknown, costOf?: unknown): DilemmaEffect | null {
  const other = (x: unknown): FactionId | null => (FACTION_IDS.includes(x as FactionId) && x !== s.player && s.factions[x as FactionId].alive ? (x as FactionId) : null);
  const kindOf = (k: string) => (k === 'friendship' || k === 'enmity' ? 'opinion' : k === 'sunward' || k === 'nightward' ? 'tilt' : k);
  if (typeof boon !== 'string' || typeof cost !== 'string' || !WRITTEN_BOONS.includes(boon) || !WRITTEN_COSTS.includes(cost)) return null;
  if (kindOf(boon) === kindOf(cost)) return null;
  const e: DilemmaEffect = {};
  if (boon === 'friendship') {
    const f = other(boonOf);
    if (!f) return null;
    e.opinion = { of: f, by: 10 };
  } else Object.assign(e, BOON_EFFECT[boon]);
  if (cost === 'enmity') {
    const f = other(costOf);
    if (!f) return null;
    e.opinion = { of: f, by: -10 };
  } else Object.assign(e, COST_EFFECT[cost]);
  return e;
}

/** An effect in a few words, for the choice buttons. */
export function effectWords(e: DilemmaEffect, s: CampaignState): string[] {
  const out: string[] = [];
  const sign = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
  const res = factionDef(s.player).resource.name;
  if (e.coin) out.push(`${sign(e.coin)} coin`);
  if (e.food) out.push(`${sign(e.food)} food`);
  if (e.res) out.push(`${sign(e.res)} ${res}`);
  if (e.order) out.push(`${sign(e.order)} order here`);
  if (e.orderAll) out.push(`${sign(e.orderAll)} order everywhere`);
  if (e.opinion) out.push(`${short(e.opinion.of)} ${e.opinion.by > 0 ? 'warmer' : 'colder'} (${sign(e.opinion.by)})`);
  if (e.tilt) out.push(`the Tilt strains ${e.tilt > 0 ? 'sunward' : 'nightward'}`);
  if (e.garrisonLoss) out.push('weaker walls here');
  return out;
}


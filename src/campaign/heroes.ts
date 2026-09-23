/**
 * Heroes acting alone on the campaign map. The design: "Heroes join armies
 * or act alone on the map." A hero recruited into an army can be sent out
 * alone. It travels up to two regions a Toll, slipping past enemy armies,
 * and once a Toll it can rally a friendly town, sabotage an enemy one, or
 * scout the land around it. It rejoins any friendly army it meets.
 */
import type { FactionId } from '../data/schema';
import { unitDef } from '../data/index';
import type { CampaignState, CampaignUnit } from './types';
import { stepsFrom } from './geometry';
import { armyById, atWar, log, withRng } from './state';
import { regionDef } from './regions';

export interface HeroState {
  id: string;
  faction: FactionId;
  /** The hero as it stood in its army: experience and wounds travel with it. */
  unit: CampaignUnit;
  region: string;
  /** Regions it can still travel this Toll. */
  moves: number;
  /** Has used its one action this Toll. */
  acted: boolean;
  /** Wounded on a failed sabotage: it rests until this Toll. */
  restUntil?: number;
  /** Scouting: sees two regions out until this Toll ends. */
  scoutUntil?: number;
}

type Result = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): Result => ({ ok: false, reason });
const OK: Result = { ok: true };

export const HERO_MOVES = 2;
/** Order a rallying hero adds to a friendly town. */
export const RALLY_ORDER = 6;
/** Chance a sabotage succeeds, and what it does to the town's garrison. */
export const SABOTAGE_CHANCE = 0.7;
export const SABOTAGE_GARRISON = 0.35;
/** Tolls a hero caught sabotaging must rest. */
export const WOUND_TOLLS = 2;
/** Units an army can hold, as in actions.ts. */
const MAX_ARMY_UNITS = 16;

type WithHeroes = CampaignState & { heroes?: HeroState[]; nextHeroId?: number };

/** The lone heroes on the map (older saves have none). */
export function heroes(s: CampaignState): HeroState[] {
  const w = s as WithHeroes;
  return (w.heroes ??= []);
}

export function heroById(s: CampaignState, id: string): HeroState | undefined {
  return heroes(s).find((h) => h.id === id);
}

export function isHero(def: string): boolean {
  const d = unitDef(def);
  return d.category === 'character' && d.character?.kind === 'hero';
}

function resting(s: CampaignState, h: HeroState): boolean {
  return (h.restUntil ?? 0) > s.turn;
}

/** Send a hero out of its army to act alone. It can move from the next Toll. */
export function detachHero(s: CampaignState, armyId: string, index: number): Result {
  const a = armyById(s, armyId);
  if (!a) return fail('No such army');
  const u = a.units[index];
  if (!u || !isHero(u.def)) return fail('Only heroes can act alone');
  a.units.splice(index, 1);
  const w = s as WithHeroes;
  w.nextHeroId = (w.nextHeroId ?? 0) + 1;
  heroes(s).push({ id: `hero${w.nextHeroId}`, faction: a.faction, unit: u, region: a.region, moves: 0, acted: false });
  log(s, 'info', `${unitDef(u.def).name} leaves ${a.name} to act alone.`, a.faction, a.region);
  return OK;
}

/** Regions the hero can reach this Toll, with the steps to each. */
export function heroReach(s: CampaignState, h: HeroState): Record<string, number> {
  if (h.moves <= 0 || resting(s, h)) return {};
  const all = stepsFrom(h.region);
  const out: Record<string, number> = {};
  for (const [id, d] of Object.entries(all)) if (d > 0 && d <= h.moves) out[id] = d;
  return out;
}

export function moveHero(s: CampaignState, heroId: string, to: string): Result {
  const h = heroById(s, heroId);
  if (!h) return fail('No such hero');
  if (resting(s, h)) return fail('Wounded: resting');
  const d = heroReach(s, h)[to];
  if (d === undefined) return fail(h.moves <= 0 ? 'No travel left this Toll' : 'Too far this Toll');
  h.region = to;
  h.moves -= d;
  return OK;
}

/** Rejoin a friendly army standing in the same region. */
export function joinArmy(s: CampaignState, heroId: string, armyId: string): Result {
  const h = heroById(s, heroId);
  const a = armyById(s, armyId);
  if (!h || !a) return fail('Not found');
  if (a.faction !== h.faction || a.region !== h.region) return fail('The army must be in the same region');
  if (a.units.length >= MAX_ARMY_UNITS) return fail('The army is full');
  if (a.units.some((u) => u.def === h.unit.def)) return fail('One of each hero per army');
  a.units.push(h.unit);
  heroes(s).splice(heroes(s).indexOf(h), 1);
  log(s, 'info', `${unitDef(h.unit.def).name} joins ${a.name}.`, a.faction, a.region);
  return OK;
}

export type HeroActionKind = 'rally' | 'sabotage' | 'scout';

export interface HeroAction {
  kind: HeroActionKind;
  label: string;
  desc: string;
  /** Why it can't be done now, if it can't. */
  why?: string;
}

/** What the hero could do where it stands. */
export function heroActions(s: CampaignState, h: HeroState): HeroAction[] {
  const r = s.regions[h.region]!;
  const def = regionDef(h.region);
  const busy = resting(s, h) ? 'Wounded: resting' : h.acted ? 'Already acted this Toll' : undefined;
  const out: HeroAction[] = [];
  if (def.settlement && r.owner === h.faction) {
    out.push({ kind: 'rally', label: 'Rally the town', desc: `+${RALLY_ORDER} public order in ${def.settlement}.`, why: busy ?? (r.order >= 20 ? 'Order is already at its height' : undefined) });
  }
  if (def.settlement && r.owner !== 'free' && r.owner !== h.faction) {
    const enemy = atWar(s, h.faction, r.owner);
    out.push({
      kind: 'sabotage',
      label: 'Sabotage',
      desc: `${Math.round(SABOTAGE_CHANCE * 100)}%: weakens the garrison of ${def.settlement} for the next assault and stirs unrest. A hero caught is wounded for ${WOUND_TOLLS} Tolls.`,
      why: busy ?? (enemy ? undefined : 'Only against a faction you are at war with'),
    });
  }
  out.push({ kind: 'scout', label: 'Scout', desc: 'See two regions out, armies included, until the end of the next Toll.', why: busy });
  return out;
}

export function heroAct(s: CampaignState, heroId: string, kind: HeroActionKind): Result {
  const h = heroById(s, heroId);
  if (!h) return fail('No such hero');
  const act = heroActions(s, h).find((a) => a.kind === kind);
  if (!act) return fail('Not possible here');
  if (act.why) return fail(act.why);
  const r = s.regions[h.region]!;
  const place = regionDef(h.region).settlement || regionDef(h.region).name;
  const name = unitDef(h.unit.def).name;
  h.acted = true;
  if (kind === 'rally') {
    r.order = Math.min(20, r.order + RALLY_ORDER);
    log(s, 'info', `${name} rallies the people of ${place}.`, h.faction, h.region);
  } else if (kind === 'sabotage') {
    const owner = r.owner as FactionId;
    const won = withRng(s, (rng) => rng.next()) < SABOTAGE_CHANCE;
    if (won) {
      r.garrisonLoss = Math.max(r.garrisonLoss ?? 0, SABOTAGE_GARRISON);
      r.order = Math.max(-20, r.order - 4);
      log(s, 'info', `${name} sabotages ${place}: its garrison is weakened.`, h.faction, h.region);
      log(s, 'warning', `Saboteurs strike ${place}: its garrison is weakened.`, owner, h.region);
    } else {
      h.restUntil = s.turn + WOUND_TOLLS;
      h.moves = 0;
      log(s, 'info', `${name} is caught in ${place} and escapes wounded.`, h.faction, h.region);
      log(s, 'info', `A saboteur is caught in ${place} and driven off.`, owner, h.region);
    }
  } else {
    h.scoutUntil = s.turn + 1;
  }
  return OK;
}

/** A new Toll: heroes may travel and act again; heroes of fallen factions are gone. */
export function heroesNewToll(s: CampaignState): void {
  const list = heroes(s);
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i]!;
    if (!s.factions[h.faction].alive) {
      list.splice(i, 1);
      continue;
    }
    const rest = resting(s, h);
    h.moves = rest ? 0 : HERO_MOVES;
    h.acted = rest;
  }
}

/** Regions a faction's lone heroes can see: their own and the next, two out while scouting. */
export function heroVision(s: CampaignState, f: FactionId): Set<string> {
  const out = new Set<string>();
  for (const h of heroes(s)) {
    if (h.faction !== f) continue;
    const range = (h.scoutUntil ?? 0) >= s.turn ? 2 : 1;
    for (const [id, d] of Object.entries(stepsFrom(h.region))) if (d <= range) out.add(id);
  }
  return out;
}

/**
 * Small helpers over the campaign state: lookups, relations, randomness and
 * the event log. Turn logic, rules and the AI all build on these.
 */
import type { FactionId } from '../data/schema';
import { FACTION_IDS } from '../data/schema';
import { Rng } from '../core/rng';
import type { ArmyState, CampaignEvent, CampaignState, EventKind, Owner, Relation } from './types';
import { REGIONS } from './regions';

export function relKey(a: FactionId, b: FactionId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function relation(s: CampaignState, a: FactionId, b: FactionId): Relation {
  return s.relations[relKey(a, b)]!;
}

/** Whether two owners fight on sight. Free cities never make treaties. */
export function hostile(s: CampaignState, a: Owner, b: Owner): boolean {
  if (a === b) return false;
  if (a === 'free' || b === 'free') return true;
  return relation(s, a, b).stance === 'war';
}

export function atWar(s: CampaignState, a: FactionId, b: FactionId): boolean {
  return a !== b && relation(s, a, b).stance === 'war';
}

export function allied(s: CampaignState, a: FactionId, b: FactionId): boolean {
  return a === b || relation(s, a, b).stance === 'alliance';
}

/** Vassal of whom, if anyone. */
export function overlordOf(s: CampaignState, f: FactionId): FactionId | null {
  for (const o of FACTION_IDS) {
    if (o === f) continue;
    if (relation(s, o, f).vassal === f) return o;
  }
  return null;
}

export function rivals(f: FactionId): FactionId[] {
  return FACTION_IDS.filter((x) => x !== f);
}

export function armiesIn(s: CampaignState, region: string, faction?: FactionId): ArmyState[] {
  return s.armies.filter((a) => a.region === region && (faction === undefined || a.faction === faction));
}

export function armyById(s: CampaignState, id: string): ArmyState | undefined {
  return s.armies.find((a) => a.id === id);
}

export function factionArmies(s: CampaignState, f: FactionId): ArmyState[] {
  return s.armies.filter((a) => a.faction === f);
}

export function ownedRegions(s: CampaignState, f: Owner): string[] {
  return REGIONS.filter((r) => s.regions[r.id]!.owner === f).map((r) => r.id);
}

export function nextId(s: CampaignState, prefix: string): string {
  s.nextId++;
  return `${prefix}${s.nextId}`;
}

/**
 * Campaign randomness: the generator state lives in the save, so a loaded
 * campaign continues exactly where it left off.
 */
export function withRng<T>(s: CampaignState, fn: (rng: Rng) => T): T {
  const rng = new Rng(1);
  rng.setState(s.rng);
  const out = fn(rng);
  s.rng = rng.getState() as [number, number, number, number];
  return out;
}

export function log(s: CampaignState, kind: EventKind, text: string, faction?: FactionId, region?: string): void {
  const e: CampaignEvent = { turn: s.turn, kind, text };
  if (faction) e.faction = faction;
  if (region) e.region = region;
  s.events.push(e);
  if (s.events.length > 300) s.events.splice(0, s.events.length - 300);
}

/** Events the player should hear about: their own, and the world's big news. */
export function playerEvents(s: CampaignState, turn = s.turn): CampaignEvent[] {
  return s.events.filter((e) => e.turn === turn && (!e.faction || e.faction === s.player));
}

export function isAlive(s: CampaignState, f: FactionId): boolean {
  return s.factions[f].alive;
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

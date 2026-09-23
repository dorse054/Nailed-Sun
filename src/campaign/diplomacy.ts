/**
 * Diplomacy between the four factions. Code values each deal and labels it,
 * from insult to generous; the other side accepts in character. Free cities
 * make no treaties.
 */
import type { FactionId } from '../data/schema';
import { FACTION_IDS } from '../data/schema';
import { factionDef } from '../data/index';
import type { CampaignState } from './types';
import { allied, factionArmies, log, ownedRegions, relation } from './state';
import { armyPower } from './rules';
import type { Result } from './actions';

export type DealKind = 'peace' | 'war' | 'trade' | 'alliance' | 'breakAlliance' | 'tribute' | 'mooring' | 'vassal' | 'gift';

export interface Deal {
  kind: DealKind;
  from: FactionId;
  to: FactionId;
  /** Coin offered (gift, tribute per Toll) or asked. */
  coin?: number;
  /** Mooring rights: the region offered to the Drift. */
  region?: string;
}

export type DealLabel = 'insult' | 'poor' | 'fair' | 'good' | 'generous';

export interface DealValue {
  value: number;
  label: DealLabel;
  why: string[];
}

/** Rough military and economic weight of a faction. */
export function factionStrength(s: CampaignState, f: FactionId): number {
  let p = 0;
  for (const a of factionArmies(s, f)) p += armyPower(a);
  p += ownedRegions(s, f).length * 900;
  p += Math.max(0, s.factions[f].coin) * 0.5;
  return p;
}

/** Personalities: the Choir zealous, the Hush patient, the Vesperate cautious, the Drift opportunistic. */
const PERSONALITY: Record<FactionId, { war: number; trade: number; peace: number; pride: number }> = {
  choir: { war: 1.3, trade: 0.8, peace: 0.8, pride: 1.2 },
  hush: { war: 1.1, trade: 0.6, peace: 0.9, pride: 1.1 },
  vesperate: { war: 0.7, trade: 1.4, peace: 1.3, pride: 0.9 },
  drift: { war: 1.0, trade: 1.3, peace: 1.1, pride: 0.8 },
};

function labelOf(v: number): DealLabel {
  if (v < -40) return 'insult';
  if (v < -5) return 'poor';
  if (v < 15) return 'fair';
  if (v < 40) return 'good';
  return 'generous';
}

/** How the receiving faction values a proposed deal. */
export function valueDeal(s: CampaignState, d: Deal): DealValue {
  const rel = relation(s, d.from, d.to);
  const p = PERSONALITY[d.to];
  const why: string[] = [];
  let v = rel.opinion * 0.4;
  if (rel.opinion) why.push(`${rel.opinion > 0 ? 'Goodwill' : 'Bad blood'} (${rel.opinion > 0 ? '+' : ''}${Math.round(rel.opinion * 0.4)})`);
  const mine = factionStrength(s, d.to);
  const theirs = factionStrength(s, d.from);
  const ratio = theirs / Math.max(1, mine);
  const enemy = (d.to === 'choir' && d.from === 'hush') || (d.to === 'hush' && d.from === 'choir');
  if (enemy && d.kind !== 'war') {
    v -= 25;
    why.push('Old enemies (−25)');
  }
  switch (d.kind) {
    case 'peace': {
      const tired = (s.turn - rel.since) * 0.8;
      const fear = (ratio - 1) * 40;
      v += (fear + Math.min(20, tired)) * p.peace - 10 * p.pride;
      why.push(ratio > 1.2 ? 'They are stronger' : ratio < 0.8 ? 'We are winning' : 'Evenly matched');
      if (d.coin) v += d.coin / 50;
      break;
    }
    case 'trade':
      v += 20 * p.trade - (rel.stance === 'war' ? 100 : 0);
      why.push('Trade profits both');
      break;
    case 'alliance': {
      const common = FACTION_IDS.filter((x) => x !== d.from && x !== d.to && relation(s, d.to, x).stance === 'war' && relation(s, d.from, x).stance === 'war').length;
      v += common * 25 - 25 + (rel.trade ? 10 : 0);
      if (common) why.push('A common enemy');
      else why.push('No common enemy');
      break;
    }
    case 'tribute':
      v += ((d.coin ?? 0) / 10) * 1;
      why.push('Coin every Toll');
      break;
    case 'gift':
      v += (d.coin ?? 0) / 20;
      why.push('A gift');
      break;
    case 'mooring':
      v += 10 * p.trade - 15;
      if (d.coin) v += d.coin / 20;
      why.push('A Drift trading post');
      break;
    case 'vassal':
      v += (ratio - 3) * 20 - 40 * p.pride;
      why.push(ratio > 3 ? 'Crushed by their might' : 'Still proud');
      break;
    default:
      break;
  }
  if (s.factions[d.from].finalStage && d.kind !== 'war') {
    v -= 40;
    why.push('They are close to victory (−40)');
  }
  return { value: Math.round(v), label: labelOf(v), why };
}

export function declareWar(s: CampaignState, a: FactionId, b: FactionId): Result {
  const rel = relation(s, a, b);
  if (rel.stance === 'war') return { ok: false, reason: 'Already at war' };
  const broke = rel.stance === 'alliance' || s.turn - rel.since < 10;
  rel.stance = 'war';
  rel.trade = false;
  rel.tribute = undefined;
  rel.since = s.turn;
  rel.opinion = Math.min(rel.opinion, 0) - 30;
  for (const r of Object.values(s.regions)) if (a === 'drift' && r.owner === b) r.mooring = false;
  log(s, 'diplomacy', `${factionDef(a).name} declare war on ${factionDef(b).name}.`);
  // Breaking a fresh treaty angers everyone; allies stand together.
  for (const o of FACTION_IDS) {
    if (o === a || o === b || !s.factions[o].alive) continue;
    if (broke) relation(s, a, o).opinion -= 10;
    if (allied(s, o, b) && relation(s, o, a).stance !== 'war') {
      const r2 = relation(s, o, a);
      r2.stance = 'war';
      r2.trade = false;
      r2.since = s.turn;
      log(s, 'diplomacy', `${factionDef(o).name} honor their alliance and join the war against ${factionDef(a).name}.`);
    }
  }
  return { ok: true };
}

/** Propose a deal; the other side answers in character. */
export function propose(s: CampaignState, d: Deal): { accepted: boolean; value: DealValue } {
  const value = valueDeal(s, d);
  const accepted = value.value >= 0 && canApply(s, d);
  if (accepted) apply(s, d);
  if (!accepted && d.kind !== 'war') relation(s, d.from, d.to).opinion -= value.label === 'insult' ? 5 : 1;
  return { accepted, value };
}

function canApply(s: CampaignState, d: Deal): boolean {
  const rel = relation(s, d.from, d.to);
  switch (d.kind) {
    case 'peace':
      return rel.stance === 'war';
    case 'trade':
      return rel.stance !== 'war' && !rel.trade;
    case 'alliance':
      return rel.stance === 'peace';
    case 'breakAlliance':
      return rel.stance === 'alliance';
    case 'tribute':
    case 'gift':
      return s.factions[d.from].coin >= (d.coin ?? 0);
    case 'mooring':
      return d.to !== 'drift' && d.from === 'drift' ? !!d.region && s.regions[d.region]?.owner === d.to : false;
    case 'vassal':
      return rel.stance !== 'alliance';
    default:
      return true;
  }
}

export function apply(s: CampaignState, d: Deal): void {
  const rel = relation(s, d.from, d.to);
  const A = factionDef(d.from).name;
  const B = factionDef(d.to).name;
  switch (d.kind) {
    case 'peace':
      rel.stance = 'peace';
      rel.since = s.turn;
      rel.opinion += 10;
      if (d.coin) {
        s.factions[d.from].coin -= d.coin;
        s.factions[d.to].coin += d.coin;
      }
      log(s, 'diplomacy', `${A} and ${B} make peace.`);
      break;
    case 'trade':
      rel.trade = true;
      rel.opinion += 10;
      log(s, 'diplomacy', `${A} and ${B} open trade.`);
      break;
    case 'alliance':
      rel.stance = 'alliance';
      rel.since = s.turn;
      rel.opinion += 15;
      log(s, 'diplomacy', `${A} and ${B} swear an alliance.`);
      break;
    case 'breakAlliance':
      rel.stance = 'peace';
      rel.since = s.turn;
      rel.opinion -= 20;
      log(s, 'diplomacy', `${A} end their alliance with ${B}.`);
      break;
    case 'tribute':
      rel.tribute = { from: d.from, amount: d.coin ?? 0, turns: 10 };
      rel.opinion += 5;
      log(s, 'diplomacy', `${A} agree to pay ${B} ${d.coin} coin a Toll for 10 Tolls.`);
      break;
    case 'gift':
      s.factions[d.from].coin -= d.coin ?? 0;
      s.factions[d.to].coin += d.coin ?? 0;
      rel.opinion += Math.min(30, Math.round((d.coin ?? 0) / 40));
      log(s, 'diplomacy', `${A} send ${B} a gift of ${d.coin} coin.`, d.from === s.player || d.to === s.player ? s.player : undefined);
      break;
    case 'mooring':
      if (d.region) s.regions[d.region]!.mooring = true;
      if (d.coin) {
        s.factions.drift.coin -= d.coin;
        s.factions[d.to].coin += d.coin;
      }
      rel.opinion += 5;
      log(s, 'diplomacy', `${B} grant the Drift a mooring.`);
      break;
    case 'vassal':
      rel.stance = 'alliance';
      rel.vassal = d.to;
      log(s, 'diplomacy', `${B} bend the knee and become vassals of ${A}.`);
      break;
    case 'war':
      declareWar(s, d.from, d.to);
      break;
  }
}

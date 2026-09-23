/**
 * Campaign battles: turning armies on the map into a battle setup, and a
 * battle's outcome back into the campaign. The approach direction sets
 * where the sun stands, so marching around to put it at your back matters.
 */
import type { FactionId, StatMods, UnitDef } from '../data/schema';
import { factionDef, unitDef } from '../data/index';
import { datan2 } from '../core/dmath';
import { hashString } from '../core/rng';
import type { ArmySetup, BattleResult, BattleSetup, Side, UnitSpec } from '../sim/types';
import type { ArmyState, BattleReport, CampaignState, Owner, PendingBattle } from './types';
import { regionDef } from './regions';
import { neighbors } from './geometry';
import { armyById, hostile, log, relation } from './state';
import { armyPower, battleLeadership, regionBand, regionWind, wallLevel, regionEffects, sumEffect } from './rules';
import { chainDef, factionChains } from './buildings';
import { lordName } from './names';

export interface UnitRef {
  kind: 'lord' | 'unit' | 'garrison';
  army?: string;
  index?: number;
}

export interface PreparedBattle {
  setup: BattleSetup;
  refs: [UnitRef[], UnitRef[]];
  attackerSide: Side;
  /** The player's side, if the player takes part. */
  playerSide: Side | null;
  attacker: Owner;
  defender: Owner;
}

export const MAX_SIDE_UNITS = 24;
export const AUTO_SCALE = 0.35;
export const AUTO_TIME = 600;

/** The settlement's own defenders, from its culture's roster. */
export function garrisonFor(s: CampaignState, region: string): string[] {
  const r = s.regions[region]!;
  const def = regionDef(region);
  if (!def.settlement) return [];
  const culture: FactionId = r.owner === 'free' ? r.culture : r.owner;
  const eff = regionEffects(r);
  const walls = wallLevel(s, region);
  let n = 1 + r.level + sumEffect(eff, 'garrison') + (def.major ? 1 : 0);
  if (r.owner === 'free' && walls > 0 && sumEffect(eff, 'garrison') === 0) n += 1;
  if (r.owner === 'free' && (def.landmark === 'candle' || def.landmark === 'nailSpire')) n += 2;
  if (r.owner === 'free' && def.major) n += 1;
  const tierCap = Math.max(1, Math.min(3, r.level));
  const roster = factionDef(culture).units.filter((u) => u.tier <= tierCap && u.category !== 'monster');
  const pattern = ['line', 'missile', 'antiLarge', 'missile', 'line', 'shock', 'missileCav', 'antiLarge'];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const role = pattern[i % pattern.length]!;
    const pick = best(roster.filter((u) => u.role === role)) ?? best(roster.filter((u) => u.category === 'infantry'));
    if (pick) out.push(pick.id);
  }
  if (walls >= 2) {
    const art = best(factionDef(culture).units.filter((u) => u.category === 'artillery' && u.tier <= 2));
    if (art) out.push(art.id);
  }
  return out;
}

function best(list: UnitDef[]): UnitDef | undefined {
  return [...list].sort((a, b) => b.tier - a.tier || b.cost - a.cost)[0];
}

export function garrisonPower(s: CampaignState, region: string): number {
  const loss = s.regions[region]!.garrisonLoss ?? 0;
  const walls = wallLevel(s, region);
  let p = 0;
  for (const id of garrisonFor(s, region)) p += unitDef(id).cost * (1 - loss);
  return p * (1 + walls * 0.25);
}

export function defenderPower(s: CampaignState, pb: PendingBattle): number {
  let p = pb.defender.garrison ? garrisonPower(s, pb.region) : 0;
  for (const id of pb.defender.armies) {
    const a = armyById(s, id);
    if (a) p += armyPower(a);
  }
  return p;
}

export function attackerPower(s: CampaignState, pb: PendingBattle): number {
  let p = 0;
  for (const id of pb.attacker.armies) {
    const a = armyById(s, id);
    if (a) p += armyPower(a);
  }
  return p;
}

/** Where the sun stands, seen from the attacker's march. */
export function sunBearing(from: string, to: string, attackerSide: Side): number {
  const f = regionDef(from);
  const t = regionDef(to);
  const ang = datan2(t.y - f.y, t.x - f.x);
  return attackerSide === 0 ? -ang : Math.PI - ang;
}

/** How the sun falls for the attacker: in their eyes, at their back, or on a flank. */
export function sunForAttacker(from: string, to: string): 'eyes' | 'back' | 'flank' {
  const f = regionDef(from);
  const t = regionDef(to);
  const dy = t.y - f.y;
  const dx = t.x - f.x;
  const len = Math.hypot(dx, dy) || 1;
  const c = dy / len;
  if (c > 0.5) return 'eyes';
  if (c < -0.5) return 'back';
  return 'flank';
}

function hymnMods(s: CampaignState, f: FactionId): StatMods | undefined {
  if (f !== 'choir') return undefined;
  const h = s.factions.choir.hymn?.id;
  if (h === 'noon') return { dmgPct: 10 };
  if (h === 'lens') return { missileDmgPct: 15, accuracyPct: 10 };
  if (h === 'unbowed') return { fatigueRatePct: -20 };
  return undefined;
}

export function prepareBattle(s: CampaignState, pb: PendingBattle, opts: { auto: boolean; unitScale: number }): PreparedBattle {
  const player = s.player;
  const attacker = pb.attacker.faction;
  const defender = pb.defender.faction;
  const playerIsDef = defender === player;
  const playerIsAtk = attacker === player;
  const attackerSide: Side = playerIsDef ? 1 : 0;
  const defenderSide = (1 - attackerSide) as Side;
  const def = regionDef(pb.region);
  const walls = pb.assault ? wallLevel(s, pb.region) : 0;
  const refs: [UnitRef[], UnitRef[]] = [[], []];
  const armies: ArmySetup[] = [];

  const build = (side: Side, owner: Owner, armyIds: string[], garrison: boolean, enemy: Owner): ArmySetup => {
    const units: UnitSpec[] = [];
    const r: UnitRef[] = [];
    let lead: ArmyState | null = null;
    for (const id of armyIds) {
      const a = armyById(s, id);
      if (!a) continue;
      lead = lead ?? a;
      if (units.length < MAX_SIDE_UNITS) {
        units.push({ def: a.lord.def });
        r.push({ kind: 'lord', army: a.id });
      }
      a.units.forEach((u, i) => {
        if (units.length >= MAX_SIDE_UNITS) return;
        units.push({ def: u.def, strength: u.strength, rank: u.rank });
        r.push({ kind: 'unit', army: a.id, index: i });
      });
    }
    if (garrison) {
      const loss = s.regions[pb.region]!.garrisonLoss ?? 0;
      for (const g of garrisonFor(s, pb.region)) {
        if (units.length >= MAX_SIDE_UNITS) break;
        units.push({ def: g, strength: Math.max(0.3, 1 - loss), tag: 'garrison' });
        r.push({ kind: 'garrison' });
      }
    }
    refs[side] = r;
    const faction: FactionId = owner === 'free' ? s.regions[pb.region]!.culture : owner;
    const lead2 = owner === 'free' ? { pct: 0, why: [] } : battleLeadership(s, lead, owner, enemy, pb.region);
    const setup: ArmySetup = {
      faction,
      units,
      controller: owner === player ? 'player' : 'ai',
      name: lead ? lead.name : owner === 'free' ? `${def.settlement} garrison` : `${def.settlement} garrison`,
    };
    if (lead2.pct) setup.leadershipPct = lead2.pct;
    const mods = owner === 'free' ? undefined : hymnMods(s, owner);
    if (mods) setup.mods = mods;
    return setup;
  };

  const atk = build(attackerSide, attacker, pb.attacker.armies, false, defender);
  const dfn = build(defenderSide, defender, pb.defender.armies, pb.defender.garrison, attacker);
  armies[attackerSide] = atk;
  armies[defenderSide] = dfn;
  const seed = hashString(`${s.seed}:${s.turn}:${pb.region}:${pb.id}`);
  const setup: BattleSetup = {
    seed,
    map: {
      seed,
      band: regionBand(s, pb.region),
      wind: regionWind(s, pb.region),
      sunBearing: sunBearing(pb.from, pb.region, attackerSide),
      steppe: !!def.galeRoad,
      preset: def.preset ?? 'default',
    },
    armies: armies as [ArmySetup, ArmySetup],
    unitScale: opts.unitScale,
    timeLimit: opts.auto ? AUTO_TIME : walls > 0 ? 25 * 60 : 20 * 60,
    attacker: attackerSide,
  };
  if (walls > 0) setup.map.fort = { defender: defenderSide, radius: 150 + walls * 15 };
  return {
    setup,
    refs,
    attackerSide,
    playerSide: playerIsAtk ? attackerSide : playerIsDef ? defenderSide : null,
    attacker,
    defender,
  };
}

// ------------------------------------------------------------------ results

const XP_RANKS = [0, 40, 110, 220];

function addXp(u: { xp: number; rank: number }, xp: number): boolean {
  u.xp += xp;
  let r = 0;
  for (let i = 0; i < XP_RANKS.length; i++) if (u.xp >= XP_RANKS[i]!) r = i;
  const up = r > u.rank;
  u.rank = Math.max(u.rank, r);
  return up;
}

export interface ApplyOptions {
  fought: boolean;
  /** The Drift choose what to do with a beaten settlement. */
  driftChoice?: 'sack' | 'moor';
}

export function applyBattle(s: CampaignState, pb: PendingBattle, prep: PreparedBattle, result: BattleResult, o: ApplyOptions): BattleReport {
  const aSide = prep.attackerSide;
  const dSide = (1 - aSide) as Side;
  const attackerWon = result.winner === aSide;
  const deadUnits = new Map<string, Set<number>>();
  const slain = new Set<string>();
  let garrisonStart = 0;
  let garrisonAlive = 0;

  for (const side of [0, 1] as Side[]) {
    const sums = result.sides[side].units;
    sums.forEach((sum, i) => {
      const ref = prep.refs[side][i];
      if (!ref) return;
      const d = unitDef(sum.def);
      const single = d.soldiers < 12;
      const frac = sum.start > 0 ? (single ? sum.hp : sum.alive / sum.start) : 0;
      if (ref.kind === 'garrison') {
        garrisonStart += sum.start;
        garrisonAlive += sum.alive;
        return;
      }
      const a = armyById(s, ref.army!);
      if (!a) return;
      if (ref.kind === 'lord') {
        if (sum.alive <= 0) slain.add(a.id);
        return;
      }
      const u = a.units[ref.index!];
      if (!u) return;
      u.strength = Math.max(0, Math.min(1, u.strength * frac));
      addXp(u, 6 + sum.kills * (single ? 0.5 : 1));
      if (sum.alive <= 0 || u.strength < 0.05) {
        if (!deadUnits.has(a.id)) deadUnits.set(a.id, new Set());
        deadUnits.get(a.id)!.add(ref.index!);
        if (d.category === 'colossus') {
          const fs = s.factions[a.faction];
          fs.colossus.alive = false;
          fs.colossus.rebuildAt = s.turn + 10;
          log(s, 'loss', `${d.name} has fallen. It can be raised again on Toll ${s.turn + 10}.`);
        }
      }
    });
  }
  for (const [id, set] of deadUnits) {
    const a = armyById(s, id);
    if (a) a.units = a.units.filter((_, i) => !set.has(i));
  }
  // Fallen lords.
  for (const id of slain) {
    const a = armyById(s, id);
    if (!a) continue;
    const fs = s.factions[a.faction];
    if (a.lord.legendary) {
      fs.lordReturns = s.turn + 5;
      log(s, 'loss', `${a.lord.name} is struck down and carried from the field. They will return on Toll ${s.turn + 5}.`, undefined, pb.region);
    } else {
      log(s, 'loss', `${a.lord.name} falls in battle.`, a.faction, pb.region);
    }
    fs.armiesRaised++;
    a.lord = { name: lordName(a.faction, s.seed * 31 + fs.armiesRaised + 7), def: `${a.faction}.captain`, legendary: false, traits: [], wins: 0 };
  }
  if (pb.defender.garrison && garrisonStart > 0) {
    s.regions[pb.region]!.garrisonLoss = Math.max(0, Math.min(0.7, 1 - garrisonAlive / garrisonStart));
  }

  const aSum = result.sides[aSide];
  const dSum = result.sides[dSide];
  const aLostFrac = aSum.costLost / Math.max(1, aSum.costStart);
  const dLostFrac = dSum.costLost / Math.max(1, dSum.costStart);
  const winner: Owner | null = result.winner === -1 ? null : result.winner === aSide ? pb.attacker.faction : pb.defender.faction;
  const loser: Owner | null = winner === null ? null : winner === pb.attacker.faction ? pb.defender.faction : pb.attacker.faction;

  // Resources from victory.
  if (winner && winner !== 'free') {
    const fs = s.factions[winner];
    fs.wins++;
    const enemyLost = winner === pb.attacker.faction ? dLostFrac : aLostFrac;
    if (winner === 'hush') fs.res = Math.min(100, fs.res + 5 + Math.round(15 * enemyLost));
    if (winner === 'choir' && loser === 'hush') fs.zeal = Math.min(100, fs.zeal + 10);
    if (winner === 'drift') fs.res += 10 + Math.round(20 * enemyLost);
    const leadIds = winner === pb.attacker.faction ? pb.attacker.armies : pb.defender.armies;
    for (const id of leadIds) {
      const a = armyById(s, id);
      if (a) a.lord.wins++;
    }
  }
  if (loser && loser !== 'free') s.factions[loser].losses++;
  if (pb.attacker.faction !== 'free' && pb.defender.faction !== 'free') {
    relation(s, pb.attacker.faction, pb.defender.faction).opinion -= 5;
  }

  let captured = false;
  const r = s.regions[pb.region]!;
  if (attackerWon) {
    // Defenders fall back or are lost.
    for (const id of pb.defender.armies) {
      const a = armyById(s, id);
      if (!a) continue;
      retreat(s, a, pb.region, pb.attacker.faction as FactionId);
    }
    for (const id of pb.attacker.armies) {
      const a = armyById(s, id);
      if (!a) continue;
      a.region = pb.region;
      a.from = pb.from;
      a.moves = 0;
      a.fought = true;
    }
    const takesSettlement = !!regionDef(pb.region).settlement && r.owner !== pb.attacker.faction && hostile(s, pb.attacker.faction as FactionId, r.owner);
    if (takesSettlement) {
      const atk = pb.attacker.faction as FactionId;
      if (atk === 'drift') {
        const choice = o.driftChoice ?? (r.owner === 'free' ? 'moor' : 'sack');
        driftSettlement(s, pb.region, choice);
      } else {
        captureRegion(s, pb.region, atk);
        captured = true;
      }
    }
  } else {
    for (const id of pb.attacker.armies) {
      const a = armyById(s, id);
      if (!a) continue;
      a.moves = 0;
      if (a.region === pb.region) retreat(s, a, pb.region, pb.defender.faction === 'free' ? null : pb.defender.faction);
    }
  }
  // Armies with nothing left are gone.
  s.armies = s.armies.filter((a) => {
    const empty = a.units.length === 0 && slain.has(a.id);
    if (empty) log(s, 'loss', `${a.name} is destroyed.`, undefined, pb.region);
    return !empty;
  });
  const report: BattleReport = {
    id: pb.id,
    turn: s.turn,
    region: pb.region,
    attacker: pb.attacker.faction,
    defender: pb.defender.faction,
    winner,
    assault: pb.assault,
    captured,
    lossesA: aSum.soldiersLost,
    lossesD: dSum.soldiersLost,
    startA: aSum.soldiersStart,
    startD: dSum.soldiersStart,
    fought: o.fought,
  };
  s.reports.push(report);
  if (s.reports.length > 60) s.reports.shift();
  const place = regionDef(pb.region).settlement || regionDef(pb.region).name;
  const nameOf = (x: Owner) => (x === 'free' ? `the free folk of ${place}` : factionDef(x).name);
  const text =
    winner === null
      ? `Battle at ${place}: ${nameOf(pb.attacker.faction)} and ${nameOf(pb.defender.faction)} fight to a standstill.`
      : `Battle at ${place}: ${nameOf(winner)} defeat ${nameOf(loser!)}${captured ? ` and take ${place}` : ''}.`;
  const involvesPlayer = pb.attacker.faction === s.player || pb.defender.faction === s.player;
  log(s, 'battle', text, involvesPlayer ? s.player : undefined, pb.region);
  checkDeaths(s);
  return report;
}

/** A beaten army falls back to the nearest safe region, or is lost. */
export function retreat(s: CampaignState, a: ArmyState, from: string, enemy: FactionId | null): void {
  const safe = neighbors(from).filter((n) => {
    const o = s.regions[n]!.owner;
    if (o !== a.faction && regionDef(n).settlement && hostile(s, a.faction, o)) return false;
    return !s.armies.some((x) => x.region === n && x.faction !== a.faction && hostile(s, a.faction, x.faction));
  });
  safe.sort((x, y) => score(y) - score(x));
  function score(n: string): number {
    const o = s.regions[n]!.owner;
    return (o === a.faction ? 3 : 0) + (a.from === n ? 2 : 0) + (enemy && o === enemy ? -3 : 0);
  }
  const to = safe[0];
  if (!to) {
    log(s, 'loss', `${a.name} is surrounded and destroyed.`, undefined, from);
    s.armies = s.armies.filter((x) => x.id !== a.id);
    for (const u of a.units) if (unitDef(u.def).category === 'colossus') s.factions[a.faction].colossus.alive = false;
    return;
  }
  for (const u of a.units) u.strength *= 0.9;
  a.region = to;
  a.moves = 0;
  a.stance = 'march';
}

/** New owner: buildings become the new owner's equivalents; wonders fall. */
export function captureRegion(s: CampaignState, region: string, f: FactionId): void {
  const r = s.regions[region]!;
  const prev = r.owner;
  const chains = factionChains(f);
  const used = new Set<string>();
  r.slots = r.slots.map((sl) => {
    if (!sl || sl.level <= 0) return null;
    const c = chainDef(sl.chain);
    if (c.kind === 'wonder') return null;
    if (c.faction === f && !used.has(c.id)) {
      used.add(c.id);
      return { chain: c.id, level: sl.level };
    }
    const eq = chains.find((x) => x.kind === c.kind && !used.has(x.id) && !x.river && !x.majorOnly);
    if (!eq) return null;
    used.add(eq.id);
    return { chain: eq.id, level: Math.min(sl.level, eq.names.length) };
  });
  r.owner = f;
  r.takenTurn = s.turn;
  r.order = -4;
  r.garrisonLoss = 0.5;
  r.raidedBy = undefined;
  if (r.mooring && f !== 'drift' && relation(s, f, 'drift').stance === 'war') r.mooring = false;
  if (f === 'choir') s.factions.choir.zeal = Math.min(100, s.factions.choir.zeal + 5);
  if (prev !== 'free') {
    relation(s, f, prev).opinion -= 20;
    log(s, 'capture', `${factionDef(f).name} take ${regionDef(region).settlement} from ${factionDef(prev).name}.`, undefined, region);
  } else {
    log(s, 'capture', `${factionDef(f).name} take ${regionDef(region).settlement}.`, undefined, region);
  }
}

function driftSettlement(s: CampaignState, region: string, choice: 'sack' | 'moor'): void {
  const r = s.regions[region]!;
  const d = s.factions.drift;
  const place = regionDef(region).settlement;
  if (choice === 'sack') {
    const loot = 150 + r.level * 120;
    d.coin += loot;
    d.res += 15;
    r.level = Math.max(1, r.level - 1);
    r.slots = r.slots.slice(0, Math.max(r.slots.length - 1, 1));
    r.order = Math.max(-20, r.order - 6);
    r.garrisonLoss = 0.6;
    log(s, 'capture', `The Drift sack ${place} for ${loot} coin and sail on.`, undefined, region);
  } else {
    const prev = r.owner;
    if (prev !== 'free') relation(s, 'drift', prev).opinion -= 15;
    r.owner = 'free';
    r.takenTurn = s.turn;
    r.order = 0;
    r.mooring = true;
    r.garrisonLoss = 0.5;
    d.coin += 150;
    d.res += 15;
    log(s, 'capture', `The Drift free ${place} and tie a mooring to its walls.`, undefined, region);
  }
}

/** Factions with no land and no armies are gone. */
export function checkDeaths(s: CampaignState): void {
  for (const f of Object.values(s.factions)) {
    if (!f.alive) continue;
    const land = Object.values(s.regions).some((r) => r.owner === f.id);
    const armies = s.armies.some((a) => a.faction === f.id);
    if (!land && !armies) {
      f.alive = false;
      log(s, 'warning', `${factionDef(f.id).name} have fallen. Their banners will not rise again.`);
    }
  }
}

export function pendingSummary(s: CampaignState, pb: PendingBattle): { atk: number; def: number; odds: number } {
  const atk = attackerPower(s, pb);
  const def = defenderPower(s, pb);
  return { atk, def, odds: atk / Math.max(1, atk + def) };
}

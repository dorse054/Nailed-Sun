/**
 * Registry of all faction and unit data.
 */
import type { FactionDef, FactionId, UnitDef } from './schema';
import { CHOIR } from './factions/choir';
import { HUSH } from './factions/hush';
import { VESPERATE } from './factions/vesperate';
import { DRIFT } from './factions/drift';

export const FACTIONS: Record<FactionId, FactionDef> = {
  choir: CHOIR,
  hush: HUSH,
  vesperate: VESPERATE,
  drift: DRIFT,
};

/** Titles for the generic lords who lead armies without a legendary lord. */
export const CAPTAIN_TITLES: Record<FactionId, string> = {
  choir: 'Sun-Captain',
  hush: 'Hunt-Lord',
  vesperate: 'Bell-Captain',
  drift: 'Sail-Master',
};

/**
 * A generic lord: the faction's lord with a smaller bodyguard, a weaker
 * champion and no signature abilities. Used for campaign armies beyond the
 * first, which the legendary lord leads.
 */
function captainOf(f: FactionDef): UnitDef {
  const l = f.lord;
  const title = CAPTAIN_TITLES[f.id];
  return {
    ...l,
    id: `${f.id}.captain`,
    name: title,
    roleLabel: 'Lord',
    tier: 2,
    cost: 650,
    soldiers: Math.max(12, Math.round(l.soldiers * 0.75)),
    leader: l.leader ? { ...l.leader, hp: Math.round(l.leader.hp * 0.65), ma: l.leader.ma - 8, md: l.leader.md - 6 } : undefined,
    character: { kind: 'lord', legendary: false, title: 'Lord' },
    abilities: [],
    mechanics: [],
    hidden: true,
    summary: `A ${title} and bodyguard. Leads armies that lack a legendary lord; no signature ability.`,
  };
}

export const CAPTAINS: Record<FactionId, UnitDef> = {
  choir: captainOf(CHOIR),
  hush: captainOf(HUSH),
  vesperate: captainOf(VESPERATE),
  drift: captainOf(DRIFT),
};

const UNITS = new Map<string, UnitDef>();
for (const f of Object.values(FACTIONS)) {
  for (const u of [...allFactionUnits(f), CAPTAINS[f.id]]) {
    if (UNITS.has(u.id)) throw new Error(`Duplicate unit id ${u.id}`);
    UNITS.set(u.id, u);
  }
}

export function allFactionUnits(f: FactionDef): UnitDef[] {
  return [...f.units, f.colossus, f.lord, ...f.heroes];
}

export function factionDef(id: FactionId): FactionDef {
  return FACTIONS[id];
}

export function unitDef(id: string): UnitDef {
  const u = UNITS.get(id);
  if (!u) throw new Error(`Unknown unit ${id}`);
  return u;
}

export function hasUnit(id: string): boolean {
  return UNITS.has(id);
}

export function allUnits(): UnitDef[] {
  return [...UNITS.values()];
}

/** Units a player can pick in custom battles and recruit in the campaign. */
export function recruitable(f: FactionId): UnitDef[] {
  const fd = FACTIONS[f];
  return [...fd.units, fd.colossus, ...fd.heroes].filter((u) => !u.hidden);
}

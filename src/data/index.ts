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

const UNITS = new Map<string, UnitDef>();
for (const f of Object.values(FACTIONS)) {
  for (const u of allFactionUnits(f)) {
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

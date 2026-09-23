/**
 * Fast lookup of named mechanics on a unit, merged with its faction's.
 */
import type { Mechanic, UnitDef } from '../data/schema';
import { factionDef } from '../data/index';

type MechKind = Mechanic['kind'];
export type MechOf<K extends MechKind> = Extract<Mechanic, { kind: K }>;

const cache = new WeakMap<UnitDef, Map<MechKind, Mechanic>>();

function index(def: UnitDef): Map<MechKind, Mechanic> {
  let m = cache.get(def);
  if (m) return m;
  m = new Map();
  for (const x of factionDef(def.faction).mechanics ?? []) m.set(x.kind, x);
  for (const x of def.mechanics ?? []) m.set(x.kind, x);
  cache.set(def, m);
  return m;
}

export function mechanic<K extends MechKind>(def: UnitDef, kind: K): MechOf<K> | undefined {
  return index(def).get(kind) as MechOf<K> | undefined;
}

export function hasMechanic(def: UnitDef, kind: MechKind): boolean {
  return index(def).has(kind);
}

export function isFlyer(def: UnitDef): boolean {
  return index(def).has('flyer');
}

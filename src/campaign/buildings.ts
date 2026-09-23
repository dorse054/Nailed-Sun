/**
 * Building chains. Every faction has about a dozen: shared kinds (barracks,
 * range, stables, foundry, farm, market, shrine, walls) under its own names,
 * plus a resource building, specials and a wonder that raises its colossus.
 * Chain levels cap at the settlement level, and higher levels unlock higher
 * unit tiers. The Drift build the same way into each wind-city.
 */
import type { FactionId, UnitDef } from '../data/schema';

export type ChainKind =
  | 'barracks'
  | 'range'
  | 'stables'
  | 'foundry'
  | 'farm'
  | 'market'
  | 'shrine'
  | 'walls'
  | 'tower'
  | 'special'
  | 'kites'
  | 'sails'
  | 'wonder';

export interface BuildingEffects {
  coin?: number;
  food?: number;
  order?: number;
  growth?: number;
  /** Faction resource per Toll: Radiance, Dread, Hours or Renown. */
  res?: number;
  /** Extra replenishment for armies here, in % per Toll. */
  replenish?: number;
  /** Wall level for fortified battles. */
  walls?: number;
  /** Extra garrison units. */
  garrison?: number;
  /** Heliograph: reveals enemy armies this many regions away. */
  vision?: number;
  /** Hush lodges: extra food per herd head in the region. */
  herdFood?: number;
  /** Vesperate bell towers: +10% leadership for armies fighting here. */
  bellRange?: boolean;
  /** Vesperate canals: river moves cost a third less. */
  canal?: boolean;
  /** Tilt pressure per Toll (+ sunward). */
  tilt?: number;
  /** Units recruited here start at this experience rank. */
  rank?: number;
  /** Drift sails: extra movement in %. */
  moves?: number;
  /** Recruitment discount in %. */
  recruitPct?: number;
}

export interface ChainDef {
  id: string;
  faction: FactionId;
  kind: ChainKind;
  names: string[];
  costs: number[];
  effects: BuildingEffects[];
  desc: string;
  /** Only in major settlements (wonders). */
  majorOnly?: boolean;
  /** One per faction (wonders). */
  unique?: boolean;
  /** Only in regions on a river. */
  river?: boolean;
  /** Needs this settlement level. */
  minLevel?: number;
  /** Extra resource cost per level (Radiance for Choir towers, Hours for the Belfry). */
  resCost?: number[];
}

const C = [300, 700, 1300];

function chain(
  faction: FactionId,
  id: string,
  kind: ChainKind,
  names: string[],
  effects: BuildingEffects[],
  desc: string,
  extra: Partial<ChainDef> = {},
): ChainDef {
  return { id: `${faction}.${id}`, faction, kind, names, costs: extra.costs ?? C.slice(0, names.length), effects, desc, ...extra };
}

const RECRUIT = (kind: string) => `Recruits ${kind}. Higher levels unlock higher tiers.`;

export const CHAINS: ChainDef[] = [
  // ------------------------------------------------------------------ Choir
  chain('choir', 'barracks', 'barracks', ['Cantory', 'Hall of Cantors', 'Sun Cloister'], [{}, {}, {}], RECRUIT('infantry')),
  chain('choir', 'range', 'range', ['Shard Range', 'Lens Gallery', 'Heliograph Academy'], [{}, {}, {}], RECRUIT('missile infantry')),
  chain('choir', 'stables', 'stables', ['Kilnback Stalls', "Riders' Court", 'Lancer Kilns'], [{}, {}, {}], RECRUIT('cavalry')),
  chain('choir', 'foundry', 'foundry', ['Mirror Foundry', 'Heliostat Works', "Saints' Forge"], [{}, {}, {}], RECRUIT('engines, and at a level-4 city the Molten Saints')),
  chain('choir', 'farm', 'farm', ['Salt Gardens', 'Irrigated Terraces', 'Sun Orchards'], [{ food: 2, growth: 1 }, { food: 4, growth: 1 }, { food: 6, growth: 2 }], 'Food, scaled by the light: best in bright land.'),
  chain('choir', 'market', 'market', ['Glass Market', 'Mirror Exchange', 'Treasury of Light'], [{ coin: 50 }, { coin: 100 }, { coin: 170 }], 'Coin every Toll.'),
  chain('choir', 'shrine', 'shrine', ['Chapel of the Nail', 'Cathedral of Noon', 'Choir Basilica'], [{ order: 2, res: 1 }, { order: 4, res: 2 }, { order: 6, res: 3 }], 'Public order and Radiance. Level 2 trains heroes.'),
  chain('choir', 'walls', 'walls', ['Sunstone Walls', 'Mirror Walls', 'Lens Bastions'], [{ walls: 1, garrison: 1, order: 1 }, { walls: 2, garrison: 2, order: 1 }, { walls: 3, garrison: 3, order: 2 }], 'Walls, gates and towers: attacks here are fortified battles.'),
  chain('choir', 'tower', 'tower', ['Mirror Tower', 'Heliograph Relay', 'Great Heliograph'], [{ res: 2, vision: 2, replenish: 3 }, { res: 4, vision: 2, replenish: 5 }, { res: 6, vision: 3, replenish: 8 }], 'Radiance and the Heliograph Network: reveals enemy armies 2 regions away and speeds replenishment. Fails in Dim and Dark regions unless built on a Candle.'),
  chain('choir', 'glassworks', 'special', ['Glassworks', 'Great Kiln', 'Lensworks'], [{ coin: 40, res: 1 }, { coin: 80, res: 2 }, { coin: 120, res: 3, recruitPct: 10 }], 'Coin and Radiance from sunglass. The Lensworks cut recruitment costs here.'),
  chain('choir', 'hospice', 'special', ['Hospice', 'House of Mending', "Saint's Rest"], [{ replenish: 5, order: 1 }, { replenish: 8, order: 2 }, { replenish: 12, order: 3 }], 'Armies here replenish faster.'),
  chain('choir', 'nailForge', 'wonder', ['The Nail Forge'], [{ tilt: 4, res: 4 }], 'Wonder: forges the Nailbearer, and pushes the Tilt sunward every Toll.', { majorOnly: true, unique: true, costs: [3000], minLevel: 3 }),

  // ------------------------------------------------------------------- Hush
  chain('hush', 'barracks', 'barracks', ['Lure Camp', 'Rime Barracks', 'Hall of the Unlit'], [{}, {}, {}], RECRUIT('infantry')),
  chain('hush', 'range', 'range', ['Bow Hollow', 'Hushbow Lodge', 'Silent Gallery'], [{}, {}, {}], RECRUIT('missile infantry')),
  chain('hush', 'stables', 'stables', ['Hound Kennels', 'Grue Pits', 'Moth Roost'], [{}, {}, {}], RECRUIT('hounds, riders and moths')),
  chain('hush', 'foundry', 'foundry', ['Bone Yard', 'Spitter Pits', 'Whalebreaker Docks'], [{}, {}, {}], RECRUIT('engines, and at a level-4 city the Lanternmaws')),
  chain('hush', 'lodge', 'farm', ['Hunting Lodge', 'Herd Trails', 'The Great Hunt'], [{ herdFood: 1, food: 1 }, { herdFood: 2, food: 2 }, { herdFood: 3, food: 3, growth: 1 }], 'The Hush do not farm: lodges take food from the migrating herds when they pass.'),
  chain('hush', 'market', 'market', ['Fur Market', 'Bone Exchange', 'Night Bazaar'], [{ coin: 50 }, { coin: 100 }, { coin: 170 }], 'Coin every Toll.'),
  chain('hush', 'shrine', 'shrine', ['Listening Stones', 'Veil Shrine', 'Choir of Silence'], [{ order: 2 }, { order: 4, res: 1 }, { order: 6, res: 2 }], 'Public order. Level 2 trains heroes.'),
  chain('hush', 'walls', 'walls', ['Ice Palisade', 'Rime Walls', 'Glacier Bastion'], [{ walls: 1, garrison: 1, order: 1 }, { walls: 2, garrison: 2, order: 1 }, { walls: 3, garrison: 3, order: 2 }], 'Walls, gates and towers: attacks here are fortified battles.'),
  chain('hush', 'trophies', 'tower', ['Trophy Hall', 'Hall of Silence', 'Dread Spire'], [{ res: 1, order: 1 }, { res: 2, order: 1 }, { res: 3, order: 2 }], 'Dread every Toll, and Dread decays slower while the halls stand.'),
  chain('hush', 'glowgarden', 'special', ['Glowgarden', 'Spore Terraces', 'Lumen Groves'], [{ food: 2 }, { food: 3, growth: 1 }, { food: 5, growth: 1 }], 'Fungal gardens that grow without light. Food in any band.'),
  chain('hush', 'carvers', 'special', ['Bone Carvers', 'Whalebone Armory', 'Rime Forge'], [{ coin: 30 }, { coin: 60, rank: 1 }, { coin: 90, rank: 1 }], 'Whalebone arms: units recruited here start with experience.'),
  chain('hush', 'hollow', 'wonder', ["The Mother's Hollow"], [{ tilt: -4, res: 4 }], 'Wonder: births the Umbral Mother, and pushes the Tilt nightward every Toll.', { majorOnly: true, unique: true, costs: [3000], minLevel: 3 }),

  // -------------------------------------------------------------- Vesperate
  chain('vesperate', 'barracks', 'barracks', ['Levy Yard', 'Oath Hall', 'Knell Barracks'], [{}, {}, {}], RECRUIT('infantry')),
  chain('vesperate', 'range', 'range', ['Arbalest Yard', "Lamplighters' Guild", 'Vesper Armory'], [{}, {}, {}], RECRUIT('missile infantry')),
  chain('vesperate', 'stables', 'stables', ['Outrider Stables', 'Antler Paddocks', 'Lancer Halls'], [{}, {}, {}], RECRUIT('cavalry')),
  chain('vesperate', 'foundry', 'foundry', ['Bell Foundry', 'Engine Works', 'Knell Foundry'], [{}, {}, {}], RECRUIT('engines and bell-cannon')),
  chain('vesperate', 'farm', 'farm', ['Grain Farms', 'Granaries', 'Harvest Mills'], [{ food: 2, growth: 1 }, { food: 4, growth: 1 }, { food: 6, growth: 2 }], 'Food, scaled by the light: best in the Gloaming.'),
  chain('vesperate', 'market', 'market', ['Market Hall', 'Lantern Exchange', 'House Lantern Bank'], [{ coin: 50 }, { coin: 100 }, { coin: 170 }], 'Coin every Toll. Pleases House Lantern.'),
  chain('vesperate', 'shrine', 'shrine', ['Chapel of Hours', 'Calendar House', 'Hall of Observances'], [{ order: 2, res: 1 }, { order: 4, res: 1 }, { order: 6, res: 2 }], 'Public order and Hours. Level 2 trains heroes.'),
  chain('vesperate', 'walls', 'walls', ['Stone Walls', 'Curtain Walls', 'Weir Bastions'], [{ walls: 1, garrison: 1, order: 1 }, { walls: 2, garrison: 2, order: 2 }, { walls: 3, garrison: 4, order: 2 }], 'The strongest walls in the world. Pleases House Weir.'),
  chain('vesperate', 'belltower', 'tower', ['Bell Tower', 'Great Bell', 'Carillon'], [{ res: 2, bellRange: true }, { res: 4, bellRange: true, order: 1 }, { res: 6, bellRange: true, order: 2 }], 'Hours every Toll. Bell Range: your armies fighting here gain +10% leadership.'),
  chain('vesperate', 'canal', 'special', ['Canal Locks', 'Canal Works', 'Great Canal'], [{ canal: true, coin: 30 }, { canal: true, coin: 60, food: 1 }, { canal: true, coin: 100, food: 2 }], 'Canals: your armies move a third faster along rivers. Pleases House Weir.', { river: true }),
  chain('vesperate', 'guildhall', 'special', ['Guildhall', 'House Seat', 'Hall of the Houses'], [{ coin: 30, order: 1 }, { coin: 60, order: 2 }, { coin: 90, order: 3 }], 'Coin and order; raises the loyalty of all three Houses a little each Toll.'),
  chain('vesperate', 'belfry', 'wonder', ['The Great Belfry'], [{ res: 4, order: 2 }], 'Wonder: casts and houses Old Midnight. Its bells are heard across the Gloaming.', { majorOnly: true, unique: true, costs: [3000], minLevel: 3, resCost: [60] }),

  // ------------------------------------------------------------------ Drift
  chain('drift', 'barracks', 'barracks', ['Reed Camp', "Dancers' Deck", 'Anchor Hall'], [{}, {}, {}], RECRUIT('infantry')),
  chain('drift', 'range', 'range', ['Windbow Loft', 'Archery Deck', 'Stormbow Deck'], [{}, {}, {}], RECRUIT('missile infantry')),
  chain('drift', 'stables', 'stables', ['Strider Pens', 'Dustrunner Pens', 'Lancer Pens'], [{}, {}, {}], RECRUIT('strider cavalry')),
  chain('drift', 'foundry', 'foundry', ['Sailcart Yard', 'Firekite Works', 'Storm Foundry'], [{}, {}, {}], RECRUIT('sailcarts and firekites')),
  chain('drift', 'kites', 'kites', ['Kite Mews', 'Galewing Roost', 'Sky Eyrie'], [{}, {}, {}], RECRUIT('kites and gliders')),
  chain('drift', 'market', 'market', ['Rope Market', 'Trade Deck', 'Sail Bazaar'], [{ coin: 60 }, { coin: 110 }, { coin: 170 }], 'Coin every Toll, wherever the wind-city is.'),
  chain('drift', 'shrine', 'shrine', ['Wind Shrine', 'Storm Altar', 'Moot Circle'], [{ res: 1 }, { res: 2 }, { res: 4 }], 'Renown every Toll. Level 2 trains heroes.'),
  chain('drift', 'forage', 'farm', ['Foragers', 'Herders', 'Sky Farms'], [{ food: 2 }, { food: 3 }, { food: 5 }], 'Food for the wind-city, in any band.'),
  chain('drift', 'sails', 'sails', ['Extra Sails', 'Storm Sails', 'Great Sails'], [{ moves: 10 }, { moves: 20 }, { moves: 30 }], 'The wind-city moves farther every Toll.'),
  chain('drift', 'stormLoft', 'wonder', ['The Storm Loft'], [{ res: 4 }], 'Wonder: rigs the Dreadsail. Only one wind-city can carry it.', { unique: true, costs: [3000], minLevel: 3 }),
];

export const CHAIN_BY_ID: Record<string, ChainDef> = Object.fromEntries(CHAINS.map((c) => [c.id, c]));

export function chainDef(id: string): ChainDef {
  const c = CHAIN_BY_ID[id];
  if (!c) throw new Error(`Unknown building chain ${id}`);
  return c;
}

export function factionChains(f: FactionId): ChainDef[] {
  return CHAINS.filter((c) => c.faction === f);
}

/** Which chain kind trains a unit, and at what level. */
export function recruitRequirement(u: UnitDef): { kind: ChainKind; level: number; cityLevel: number } {
  const tier = Math.min(4, u.tier);
  const level = Math.min(3, Math.max(1, tier));
  const cityLevel = Math.max(1, tier);
  if (u.category === 'colossus') return { kind: 'wonder', level: 1, cityLevel: 3 };
  if (u.category === 'character') return { kind: 'shrine', level: 2, cityLevel: 2 };
  if (u.faction === 'drift' && (u.category === 'flyer' || u.role === 'support')) return { kind: 'kites', level, cityLevel };
  if (u.category === 'artillery' || u.category === 'monster') return { kind: 'foundry', level, cityLevel };
  if (u.category === 'cavalry' || u.category === 'beast' || u.category === 'flyer') return { kind: 'stables', level, cityLevel };
  if (u.role === 'missile') return { kind: 'range', level, cityLevel };
  if (u.role === 'support') return { kind: 'shrine', level: Math.max(1, level), cityLevel };
  return { kind: 'barracks', level, cityLevel };
}

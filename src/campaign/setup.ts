/**
 * A new campaign: the map as the Shudder finds it. The Hush hold the
 * north-east Evernight, the Choir the south-central Long Afternoon, the
 * Vesperate the central Gloaming, and the Drift sail the western Gale Roads
 * with no cities at all. Everything else is free settlements.
 */
import type { FactionId } from '../data/schema';
import { FACTION_IDS } from '../data/schema';
import { factionDef } from '../data/index';
import { Rng } from '../core/rng';
import type { ArmyState, BuildingSlot, CampaignState, CampaignUnit, Difficulty, FactionState, Relation, RegionState } from './types';
import { REGIONS } from './regions';
import { relKey } from './state';
import { slotCount } from './rules';
import { lordName } from './names';

const CAPITAL: Record<FactionId, string> = { choir: 'aumsgate', hush: 'pole', vesperate: 'vesper', drift: 'kiteFields' };

export function capitalOf(f: FactionId): string {
  return CAPITAL[f];
}

/** Which roster a free settlement fields, by band and road. */
function cultureOf(id: string): FactionId {
  const r = REGIONS.find((x) => x.id === id)!;
  if (r.galeRoad) return 'drift';
  if (r.h < 2) return 'hush';
  if (r.h < 3) return 'vesperate';
  return 'choir';
}

// Every settlement starts with open plots, so the first Tolls hold real choices.
const START_BUILDINGS: Record<string, [string, number][]> = {
  aumsgate: [['choir.barracks', 1], ['choir.range', 1], ['choir.walls', 1]],
  glassFurnace: [['choir.glassworks', 1]],
  oasis: [['choir.farm', 1]],
  pole: [['hush.barracks', 1], ['hush.range', 1], ['hush.walls', 1]],
  rimeCoast: [['hush.carvers', 1]],
  glowgardens: [['hush.glowgarden', 1]],
  vesper: [['vesperate.barracks', 1], ['vesperate.range', 1], ['vesperate.walls', 1]],
  amberfields: [['vesperate.farm', 1]],
  canalReach: [['vesperate.canal', 1]],
  bellmarch: [['vesperate.belltower', 1]],
  candleAum: [],
  candleVigil: [],
  candleEmber: [],
  tundraMarch: [['hush.walls', 1]],
};

function units(defs: [string, number][]): CampaignUnit[] {
  const out: CampaignUnit[] = [];
  for (const [d, n] of defs) for (let i = 0; i < n; i++) out.push({ def: d, strength: 1, rank: 0, xp: 0 });
  return out;
}

function slots(list: [string, number][], count: number): (BuildingSlot | null)[] {
  const out: (BuildingSlot | null)[] = [];
  for (let i = 0; i < count; i++) {
    const b = list[i];
    out.push(b ? { chain: b[0], level: b[1] } : null);
  }
  return out;
}

export interface NewCampaignOptions {
  faction: FactionId;
  seed?: number;
  difficulty?: Difficulty;
  colossusUnique?: boolean;
}

export function newCampaign(o: NewCampaignOptions): CampaignState {
  const seed = o.seed ?? 1;
  const rng = new Rng(`campaign:${seed}`);
  const regions: Record<string, RegionState> = {};
  for (const r of REGIONS) {
    const owner = r.start ?? 'free';
    const capital = Object.values(CAPITAL).includes(r.id);
    const level = capital ? 3 : r.major ? 2 : 1;
    const culture = owner === 'free' ? cultureOf(r.id) : owner;
    const list = START_BUILDINGS[r.id] ?? [];
    const st: RegionState = {
      id: r.id,
      owner,
      level: r.settlement ? level : 0,
      growth: rng.int(4),
      slots: r.settlement ? slots(list, slotCount(r.id, level)) : [],
      order: owner === 'free' ? 0 : 6,
      takenTurn: -99,
      culture,
    };
    if (r.landmark === 'candle') st.lit = true;
    regions[r.id] = st;
  }

  const factions = {} as Record<FactionId, FactionState>;
  for (const f of FACTION_IDS) {
    factions[f] = {
      id: f,
      player: f === o.faction,
      alive: true,
      coin: { choir: 1600, hush: 1500, vesperate: 1800, drift: 2200 }[f],
      food: 20,
      res: { choir: 60, hush: 20, vesperate: 30, drift: 0 }[f],
      zeal: 20,
      lens: 0,
      herds: [],
      calendar: ['harvest', 'muster', 'market', 'vigil'],
      houses: { carillon: 55, lantern: 50, weir: 50 },
      greatTollCooldown: 0,
      migrations: 0,
      colossus: { alive: false, rebuildAt: 0, built: false },
      hold: 0,
      finalStage: false,
      armiesRaised: 0,
      wins: 0,
      losses: 0,
    };
  }
  factions.hush.herds = [
    { region: 'glowgardens', size: 3, hunted: 0 },
    { region: 'tundraMarch', size: 4, hunted: 0 },
    { region: 'palewood', size: 3, hunted: 0 },
  ];

  const relations: Record<string, Relation> = {};
  for (let i = 0; i < FACTION_IDS.length; i++) {
    for (let j = i + 1; j < FACTION_IDS.length; j++) {
      const a = FACTION_IDS[i]!;
      const b = FACTION_IDS[j]!;
      const war = (a === 'choir' && b === 'hush') || (a === 'hush' && b === 'choir');
      relations[relKey(a, b)] = { stance: war ? 'war' : 'peace', opinion: war ? -60 : 0, trade: false, since: 0 };
    }
  }
  relations[relKey('vesperate', 'drift')]!.opinion = 15;
  relations[relKey('vesperate', 'choir')]!.opinion = 5;

  const s: CampaignState = {
    version: 1,
    seed,
    turn: 1,
    tilt: 0,
    tiltProgress: 0,
    player: o.faction,
    difficulty: o.difficulty ?? 'normal',
    factions,
    regions,
    armies: [],
    relations,
    events: [],
    reports: [],
    shudder: { active: false, next: 0, stillness: 0 },
    nextId: 0,
    rng: rng.getState() as [number, number, number, number],
    options: { colossusUnique: o.colossusUnique ?? true, jev: false },
  };

  const army = (f: FactionId, region: string, legendary: boolean, list: [string, number][], city?: [string, number][]): ArmyState => {
    const fd = factionDef(f);
    const fs = s.factions[f];
    fs.armiesRaised++;
    s.nextId++;
    const a: ArmyState = {
      id: `a${s.nextId}`,
      faction: f,
      name: armyName(f, fs.armiesRaised),
      lord: legendary
        ? { name: fd.lord.name, def: fd.lord.id, legendary: true, traits: [], wins: 0 }
        : { name: lordName(f, s.seed * 31 + fs.armiesRaised), def: `${f}.captain`, legendary: false, traits: [], wins: 0 },
      units: units(list),
      region,
      moves: 100,
      stance: 'march',
    };
    if (city) a.city = { level: 1, slots: slots(city, 3) };
    if (f === 'drift') a.bandsVisited = [2];
    s.armies.push(a);
    return a;
  };

  army('choir', 'aumsgate', true, [
    ['choir.kilnAcolytes', 2],
    ['choir.mirrorWardens', 1],
    ['choir.gnomonGuard', 1],
    ['choir.shardbows', 2],
    ['choir.heliographerRiders', 1],
    ['choir.cinderglassMangonel', 1],
  ]);
  army('hush', 'pole', true, [
    ['hush.glowkinLurers', 2],
    ['hush.rimeguard', 1],
    ['hush.hushbows', 2],
    ['hush.rimeHounds', 1],
    ['hush.grueHunters', 1],
    ['hush.veilweavers', 1],
  ]);
  // The Long Hunt: the Hush have the least free land in reach and a war
  // with the Choir from the first Toll, so a second, lighter host rides out.
  army('hush', 'glowgardens', false, [
    ['hush.glowkinLurers', 2],
    ['hush.hushbows', 1],
    ['hush.rimeHounds', 1],
  ]);
  army('vesperate', 'vesper', true, [
    ['vesperate.hourLevy', 2],
    ['vesperate.lanternGuard', 1],
    ['vesperate.oathswornHalberdiers', 1],
    ['vesperate.vesperArbalests', 2],
    ['vesperate.bellOutriders', 1],
    ['vesperate.counterweightEngine', 1],
  ]);
  army(
    'drift',
    'kiteFields',
    true,
    [
      ['drift.reedspears', 1],
      ['drift.anchorGuard', 1],
      ['drift.windbows', 2],
      ['drift.dustrunners', 1],
      ['drift.striderArchers', 1],
    ],
    [
      ['drift.barracks', 1],
      ['drift.range', 1],
      ['drift.market', 1],
    ],
  );
  army(
    'drift',
    'kiteFields',
    false,
    [
      ['drift.reedspears', 1],
      ['drift.windbows', 1],
      ['drift.dustrunners', 1],
      ['drift.galeDancers', 1],
    ],
    [
      ['drift.stables', 1],
      ['drift.kites', 1],
    ],
  );

  s.events.push({
    turn: 1,
    kind: 'shudder',
    text: 'The Shudder: the sun slipped a hair’s breadth. Every permanent shadow twitched, and the wind died for an hour. Everyone now believes the Nail is failing.',
  });
  return s;
}

const ARMY_NAMES: Record<FactionId, string[]> = {
  choir: ['The First Choir', 'The Second Choir', 'The Lens of Noon', 'The Burning Verse', 'The White Procession', 'The Last Hymn', 'The Mirror Host', 'The Pilgrim Host'],
  hush: ['The Quiet Court', 'The Long Hunt', 'The Unlit Host', 'The Rime Pack', 'The Listening Host', 'The Pale Tide', 'The Moth Court', 'The Deep Hunt'],
  vesperate: ['The Evening Host', 'The Carillon Guard', 'The Lantern Host', 'The Weir Company', 'The Ninth Hour', 'The Vigil Host', 'The Bronze Company', 'The Dial Guard'],
  drift: ['The Longwind Sail', 'The Second Sail', 'The Kite Clan', 'The Storm Sail', 'The Dust Sail', 'The Red Sail', 'The High Sail', 'The Far Sail'],
};

export function armyName(f: FactionId, n: number): string {
  const list = ARMY_NAMES[f];
  return n <= list.length ? list[n - 1]! : `${list[(n - 1) % list.length]} ${Math.ceil(n / list.length)}`;
}

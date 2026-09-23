/**
 * The campaign map: about 30 regions along the terminator, north (dark) to
 * south (bright). Each region has one settlement, a light band given by its
 * sun-height, a wind strength and one resource. The Gale Roads run down the
 * western edge through all five bands.
 *
 * Map space is 1600 x 1000: x runs west to east, y north to south. The sun
 * lies due south, so a larger y means a higher sun.
 */
import type { FactionId, WindLevel } from '../data/schema';

export const MAP_W = 1600;
export const MAP_H = 1000;

export type ResourceId =
  | 'furs'
  | 'sulfur'
  | 'gold'
  | 'whalebone'
  | 'fungus'
  | 'silk'
  | 'timber'
  | 'iron'
  | 'amber'
  | 'kites'
  | 'grain'
  | 'bronze'
  | 'water'
  | 'salt'
  | 'obsidian'
  | 'glass'
  | 'copper'
  | 'relics';

export const RESOURCES: Record<ResourceId, { name: string; coin: number; food?: number; desc: string }> = {
  furs: { name: 'Furs', coin: 25, desc: 'Night-pelts traded south for coin.' },
  sulfur: { name: 'Sulfur', coin: 30, desc: 'Vent-sulfur for kilns and fire-kites.' },
  gold: { name: 'Candle gold', coin: 45, desc: 'Gold from the sunlit peaks.' },
  whalebone: { name: 'Whalebone', coin: 30, desc: 'Ice-whale bone for Hush arms and armor.' },
  fungus: { name: 'Glowfungus', coin: 15, food: 2, desc: 'Pale gardens that grow without light.' },
  silk: { name: 'Moth silk', coin: 35, desc: 'Spun by the barrens moths; prized for sails.' },
  timber: { name: 'Timber', coin: 25, desc: 'Wood for engines, walls and wind-cities.' },
  iron: { name: 'Iron', coin: 35, desc: 'Ore for blades and armor.' },
  amber: { name: 'Amber', coin: 30, desc: 'Sap from the sunward-bowed forests.' },
  kites: { name: 'Kite cloth', coin: 25, desc: 'Where the Drift clans gather.' },
  grain: { name: 'Amber grain', coin: 20, food: 3, desc: 'The endless harvest of the Gloaming.' },
  bronze: { name: 'Bell bronze', coin: 35, desc: 'Metal for bells and cannon.' },
  water: { name: 'Sweet water', coin: 20, food: 2, desc: 'Springs and falls in a thirsty land.' },
  salt: { name: 'Salt', coin: 30, desc: 'Salt pans, traded across every band.' },
  obsidian: { name: 'Obsidian', coin: 30, desc: 'Black glass from the shadowed vales.' },
  glass: { name: 'Sunglass', coin: 40, desc: 'The Choir furnace-glass for lenses and mirrors.' },
  copper: { name: 'Copper', coin: 30, desc: 'Red ore from the mesas.' },
  relics: { name: 'Relics', coin: 40, desc: 'Pilgrim offerings at the foot of the Spire.' },
};

export type LandmarkId =
  | 'candle'
  | 'nailSpire'
  | 'pole'
  | 'stoppedDial'
  | 'kiteFields'
  | 'rimeSea'
  | 'leaningWood'
  | 'mistfalls'
  | 'umbralVale'
  | 'vents'
  | 'furnaces';

export const LANDMARKS: Record<LandmarkId, { name: string; desc: string }> = {
  candle: { name: 'A Candle', desc: 'A peak tall enough to catch the sun: a gold spire burning in the dark. Choir holy site. Hold all three to begin the Last Lens; extinguish all three to begin the Turning.' },
  nailSpire: { name: 'The Nail Spire', desc: 'Said to pin the sun. Site of the Choir Last Lens and the Hush final ritual.' },
  pole: { name: 'The Pole of Night', desc: 'The darkest place in the world. Seat of the Hush queen; the Listening here pushes the Tilt nightward.' },
  stoppedDial: { name: 'The Stopped Dial', desc: 'A giant sundial whose shadow never moved, until the Shudder moved it one notch.' },
  kiteFields: { name: 'The Kite Fields', desc: 'Where Drift clans gather for their great moots under a sky crowded with kites. No settlement: whoever holds the field holds the moot.' },
  rimeSea: { name: 'The Rime Sea', desc: 'A frozen ocean under the aurora. Its ice-whales give the Hush bone for weapons and armor.' },
  leaningWood: { name: 'The Leaning Wood', desc: 'Colossal trees bowed sunward like a frozen wave. Deep cover on the nightward side only.' },
  mistfalls: { name: 'The Mistfalls', desc: 'Rivers pour off cliffs and boil into walls of mist with permanent rainbows. A natural chokepoint.' },
  umbralVale: { name: 'The Umbral Vales', desc: 'Canyons in permanent shadow, cold and dark inside the day. The Hush use them as hidden roads.' },
  vents: { name: 'The Vent Fields', desc: 'Steaming vents keep pale gardens alive under the stars.' },
  furnaces: { name: 'The Glass Furnaces', desc: 'Where the Choir melt sand into sunglass for their lenses.' },
};

export type MapPreset = 'default' | 'open' | 'wooded' | 'hilly' | 'river';

export interface RegionDef {
  id: string;
  name: string;
  /** The region's one settlement; empty for the Kite Fields. */
  settlement: string;
  major: boolean;
  x: number;
  y: number;
  /**
   * Sun-height: 0..5, one unit per band. Each Tilt point moves it a fifth of
   * a band, so regions near a band edge flip first.
   */
  h: number;
  wind: WindLevel;
  resource: ResourceId;
  galeRoad?: boolean;
  river?: boolean;
  landmark?: LandmarkId;
  /** An Umbral Vale: Shadow Roads link every vale. */
  vale?: boolean;
  start?: FactionId;
  preset?: MapPreset;
  desc: string;
}

export const REGIONS: RegionDef[] = [
  // ------------------------------------------------------------ The Evernight
  {
    id: 'frostgate',
    name: 'Frostwind Gate',
    settlement: 'Kestrel Moot',
    major: false,
    x: 120,
    y: 115,
    h: 0.58,
    wind: 2,
    resource: 'furs',
    galeRoad: true,
    preset: 'open',
    desc: 'Where the Gale Roads climb into the night: a pass that howls without end.',
  },
  {
    id: 'ventfields',
    name: 'The Vent Fields',
    settlement: 'Sulfurwell',
    major: false,
    x: 360,
    y: 75,
    h: 0.35,
    wind: 0,
    resource: 'sulfur',
    landmark: 'vents',
    preset: 'hilly',
    desc: 'Steaming vents keep a few pale gardens alive under the stars.',
  },
  {
    id: 'candleAum',
    name: "Aum's Candle",
    settlement: 'The Candle of Aum',
    major: false,
    x: 560,
    y: 170,
    h: 0.85,
    wind: 0,
    resource: 'gold',
    landmark: 'candle',
    preset: 'hilly',
    desc: 'The westernmost Candle. Its gold summit burns in the dark; Candlekeeper monks guard the stair.',
  },
  {
    id: 'rimeCoast',
    name: 'The Rime Coast',
    settlement: 'Whalefall',
    major: false,
    x: 850,
    y: 65,
    h: 0.3,
    wind: 1,
    resource: 'whalebone',
    landmark: 'rimeSea',
    start: 'hush',
    preset: 'open',
    desc: 'The shore of the frozen Rime Sea. Hush hunters take ice-whales here for bone.',
  },
  {
    id: 'candleVigil',
    name: 'Vigil Candle',
    settlement: 'The Candle of Vigil',
    major: false,
    x: 1060,
    y: 185,
    h: 0.88,
    wind: 0,
    resource: 'gold',
    landmark: 'candle',
    preset: 'hilly',
    desc: 'The middle Candle, within sight of the Pole. Pilgrims climb it by the light of its summit.',
  },
  {
    id: 'pole',
    name: 'The Pole of Night',
    settlement: 'Hollowthrone',
    major: true,
    x: 1330,
    y: 55,
    h: 0.05,
    wind: 0,
    resource: 'fungus',
    landmark: 'pole',
    start: 'hush',
    desc: 'The darkest place in the world. Seat of Queen Ysh and the Hush greatest ritual site.',
  },
  {
    id: 'candleEmber',
    name: 'Ember Candle',
    settlement: 'The Candle of Embers',
    major: false,
    x: 1510,
    y: 190,
    h: 0.9,
    wind: 0,
    resource: 'gold',
    landmark: 'candle',
    preset: 'hilly',
    desc: 'The eastern Candle, deep in Hush country. Its keepers have not seen a friendly face in a generation.',
  },
  // -------------------------------------------------------------- The Dimmark
  {
    id: 'mothbarrens',
    name: 'The Moth Barrens',
    settlement: 'Wingfall',
    major: false,
    x: 110,
    y: 330,
    h: 1.55,
    wind: 2,
    resource: 'silk',
    galeRoad: true,
    preset: 'open',
    desc: 'Moth-haunted barrens where the Gale Roads cross the Dimmark.',
  },
  {
    id: 'palewood',
    name: 'The Pale Wood',
    settlement: 'Ghostbough',
    major: false,
    x: 340,
    y: 300,
    h: 1.45,
    wind: 1,
    resource: 'timber',
    preset: 'wooded',
    desc: 'Pale fungal forests taller than towers, lit by drifting spores.',
  },
  {
    id: 'tundraMarch',
    name: 'The Tundra March',
    settlement: 'Grimsward',
    major: true,
    x: 600,
    y: 340,
    h: 1.68,
    wind: 1,
    resource: 'furs',
    preset: 'open',
    desc: 'Open tundra where the great herds run in the red rim-light. A free city of trappers holds the ford.',
  },
  {
    id: 'greyReach',
    name: 'Greyreach',
    settlement: 'Irongrave',
    major: false,
    x: 860,
    y: 290,
    h: 1.4,
    wind: 1,
    resource: 'iron',
    preset: 'hilly',
    desc: 'Grey hills of iron ore, dug by free miners who pay no one.',
  },
  {
    id: 'redRim',
    name: 'The Red Rim',
    settlement: 'Emberwatch',
    major: false,
    x: 1110,
    y: 360,
    h: 1.82,
    wind: 1,
    resource: 'amber',
    preset: 'default',
    desc: 'The first place a northerner sees the sun: a red rim on the horizon. The border everyone watches.',
  },
  {
    id: 'glowgardens',
    name: 'The Glowgardens',
    settlement: 'Lumen Hollow',
    major: false,
    x: 1360,
    y: 300,
    h: 1.3,
    wind: 0,
    resource: 'fungus',
    start: 'hush',
    preset: 'wooded',
    desc: 'Glowing fungal gardens that feed the Hush and light their lures.',
  },
  {
    id: 'hollowMoors',
    name: 'The Hollow Moors',
    settlement: 'Mothwatch',
    major: false,
    x: 1530,
    y: 400,
    h: 1.76,
    wind: 1,
    resource: 'amber',
    preset: 'default',
    desc: 'Wet moors under a red rim of sun, where moths the size of kites nest in the peat.',
  },
  // -------------------------------------------------------------- The Gloaming
  {
    id: 'kiteFields',
    name: 'The Kite Fields',
    settlement: '',
    major: false,
    x: 130,
    y: 525,
    h: 2.5,
    wind: 2,
    resource: 'kites',
    galeRoad: true,
    landmark: 'kiteFields',
    preset: 'open',
    desc: 'Where the Drift clans hold their great moots under a sky crowded with kites.',
  },
  {
    id: 'leaningWood',
    name: 'The Leaning Wood',
    settlement: 'Bowhollow',
    major: false,
    x: 360,
    y: 470,
    h: 2.3,
    wind: 1,
    resource: 'timber',
    landmark: 'leaningWood',
    preset: 'wooded',
    desc: 'Colossal trees bowed sunward like a frozen wave. Deep cover on the nightward side only.',
  },
  {
    id: 'amberfields',
    name: 'The Amber Fields',
    settlement: 'Harrowmere',
    major: false,
    x: 590,
    y: 545,
    h: 2.6,
    wind: 1,
    resource: 'grain',
    start: 'vesperate',
    preset: 'open',
    desc: 'Endless amber grain under an endless sunset: the breadbasket of the Vesperate.',
  },
  {
    id: 'vesper',
    name: 'Vesper',
    settlement: 'Vesper',
    major: true,
    x: 830,
    y: 490,
    h: 2.45,
    wind: 1,
    resource: 'bronze',
    river: true,
    landmark: 'stoppedDial',
    start: 'vesperate',
    preset: 'river',
    desc: 'The Vesperate capital, city of bells, built around the Stopped Dial.',
  },
  {
    id: 'canalReach',
    name: 'Ninefold Canals',
    settlement: 'Ninefold',
    major: false,
    x: 1070,
    y: 560,
    h: 2.72,
    wind: 0,
    resource: 'grain',
    river: true,
    start: 'vesperate',
    preset: 'river',
    desc: 'Nine canals and a hundred locks, dug by House Weir. Barges carry the harvest to Vesper.',
  },
  {
    id: 'bellmarch',
    name: 'Bellmarch',
    settlement: 'Carillon Keep',
    major: false,
    x: 1300,
    y: 470,
    h: 2.32,
    wind: 1,
    resource: 'bronze',
    vale: true,
    start: 'vesperate',
    preset: 'hilly',
    desc: 'The eastern march of the Vesperate, where House Carillon rings the watch. A shadowed cleft runs beneath it.',
  },
  {
    id: 'mistfalls',
    name: 'The Mistfalls',
    settlement: 'Rainbow Weir',
    major: false,
    x: 1500,
    y: 600,
    h: 2.9,
    wind: 1,
    resource: 'water',
    river: true,
    landmark: 'mistfalls',
    preset: 'river',
    desc: 'Where the Gloaming rivers pour off cliffs and boil into walls of mist with permanent rainbows.',
  },
  // ------------------------------------------------------- The Long Afternoon
  {
    id: 'saltroad',
    name: 'The Salt Road',
    settlement: 'Brinecross',
    major: false,
    x: 120,
    y: 720,
    h: 3.5,
    wind: 2,
    resource: 'salt',
    galeRoad: true,
    preset: 'open',
    desc: 'The Gale Roads cross the salt pans here, white and blinding.',
  },
  {
    id: 'umbralVale',
    name: 'The Umbral Vales',
    settlement: 'Shadowfold',
    major: false,
    x: 380,
    y: 700,
    h: 3.35,
    wind: 0,
    resource: 'obsidian',
    landmark: 'umbralVale',
    vale: true,
    preset: 'hilly',
    desc: 'Canyons in permanent shadow, cold and dark inside the day. The Hush call them roads.',
  },
  {
    id: 'glassFurnace',
    name: 'The Furnace Coast',
    settlement: 'Kilnreach',
    major: false,
    x: 630,
    y: 745,
    h: 3.7,
    wind: 1,
    resource: 'glass',
    landmark: 'furnaces',
    start: 'choir',
    preset: 'default',
    desc: 'Glass furnaces burn day and endless day, melting salt-sand into sunglass.',
  },
  {
    id: 'aumsgate',
    name: 'Aumsgate',
    settlement: 'Aumsgate',
    major: true,
    x: 880,
    y: 705,
    h: 3.55,
    wind: 1,
    resource: 'glass',
    start: 'choir',
    preset: 'default',
    desc: 'The Choir capital: white towers and mirror-domes that never cast a changing shadow.',
  },
  {
    id: 'oasis',
    name: 'The Oasis of Tears',
    settlement: 'Mirrormere',
    major: false,
    x: 1130,
    y: 740,
    h: 3.65,
    wind: 0,
    resource: 'water',
    start: 'choir',
    preset: 'river',
    desc: 'A mirror-still lake in the salt, ringed by Choir hospices.',
  },
  {
    id: 'mesas',
    name: 'The Red Mesas',
    settlement: 'Cinderhold',
    major: false,
    x: 1400,
    y: 690,
    h: 3.4,
    wind: 1,
    resource: 'copper',
    vale: true,
    preset: 'hilly',
    desc: 'Red mesas split by shadowed canyons, held by copper-miners who answer to no Cantor.',
  },
  // ------------------------------------------------------------- The Glare
  {
    id: 'scour',
    name: 'The Scour',
    settlement: 'Last Well',
    major: false,
    x: 140,
    y: 905,
    h: 4.5,
    wind: 2,
    resource: 'salt',
    galeRoad: true,
    preset: 'open',
    desc: 'Where the Gale Roads end in a scouring wind of hot glass-dust.',
  },
  {
    id: 'fusedWaste',
    name: 'The Fused Waste',
    settlement: "Pilgrim's Rest",
    major: false,
    x: 480,
    y: 900,
    h: 4.4,
    wind: 0,
    resource: 'glass',
    preset: 'open',
    desc: 'A desert of fused glass under a sun straight overhead. Only pilgrims live here, and not for long.',
  },
  {
    id: 'nailSpire',
    name: 'The Nail Spire',
    settlement: 'The Spire',
    major: false,
    x: 860,
    y: 925,
    h: 4.85,
    wind: 0,
    resource: 'relics',
    landmark: 'nailSpire',
    preset: 'open',
    desc: 'Said to pin the sun. The Choir would build the Last Lens here; the Hush would finish their Turning.',
  },
  {
    id: 'boiledSea',
    name: 'The Boiled Sea',
    settlement: 'Saltglass',
    major: false,
    x: 1260,
    y: 905,
    h: 4.45,
    wind: 1,
    resource: 'salt',
    preset: 'open',
    desc: 'A sea that boiled away a thousand years ago, leaving salt cliffs and glass shores.',
  },
];

export const REGION_BY_ID: Record<string, RegionDef> = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

export function regionDef(id: string): RegionDef {
  const r = REGION_BY_ID[id];
  if (!r) throw new Error(`Unknown region ${id}`);
  return r;
}

export const CANDLES = REGIONS.filter((r) => r.landmark === 'candle').map((r) => r.id);
export const VALES = REGIONS.filter((r) => r.vale).map((r) => r.id);
export const NAIL_SPIRE = 'nailSpire';
export const POLE = 'pole';
export const STOPPED_DIAL = 'vesper';
export const KITE_FIELDS = 'kiteFields';

/**
 * A battle Claude makes up for the Custom Battle screen: a name and a
 * briefing for the player, the place, light and wind, and both armies from
 * the real rosters. Everything it answers is checked against the rules before
 * it is used: unknown units are dropped, each army is kept to its budget, the
 * unit limit and one colossus, a lord always leads, and an army left too thin
 * is filled in by the game's own recruiter.
 */
import { FACTIONS, recruitable } from '../data/index';
import { ARMY, BANDS } from '../data/rules';
import { BAND_IDS, FACTION_IDS, LIGHT_NAMES, type BandId, type FactionId, type WindLevel } from '../data/schema';
import { Rng } from '../core/rng';
import { generateArmy } from '../game/armyGen';
import type { MapSetup } from '../sim/terrain';
import { askClaudeJson, claudeStatus } from './claude';

export type ScenarioKind = 'field' | 'assault' | 'defend';
export type ScenarioSun = 'eyes' | 'back' | 'left' | 'right';
export type ScenarioPlace = 'anywhere' | 'deadCandle' | NonNullable<MapSetup['landmark']>;
export type ScenarioPreset = NonNullable<MapSetup['preset']>;

export interface Scenario {
  title: string;
  briefing: string;
  me: FactionId;
  foe: FactionId;
  kind: ScenarioKind;
  place: ScenarioPlace;
  band: BandId;
  steppe: boolean;
  preset: ScenarioPreset;
  wind: WindLevel;
  sun: ScenarioSun;
  budget: number;
  mine: string[];
  theirs: string[];
}

/** The landmarks a scenario may use, each in the band it lies in. */
export const SCENARIO_PLACES: { id: ScenarioPlace; name: string; band?: BandId }[] = [
  { id: 'anywhere', name: 'anywhere in the band (no landmark)' },
  { id: 'nailSpire', name: 'the Nail Spire, at the heart of the Glare', band: 'glare' },
  { id: 'candle', name: 'a lit Candle, a gold peak burning in the Evernight', band: 'evernight' },
  { id: 'deadCandle', name: 'a dead Candle, gone dark', band: 'evernight' },
  { id: 'pole', name: 'the Pole of Night, the darkest place in the world', band: 'evernight' },
  { id: 'stoppedDial', name: 'the Stopped Dial, in the Gloaming', band: 'gloaming' },
  { id: 'umbralVale', name: 'an Umbral Vale, a canyon of shadow', band: 'longAfternoon' },
  { id: 'mistfalls', name: 'the Mistfalls, where rivers boil into mist', band: 'gloaming' },
  { id: 'leaningWood', name: 'the Leaning Wood, trees bowed to the sun', band: 'gloaming' },
  { id: 'rimeSea', name: 'the Rime Sea, frozen and cracked', band: 'evernight' },
];

const BUDGETS = [6000, 9000, 12000, 18000];
const PRESETS: ScenarioPreset[] = ['default', 'open', 'wooded', 'hilly', 'river'];
const SUNS: ScenarioSun[] = ['eyes', 'back', 'left', 'right'];
const KINDS: ScenarioKind[] = ['field', 'assault', 'defend'];

function roster(f: FactionId): string {
  const fd = FACTIONS[f];
  const lines = recruitable(f).map((u) => `  ${u.id}: ${u.name} (${u.roleLabel.toLowerCase()}, ${u.cost})`);
  return [`${fd.name} (${f}): ${fd.pitch}`, `  Their lord, always included: ${fd.lord.name} (${fd.lord.cost})`, ...lines].join('\n');
}

/** An army from the answer, kept to the rules; null when too little of it was usable. */
function army(f: FactionId, ids: unknown, budget: number): string[] | null {
  const fd = FACTIONS[f];
  const pool = recruitable(f);
  const byId = new Map(pool.map((u) => [u.id, u]));
  const byName = new Map(pool.map((u) => [u.name.toLowerCase(), u]));
  const out = [fd.lord.id];
  let spent = fd.lord.cost;
  let colossus = false;
  for (const x of Array.isArray(ids) ? ids : []) {
    if (typeof x !== 'string') continue;
    const u = byId.get(x) ?? byId.get(`${f}.${x}`) ?? byName.get(x.toLowerCase());
    if (!u) continue;
    if (u.role === 'colossus') {
      if (colossus) continue;
      colossus = true;
    }
    if (spent + u.cost > budget || out.length - 1 >= ARMY.maxUnits) continue;
    out.push(u.id);
    spent += u.cost;
  }
  return out.length >= 4 ? out : null;
}

const pick = <T,>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/**
 * Ask Claude for a battle, optionally about something the player asked for.
 * Null when Claude is unavailable or the answer can't be used.
 */
export async function askScenario(wish: string, signal?: AbortSignal): Promise<Scenario | null> {
  if (claudeStatus.value !== 'ready') return null;
  const prompt = [
    'You design battles for Nailed Sun, a strategy game of real-time battles. The world is tidally locked: one half burns in endless noon, the other freezes in endless night, and the sun had not moved in a thousand years until it shuddered. Four factions fight over the light.',
    wish.trim() ? `The player asks for: ${wish.trim().slice(0, 200)}` : 'Invent a battle with a story: a place, a reason to fight, and a twist in the conditions or the armies.',
    '',
    'Light bands, from night to noon: ' + BAND_IDS.map((b) => `${b} (${BANDS[b].name}, ${LIGHT_NAMES[BANDS[b].light]} light)`).join(', ') + '.',
    'Places: ' + SCENARIO_PLACES.map((p) => `${p.id} (${p.name})`).join('; ') + '. A place sets its own band.',
    'Ground: default, open, wooded, hilly or river; or steppe: true for the open Gale Roads. Wind: 0 calm, 1 breeze, 2 gale; it always blows toward the sun.',
    'The sun, as the player deploys: eyes (in their eyes), back (at their back), left or right. Glare blinds whoever faces the sun, except the Choir, whose mirrors want it.',
    'Kinds: field (open battle), assault (the player storms a walled town), defend (the player holds a walled town).',
    `Budgets: ${BUDGETS.join(', ')} points for the player; the enemy may have from 60% to 160% of it, for the story. Each army has at most ${ARMY.maxUnits} units besides its lord and at most one colossus; the lord counts toward the budget.`,
    '',
    'The armies, by unit id:',
    ...FACTION_IDS.map(roster),
    '',
    'Write the title (2 to 6 words) and a briefing to the player as their commander: two or three sentences, second person, vivid, naming the place and why this fight matters. No numbers in the briefing.',
    'Reply with only JSON: {"title": "...", "briefing": "...", "me": "<faction id>", "foe": "<another faction id>", "kind": "field|assault|defend", "place": "<place id>", "band": "<band id>", "steppe": false, "ground": "<ground>", "wind": 0, "sun": "eyes|back|left|right", "budget": 12000, "foeBudget": 12000, "mine": ["<unit id>", ...], "theirs": ["<unit id>", ...]}',
  ].join('\n');
  let j: Record<string, unknown> | null;
  try {
    // Asking again should bring another battle, not the same one replayed from the cache.
    j = await askClaudeJson<Record<string, unknown> | null>(prompt, { modelTier: 'default', signal, cache: false });
  } catch {
    return null;
  }
  if (!j) return null;
  const me = pick(j.me, FACTION_IDS, 'vesperate' as FactionId);
  const foe = pick(j.foe, FACTION_IDS.filter((f) => f !== me), FACTION_IDS.find((f) => f !== me)!);
  const place = pick(j.place, SCENARIO_PLACES.map((p) => p.id), 'anywhere' as ScenarioPlace);
  const band = SCENARIO_PLACES.find((p) => p.id === place)?.band ?? pick(j.band, BAND_IDS, 'gloaming' as BandId);
  const budget = pick(j.budget, BUDGETS, ARMY.customBudget);
  const fb = typeof j.foeBudget === 'number' && Number.isFinite(j.foeBudget) ? Math.round(Math.min(budget * 1.6, Math.max(budget * 0.6, j.foeBudget)) / 100) * 100 : budget;
  const seed = Math.floor(Math.random() * 1e6);
  const mine = army(me, j.mine, budget) ?? generateArmy(me, budget, new Rng(`${seed}:me`)).map((s) => s.def);
  const theirs = army(foe, j.theirs, fb) ?? generateArmy(foe, fb, new Rng(`${seed}:foe`)).map((s) => s.def);
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').replace(/^"|"$/g, '').slice(0, max) : '');
  const title = clean(j.title, 80);
  const briefing = clean(j.briefing, 600);
  if (!title || briefing.length < 20) return null;
  return {
    title,
    briefing,
    me,
    foe,
    kind: pick(j.kind, KINDS, 'field'),
    place,
    band,
    steppe: place === 'anywhere' && j.steppe === true,
    preset: pick(j.ground, PRESETS, 'default'),
    wind: pick(j.wind, [0, 1, 2] as WindLevel[], 1),
    sun: pick(j.sun, SUNS, 'left'),
    budget,
    mine,
    theirs,
  };
}

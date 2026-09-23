/**
 * The tale of a battle, told by Claude as a chronicler of the player's people
 * would tell it: from the armies, the field, the turning points and how it
 * ended. Asked for only when the player wants it; null when Claude can't be
 * asked or says nothing useful.
 */
import { LANDMARKS } from '../../campaign/regions';
import { factionDef, unitDef } from '../../data/index';
import { BANDS } from '../../data/rules';
import { LIGHT_NAMES, WIND_NAMES } from '../../data/schema';
import type { BattleResult, BattleSetup, Side, SideSummary } from '../../sim/types';
import { askClaudeJson, claudeStatus } from '../claude';
import { clock, type Moment } from './moments';

export interface Tale {
  title: string;
  text: string;
}

const lossWords = (s: SideSummary) => {
  const x = s.soldiersLost / Math.max(1, s.soldiersStart);
  return x < 0.15 ? 'lost few' : x < 0.35 ? 'lost a quarter of their soldiers' : x < 0.6 ? 'lost nearly half their soldiers' : x < 0.85 ? 'lost most of their soldiers' : 'were all but destroyed';
};

function army(s: SideSummary): string {
  const lord = s.units.find((u) => unitDef(u.def).character?.kind === 'lord');
  const by = new Map<string, number>();
  for (const u of s.units) by.set(u.name, (by.get(u.name) ?? 0) + 1);
  const roster = [...by].map(([n, k]) => (k > 1 ? `${k}× ${n}` : n)).join(', ');
  // The ones who did the most harm, for the chronicler to name.
  const best = [...s.units]
    .filter((u) => (u.valueDealt ?? 0) > u.cost * 0.5)
    .sort((a, b) => (b.valueDealt ?? 0) - (a.valueDealt ?? 0))
    .slice(0, 2)
    .map((u) => u.name);
  return `${factionDef(s.faction).name}${lord ? `, led by ${lord.name}` : ''}: ${roster}.${best.length ? ` Their deadliest: ${best.join(' and ')}.` : ''}`;
}

const LIGHT_WORDS: Record<(typeof LIGHT_NAMES)[number], string> = {
  Dark: 'in darkness',
  Dim: 'in dim twilight',
  Dusk: 'in the long light of dusk',
  Bright: 'in bright sun',
  Blaze: 'under the blazing noon',
};
const WIND_WORDS: Record<(typeof WIND_NAMES)[number], string> = { Calm: 'no wind', Breeze: 'a breeze blowing', Gale: 'a gale blowing' };

/** Where a battle was fought, in a few words: its name, else its landmark, else its band. */
export function placeOf(setup: BattleSetup, title?: string): string {
  const m = setup.map;
  if (title) return title;
  if (m.landmark) return LANDMARKS[m.landmark].name;
  return BANDS[m.band].name;
}

/** The field in words: the landmark or town, the band, the light and the wind. */
function field(setup: BattleSetup, title?: string): string {
  const m = setup.map;
  const band = BANDS[m.band];
  const light = LIGHT_NAMES[m.light ?? band.light];
  const parts: string[] = [];
  if (title) parts.push(title);
  if (m.landmark) parts.push(`at ${LANDMARKS[m.landmark].name.replace(/^The /, 'the ')}${m.landmark === 'candle' ? (m.glow ? ' (still lit)' : ' (gone dark)') : ''}`);
  parts.push(`in ${band.name.replace(/^The /, 'the ')}`);
  if (m.fort) parts.push(`a walled town stormed by ${factionDef(setup.armies[m.fort.defender === 0 ? 1 : 0].faction).name} and held by ${factionDef(setup.armies[m.fort.defender].faction).name}`);
  parts.push(`${LIGHT_WORDS[light]}, ${WIND_WORDS[WIND_NAMES[m.wind]]}`);
  return parts.join(', ') + '.';
}

function ending(result: BattleResult): string {
  const name = (s: Side) => factionDef(result.sides[s].faction).name;
  const w = result.winner;
  if (w === -1) return 'Neither army broke before the fighting ended, and neither could claim the field.';
  const l = (1 - w) as Side;
  const how =
    result.reason === 'rout'
      ? `the army of ${name(l)} broke and fled`
      : result.reason === 'capture'
        ? `${name(w)} held the town square`
        : result.reason === 'withdraw'
          ? `${name(l)} gave up the field`
          : `the fighting wore on until ${name(w)} were left the stronger`;
  return `${name(w)} won: ${how}. ${name(w)} ${lossWords(result.sides[w])}; ${name(l)} ${lossWords(result.sides[l])}.`;
}

export async function tellTale(setup: BattleSetup, result: BattleResult, moments: Moment[], player: Side, title?: string, signal?: AbortSignal): Promise<Tale | null> {
  if (claudeStatus.value !== 'ready') return null;
  const people = factionDef(result.sides[player].faction).name;
  const prompt = [
    `You are a chronicler of ${people} in Nailed Sun, a strategy game. The world is tidally locked: one half burns in endless noon, the other freezes in endless night, and the sun had not moved in a thousand years until it shuddered.`,
    `Tell the tale of this battle as ${people} will remember it: one paragraph of 80 to 130 words, past tense, vivid and concrete. Use the names below and keep to what happened. No numbers, and no game terms such as units, morale or hit points.`,
    '',
    `The field: ${field(setup, title)}`,
    `Your people's army: ${army(result.sides[player])}`,
    `Their foe: ${army(result.sides[(1 - player) as Side])}`,
    '',
    'What happened, in order (minutes:seconds):',
    ...(moments.length ? moments.map((m) => `${clock(m.t)} ${m.text}`) : ['(no one recorded the fighting)']),
    '',
    `How it ended: ${ending(result)}`,
    '',
    'Reply with only JSON: {"title": "<the name the battle will be remembered by, 2 to 6 words>", "tale": "<the tale>"}',
  ].join('\n');
  try {
    const j = await askClaudeJson<{ title?: unknown; tale?: unknown } | null>(prompt, { modelTier: 'default', signal });
    const text = typeof j?.tale === 'string' ? j.tale.trim() : '';
    if (text.length < 40) return null;
    const name = typeof j?.title === 'string' && j.title.trim() ? j.title.trim().replace(/^"|"$/g, '').slice(0, 80) : title ?? 'The Battle';
    return { title: name, text: text.slice(0, 1400) };
  } catch {
    return null;
  }
}

/**
 * Claude as Jev: the campaign AI's advisor, when the player turns it on in
 * Settings and the game runs on claude.ai. One quick call per AI faction
 * per Toll: the code lists the legal options and Claude picks one, in
 * character. Any failure, doubt or delay leaves the scripted AI in charge.
 */
import { effect } from '@preact/signals';
import type { FactionId } from '../../data/schema';
import { setJevProvider, situationFor, type JevChoice, type JevProvider } from '../../campaign/jev';
import { regionDef } from '../../campaign/regions';
import { neighbors } from '../../campaign/geometry';
import type { CampaignState } from '../../campaign/types';
import type { Deal, DealKind, DealValue } from '../../campaign/diplomacy';
import { relation } from '../../campaign/state';
import { factionDef } from '../../data/index';
import { askClaudeJson, claudeStatus, findClaude } from '../claude';
import { settings } from '../store';

/** The design's plain-language personalities. */
/** Each faction's temper, for Claude to speak and choose in character. */
export const PERSONA: Record<FactionId, string> = {
  choir: 'the Choir of the Nail: zealots of the fixed sun who mean to make all the world shine. Bold, certain, quick to crusade, slow to forgive.',
  hush: 'the Hush: the patient people of the endless night. Ambush-minded; they strike only when the dark favours them and never spend lives for nothing.',
  vesperate: 'the Vesperate: bell-keepers of the Gloaming who want the world held at the Hour. Cautious and orderly; they distrust whoever pushes the Tilt.',
  drift: 'the Drift: wind-city nomads of the Gale Roads. Opportunistic; they raid the weak, trade with the strong and chase Renown.',
};

export const claudeJev: JevProvider = {
  // Claude is slower than a local server, and the viewer pays for each question:
  // every faction asks every other Toll, all at once (see prefetchJev).
  timeoutMs: 12000,
  every: 2,
  async choose(faction, situation, options, signal) {
    const prompt = [
      `You are the war council of ${PERSONA[faction]}`,
      'It is your turn in Nailed Sun, a strategy game. Read the situation and pick exactly ONE option by its id.',
      '',
      'Situation:',
      situation,
      '',
      'Options:',
      ...options.map((o) => `- ${o.id}: ${o.label}`),
      '',
      'Pick "keep" unless another option is clearly better for your faction now. Stay in character.',
      'Reply with only JSON: {"choice": "<option id>", "confidence": <number 0 to 1>, "reason": "<one short sentence your council would say>"}',
    ].join('\n');
    const j = await askClaudeJson<Partial<JevChoice> | null>(prompt, { modelTier: 'quick', signal });
    return {
      choice: String(j?.choice ?? ''),
      confidence: Number(j?.confidence) || 0,
      reason: j?.reason ? String(j.reason).slice(0, 200) : undefined,
    };
  },
};

const DEAL_WORDS: Partial<Record<DealKind, string>> = {
  peace: 'offered you peace',
  trade: 'proposed trade between your peoples',
  alliance: 'proposed an alliance',
  breakAlliance: 'ended your alliance',
  gift: 'sent you coin as a gift',
  war: 'declared war on you',
};

/**
 * The words of a faction's envoy answering the player. The game has already
 * decided; Claude only gives the answer a voice. Null when Claude is off,
 * unavailable, slow or says something unusable.
 */
export async function envoyWords(s: CampaignState, deal: Deal, accepted: boolean, why: string[]): Promise<string | null> {
  if (!settings.value.claudeAI || claudeStatus.value !== 'ready') return null;
  const to = deal.to;
  const from = factionDef(deal.from).name;
  const opinion = relation(s, to, deal.from).opinion;
  const mood = opinion < -40 ? 'hostile' : opinion < -10 ? 'cold' : opinion < 10 ? 'wary' : opinion < 40 ? 'warm' : 'friendly';
  const offer = `${DEAL_WORDS[deal.kind] ?? 'made you an offer'}${deal.coin && deal.kind !== 'gift' ? `, with ${deal.coin} coin` : ''}`;
  const verdict = deal.kind === 'war' ? 'Answer the declaration.' : deal.kind === 'breakAlliance' || deal.kind === 'gift' ? 'Answer them.' : `Your council ${accepted ? 'ACCEPTS' : 'REFUSES'}.`;
  // The valuation's reasons, without its numbers.
  const reasons = why.map((w) => w.replace(/\s*\([^)]*\)/g, '').trim()).filter(Boolean);
  const prompt = [
    `You are the envoy of ${PERSONA[to]}`,
    `In Nailed Sun, a strategy game, it is Toll ${s.turn}. ${from} have just ${offer}. Relations between you are ${mood}.`,
    verdict + (reasons.length && deal.kind !== 'war' ? ` The council weighed: ${reasons.join('; ')}.` : ''),
    `Speak your council's answer to ${from} in one or two short sentences, in character. Keep the decision as given. No numbers or game terms.`,
    'Reply with only JSON: {"reply": "<what the envoy says>"}',
  ].join('\n');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const j = await askClaudeJson<{ reply?: unknown } | null>(prompt, { modelTier: 'quick', signal: ctrl.signal });
    const text = typeof j?.reply === 'string' ? j.reply.trim().replace(/\s+/g, ' ').replace(/^"|"$/g, '') : '';
    return text ? text.slice(0, 240) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A close call on the player's proposal, decided in character as the design
 * asks: the game values the deal and labels it; Claude's envoy weighs that
 * and answers. Null when Claude is off, unavailable or slow: the game then
 * decides by the value alone.
 */
export async function envoyDecision(s: CampaignState, deal: Deal, value: DealValue): Promise<{ accept: boolean; reply: string | null } | null> {
  if (!settings.value.claudeAI || claudeStatus.value !== 'ready') return null;
  const to = deal.to;
  const from = factionDef(deal.from).name;
  const opinion = relation(s, to, deal.from).opinion;
  const mood = opinion < -40 ? 'hostile' : opinion < -10 ? 'cold' : opinion < 10 ? 'wary' : opinion < 40 ? 'warm' : 'friendly';
  const offer = `${DEAL_WORDS[deal.kind] ?? 'made you an offer'}${deal.coin ? `, with ${deal.coin} coin` : ''}`;
  const reasons = value.why.map((w) => w.replace(/\s*\([^)]*\)/g, '').trim()).filter(Boolean);
  const prompt = [
    `You are the envoy of ${PERSONA[to]}`,
    `In Nailed Sun, a strategy game, it is Toll ${s.turn}. ${from} have just ${offer}. Relations between you are ${mood}.`,
    `Your council's advisers judge the deal ${value.label}${reasons.length ? `: ${reasons.join('; ')}` : ''}.`,
    'Decide in character whether your council accepts. A deal your advisers call poor is usually refused and a good one usually accepted, but your people\'s temper decides the close calls.',
    `Then speak your council's answer to ${from} in one or two short sentences. No numbers or game terms.`,
    'Reply with only JSON: {"accept": true or false, "reply": "<what the envoy says>"}',
  ].join('\n');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const j = await askClaudeJson<{ accept?: unknown; reply?: unknown } | null>(prompt, { modelTier: 'quick', signal: ctrl.signal });
    if (typeof j?.accept !== 'boolean') return null;
    const text = typeof j.reply === 'string' ? j.reply.trim().replace(/\s+/g, ' ').replace(/^"|"$/g, '').slice(0, 240) : '';
    return { accept: j.accept, reply: text || null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The annals worth telling, oldest first: every war, fall and turn of the Tilt, and the latest conquests. */
function sagaLines(s: CampaignState): string[] {
  const a = s.annals ?? s.events.filter((e) => !e.faction);
  const captures = a.filter((e) => e.kind === 'capture');
  const tilts = a.filter((e) => e.kind === 'tilt');
  const keep = new Set([...captures.slice(-30), ...tilts.slice(-15)]);
  return a
    .filter((e) => (e.kind !== 'capture' && e.kind !== 'tilt') || keep.has(e))
    .slice(-90)
    .map((e) => `Toll ${e.turn}: ${e.text}`);
}

/**
 * The story of a finished campaign, told by Claude as the world's chronicler
 * from the campaign's own annals. Null when Claude is off or can't be asked.
 */
export async function writeSaga(s: CampaignState): Promise<{ title: string; text: string } | null> {
  if (!settings.value.claudeAI || claudeStatus.value !== 'ready') return null;
  const player = factionDef(s.player).name;
  const w = s.winner;
  const outcome = w
    ? w.faction === s.player
      ? `${player} won on Toll ${w.turn} by ${w.kind}`
      : `${factionDef(w.faction).name} won on Toll ${w.turn} by ${w.kind}, and ${player} did not`
    : `${player} fell on Toll ${s.turn}`;
  const prompt = [
    'You are the chronicler of the world of Nailed Sun, a strategy game. The world is tidally locked: one half burns in endless noon, the other freezes in endless night, and the sun had not moved in a thousand years until it shuddered.',
    `Write the saga of this war for the player, who led ${player}. ${outcome}.`,
    'One paragraph of 110 to 160 words, past tense, vivid but plain. Name the factions and places from the annals, dwell on the turning points, and end with how it ended. Invent nothing that contradicts the annals.',
    '',
    'The annals, oldest first:',
    ...sagaLines(s),
    '',
    'Reply with only JSON: {"title": "<a title of 2 to 6 words>", "saga": "<the paragraph>"}',
  ].join('\n');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const j = await askClaudeJson<{ title?: unknown; saga?: unknown } | null>(prompt, { modelTier: 'default', signal: ctrl.signal });
    const text = typeof j?.saga === 'string' ? j.saga.trim() : '';
    if (text.length < 40) return null;
    const title = typeof j?.title === 'string' && j.title.trim() ? j.title.trim().replace(/^"|"$/g, '').slice(0, 80) : 'The War of the Shudder';
    return { title, text: text.slice(0, 1600) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The player's own council, asked on request: three things to do this Toll,
 * in the faction's voice, from the same plain-language picture the AI
 * factions get. Null when Claude can't be asked or gives nothing usable.
 */
export async function councilAdvice(s: CampaignState): Promise<string[] | null> {
  if (claudeStatus.value !== 'ready') return null;
  const f = s.player;
  const armies = s.armies
    .filter((a) => a.faction === f)
    .map((a) => `${a.name} (${a.units.length} units) at ${regionDef(a.region).settlement || regionDef(a.region).name}${a.moves > 0 ? '' : ', done moving this Toll'}`);
  const place = (id: string) => regionDef(id).settlement || regionDef(id).name;
  const ours = Object.keys(s.regions).filter((id) => s.regions[id]!.owner === f);
  const near = new Set<string>();
  for (const id of ours) for (const n of neighbors(id)) if (s.regions[n]!.owner !== f) near.add(n);
  for (const a of s.armies) if (a.faction === f) for (const n of neighbors(a.region)) if (s.regions[n]!.owner !== f) near.add(n);
  const beside = [...near].map((id) => `${place(id)} (${s.regions[id]!.owner === 'free' ? 'free' : factionDef(s.regions[id]!.owner as FactionId).short})`);
  const prompt = [
    `You are the war council of ${PERSONA[f]} You advise your ruler, who is playing Nailed Sun, a strategy game.`,
    '',
    'Situation:',
    situationFor(s, f),
    `Our armies: ${armies.length ? armies.join('; ') : 'none'}.`,
    `Our towns: ${ours.length ? ours.map(place).join(', ') : 'none'}.`,
    `Beside our lands and armies: ${beside.length ? beside.join(', ') : 'nothing'}.`,
    '',
    'Give three concrete, different things to do this Toll, most urgent first: where to march, what to build or recruit, which treaty to seek or war to press, how to move toward our victory. Name places and factions from the situation. One short sentence each, in character, spoken to the ruler. No numbers.',
    'Reply with only JSON: {"advice": ["...", "...", "..."]}',
  ].join('\n');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const j = await askClaudeJson<{ advice?: unknown } | null>(prompt, { modelTier: 'default', signal: ctrl.signal });
    const list = Array.isArray(j?.advice) ? j.advice.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
    return list.length ? list.slice(0, 3).map((x) => x.trim().slice(0, 240)) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let synced = false;

/** Keep the campaign's advisor in step with the setting and Claude's availability. */
export function syncClaudeJev(): void {
  if (synced) return;
  synced = true;
  void findClaude();
  effect(() => {
    setJevProvider(settings.value.claudeAI && claudeStatus.value === 'ready' ? claudeJev : null);
  });
}

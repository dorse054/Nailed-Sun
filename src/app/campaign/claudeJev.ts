/**
 * Claude as Jev: the campaign AI's advisor, when the player turns it on in
 * Settings and the game runs on claude.ai. One quick call per AI faction
 * per Toll: the code lists the legal options and Claude picks one, in
 * character. Any failure, doubt or delay leaves the scripted AI in charge.
 */
import { effect } from '@preact/signals';
import type { FactionId } from '../../data/schema';
import { setJevProvider, type JevChoice, type JevProvider } from '../../campaign/jev';
import type { CampaignState } from '../../campaign/types';
import type { Deal, DealKind } from '../../campaign/diplomacy';
import { relation } from '../../campaign/state';
import { factionDef } from '../../data/index';
import { askClaudeJson, claudeStatus, findClaude } from '../claude';
import { settings } from '../store';

/** The design's plain-language personalities. */
const PERSONA: Record<FactionId, string> = {
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

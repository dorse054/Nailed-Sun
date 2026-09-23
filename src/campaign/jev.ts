/**
 * Jev: an optional advisor for the campaign AI. When a provider is set (an
 * HTTP endpoint on a server the player runs; the game never holds API
 * keys) and the campaign has Jev switched on, each AI faction may ask it
 * once per Toll to pick among its legal war, treaty and objective options.
 * The situation goes out in plain words, numbers turned into named bands
 * ("weak", "even", "strong"). A low-confidence answer keeps the current
 * plan; any error or a slow reply (past the provider's deadline, 3 seconds
 * unless it sets its own; its abort signal fires then) falls back to the
 * scripted AI, which stays complete on its own. Choices it applies are told
 * in the chronicle (events marked `by: 'jev'`) when the world could see
 * them. Off by default: headless runs never touch the network.
 */
import type { FactionId } from '../data/schema';
import { FACTION_IDS } from '../data/schema';
import { factionDef } from '../data/index';
import type { AiFocusKind, CampaignState } from './types';
import { allied, atWar, factionArmies, log, overlordOf, ownedRegions, relation } from './state';
import { regionDef } from './regions';
import { neighbors } from './geometry';
import { armyPower } from './rules';
import { declareWar, factionStrength, propose, type Deal } from './diplomacy';
import { factionLedger, ledgerNet } from './turn';
import { victoryStatus } from './victory';

export interface JevOption {
  /** Stable id the provider answers with, e.g. "war:hush" or "focus:defend". */
  id: string;
  /** What it means, in plain words. */
  label: string;
}

export interface JevChoice {
  /** One of the offered option ids. */
  choice: string;
  /** 0..1. Below JEV_MIN_CONFIDENCE the faction keeps its current plan. */
  confidence: number;
  reason?: string;
}

export interface JevProvider {
  /** How long to wait for an answer, in ms (JEV_TIMEOUT_MS when unset). */
  timeoutMs?: number;
  /** Consult each faction only every this many Tolls, staggered (every Toll when unset). */
  every?: number;
  /**
   * Pick one of the options. `signal` aborts when the deadline passes (or
   * the advice is no longer wanted): stop work and reject.
   */
  choose(faction: FactionId, situation: string, options: JevOption[], signal?: AbortSignal): Promise<JevChoice>;
}

export const JEV_TIMEOUT_MS = 3000;
export const JEV_MIN_CONFIDENCE = 0.55;
/** Tolls a Jev objective stays in force. */
export const JEV_FOCUS_TOLLS = 5;

let provider: JevProvider | null = null;
let lastError: string | null = null;

/** Set (or clear) the advisor. Custom providers are fine too, e.g. for tests. */
export function setJevProvider(p: JevProvider | null): void {
  provider = p;
  lastError = null;
}

/** Point Jev at an endpoint on a server the player runs, or switch it off with null. */
export function configureJev(url: string | null): void {
  if (!url) {
    setJevProvider(null);
    return;
  }
  if (!/^https?:\/\//i.test(url)) throw new Error('Jev needs an http(s) URL');
  setJevProvider(httpJev(url));
}

export function jevProvider(): JevProvider | null {
  return provider;
}

/** The last failure, for the UI (null when the last call worked). */
export function jevError(): string | null {
  return lastError;
}

/**
 * The HTTP provider: POSTs { faction, situation, options } as JSON and
 * expects { choice, confidence, reason? } back. No credentials are sent:
 * the server holds any keys it needs.
 */
export function httpJev(url: string, timeoutMs = JEV_TIMEOUT_MS): JevProvider {
  return {
    timeoutMs,
    async choose(faction, situation, options, signal) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faction, situation, options }),
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as Partial<JevChoice>;
      return { choice: String(j.choice ?? ''), confidence: Number(j.confidence) || 0, reason: j.reason ? String(j.reason) : undefined };
    },
  };
}

// ------------------------------------------------------------- the words

function band(x: number, cuts: number[], names: string[]): string {
  for (let i = 0; i < cuts.length; i++) if (x < cuts[i]!) return names[i]!;
  return names[names.length - 1]!;
}

const comparedTo = (ratio: number) => band(ratio, [0.5, 0.8, 1.25, 2], ['far weaker than', 'weaker than', 'about even with', 'stronger than', 'far stronger than']);
const treasury = (c: number) => band(c, [0, 500, 1500, 4000], ['in debt', 'nearly empty', 'modest', 'comfortable', 'rich']);
const incomeWord = (n: number) => band(n, [0, 200, 600], ['shrinking', 'thin', 'healthy', 'strong']);
const foodWord = (f: number) => band(f, [0, 20, 100], ['starving', 'short', 'enough', 'plentiful']);
const mood = (o: number) => band(o, [-40, -10, 10, 40], ['hostile', 'cold', 'neutral', 'warm', 'friendly']);
const tiltWord = (t: number) => (t === 0 ? 'at the Hour (0)' : `${Math.abs(t) >= 3 ? 'far ' : ''}${t > 0 ? 'sunward' : 'nightward'} (${t > 0 ? '+' : ''}${t})`);

function name(f: FactionId): string {
  return factionDef(f).name;
}

/** A plain-language picture of the faction's position, with no raw numbers but the Toll and the Tilt. */
export function situationFor(s: CampaignState, f: FactionId): string {
  const fs = s.factions[f];
  const lines: string[] = [];
  const phase = s.turn < 26 ? 'early days: expanding and meeting the neighbors' : s.turn < 61 ? 'the middle years: the wars over the Gloaming' : 'the last years: the race to victory';
  lines.push(`Toll ${s.turn}, ${phase}. The Tilt stands ${tiltWord(s.tilt)}${s.turn >= 70 ? ', and the Great Shudder shakes the world' : ''}.`);
  const me = factionStrength(s, f);
  const regions = ownedRegions(s, f).length;
  const net = ledgerNet(factionLedger(s, f));
  lines.push(`We are ${name(f)}. ${f === 'drift' ? 'We hold no towns; our wind-cities sail.' : `We hold ${regions} region${regions === 1 ? '' : 's'}.`} Treasury ${treasury(fs.coin)}, income ${incomeWord(net.coin)}, food ${foodWord(fs.food)}.`);
  const armies = factionArmies(s, f);
  const full = armies.filter((a) => a.units.length >= 12).length;
  lines.push(`Armies: ${armies.length} in the field${armies.length ? `, ${full === armies.length ? 'all near full strength' : full ? 'some under strength' : 'all under strength'}` : ''}.`);
  for (const o of FACTION_IDS) {
    if (o === f) continue;
    if (!s.factions[o].alive) {
      lines.push(`${name(o)} have fallen.`);
      continue;
    }
    const rel = relation(s, f, o);
    const ratio = me / Math.max(1, factionStrength(s, o));
    const age = s.turn - rel.since;
    const vassal = overlordOf(s, o) === f ? ' They are our vassals.' : overlordOf(s, f) === o ? ' We are their vassals.' : '';
    const stance = rel.stance === 'war' ? `at war with them (${age < 5 ? 'a new war' : age < 15 ? 'a long war' : 'an endless war'})` : rel.stance === 'alliance' ? 'allied with them' : `at peace with them${rel.trade ? ', trading' : ''}`;
    const final = s.factions[o].finalStage ? ` They have begun their final victory stage: ${victoryStatus(s, o).name}!` : '';
    lines.push(`${name(o)}: we are ${comparedTo(ratio)} them; ${stance}; relations ${mood(rel.opinion)}.${vassal}${final}`);
  }
  // Threats: enemy armies next to our towns.
  const threatened = ownedRegions(s, f).filter((r) => s.armies.some((a) => a.faction !== f && atWar(s, f, a.faction) && (a.region === r || regionNear(a.region, r)) && armyPower(a) > 3000));
  if (threatened.length) lines.push(`Enemy armies stand near ${threatened.slice(0, 3).map((r) => regionDef(r).settlement || regionDef(r).name).join(', ')}.`);
  const v = victoryStatus(s, f);
  const met = v.lines.filter((l) => l.ok).length;
  lines.push(`Our victory, ${v.name}: ${met} of ${v.lines.length} conditions met${v.lines.length ? ` (still needed: ${v.lines.filter((l) => !l.ok).map((l) => l.label.toLowerCase()).join('; ')})` : ''}.`);
  const focus = fs.ai?.focus;
  lines.push(`Current plan: ${focus && focus.until > s.turn ? focusLabel(focus.kind, focus.target) : 'the usual course'}.`);
  return lines.join('\n');
}

function regionNear(a: string, b: string): boolean {
  return a === b || neighbors(a).includes(b);
}

function focusLabel(kind: AiFocusKind, target?: FactionId): string {
  switch (kind) {
    case 'expand':
      return 'expand into free land';
    case 'defend':
      return 'hold what we have';
    case 'economy':
      return 'build up the economy';
    case 'victory':
      return 'pursue our victory';
    case 'war':
      return target ? `concentrate on the war with ${name(target)}` : 'press our wars';
  }
}

/**
 * Wars of choice keep the scripted AI's pacing: none in the first Tolls after
 * the Shudder, none soon after a treaty, never a third front.
 */
export const JEV_WAR_FROM = 14;
const JEV_WAR_SETTLE = 10;
const JEV_MAX_WARS = 2;

/** Every choice the faction could legally make this Toll. */
export function optionsFor(s: CampaignState, f: FactionId): JevOption[] {
  const out: JevOption[] = [{ id: 'keep', label: 'Keep the current plan' }];
  const wars = FACTION_IDS.filter((x) => x !== f && s.factions[x].alive && atWar(s, f, x)).length;
  for (const o of FACTION_IDS) {
    if (o === f || !s.factions[o].alive) continue;
    if (overlordOf(s, f) === o || overlordOf(s, o) === f) continue;
    const rel = relation(s, f, o);
    if (rel.stance === 'peace' && s.turn >= JEV_WAR_FROM && s.turn - rel.since >= JEV_WAR_SETTLE && wars < JEV_MAX_WARS) out.push({ id: `war:${o}`, label: `Declare war on ${name(o)}` });
    if (rel.stance === 'war' && !s.factions[o].finalStage) out.push({ id: `peace:${o}`, label: `Offer peace to ${name(o)}` });
    const common = FACTION_IDS.some((x) => x !== f && x !== o && s.factions[x].alive && atWar(s, f, x) && atWar(s, o, x));
    if (rel.stance === 'peace' && common) out.push({ id: `alliance:${o}`, label: `Propose an alliance with ${name(o)}` });
    if (rel.stance === 'war') out.push({ id: `focus:war:${o}`, label: `Concentrate on the war with ${name(o)}` });
  }
  out.push({ id: 'focus:expand', label: 'Expand into free land' });
  out.push({ id: 'focus:defend', label: 'Hold what we have' });
  out.push({ id: 'focus:economy', label: 'Build up the economy' });
  out.push({ id: 'focus:victory', label: 'Pursue our victory' });
  return out;
}

/**
 * Ask with a hard deadline (the provider's own, or JEV_TIMEOUT_MS): when it
 * passes, the provider's signal aborts and the scripted AI carries on
 * without waiting for it.
 */
async function ask(p: JevProvider, f: FactionId, situation: string, options: JevOption[]): Promise<JevChoice> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl?.abort();
      reject(new Error('timed out'));
    }, p.timeoutMs ?? JEV_TIMEOUT_MS);
  });
  try {
    return await Promise.race([p.choose(f, situation, options, ctrl?.signal), late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Is this faction due to consult this Toll? */
function due(s: CampaignState, f: FactionId, p: JevProvider): boolean {
  const fs = s.factions[f];
  if (!s.options.jev || fs.player || !fs.alive || fs.ai?.jevTurn === s.turn) return false;
  const every = Math.max(1, Math.round(p.every ?? 1));
  return (s.turn + FACTION_IDS.indexOf(f)) % every === 0;
}

/** Questions already on their way this Toll, by faction. */
const early = new Map<string, { p: JevProvider; answer: Promise<JevChoice> }>();

/**
 * Ask for every AI faction due this Toll at once, before any of them moves,
 * so the answers arrive together rather than one after another. Each
 * faction still checks its answer against its options when its turn comes.
 */
export function prefetchJev(s: CampaignState): void {
  early.clear();
  const p = provider;
  if (!p) return;
  for (const f of FACTION_IDS) {
    if (!due(s, f, p)) continue;
    const answer = ask(p, f, situationFor(s, f), optionsFor(s, f));
    answer.catch(() => undefined);
    early.set(`${s.turn}:${f}`, { p, answer });
  }
}

/**
 * Consult Jev once per faction per Toll, when it is on. Applies a confident
 * choice (a war, a treaty or an objective for the next Tolls) and returns
 * it; returns null when off, unsure, wrong or unreachable, and the scripted
 * AI simply carries on. Treaties with the human player go through `offer`
 * (the player answers), never straight through.
 */
export async function consultJev(s: CampaignState, f: FactionId, offer?: (d: Deal) => Promise<boolean>): Promise<JevChoice | null> {
  const p = provider;
  const fs = s.factions[f];
  const key = `${s.turn}:${f}`;
  const pre = early.get(key);
  early.delete(key);
  if (!p || !due(s, f, p)) return null;
  const mem = (fs.ai ??= {});
  mem.jevTurn = s.turn;
  const options = optionsFor(s, f);
  let pick: JevChoice;
  try {
    pick = await (pre && pre.p === p ? pre.answer : ask(p, f, situationFor(s, f), options));
    lastError = null;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return null;
  }
  if (!options.some((o) => o.id === pick.choice) || !(pick.confidence >= JEV_MIN_CONFIDENCE) || pick.choice === 'keep') return null;
  const [kind, a, b] = pick.choice.split(':') as [string, string?, string?];
  const other = a as FactionId;
  // The chronicle hears of it when the world could: wars and envoys are
  // public; a change of plan only reaches the player through an alliance.
  const why = pick.reason ? `: "${pick.reason.trim().replace(/\s+/g, ' ').slice(0, 160)}"` : '.';
  if (kind === 'war') {
    if (!declareWar(s, f, other).ok) return null;
    mem.holdWar = { target: other, until: s.turn + 8 };
    mem.focus = { kind: 'war', target: other, until: s.turn + JEV_FOCUS_TOLLS, by: 'jev' };
    log(s, 'diplomacy', `${name(f)} turn their whole strength on ${name(other)}${why}`, undefined, undefined, 'jev');
  } else if (kind === 'peace' || kind === 'alliance') {
    const deal: Deal = { kind, from: f, to: other };
    log(s, 'diplomacy', `${name(f)} send envoys to ${name(other)} ${kind === 'peace' ? 'to sue for peace' : 'to seek an alliance'}${why}`, undefined, undefined, 'jev');
    if (s.factions[other].player) {
      if (offer) await offer(deal);
    } else propose(s, deal);
  } else if (kind === 'focus') {
    const fk = a as AiFocusKind;
    mem.focus = { kind: fk, target: fk === 'war' ? (b as FactionId) : undefined, until: s.turn + JEV_FOCUS_TOLLS, by: 'jev' };
    if (fk === 'war' && b) mem.holdWar = { target: b as FactionId, until: s.turn + JEV_FOCUS_TOLLS };
    if (s.player !== f && allied(s, f, s.player)) log(s, 'info', `Our allies ${name(f)} resolve to ${focusLabel(fk, mem.focus.target)}${why}`, s.player, undefined, 'jev');
  }
  return pick;
}

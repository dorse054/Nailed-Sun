/**
 * Replay files: a battle's setup and the player's orders, enough to replay
 * it exactly (for bug reports and balance reviews). Each file carries a
 * fingerprint of the game data, because a replay saved before a balance
 * change can play out differently after it.
 */
import { FACTIONS, factionDef, hasUnit } from '../data/index';
import * as RULES from '../data/rules';
import type { BattleSetup, Side, TimedCommand } from '../sim/types';

export interface ReplayFile {
  kind: 'nailed-sun-replay';
  version: 1;
  /** Fingerprint of the unit data and rules this replay was recorded with. */
  build: string;
  playerSide: Side;
  setup: BattleSetup;
  log: TimedCommand[];
}

let fingerprint: string | null = null;

/** FNV-1a over the factions (units, traits, abilities) and the rules. */
export function dataFingerprint(): string {
  if (fingerprint) return fingerprint;
  const text = JSON.stringify([FACTIONS, RULES]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  fingerprint = (h >>> 0).toString(16).padStart(8, '0');
  return fingerprint;
}

export function replayJson(setup: BattleSetup, log: TimedCommand[], playerSide: Side): string {
  const file: ReplayFile = { kind: 'nailed-sun-replay', version: 1, build: dataFingerprint(), playerSide, setup, log };
  return JSON.stringify(file);
}

export function replayName(setup: BattleSetup): string {
  const [a, b] = setup.armies.map((x) => factionDef(x.faction).short.toLowerCase().replace(/[^a-z]+/g, '-'));
  return `nailed-sun-${a}-vs-${b}-${setup.seed}.json`;
}

/** Read a replay file, or say what is wrong with it. */
export function parseReplay(text: string): { file: ReplayFile; sameBuild: boolean } | { error: string } {
  let j: Partial<ReplayFile>;
  try {
    j = JSON.parse(text) as Partial<ReplayFile>;
  } catch {
    return { error: 'That file is not a replay (it is not JSON).' };
  }
  if (j?.kind !== 'nailed-sun-replay' || j.version !== 1) return { error: 'That file is not a Nailed Sun replay.' };
  if (!j.setup || !Array.isArray(j.setup.armies) || j.setup.armies.length !== 2 || !Array.isArray(j.log)) return { error: 'That replay is damaged.' };
  for (const a of j.setup.armies) {
    if (!a || !(a.faction in FACTIONS) || !Array.isArray(a.units)) return { error: 'That replay names an unknown faction.' };
    if (a.units.some((u) => !u || !hasUnit(u.def))) return { error: 'That replay has units this version of the game does not know.' };
  }
  const side: Side = j.playerSide === 1 ? 1 : 0;
  return { file: { ...(j as ReplayFile), playerSide: side }, sameBuild: j.build === dataFingerprint() };
}

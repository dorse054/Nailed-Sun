/**
 * Victory conditions and the endgame warning. When a faction begins its
 * final victory stage, every rival is warned and fights it at +15%
 * leadership: endgames become coalition wars.
 */
import type { FactionId } from '../data/schema';
import { FACTION_IDS } from '../data/schema';
import { factionDef } from '../data/index';
import type { CampaignState } from './types';
import { CANDLES, KITE_FIELDS, NAIL_SPIRE, REGIONS, STOPPED_DIAL } from './regions';
import { hostile, log, overlordOf } from './state';
import { regionBand } from './rules';

export interface VictoryLine {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface VictoryStatus {
  name: string;
  desc: string;
  lines: VictoryLine[];
  /** Consecutive Tolls held, and how many are needed (0 if not a hold goal). */
  hold: number;
  holdNeeded: number;
  /** All conditions met right now. */
  met: boolean;
  final: boolean;
  progress: number;
}

export const HOLD_NEEDED: Record<FactionId, number> = { choir: 0, hush: 5, vesperate: 10, drift: 5 };

/** Final victory stages open in the late game, after the wars over the Gloaming. */
export const VICTORY_OPENS = 50;

export function gloamingSettlements(s: CampaignState): string[] {
  return REGIONS.filter((r) => r.settlement && regionBand(s, r.id) === 'gloaming').map((r) => r.id);
}

export function kiteFieldsHeld(s: CampaignState): boolean {
  const here = s.armies.filter((a) => a.region === KITE_FIELDS);
  return here.some((a) => a.faction === 'drift') && !here.some((a) => a.faction !== 'drift' && hostile(s, 'drift', a.faction));
}

export function victoryStatus(s: CampaignState, f: FactionId): VictoryStatus {
  const fs = s.factions[f];
  const lines: VictoryLine[] = [];
  let met = false;
  if (f === 'choir') {
    const held = CANDLES.filter((c) => s.regions[c]!.owner === 'choir' && s.regions[c]!.lit).length;
    lines.push({ label: 'Hold all three Candles, lit', ok: held === 3, detail: `${held} / 3` });
    lines.push({ label: 'Hold the Nail Spire', ok: s.regions[NAIL_SPIRE]!.owner === 'choir' });
    lines.push({ label: 'Tilt at +3 or higher', ok: s.tilt >= 3, detail: fmt(s.tilt) });
    lines.push({ label: 'Build the five stages of the Last Lens', ok: fs.lens >= 5, detail: `${fs.lens} / 5${fs.lensBuilding ? ' (building)' : ''}` });
    met = fs.lens >= 5;
  } else if (f === 'hush') {
    const dark = CANDLES.filter((c) => !s.regions[c]!.lit).length;
    lines.push({ label: 'Extinguish all three Candles', ok: dark === 3, detail: `${dark} / 3` });
    lines.push({ label: 'Hold the Nail Spire', ok: s.regions[NAIL_SPIRE]!.owner === 'hush' });
    lines.push({ label: 'Tilt at −3 or lower', ok: s.tilt <= -3, detail: fmt(s.tilt) });
    met = dark === 3 && s.regions[NAIL_SPIRE]!.owner === 'hush' && s.tilt <= -3;
  } else if (f === 'vesperate') {
    const gl = gloamingSettlements(s);
    const held = gl.filter((r) => s.regions[r]!.owner === 'vesperate').length;
    lines.push({ label: 'Hold every settlement in the Gloaming', ok: held === gl.length, detail: `${held} / ${gl.length}` });
    lines.push({ label: 'Hold the Stopped Dial (Vesper)', ok: s.regions[STOPPED_DIAL]!.owner === 'vesperate' });
    lines.push({ label: 'Tilt between −1 and +1', ok: Math.abs(s.tilt) <= 1, detail: fmt(s.tilt) });
    met = held === gl.length && s.regions[STOPPED_DIAL]!.owner === 'vesperate' && Math.abs(s.tilt) <= 1;
  } else {
    lines.push({ label: 'Reach 1,000 Renown', ok: fs.res >= 1000, detail: `${Math.floor(fs.res)} / 1,000` });
    lines.push({ label: 'Hold the Kite Fields with a sail', ok: kiteFieldsHeld(s) });
    met = fs.res >= 1000 && kiteFieldsHeld(s);
  }
  const need = HOLD_NEEDED[f];
  if (need) lines.push({ label: `Hold it for ${need} straight Tolls`, ok: fs.hold >= need, detail: `${fs.hold} / ${need}` });
  if (s.turn < VICTORY_OPENS) {
    lines.unshift({ label: `The world is not ready: final stages open on Toll ${VICTORY_OPENS}`, ok: false, detail: `Toll ${s.turn}` });
    met = false;
  }
  const okCount = lines.filter((l) => l.ok).length;
  return {
    name: factionDef(f).victory.name,
    desc: factionDef(f).victory.desc,
    lines,
    hold: fs.hold,
    holdNeeded: need,
    met,
    final: fs.finalStage,
    progress: okCount / lines.length,
  };
}

export function dominationStatus(s: CampaignState, f: FactionId): { done: boolean; left: FactionId[] } {
  const left = FACTION_IDS.filter((x) => x !== f && s.factions[x].alive && overlordOf(s, x) !== f);
  return { done: left.length === 0, left };
}

function fmt(t: number): string {
  return t > 0 ? `+${t}` : `${t}`;
}

/** End-of-Toll: update hold counters, final-stage warnings and the winner. */
export function checkVictory(s: CampaignState): void {
  if (s.winner) return;
  for (const f of FACTION_IDS) {
    const fs = s.factions[f];
    if (!fs.alive) {
      fs.hold = 0;
      fs.finalStage = false;
      continue;
    }
    const st = victoryStatus(s, f);
    const need = HOLD_NEEDED[f];
    if (need) fs.hold = st.met ? fs.hold + 1 : 0;
    const final = s.turn >= VICTORY_OPENS && (f === 'choir' ? fs.lens >= 1 || !!fs.lensBuilding : st.met);
    if (final && !fs.finalStage) {
      fs.finalStage = true;
      log(s, 'warning', `${factionDef(f).name} have begun their final victory stage: ${st.name}. Every rival gains +15% leadership against them.`);
    } else if (!final && fs.finalStage && f !== 'choir') {
      fs.finalStage = false;
      log(s, 'info', `${factionDef(f).name} have lost their grip on ${st.name}.`);
    }
    const won = need ? fs.hold >= need : st.met;
    if (won) {
      s.winner = { faction: f, kind: st.name, turn: s.turn };
      log(s, 'victory', `${factionDef(f).name} win: ${st.name}.`);
      return;
    }
    if (dominationStatus(s, f).done) {
      s.winner = { faction: f, kind: 'Domination', turn: s.turn };
      log(s, 'victory', `${factionDef(f).name} win by Domination.`);
      return;
    }
  }
}

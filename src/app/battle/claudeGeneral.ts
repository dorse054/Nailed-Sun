/**
 * Claude as the enemy general. With Claude switched on, while the player
 * deploys, the AI side's general reads the field in words and picks a plan:
 * bring the enemy to battle, hold, or wait in ambush, and says a few words to
 * the army. The plan goes into the battle's setup before it starts, so the
 * battle and its replay follow it exactly; an answer that comes too late is
 * dropped and the scripted general decides alone, as it always can.
 */
import type { FactionId } from '../../data/schema';
import { LIGHT_NAMES, WIND_NAMES } from '../../data/schema';
import { factionDef } from '../../data/index';
import type { Battle } from '../../sim/battle';
import type { ArmyPlan, Side, Unit } from '../../sim/types';
import { COVER } from '../../sim/terrain';
import { askClaudeJson, claudeStatus } from '../claude';
import { settings } from '../store';
import { PERSONA } from '../campaign/claudeJev';

/** How long a holding army waits for the enemy, by plan. */
const PATIENCE = { hold: 120, ambush: 300 } as const;

type Choice = 'attack' | 'hold' | 'ambush';

export function planFor(choice: Choice, speech?: string): ArmyPlan {
  const plan: ArmyPlan = choice === 'attack' ? { stance: 'attack' } : { stance: 'defend', patience: PATIENCE[choice] };
  if (speech) plan.speech = speech;
  return plan;
}

function band(x: number, cuts: number[], names: string[]): string {
  for (let i = 0; i < cuts.length; i++) if (x < cuts[i]!) return names[i]!;
  return names[names.length - 1]!;
}

/** "3 Hour Levies (line infantry), the Carillon Knights (shock cavalry), …" */
function roster(units: Unit[]): string {
  const by = new Map<string, { name: string; role: string; n: number }>();
  for (const u of units) {
    const k = u.def.id;
    const e = by.get(k) ?? { name: u.def.name, role: u.def.roleLabel, n: 0 };
    e.n++;
    by.set(k, e);
  }
  return [...by.values()].map((e) => `${e.n > 1 ? `${e.n}× ` : ''}${e.name} (${e.role.toLowerCase()})`).join(', ');
}

const value = (list: Unit[]) => list.reduce((a, u) => a + u.cost, 0);
const missiles = (list: Unit[]) => list.reduce((a, u) => a + (u.def.missile ? u.cost : 0), 0);

/** Share of forest in a stretch of the field. */
function forestIn(b: Battle, x0: number, y0: number, x1: number, y1: number): number {
  const t = b.terrain;
  let n = 0;
  let f = 0;
  for (let y = Math.max(0, y0); y < Math.min(t.height, y1); y += t.cell * 2) {
    for (let x = Math.max(0, x0); x < Math.min(t.width, x1); x += t.cell * 2) {
      n++;
      if (t.cover[t.idx(x, y)] === COVER.Forest) f++;
    }
  }
  return n ? f / n : 0;
}

/** The field as the AI side's general sees it, in words and bands rather than numbers. */
export function fieldReport(b: Battle, side: Side): string {
  const t = b.terrain;
  const foe = b.sides[(1 - side) as Side].faction;
  const mine = b.units.filter((u) => u.side === side);
  const theirs = b.units.filter((u) => u.side !== side);
  const lines: string[] = [];
  lines.push(`Your army: ${roster(mine)}.`);
  lines.push(`The enemy, ${factionDef(foe).name}: ${roster(theirs)}.`);
  const ratio = value(mine) / Math.max(1, value(theirs));
  lines.push(`You are ${band(ratio, [0.7, 0.9, 1.12, 1.4], ['far weaker than', 'weaker than', 'about even with', 'stronger than', 'far stronger than'])} them.`);
  const mr = missiles(mine) / Math.max(1, value(mine));
  const tr = missiles(theirs) / Math.max(1, value(theirs));
  lines.push(mr > tr + 0.08 ? 'Your missiles outshoot theirs: standing off favors you.' : tr > mr + 0.08 ? 'Their missiles outshoot yours: waiting under their arrows costs you.' : 'Missiles are about even.');
  // The enemy deploys across the field: facing them, where do the sun and the wind stand?
  const facing = side === 1 ? Math.PI / 2 : -Math.PI / 2;
  const rel = Math.abs(Math.atan2(Math.sin(t.sunBearing - facing), Math.cos(t.sunBearing - facing)));
  const light = `The light is ${LIGHT_NAMES[t.light]}`;
  if (t.light === 2 || t.light === 3) {
    const sun = rel < Math.PI / 4 ? 'in your face: your army suffers glare' : rel > (Math.PI * 3) / 4 ? 'at your back: the enemy fights into the glare' : 'on the flank: neither line is blinded';
    lines.push(`${light}, the sun low on the horizon and ${sun}. Long shadows hide whoever stands in them.`);
  } else if (t.light === 4) lines.push(`${light}: the sun overhead, no glare, and everyone but the Choir tires fast.`);
  else lines.push(`${light}: the sun is below the horizon${t.light === 0 ? ' and the dark hides everyone until they are close' : ''}.`);
  if (t.wind > 0) {
    const down = Math.cos(t.sunBearing - facing);
    lines.push(`${WIND_NAMES[t.wind]}, blowing ${down > 0.5 ? 'toward the enemy: your shots carry farther' : down < -0.5 ? 'toward you: their shots carry farther' : 'across the field'}.`);
  } else lines.push('No wind.');
  const zone = t.deployZone(side);
  const near = forestIn(b, zone.x, zone.y - 120, zone.x + zone.w, zone.y + zone.h + 120);
  const mid = forestIn(b, 0, t.height * 0.3, t.width, t.height * 0.7);
  if (near > 0.06) lines.push('There are woods near your lines to hide in.');
  if (mid > 0.06) lines.push('Woods break up the middle of the field.');
  if (t.fort) lines.push(t.fort.defender === side ? 'You hold a walled town: the attacker must take its square.' : 'You must storm a walled town and hold its square.');
  return lines.join('\n');
}

/**
 * Ask for the AI general's plan and words. Null when Claude is off or
 * unavailable, slow or unclear; the scripted general then decides alone.
 */
export async function askGeneral(b: Battle, side: Side, signal?: AbortSignal): Promise<ArmyPlan | null> {
  if (!settings.value.claudeAI || claudeStatus.value !== 'ready') return null;
  const me: FactionId = b.sides[side].faction;
  const fort = !!b.terrain.fort;
  const prompt = [
    `You are the general of ${PERSONA[me]}`,
    'A battle in Nailed Sun, a strategy game, is about to begin. Read the field and choose your plan.',
    '',
    fieldReport(b, side),
    '',
    fort
      ? 'The walls decide your plan. Choose "attack" if you storm the town, "hold" if you defend it.'
      : 'Plans: "attack" (advance and bring them to battle), "hold" (keep your ground and let them come; advance if they will not), "ambush" (wait in cover for as long as it takes).',
    'Then speak to your army in one or two short sentences, in character. No numbers or game terms.',
    'Reply with only JSON: {"plan": "attack" | "hold" | "ambush", "speech": "<what the general says>"}',
  ].join('\n');
  try {
    const j = await askClaudeJson<{ plan?: unknown; speech?: unknown } | null>(prompt, { modelTier: 'quick', signal });
    const choice = j?.plan === 'attack' || j?.plan === 'hold' || j?.plan === 'ambush' ? j.plan : null;
    if (!choice) return null;
    const speech = typeof j?.speech === 'string' ? j.speech.trim().replace(/\s+/g, ' ').replace(/^"|"$/g, '').slice(0, 220) : '';
    // The walls set the stance of a siege, whatever was said.
    const fixed: Choice = fort ? (b.terrain.fort!.defender === side ? 'hold' : 'attack') : choice;
    return planFor(fixed, speech || undefined);
  } catch {
    return null;
  }
}

/**
 * Claude as the enemy general. With Claude switched on, while the player
 * deploys, the AI side's general reads the field in words and picks a plan:
 * bring the enemy to battle, hold, or wait in ambush, and says a few words to
 * the army. The plan goes into the battle's setup before it starts, so the
 * battle and its replay follow it exactly; an answer that comes too late is
 * dropped and the scripted general decides alone, as it always can.
 *
 * During the battle the general thinks again at the moments that matter (the
 * lines meet, the battle turns, a colossus falls, nobody will attack) and may
 * switch between pressing and holding. That change goes in as a recorded
 * order, so the replay follows it too.
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
import { COUNTERS, matchupNote } from '../../data/lore';

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

/** Each kind of unit in an army once, with its role and what it does. */
function unitNotes(units: Unit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of units) {
    if (seen.has(u.def.id)) continue;
    seen.add(u.def.id);
    const n = units.filter((x) => x.def.id === u.def.id).length;
    out.push(`- ${n > 1 ? `${n}× ` : ''}${u.def.name} (${u.def.roleLabel.toLowerCase()}): ${u.def.summary}`);
  }
  return out;
}

/**
 * Counsel for the player while they deploy: three short tips for this
 * battle, from the field, both armies and what each faction does best and
 * worst. Null when Claude is unavailable, slow or unclear.
 */
export async function askCounsel(b: Battle, side: Side, signal?: AbortSignal): Promise<string[] | null> {
  if (claudeStatus.value !== 'ready') return null;
  const me = factionDef(b.sides[side].faction);
  const foe = factionDef(b.sides[(1 - side) as Side].faction);
  const note = matchupNote(me.id, foe.id);
  const prompt = [
    `You are a veteran adviser to the player, who commands ${me.name} in Nailed Sun, a strategy game of real-time battles on a world whose sun never moves. The player is about to deploy. Give three short, concrete tips for this battle.`,
    '',
    fieldReport(b, side),
    '',
    `${me.name}: ${me.strengths} Weak at: ${me.weaknesses} ${me.playstyle}`,
    `Their traits: ${me.traitText.map((t) => `${t.name} (${t.desc})`).join('; ')}.`,
    'The player\'s units:',
    ...unitNotes(b.units.filter((u) => u.side === side)),
    '',
    `The enemy, ${foe.name}: ${foe.strengths} Weak at: ${foe.weaknesses} ${foe.playstyle}`,
    'Their units:',
    ...unitNotes(b.units.filter((u) => u.side !== side)),
    note ? `\nThis matchup: ${note}` : '',
    '',
    `Counters: ${COUNTERS.map((c) => `${c.role} beats ${c.beats.toLowerCase()}, loses to ${c.losesTo.toLowerCase()}`).join('; ')}.`,
    '',
    'Each tip is one sentence of plain advice that names the player\'s own units: where to place them or what to do with them, and which enemy to fear or hunt. No numbers.',
    'Reply with only JSON: {"tips": ["<tip>", "<tip>", "<tip>"]}',
  ].join('\n');
  try {
    const j = await askClaudeJson<{ tips?: unknown } | null>(prompt, { modelTier: 'default', signal });
    const tips = Array.isArray(j?.tips) ? j!.tips.filter((t): t is string => typeof t === 'string' && t.trim().length > 8).map((t) => t.trim().slice(0, 260)) : [];
    return tips.length ? tips.slice(0, 3) : null;
  } catch {
    return null;
  }
}

/** Where a unit stands as the player sees the field: left, centre or right, and how far toward the enemy. */
function where(b: Battle, side: Side, u: Unit): string {
  const t = b.terrain;
  const x = u.x / t.width;
  const h = x < 0.36 ? 'left' : x < 0.64 ? 'centre' : 'right';
  const zo = t.deployZone(side);
  const ze = t.deployZone((1 - side) as Side);
  const oy = zo.y + zo.h / 2;
  const ey = ze.y + ze.h / 2;
  const d = Math.max(0, Math.min(1, (u.y - oy) / (ey - oy || 1)));
  return `${h}, ${d < 0.3 ? 'near your lines' : d < 0.7 ? 'midfield' : 'near their lines'}`;
}

/** What a unit is doing and how it is holding up, in words. */
function doing(u: Unit): string {
  if (u.state === 'routing') return 'routing';
  if (u.state === 'embarked') return 'aboard';
  const parts: string[] = [];
  if (u.engaged > 0) parts.push(u.meleeTarget ? `fighting ${u.meleeTarget.def.name}` : 'fighting');
  else if (u.missileTarget && u.missileTarget.alive > 0) parts.push(`shooting at ${u.missileTarget.def.name}`);
  else parts.push(u.moving ? 'moving' : 'standing');
  const hp = u.hpStart > 0 ? u.soldiers.reduce((a, s) => a + (s.alive ? Math.max(0, s.hp) : 0), 0) / u.hpStart : u.alive / Math.max(1, u.initial);
  parts.push(hp > 0.8 ? 'fresh' : hp > 0.5 ? 'worn' : hp > 0.25 ? 'badly hurt' : 'nearly spent');
  if (u.morale < u.maxMorale * 0.5) parts.push('wavering');
  if (spent([u]).length) parts.push('nearly out of shot');
  if (u.fatigue > 0.6) parts.push('tired');
  return parts.join(', ');
}

/**
 * Counsel for the player in the middle of a battle, with the game paused:
 * two or three orders to give now, from where every unit stands. Null when
 * Claude is unavailable, slow or unclear.
 */
export async function askAdvice(b: Battle, side: Side, signal?: AbortSignal): Promise<string[] | null> {
  if (claudeStatus.value !== 'ready') return null;
  const me = factionDef(b.sides[side].faction);
  const foe = factionDef(b.sides[(1 - side) as Side].faction);
  const known = (u: Unit) => u.visible[side] || (u.lastSeen[side] > 0 && b.time - u.lastSeen[side] < 10);
  const active = (u: Unit) => u.state === 'ready' || u.state === 'routing' || u.state === 'embarked';
  const mine = b.units.filter((u) => u.side === side && active(u));
  const theirs = b.units.filter((u) => u.side !== side && active(u) && known(u));
  const field = fieldReport(b, side)
    .split('\n')
    .filter((l) => /^(The light|Breeze|Gale|No wind|There are woods|Woods)/.test(l));
  const prompt = [
    `You are the adviser of the player, who commands ${me.name} against ${foe.name} in Nailed Sun, a strategy game of real-time battles. The battle is paused so the player can give orders.`,
    '',
    battleReport(b, side),
    ...field,
    '',
    'Where everyone stands, as the player sees the field (left, centre or right; near the player\'s lines, midfield or near the enemy\'s):',
    'Yours:',
    ...mine.map((u) => `- ${u.def.name} (${u.def.roleLabel.toLowerCase()}): ${where(b, side, u)}; ${doing(u)}.`),
    'Theirs, as far as you can see:',
    ...(theirs.length ? theirs.map((u) => `- ${u.def.name} (${u.def.roleLabel.toLowerCase()}): ${where(b, side, u)}; ${doing(u)}.`) : ['- none in sight']),
    '',
    `${me.name} are strong at: ${me.strengths} ${foe.name} are weak at: ${foe.weaknesses}`,
    '',
    'Give the two or three orders that matter most right now, the most urgent first: each one sentence that names the player\'s own units and says where to send them or whom to attack, using left, centre and right as above. No numbers.',
    'Reply with only JSON: {"tips": ["<order>", "<order>"]}',
  ].join('\n');
  try {
    const j = await askClaudeJson<{ tips?: unknown } | null>(prompt, { modelTier: 'default', signal });
    const tips = Array.isArray(j?.tips) ? j!.tips.filter((t): t is string => typeof t === 'string' && t.trim().length > 8).map((t) => t.trim().slice(0, 260)) : [];
    return tips.length ? tips.slice(0, 3) : null;
  } catch {
    return null;
  }
}

/** Our army's strength against theirs as things stand: 1 is even, 2 twice theirs. */
export function strengthRatio(b: Battle, side: Side): number {
  const foe = (1 - side) as Side;
  const mine = b.remainingValue(side) * value(b.units.filter((u) => u.side === side));
  const theirs = b.remainingValue(foe) * value(b.units.filter((u) => u.side === foe));
  return mine / Math.max(1, theirs);
}

/** A share of an army, in words. */
const share = (x: number) => band(x, [0.12, 0.3, 0.45, 0.6, 0.8, 0.95], ['almost none', 'about a quarter', 'about a third', 'about half', 'about two-thirds', 'most', 'all']);

/** Missile units whose shot is nearly spent. */
function spent(list: Unit[]): Unit[] {
  return list.filter((u) => {
    const w = u.def.missile;
    if (!w || !(w.ammo > 0) || !Number.isFinite(w.ammo) || u.state !== 'ready' || u.alive <= 0) return false;
    let left = 0;
    for (const s of u.soldiers) if (s.alive) left += s.ammo;
    return left < u.alive * w.ammo * 0.25;
  });
}

/** Where each unit of an army stands: fighting, waiting, broken or destroyed. */
function standing(label: string, list: Unit[]): string[] {
  const fighting = list.filter((u) => u.state === 'ready' && u.engaged > 0);
  const waiting = list.filter((u) => (u.state === 'ready' && u.engaged === 0) || u.state === 'embarked');
  const broken = list.filter((u) => u.state === 'routing' || u.state === 'shattered' || u.state === 'fled');
  const lost = list.filter((u) => u.state === 'dead');
  const out: string[] = [];
  if (fighting.length) out.push(`${label} fighting now: ${roster(fighting)}.`);
  if (waiting.length) out.push(`${label} not yet fighting: ${roster(waiting)}.`);
  if (broken.length) out.push(`${label} broken or fled: ${roster(broken)}.`);
  if (lost.length) out.push(`${label} destroyed: ${roster(lost)}.`);
  const dry = spent(list);
  if (dry.length) out.push(`${label} nearly out of shot: ${roster(dry)}.`);
  return out;
}

/** The battle as it stands, for a general asked to think again. */
export function battleReport(b: Battle, side: Side): string {
  const foe = (1 - side) as Side;
  const mine = b.units.filter((u) => u.side === side);
  // The general knows only what its army can see of the enemy, and the enemy dead.
  const known = (u: Unit) => u.state === 'dead' || u.visible[side] || (u.lastSeen[side] > 0 && b.time - u.lastSeen[side] < 10);
  const theirs = b.units.filter((u) => u.side === foe);
  const seen = theirs.filter(known);
  const lines: string[] = [];
  const f = b.time / b.timeLimit;
  lines.push(f < 0.25 ? 'The battle is young.' : f < 0.6 ? 'The battle is well under way.' : f < 0.85 ? 'The battle is getting long.' : 'Time is nearly out.');
  if (!b.terrain.fort) lines.push('If time runs out, whichever army has kept more of itself wins.');
  lines.push(`You have kept ${share(b.remainingValue(side))} of your army; they have kept ${share(b.remainingValue(foe))} of theirs.`);
  const r = strengthRatio(b, side);
  lines.push(`You are now ${band(r, [0.7, 0.9, 1.12, 1.4], ['far weaker than', 'weaker than', 'about even with', 'stronger than', 'far stronger than'])} them.`);
  lines.push(...standing('Yours', mine));
  lines.push(...standing('Theirs', seen));
  if (seen.length < theirs.length) lines.push('Some of their army is out of your sight.');
  if (b.sides[foe].generalDead) lines.push('Their general has fallen.');
  return lines.join('\n');
}

/** A plan changed in the middle of a battle, as the order that carries it. */
export interface MidPlan {
  stance: 'attack' | 'defend';
  patience?: number;
  speech?: string;
}

/** How long a mid-battle order to hold stands before the army goes in anyway. */
const HOLD_AGAIN = 90;

/**
 * Ask the AI general to think again in the middle of the battle, told why
 * (the lines have met, the battle is turning). Null when Claude is off,
 * slow or unclear: the army carries on as it was.
 */
export async function askGeneralMid(b: Battle, side: Side, why: string, stance: 'attack' | 'defend', signal?: AbortSignal, opening = false): Promise<MidPlan | null> {
  if (!settings.value.claudeAI || claudeStatus.value !== 'ready') return null;
  const me: FactionId = b.sides[side].faction;
  const prompt = [
    `You are the general of ${PERSONA[me]}`,
    `You are ${opening ? 'opening' : 'in the middle of'} a battle in Nailed Sun, a strategy game, against ${factionDef(b.sides[(1 - side) as Side].faction).name}. ${why}`,
    '',
    opening ? fieldReport(b, side) : battleReport(b, side),
    '',
    `Right now your army is ${stance === 'attack' ? 'pressing the attack' : 'holding its ground'}.`,
    'Choose: "press" (go forward and attack everywhere) or "hold" (keep your ground and let them come; your army still fights whatever reaches it, and goes forward if they will not come).',
    'Then give your army one short order, as you would shout it across the field: one sentence, in character, no numbers or game terms.',
    'Reply with only JSON: {"plan": "press" | "hold", "speech": "<the order>"}',
  ].join('\n');
  try {
    const j = await askClaudeJson<{ plan?: unknown; speech?: unknown } | null>(prompt, { modelTier: 'quick', signal });
    const choice = j?.plan === 'press' ? 'attack' : j?.plan === 'hold' ? 'defend' : null;
    if (!choice) return null;
    const speech = typeof j?.speech === 'string' ? j.speech.trim().replace(/\s+/g, ' ').replace(/^"|"$/g, '').slice(0, 160) : '';
    const plan: MidPlan = { stance: choice };
    if (choice === 'defend') plan.patience = HOLD_AGAIN;
    if (speech) plan.speech = speech;
    return plan;
  } catch {
    return null;
  }
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

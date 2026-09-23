/**
 * A battle's turning points as they happen, in words: when the lines met,
 * who broke, what fell, what the generals ordered. The battle report lists
 * them, and the tale of the battle is told from them.
 */
import { factionDef } from '../../data/index';
import type { Battle } from '../../sim/battle';
import type { SimEvent, Side, Unit } from '../../sim/types';

export interface Moment {
  /** Battle seconds. */
  t: number;
  text: string;
  /** Whose moment it is, when it belongs to one army. */
  side?: Side;
}

/** More than this and the list stops being a story. */
const MAX = 30;

/** Colossi, monsters and characters: whatever happens to them is worth telling. */
function big(u: Unit): boolean {
  return u.def.category === 'colossus' || u.def.category === 'monster' || u.def.category === 'character' || !!u.def.character;
}

export function unitName(u: Unit): string {
  return `${u.def.name} (${factionDef(u.faction).short})`;
}

export class MomentLog {
  readonly list: Moment[] = [];
  private met = false;
  private routed = new Set<number>();
  private told = new Set<string>();
  private routs: [number, number] = [0, 0];
  private charges: [number, number] = [0, 0];
  /** How each big unit stood when last looked at. */
  private bigState = new Map<number, Unit['state']>();

  constructor(readonly battle: Battle) {
    for (const u of battle.units) if (big(u)) this.bigState.set(u.id, u.state);
  }

  private add(text: string, side?: Side): void {
    if (this.list.length >= MAX) return;
    const m: Moment = { t: Math.round(this.battle.time), text };
    if (side !== undefined) m.side = side;
    this.list.push(m);
  }

  private once(key: string): boolean {
    if (this.told.has(key)) return false;
    this.told.add(key);
    return true;
  }

  consume(ev: SimEvent[]): void {
    const b = this.battle;
    if (!this.met && b.units.some((u) => u.state === 'ready' && u.engaged > 0 && u.def.category !== 'flyer')) {
      this.met = true;
      this.add('The lines met.');
    }
    for (const e of ev) {
      switch (e.t) {
        case 'rout': {
          const u = b.units[e.unit];
          if (!u || this.routed.has(u.id) || big(u)) break;
          this.routed.add(u.id);
          if (this.routs[u.side]++ < 3) this.add(`${unitName(u)} broke and ran.`, u.side);
          break;
        }
        case 'charge': {
          const u = b.units[e.unit];
          if (!u || !this.once(`charge:${u.id}`)) break;
          if (big(u) || (u.def.category === 'cavalry' && e.power >= 20 && this.charges[u.side]++ < 2)) this.add(`${unitName(u)} charged home.`, u.side);
          break;
        }
        case 'ability': {
          const u = b.units[e.unit];
          if (u && big(u) && this.once(`ability:${u.id}:${e.name}`)) this.add(`${unitName(u)} used ${e.name}.`, u.side);
          break;
        }
        case 'general': {
          const g = b.sides[e.side].general;
          this.add(`${g ? g.def.name : 'The general'} of the ${factionDef(b.sides[e.side].faction).short} fell.`, e.side);
          break;
        }
        case 'plan':
          if (e.speech) {
            const g = b.sides[e.side].general;
            this.add(`${g ? g.def.name : `The ${factionDef(b.sides[e.side].faction).short} general`} ordered: “${e.speech}”`, e.side);
          }
          break;
      }
    }
    // Big units: fell, broke or fled, whatever event carried it.
    for (const [id, was] of this.bigState) {
      const u = b.units[id]!;
      if (u.state === was) continue;
      this.bigState.set(id, u.state);
      if (u.isGeneral && u.state === 'dead') continue; // told by its 'general' event
      // Gone is told once, however it happened.
      if (u.state === 'dead' && this.once(`gone:${id}`)) this.add(`${unitName(u)} was brought down.`, u.side);
      else if (u.state === 'routing' && this.once(`broke:${id}`)) this.add(`${unitName(u)} broke and ran.`, u.side);
      else if ((u.state === 'fled' || u.state === 'shattered') && this.once(`gone:${id}`)) this.add(`${unitName(u)} left the field.`, u.side);
    }
  }
}

/** "2:05" */
export function clock(t: number): string {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

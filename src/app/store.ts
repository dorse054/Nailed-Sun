/**
 * App-level state: which screen is showing, and player settings.
 */
import { signal } from '@preact/signals';
import type { Controller } from '../sim/battle';
import type { BattleResult, BattleSetup, Side, TimedCommand } from '../sim/types';
import type { Moment } from './battle/moments';

export type BattleMode = 'custom' | 'campaign' | 'tutorial' | 'replay' | 'demo';

export interface BattleRequest {
  setup: BattleSetup;
  playerSide: Side;
  mode: BattleMode;
  title?: string;
  /** Skip deployment (replays, demos, auto-deployed tutorials). */
  skipDeploy?: boolean;
  replay?: TimedCommand[];
  /** Called with the outcome; campaign and tutorials use it. */
  onDone?: (result: BattleResult, log: TimedCommand[], setup: BattleSetup, moments: Moment[], strength: [number, number, number][]) => void;
  tutorial?: string;
  /** A made-up battle's name and story, shown while the player deploys. */
  briefing?: { title: string; text: string };
  /** The Legend this battle is (see legends.ts), for its medal. */
  legend?: string;
  /** Who plays a side instead of the default (tutorials script their opponent). Undefined keeps the default. */
  controller?: (side: Side) => Controller | null | undefined;
}

export type Screen =
  | { name: 'menu' }
  | { name: 'custom' }
  | { name: 'battle'; req: BattleRequest }
  | { name: 'results'; req: BattleRequest; result: BattleResult; log: TimedCommand[]; setup: BattleSetup; moments?: Moment[]; strength?: [number, number, number][] }
  | { name: 'codex'; page?: string }
  | { name: 'lab' }
  | { name: 'campaign' }
  | { name: 'tutorials' }
  | { name: 'chronicles' }
  | { name: 'legends' };

export const screen = signal<Screen>({ name: 'menu' });

export interface Settings {
  unitScale: number;
  volume: number;
  music: boolean;
  tips: boolean;
  edgeScroll: boolean;
  /** Let Claude make the AI factions' judgment calls (published artifact only). */
  claudeAI: boolean;
  /** The battle minimap (large screens). */
  minimap: boolean;
}

/** Phones start on small regiments: half the soldiers to draw, and they are tiny on a phone anyway. */
const PHONE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse) and (max-width: 900px)').matches;

const DEFAULTS: Settings = { unitScale: PHONE ? 0.5 : 0.75, volume: 0.7, music: true, tips: true, edgeScroll: false, claudeAI: false, minimap: true };

export const settings = signal<Settings>(load('nailedsun.settings', DEFAULTS));

export function saveSettings(s: Settings): void {
  settings.value = s;
  save('nailedsun.settings', s);
}

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

export function loadRaw<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable; nothing to clean up then.
  }
}

export function go(s: Screen): void {
  screen.value = s;
}

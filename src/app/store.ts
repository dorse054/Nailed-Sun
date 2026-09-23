/**
 * App-level state: which screen is showing, and player settings.
 */
import { signal } from '@preact/signals';
import type { Controller } from '../sim/battle';
import type { BattleResult, BattleSetup, Side, TimedCommand } from '../sim/types';

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
  onDone?: (result: BattleResult, log: TimedCommand[], setup: BattleSetup) => void;
  tutorial?: string;
  /** Who plays a side instead of the default (tutorials script their opponent). Undefined keeps the default. */
  controller?: (side: Side) => Controller | null | undefined;
}

export type Screen =
  | { name: 'menu' }
  | { name: 'custom' }
  | { name: 'battle'; req: BattleRequest }
  | { name: 'results'; req: BattleRequest; result: BattleResult; log: TimedCommand[]; setup: BattleSetup }
  | { name: 'codex'; page?: string }
  | { name: 'lab' }
  | { name: 'campaign' }
  | { name: 'tutorials' };

export const screen = signal<Screen>({ name: 'menu' });

export interface Settings {
  unitScale: number;
  volume: number;
  music: boolean;
  tips: boolean;
  edgeScroll: boolean;
}

const DEFAULTS: Settings = { unitScale: 0.75, volume: 0.7, music: true, tips: true, edgeScroll: false };

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

/**
 * Tutorials: a fixed battle and an ordered script of steps. A step shows a
 * short text, can point at a HUD element or a place on the field, and ends
 * when its condition holds (checked every frame) or when the player clicks
 * Next.
 */
import type { FactionId, HourId, LightLevel, WindLevel } from '../../data/schema';
import type { Battle } from '../../sim/battle';
import type { BattleSetup, Command, Side, Unit } from '../../sim/types';
import type { TutorialContext } from './context';

/** What a tutorial reads and drives in a battle. BattleSession fits it; tests use a headless one. */
export interface TutorialHost {
  readonly battle: Battle;
  readonly side: Side;
  readonly phase: 'deploy' | 'battle' | 'over';
  paused: boolean;
  speed: number;
  readonly overlay: { readonly selected: Set<number>; readonly preview: readonly unknown[] };
  /** Called with every order the player gives. */
  onIssue: ((cmd: Command) => void) | null;
  select(ids: number[], add?: boolean): void;
  issue(cmd: Command): void;
  setHour(hour: HourId): void;
}

/** A world rectangle, in meters. */
export interface View {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A circle on the field, in meters. */
export interface Spot {
  x: number;
  y: number;
  r: number;
}

/** Something to point at on the field. */
export type Mark =
  | { kind: 'area'; x: number; y: number; r: number; label?: string; done?: boolean }
  | { kind: 'unit'; unit: Unit | undefined; label?: string; tone?: 'gold' | 'foe' | 'good' }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; label?: string }
  | { kind: 'shape'; pts: { x: number; y: number }[]; label?: string; at?: { x: number; y: number } }
  | { kind: 'badge'; unit: Unit | undefined; text: string; title?: string };

/** A value, or a function of the tutorial's state. */
export type Dyn<T> = T | ((c: TutorialContext) => T);

export interface TutorialStep {
  id: string;
  title: string;
  /** Short, concrete text. `**bold**` marks a word or two. */
  text: Dyn<string>;
  /** A live line under the text, refreshed a few times a second. */
  live?: (c: TutorialContext) => string | null;
  /** HUD elements to outline, as CSS selectors. */
  hud?: Dyn<string | string[] | null>;
  /** Places and units to point at on the field. */
  marks?: (c: TutorialContext) => Mark[];
  /** The step is done when this holds. Steps without it wait for Next. */
  done?: (c: TutorialContext) => boolean;
  /** Shown for a moment once the step is done. */
  doneText?: Dyn<string>;
  /** Hold the battle while the step shows; it resumes when the step ends. */
  pause?: boolean;
  /** Runs once, the first time the step starts. */
  enter?: (c: TutorialContext) => void;
  /** Skip the step when this holds as it starts. */
  skip?: (c: TutorialContext) => boolean;
  /** World area to bring into view the first time the step starts. */
  view?: Dyn<View | null>;
  /** Does the step's action for the player: the Skip step button, and the tests. */
  auto?: (c: TutorialContext) => void;
  /** No Skip step button: skipping would spoil what comes next. */
  noSkip?: boolean;
}

export interface TutorialDef {
  id: string;
  faction: FactionId;
  title: string;
  /** The one idea the tutorial teaches. */
  idea: string;
  blurb: string;
  learn: string[];
  minutes: number;
  /** Shown on the list: the field the lesson is fought on. */
  field: { light: LightLevel; wind: WindLevel; sunBearing: number; note: string };
  setup: () => BattleSetup;
  steps: TutorialStep[];
  /** What to remember, shown when the battle is won. */
  recap: string[];
}

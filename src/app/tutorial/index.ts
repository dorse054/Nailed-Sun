/**
 * The four tutorials, one per faction, and how a tutorial battle starts.
 */
import { go, type BattleRequest } from '../store';
import { TutorialRun } from './runner';
import type { TutorialDef } from './types';
import { CHOIR_TUTORIAL } from './tutorials/choir';
import { HUSH_TUTORIAL } from './tutorials/hush';
import { VESPERATE_TUTORIAL } from './tutorials/vesperate';
import { DRIFT_TUTORIAL } from './tutorials/drift';

/** In the order they are meant to be played: the Choir one teaches the controls. */
export const TUTORIALS: TutorialDef[] = [CHOIR_TUTORIAL, HUSH_TUTORIAL, VESPERATE_TUTORIAL, DRIFT_TUTORIAL];

export function tutorialDef(id: string): TutorialDef | undefined {
  return TUTORIALS.find((t) => t.id === id);
}

const runs = new WeakMap<BattleRequest, TutorialRun>();

/** The run that goes with a tutorial battle request. */
export function runFor(req: BattleRequest): TutorialRun | undefined {
  return runs.get(req);
}

/** A battle request for a tutorial, with its scripted opponent. */
export function tutorialRequest(def: TutorialDef): { req: BattleRequest; run: TutorialRun } {
  const run = new TutorialRun(def);
  const req: BattleRequest = {
    setup: def.setup(),
    playerSide: 0,
    mode: 'tutorial',
    tutorial: def.id,
    title: def.title,
    skipDeploy: true,
    // The player is side 0; side 1 is the scripted opponent.
    controller: (side) => (side === 1 ? run.enemy : undefined),
  };
  runs.set(req, run);
  return { req, run };
}

export function startTutorial(id: string): void {
  const def = tutorialDef(id);
  if (!def) return;
  go({ name: 'battle', req: tutorialRequest(def).req });
}

export function nextTutorial(id: string): TutorialDef | undefined {
  const i = TUTORIALS.findIndex((t) => t.id === id);
  return i >= 0 ? TUTORIALS[i + 1] : undefined;
}

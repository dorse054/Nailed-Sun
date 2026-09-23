/**
 * Runs a battle to the end with the scripted AI on both sides: auto-resolve
 * and AI-versus-AI campaign battles. The same code runs in a worker or on
 * the main thread, and the result depends only on the setup.
 */
import { Battle } from './battle';
import { BattleAI } from '../ai/battleAI';
import type { BattleResult, BattleSetup } from './types';

export function runAuto(setup: BattleSetup): BattleResult {
  const b = new Battle(setup);
  b.setController(0, new BattleAI());
  b.setController(1, new BattleAI());
  return b.run();
}

/** Main-thread fallback that yields to the page between slices. */
export async function runAutoSliced(setup: BattleSetup, sliceTicks = 600): Promise<BattleResult> {
  const b = new Battle(setup);
  b.setController(0, new BattleAI());
  b.setController(1, new BattleAI());
  const maxTicks = Math.ceil((b.timeLimit + 5) * 20);
  while (!b.over && b.tick < maxTicks) {
    for (let i = 0; i < sliceTicks && !b.over; i++) b.step();
    b.takeEvents();
    await new Promise((r) => setTimeout(r, 0));
  }
  return b.run(0);
}

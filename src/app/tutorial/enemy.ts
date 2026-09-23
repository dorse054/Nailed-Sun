/**
 * The tutorial's opponent: it stands still until the script lets it fight,
 * then plays the scripted battle AI with whatever stance the lesson needs.
 * While it stands, its units still shoot what comes in range and fight back
 * in melee.
 */
import { BattleAI, type AIOptions } from '../../ai/battleAI';
import type { Battle, Controller } from '../../sim/battle';
import type { Side } from '../../sim/types';

export class TutorialEnemy implements Controller {
  private ai: BattleAI | null = null;

  get fighting(): boolean {
    return this.ai !== null;
  }

  /** Hand the army to the battle AI. A fresh AI reads the field again. */
  fight(opts: AIOptions = {}): void {
    this.ai = new BattleAI(opts);
  }

  update(b: Battle, side: Side): void {
    this.ai?.update(b, side);
  }
}

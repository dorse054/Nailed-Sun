/**
 * An army's plan, when its setup carries one, as options for the scripted
 * general. Kept apart from the AI itself so headless tools replay a planned
 * battle exactly as it was fought.
 */
import type { ArmySetup } from '../sim/types';
import type { AIOptions } from './battleAI';

export function aiOptions(a: ArmySetup): AIOptions {
  const p = a.plan;
  if (!p) return {};
  const o: AIOptions = { plan: p.stance };
  if (p.patience !== undefined) o.patience = p.patience;
  return o;
}

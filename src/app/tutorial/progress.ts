/** Which tutorials the player has finished, kept in this browser. */
import { loadRaw, save } from '../store';

const KEY = 'nailedsun.tutorials';

interface Saved {
  done: string[];
}

export function completedTutorials(): Set<string> {
  const s = loadRaw<Saved>(KEY);
  return new Set(Array.isArray(s?.done) ? s.done.filter((x) => typeof x === 'string') : []);
}

export function markComplete(id: string): void {
  const done = completedTutorials();
  if (done.has(id)) return;
  done.add(id);
  save(KEY, { done: [...done] } satisfies Saved);
}

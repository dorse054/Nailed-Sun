/**
 * Worker entry: runs battle setups to the end off the main thread.
 */
import { runAuto } from './auto';
import type { BattleSetup } from './types';

interface Req {
  id: number;
  setup: BattleSetup;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, setup } = e.data;
  try {
    const result = runAuto(setup);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

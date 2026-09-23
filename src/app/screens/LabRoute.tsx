import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { go } from '../store';

/**
 * The Balance Lab is a development tool. The hosted single-page build leaves
 * it out (VITE_LAB=off); `npm run dev` and `npm run balance` still have it.
 */
const LAB = import.meta.env.VITE_LAB !== 'off';

export function LabRoute() {
  const [Lab, setLab] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (LAB) void import('./BalanceLab').then((m) => setLab(() => m.BalanceLab));
  }, []);
  if (LAB) return Lab ? <Lab /> : <div class="screen" style={{ background: 'var(--ink)' }} />;
  return (
    <div class="screen" style={{ display: 'grid', placeItems: 'center', padding: '16px', background: 'var(--ink)' }}>
      <div class="panel modal">
        <h2>Balance Lab</h2>
        <p>
          The Balance Lab runs thousands of automated battles at equal cost to check that every faction wins 45–55% of the time, that colossi win 40–50% against equal-cost armies, and that every unit has its counters.
        </p>
        <p class="muted">
          It is a development tool, so this page leaves it out. Run it from the project with <code>npm run dev</code> and open <code>#lab</code>, or from the command line with <code>npm run balance</code>.
        </p>
        <button class="btn" onClick={() => go({ name: 'menu' })}>
          Back
        </button>
      </div>
    </div>
  );
}

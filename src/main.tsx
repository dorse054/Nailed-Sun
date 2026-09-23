import { render } from 'preact';
import './app/styles.css';
import { App } from './app/App';
import { go } from './app/store';
import { demoBattle, quickBattle } from './app/quick';

render(<App />, document.getElementById('app')!);

// Shortcuts: #demo, #demo:a=choir,b=hush,band=gloaming,seed=3 and #quick start straight into a battle.
const hash = location.hash.slice(1);
if (hash.startsWith('demo')) {
  const o: Record<string, string> = {};
  for (const kv of hash.split(':')[1]?.split(',') ?? []) {
    const [k, v] = kv.split('=');
    if (k && v) o[k] = v;
  }
  demoBattle({
    seed: o.seed ? Number(o.seed) : undefined,
    a: o.a as never,
    b: o.b as never,
    band: o.band as never,
    wind: o.wind ? (Number(o.wind) as never) : undefined,
    budget: o.budget ? Number(o.budget) : undefined,
    steppe: o.steppe ? o.steppe === '1' : undefined,
  });
} else if (hash === 'quick') quickBattle();
else if (hash === 'codex') go({ name: 'codex' });
else if (hash === 'lab') go({ name: 'lab' });

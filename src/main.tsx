import { render } from 'preact';
import './app/styles.css';
import './app/screens.css';
import './app/campaign/campaign.css';
import { App } from './app/App';
import { Guard } from './app/Guard';
import { go } from './app/store';
import { demoBattle, quickBattle } from './app/quick';
import { active, resumeCampaign, startCampaign } from './app/campaign/session';
import { syncClaudeJev } from './app/campaign/claudeJev';
import type { FactionId } from './data/schema';
import type { CampaignState } from './campaign/types';

render(
  <Guard>
    <App />
  </Guard>,
  document.getElementById('app')!,
);

// The AI factions may take Claude's counsel, when the page can reach Claude and the player allows it.
syncClaudeJev();

// When the published page is updated, a running campaign carries over.
interface Hot {
  snapshot?: (fn: () => unknown) => void;
  ready?: (fn: (data: unknown) => void) => void;
  data?: unknown;
}
const hot = (globalThis as unknown as { claude?: { hot?: Hot } }).claude?.hot;
hot?.snapshot?.(() => (active ? { campaign: active.s } : {}));
const resume = (data: unknown) => {
  const c = (data as { campaign?: CampaignState } | null)?.campaign;
  if (c && c.version === 1 && !active) {
    resumeCampaign(c);
    go({ name: 'campaign' });
  }
};
if (hot?.ready) hot.ready(resume);
else if (hot?.data) resume(hot.data);

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
else if (hash === 'custom') go({ name: 'custom' });
else if (hash === 'campaign') go({ name: 'campaign' });
else if (hash.startsWith('camp:')) {
  // #camp:vesperate starts a fresh campaign straight away (for testing).
  startCampaign(hash.slice(5) as FactionId, 'normal', 7);
  go({ name: 'campaign' });
}
else if (hash === 'lab') go({ name: 'lab' });

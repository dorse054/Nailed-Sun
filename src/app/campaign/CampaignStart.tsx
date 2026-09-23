import { useState } from 'preact/hooks';
import type { FactionId } from '../../data/schema';
import { FACTION_IDS } from '../../data/schema';
import { factionDef } from '../../data/index';
import type { CampaignState } from '../../campaign/types';
import { active, continueCampaign, savedCampaign, startCampaign } from './session';
import { CampaignScreen } from './CampaignScreen';
import { go, saveSettings, settings } from '../store';
import { claudeStatus, findClaude } from '../claude';
import { audio } from '../../audio/audio';
import { OWNER_COLOR } from './campaignMap';

const STARTS: Record<FactionId, string> = {
  choir: 'Three cities in the south-central Long Afternoon, beside the Nail Spire. The Candles you need burn far away in Hush country.',
  hush: 'The Pole of Night and two holdings in the north-east Evernight, with two Candles on your doorstep and the herds to feed you.',
  vesperate: 'Four cities across the central Gloaming around Vesper and the Stopped Dial. Everyone will want what you have.',
  drift: 'No cities at all: two wind-cities on the western Gale Roads, and the Kite Fields where the clans gather.',
};

const DIFFICULTY: Record<string, string> = {
  easy: 'Rivals earn 15% less',
  normal: 'Even footing',
  hard: 'Rivals earn 25% more and keep order better',
};

/** Campaign route: the running campaign, or the start screen. */
export function CampaignRoot() {
  const [, force] = useState(0);
  if (active) return <CampaignScreen session={active} />;
  return <CampaignStart onStart={() => force((x) => x + 1)} />;
}

function CampaignStart({ onStart }: { onStart: () => void }) {
  const [pick, setPick] = useState<FactionId>('vesperate');
  const [diff, setDiff] = useState<CampaignState['difficulty']>('normal');
  const saved = savedCampaign();
  const fd = factionDef(pick);
  const begin = () => {
    audio.unlock();
    audio.ui('click');
    startCampaign(pick, diff, Math.floor(Math.random() * 1e9));
    onStart();
  };
  return (
    <div class="screen setup-screen scroll">
      <div class="setup-head">
        <h1>Campaign</h1>
        <div class="row">
          {saved && (
            <button
              class="btn primary"
              onClick={() => {
                continueCampaign();
                onStart();
              }}
            >
              Continue: {factionDef(saved.player).short}, Toll {saved.turn}
            </button>
          )}
          <button class="btn ghost" onClick={() => go({ name: 'menu' })}>
            Back
          </button>
        </div>
      </div>
      <div class="cs-grid">
        <div class="cs-factions" role="radiogroup" aria-label="Choose a faction">
          {FACTION_IDS.map((f) => {
            const d = factionDef(f);
            return (
              <button key={f} role="radio" aria-checked={pick === f} class={`cs-card panel ${pick === f ? 'on' : ''}`} style={{ '--fc': OWNER_COLOR[f] } as never} onClick={() => setPick(f)}>
                <b>{d.name}</b>
                <span class="muted">{d.essence}</span>
              </button>
            );
          })}
        </div>
        <div class="panel cs-detail">
          <h2 style={{ color: OWNER_COLOR[pick] }}>{fd.name}</h2>
          <p class="cs-motto">“{fd.motto}”</p>
          <p>{fd.pitch}</p>
          <h3>Where you begin</h3>
          <p>{STARTS[pick]}</p>
          <h3>How you play</h3>
          <p>{fd.playstyle}</p>
          <ul class="cs-mech">
            {fd.campaignText.map((c) => (
              <li key={c.name}>
                <b>{c.name}.</b> {c.desc}
              </li>
            ))}
          </ul>
          <h3>Victory: {fd.victory.name}</h3>
          <p>{fd.victory.desc}</p>
          <div class="spread cs-go">
            <div class="row">
              <div class="seg" role="radiogroup" aria-label="Difficulty">
                {(['easy', 'normal', 'hard'] as const).map((d) => (
                  <button key={d} role="radio" aria-checked={diff === d} class={`btn small ${diff === d ? 'on' : ''}`} onClick={() => setDiff(d)} title={DIFFICULTY[d]}>
                    {d[0]!.toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
              <ClaudeChoice />
            </div>
            <button class="btn primary big" onClick={begin}>
              {saved ? 'Begin a new campaign' : 'Begin the campaign'}
            </button>
          </div>
          {saved && <p class="small muted">Beginning a new campaign replaces your saved one when you next save.</p>}
        </div>
      </div>
    </div>
  );
}

/** Where Claude can be asked, the AI factions' counsel is chosen here as well as in Settings. */
function ClaudeChoice() {
  void findClaude();
  const status = claudeStatus.value;
  const on = settings.value.claudeAI;
  if (status !== 'ready') return null;
  const set = (claudeAI: boolean) => saveSettings({ ...settings.value, claudeAI });
  const why = 'Rival factions take Claude’s counsel on wars and treaties, envoys answer in their own words, enemy generals speak before battle, and the war ends with its saga. Uses your Claude usage.';
  return (
    <div class="seg" role="radiogroup" aria-label="AI factions">
      <button role="radio" aria-checked={!on} class={`btn small ${!on ? 'on' : ''}`} onClick={() => set(false)} title="Rival factions follow the scripted AI">
        Scripted AI
      </button>
      <button role="radio" aria-checked={on} class={`btn small ${on ? 'on' : ''}`} onClick={() => set(true)} title={why}>
        ✦ Advised by Claude
      </button>
    </div>
  );
}

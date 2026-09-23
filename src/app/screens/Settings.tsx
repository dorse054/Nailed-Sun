import { useState } from 'preact/hooks';
import { saveSettings, settings } from '../store';
import { audio } from '../../audio/audio';
import { abandonCampaign, savedCampaign } from '../campaign/session';
import { factionDef } from '../../data/index';
import { claudeStatus, findClaude } from '../claude';

const SIZES: { value: number; label: string; note: string }[] = [
  { value: 0.5, label: 'Small', note: 'About half-size regiments. Fastest.' },
  { value: 0.75, label: 'Medium', note: 'The default.' },
  { value: 1, label: 'Large', note: 'Full regiments: 1,000–2,500 soldiers a battle.' },
];

/** Sound, unit size and the saved campaign. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = settings.value;
  const [confirm, setConfirm] = useState(false);
  const saved = savedCampaign();
  const set = (patch: Partial<typeof s>) => saveSettings({ ...s, ...patch });
  void findClaude();
  const claude = claudeStatus.value;
  return (
    <div class="modal-veil" onClick={onClose}>
      <div class="panel modal settings" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <section>
          <span class="label" id="size-label">
            Unit size
          </span>
          <div class="seg" role="radiogroup" aria-labelledby="size-label">
            {SIZES.map((z) => (
              <button key={z.value} role="radio" aria-checked={s.unitScale === z.value} class={`btn small ${s.unitScale === z.value ? 'on' : ''}`} onClick={() => set({ unitScale: z.value })} title={z.note}>
                {z.label}
              </button>
            ))}
          </div>
          <p class="muted small">{SIZES.find((z) => z.value === s.unitScale)?.note ?? ''} Colossi, heroes and engines adjust their strength so battles play alike at every size.</p>
        </section>
        <section>
          <label class="label" for="vol">
            Volume
          </label>
          <input
            id="vol"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={s.volume}
            onInput={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              set({ volume: v });
              audio.setVolume(v);
            }}
          />
          <label class="check">
            <input
              id="music"
              type="checkbox"
              checked={s.music}
              onChange={(e) => {
                const on = (e.target as HTMLInputElement).checked;
                set({ music: on });
                audio.setMusic(on);
              }}
            />
            Ambient drones and bells
          </label>
        </section>
        <section>
          <span class="label" id="ai-label">
            AI factions
          </span>
          <div class="seg" role="radiogroup" aria-labelledby="ai-label">
            <button role="radio" aria-checked={!s.claudeAI} class={`btn small ${!s.claudeAI ? 'on' : ''}`} onClick={() => set({ claudeAI: false })}>
              Scripted
            </button>
            <button role="radio" aria-checked={s.claudeAI} class={`btn small ${s.claudeAI ? 'on' : ''}`} disabled={claude === 'absent' || claude === 'refused'} onClick={() => set({ claudeAI: true })}>
              Advised by Claude
            </button>
          </div>
          <p class="muted small">
            {claude === 'absent'
              ? 'Claude can advise the AI factions when the game runs on claude.ai. Here the scripted AI plays.'
              : claude === 'refused'
                ? 'Claude is not allowed for this page right now, so the scripted AI plays.'
                : 'In a campaign, each AI faction asks Claude once per Toll to choose its wars, treaties and plans, in character. It uses your Claude usage, and the scripted AI takes over whenever Claude is slow or unavailable.'}
          </p>
        </section>
        {saved && (
          <section>
            <span class="label">Saved campaign</span>
            <p class="small">
              {factionDef(saved.player).name}, Toll {saved.turn}.
            </p>
            {confirm ? (
              <div class="row">
                <span class="bad small">Delete it for good?</span>
                <button
                  class="btn small danger"
                  onClick={() => {
                    abandonCampaign();
                    setConfirm(false);
                  }}
                >
                  Delete
                </button>
                <button class="btn small ghost" onClick={() => setConfirm(false)}>
                  Keep it
                </button>
              </div>
            ) : (
              <button class="btn small" onClick={() => setConfirm(true)}>
                Delete saved campaign
              </button>
            )}
          </section>
        )}
        <div class="row" style={{ justifyContent: 'flex-end' }}>
          <button class="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

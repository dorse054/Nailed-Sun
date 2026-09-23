import { useEffect, useRef, useState } from "preact/hooks";
import { saveSettings, settings } from "../store";
import { audio } from "../../audio/audio";
import {
  abandonCampaign,
  campaignFile,
  importCampaign,
  readCampaignFile,
  savedCampaign,
} from "../campaign/session";
import type { CampaignState } from "../../campaign/types";
import { factionDef } from "../../data/index";
import { claudeStatus, findClaude, saveFile } from "../claude";

const SIZES: { value: number; label: string; note: string }[] = [
  {
    value: 0.5,
    label: "Small",
    note: "About half-size regiments. Fastest; the default on phones.",
  },
  { value: 0.75, label: "Medium", note: "The default on larger screens." },
  {
    value: 1,
    label: "Large",
    note: "Full regiments: 1,000–2,500 soldiers a battle.",
  },
];

/** Sound, unit size, the AI and the saved campaign. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = settings.value;
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<CampaignState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saved = savedCampaign();
  const set = (patch: Partial<typeof s>) => saveSettings({ ...s, ...patch });
  void findClaude();
  const claude = claudeStatus.value;
  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div class="modal-veil" onClick={onClose}>
      <div
        class="panel modal settings"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Settings</h2>
        <section>
          <span class="label" id="size-label">
            Unit size
          </span>
          <div class="seg" role="radiogroup" aria-labelledby="size-label">
            {SIZES.map((z) => (
              <button
                key={z.value}
                role="radio"
                aria-checked={s.unitScale === z.value}
                class={`btn small ${s.unitScale === z.value ? "on" : ""}`}
                onClick={() => set({ unitScale: z.value })}
                title={z.note}
              >
                {z.label}
              </button>
            ))}
          </div>
          <p class="muted small">
            {SIZES.find((z) => z.value === s.unitScale)?.note ?? ""} Colossi,
            heroes and engines adjust their strength so battles play alike at
            every size.
          </p>
          <label class="check">
            <input
              type="checkbox"
              checked={s.minimap}
              onChange={(e) => set({ minimap: (e.target as HTMLInputElement).checked })}
            />
            Battle minimap (on larger screens)
          </label>
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
        {(claude === "ready" || claude === "refused") && (
          <section>
            <span class="label" id="ai-label">
              AI factions
            </span>
            <div class="seg" role="radiogroup" aria-labelledby="ai-label">
              <button
                role="radio"
                aria-checked={!s.claudeAI}
                class={`btn small ${!s.claudeAI ? "on" : ""}`}
                onClick={() => set({ claudeAI: false })}
              >
                Scripted
              </button>
              <button
                role="radio"
                aria-checked={s.claudeAI}
                class={`btn small ${s.claudeAI ? "on" : ""}`}
                disabled={claude === "refused"}
                onClick={() => set({ claudeAI: true })}
              >
                Advised by Claude
              </button>
            </div>
            <p class="muted small">
              {claude === "refused"
                ? "Claude is not allowed for this page right now, so the scripted AI plays."
                : "In a campaign, every other Toll each AI faction asks Claude to choose its wars, treaties and plans, in character, and their envoys decide your closer proposals and answer them in their own words, and now and then a dilemma is written for the moment. In battles, the enemy general reads the field with Claude while you deploy, picks a plan and speaks, and thinks again at the turning points of the fight. Choices made on Claude's advice are marked ✦ Claude in the chronicle, and at the end Claude writes the saga of your war. It uses your Claude usage, and the scripted AI takes over whenever Claude is slow or unavailable."}
            </p>
            {claude !== "refused" && (
              <p class="muted small">
                Either way, the ✦ buttons (Counsel, your adviser, Tell the tale, Invent a battle, the council) ask Claude only when you press them.
              </p>
            )}
          </section>
        )}
        <section>
          <span class="label">Saved campaign</span>
          {saved ? (
            <p class="small">
              {factionDef(saved.player).name}, Toll {saved.turn}.
            </p>
          ) : (
            <p class="small muted">No campaign in progress.</p>
          )}
          <div class="row">
            {saved && (
              <button
                class="btn small"
                onClick={async () => {
                  const f = campaignFile();
                  if (!f) return;
                  const r = await saveFile(f.name, f.json);
                  setNote(
                    r === "saved"
                      ? "Save file written."
                      : r === "declined"
                        ? null
                        : "The save file could not be written here.",
                  );
                }}
                title="Keep a copy, or carry the campaign to another device"
              >
                Download save
              </button>
            )}
            <button
              class="btn small"
              onClick={() => fileRef.current?.click()}
              title="Continue a campaign from a save file"
            >
              Load a save file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const input = e.target as HTMLInputElement;
                const file = input.files?.[0];
                input.value = "";
                if (!file) return;
                const r = readCampaignFile(await file.text());
                if ("error" in r) setNote(r.error);
                else if (saved) setPending(r.state);
                else
                  setNote(
                    importCampaign(r.state)
                      ? `Loaded: ${factionDef(r.state.player).name}, Toll ${r.state.turn}. Continue it from Campaign.`
                      : "This browser would not store the save.",
                  );
              }}
            />
          </div>
          {pending && (
            <div class="row">
              <span class="warn small">
                Replace your {factionDef(saved!.player).short} campaign with{" "}
                {factionDef(pending.player).name}, Toll {pending.turn}?
              </span>
              <button
                class="btn small danger"
                onClick={() => {
                  setNote(
                    importCampaign(pending)
                      ? `Loaded: ${factionDef(pending.player).name}, Toll ${pending.turn}. Continue it from Campaign.`
                      : "This browser would not store the save.",
                  );
                  setPending(null);
                }}
              >
                Replace
              </button>
              <button class="btn small ghost" onClick={() => setPending(null)}>
                Keep mine
              </button>
            </div>
          )}
          {note && (
            <p class="small muted" role="status">
              {note}
            </p>
          )}
        </section>
        {saved && (
          <section>
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
                <button
                  class="btn small ghost"
                  onClick={() => setConfirm(false)}
                >
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
        <div class="row" style={{ justifyContent: "flex-end" }}>
          <button class="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

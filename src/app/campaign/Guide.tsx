import type { CampaignSession } from './session';
import type { CampaignState } from '../../campaign/types';
import type { FactionId } from '../../data/schema';
import { REGIONS } from '../../campaign/regions';
import { victoryStatus } from '../../campaign/victory';

/** The guide shows for the opening Tolls only. */
const GUIDE_TOLLS = 12;

export function playerUnits(s: CampaignState, f: FactionId): number {
  return s.armies.reduce((n, a) => n + (a.faction === f ? a.units.length : 0), 0);
}

/** A building the player has put under way in a settlement or wind-city. */
function building(s: CampaignState, f: FactionId): boolean {
  for (const r of Object.values(s.regions)) if (r.owner === f && r.slots.some((sl) => sl?.building)) return true;
  return s.armies.some((a) => a.faction === f && !!a.city?.slots.some((sl) => sl?.building));
}

/** What a new campaign's player starts with, for the guide to measure against. */
export function guideBaseline(s: CampaignState): NonNullable<CampaignState['guide']> {
  return { units: playerUnits(s, s.player), done: [] };
}

interface Step {
  id: string;
  label: string;
  how: string;
  /** Seen now; once seen, a step stays done. */
  now: () => boolean;
}

function steps(s: CampaignState, touch: boolean): Step[] {
  const f = s.player;
  const g = s.guide!;
  const click = touch ? 'Tap' : 'Click';
  const drift = f === 'drift';
  const started = REGIONS.filter((r) => r.start === f).length;
  return [
    { id: 'march', label: 'March an army', how: `${click} one of your armies, then ${touch ? 'tap' : 'click'} a highlighted region.`, now: () => s.armies.some((a) => a.faction === f && !!a.from) },
    drift
      ? { id: 'take', label: 'Tie a mooring', how: 'Sail to a free town and demand tribute, or win it by force: a mooring pays you every Toll.', now: () => Object.values(s.regions).some((r) => r.mooring) }
      : { id: 'take', label: 'Take a settlement', how: 'March into a free or enemy town and assault it.', now: () => Object.values(s.regions).filter((r) => r.owner === f).length > started },
    { id: 'recruit', label: 'Recruit', how: `${click} an army standing in your ${drift ? 'wind-city' : 'land'} and open Recruit.`, now: () => playerUnits(s, f) > g.units },
    { id: 'build', label: 'Build', how: drift ? `${click} a wind-city and choose a building for an empty plot.` : `${click} one of your settlements and choose a building for an empty plot.`, now: () => building(s, f) },
    { id: 'end', label: 'End the Toll', how: 'The other factions move, battles are fought and the economy turns.', now: () => s.turn > 1 },
  ];
}

/** A short checklist for the first Tolls of a new campaign; it ticks itself off. */
export function Guide({ session }: { session: CampaignSession }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  if (!s.guide || s.guide.hidden || s.turn > GUIDE_TOLLS || s.winner) return null;
  const touch = matchMedia('(pointer: coarse)').matches;
  const all = steps(s, touch);
  const done = new Set(s.guide.done ?? []);
  for (const x of all) if (!done.has(x.id) && x.now()) done.add(x.id);
  s.guide.done = [...done];
  const list = all.map((x) => ({ ...x, done: done.has(x.id) }));
  const left = list.filter((x) => !x.done).length;
  if (!left) return null;
  const next = list.find((x) => !x.done)!;
  const v = victoryStatus(s, s.player);
  return (
    <details class="camp-guide panel" open={!matchMedia('(max-width: 720px), (max-height: 560px)').matches}>
      <summary>
        <b>First steps</b>
        <span class="muted num">
          {list.length - left} / {list.length}
        </span>
      </summary>
      <ol>
        {list.map((x) => (
          <li key={x.id} class={x.done ? 'done' : x === next ? 'next' : ''}>
            <span aria-hidden="true">{x.done ? '✓' : '○'}</span>
            <div>
              <b>{x.label}</b>
              {x === next && <p class="muted small">{x.how}</p>}
            </div>
          </li>
        ))}
      </ol>
      <div class="spread">
        <button class="btn small ghost" onClick={() => (session.panel.value = 'victory')}>
          How you win: {v.name}
        </button>
        <button
          class="btn small ghost"
          onClick={() => {
            s.guide!.hidden = true;
            session.bump();
          }}
        >
          Hide
        </button>
      </div>
    </details>
  );
}

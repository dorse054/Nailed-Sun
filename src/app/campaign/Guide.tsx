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

/** Buildings standing or under way in the player's settlements and wind-cities. */
export function playerBuildings(s: CampaignState, f: FactionId): number {
  let n = 0;
  for (const r of Object.values(s.regions)) if (r.owner === f) for (const sl of r.slots) if (sl && (sl.level > 0 || sl.building)) n++;
  for (const a of s.armies) if (a.faction === f && a.city) for (const sl of a.city.slots) if (sl && (sl.level > 0 || sl.building)) n++;
  return n;
}

/** What a new campaign's player starts with, for the guide to measure against. */
export function guideBaseline(s: CampaignState): NonNullable<CampaignState['guide']> {
  return { units: playerUnits(s, s.player), buildings: playerBuildings(s, s.player) };
}

interface Step {
  label: string;
  how: string;
  done: boolean;
}

function steps(s: CampaignState, touch: boolean): Step[] {
  const f = s.player;
  const g = s.guide!;
  const click = touch ? 'Tap' : 'Click';
  const drift = f === 'drift';
  const started = REGIONS.filter((r) => r.start === f).length;
  const held = Object.values(s.regions).filter((r) => r.owner === f).length;
  return [
    { label: 'March an army', how: `${click} one of your armies, then ${touch ? 'tap' : 'click'} a highlighted region.`, done: s.armies.some((a) => a.faction === f && !!a.from) },
    drift
      ? { label: 'Tie a mooring', how: 'Sail to a free town and demand tribute, or win it by force: a mooring pays you every Toll.', done: Object.values(s.regions).some((r) => r.mooring) }
      : { label: 'Take a settlement', how: 'March into a free or enemy town and assault it.', done: held > started },
    { label: 'Recruit', how: `${click} an army standing in your ${drift ? 'wind-city' : 'land'} and open Recruit.`, done: playerUnits(s, f) > g.units },
    { label: 'Build', how: drift ? `${click} a wind-city and choose a building for an empty plot.` : `${click} one of your settlements and choose a building for an empty plot.`, done: playerBuildings(s, f) > g.buildings },
    { label: 'End the Toll', how: 'The other factions move, battles are fought and the economy turns.', done: s.turn > 1 },
  ];
}

/** A short checklist for the first Tolls of a new campaign; it ticks itself off. */
export function Guide({ session }: { session: CampaignSession }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  if (!s.guide || s.guide.hidden || s.turn > GUIDE_TOLLS || s.winner) return null;
  const touch = matchMedia('(pointer: coarse)').matches;
  const list = steps(s, touch);
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
          <li key={x.label} class={x.done ? 'done' : x === next ? 'next' : ''}>
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

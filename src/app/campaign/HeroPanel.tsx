import type { CampaignSession } from './session';
import { factionDef, unitDef } from '../../data/index';
import { armiesIn } from '../../campaign/state';
import { regionDef } from '../../campaign/regions';
import { HERO_MOVES, heroActions, heroAct, heroById, joinArmy } from '../../campaign/heroes';
import { UnitIcon } from '../../ui/UnitIcon';
import { OWNER_COLOR } from './campaignMap';

/** A lone hero: where it is, what it can still do this Toll, and the armies it can rejoin. */
export function HeroPanel({ session, heroId }: { session: CampaignSession; heroId: string }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const h = heroById(s, heroId);
  if (!h) return null;
  const d = unitDef(h.unit.def);
  const place = regionDef(h.region);
  const resting = (h.restUntil ?? 0) > s.turn;
  const mine = h.faction === session.player;
  const friends = armiesIn(s, h.region, h.faction);
  return (
    <div class="ap">
      <header class="rp-head">
        <div class="row" style={{ gap: '10px' }}>
          <UnitIcon def={d} size={36} />
          <div>
            <h2 style={{ color: OWNER_COLOR[h.faction] }}>{d.name}</h2>
            <div class="muted">
              {d.character?.title ?? d.roleLabel} · {factionDef(h.faction).short} · acting alone
            </div>
          </div>
        </div>
        <button class="btn ghost small" onClick={() => session.selectHero(null)} aria-label="Close">
          ✕
        </button>
      </header>
      <div class="ap-stats">
        <span title="Regions left to travel this Toll">
          <span class="label">Travel</span>
          <div class="bar">
            <div style={{ width: `${(h.moves / HERO_MOVES) * 100}%`, background: 'var(--good)' }} />
          </div>
        </span>
        <span>
          <span class="label">In</span> <b>{place.settlement || place.name}</b>
        </span>
      </div>
      {resting && <div class="warnline">Wounded: resting until Toll {h.restUntil}.</div>}
      {mine && (
        <>
          <p class="muted small">
            {h.moves > 0 && !resting ? 'Click a highlighted region to travel: up to two a Toll, slipping past enemy armies.' : 'Travels again next Toll.'} One action a Toll:
          </p>
          <div class="hero-acts">
            {heroActions(s, h).map((a) => (
              <button key={a.kind} class="btn small" disabled={!!a.why} title={a.why ?? a.desc} onClick={() => session.heroOrder(heroAct(s, h.id, a.kind))}>
                <b>{a.label}</b>
                <span class="muted small">{a.why ?? a.desc}</span>
              </button>
            ))}
          </div>
          {friends.length > 0 && (
            <div class="hero-join">
              <span class="label">rejoin</span>
              {friends.map((a) => (
                <button key={a.id} class="btn small" onClick={() => session.heroOrder(joinArmy(s, h.id, a.id))}>
                  {a.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

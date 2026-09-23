import type { CampaignSession, Panel } from './session';
import type { FactionId } from '../../data/schema';
import { FACTION_IDS } from '../../data/schema';
import { factionDef } from '../../data/index';
import type { HouseId, ObservanceId } from '../../campaign/types';
import { CANDLES, REGIONS, regionDef } from '../../campaign/regions';
import { factionArmies, fmtNum, ownedRegions, relation } from '../../campaign/state';
import { armyPower, currentObservance } from '../../campaign/rules';
import { victoryStatus } from '../../campaign/victory';
import { factionLedger } from '../../campaign/turn';
import {
  HYMNS,
  OBSERVANCES,
  GREAT_TOLL,
  LENS_COST,
  buildLensStage,
  giftHouse,
  greatToll,
  lensReady,
  setObservance,
  singHymn,
  armyCap,
} from '../../campaign/actions';
import { declareWar, propose, valueDeal, type Deal, type DealKind } from '../../campaign/diplomacy';
import { OWNER_COLOR } from './campaignMap';

const TITLES: Record<Exclude<Panel, 'none'>, string> = {
  faction: 'Your faction',
  diplomacy: 'Diplomacy',
  log: 'Chronicle',
  victory: 'Victory',
  help: 'How to play',
};

export function FactionPanel({ session, focus }: { session: CampaignSession; focus: (r: string) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const p = session.panel.value;
  if (p === 'none') return null;
  const close = () => (session.panel.value = 'none');
  return (
    <div class="modal-veil" onClick={close}>
      <div class="panel modal fp scroll" role="dialog" aria-label={TITLES[p]} onClick={(e) => e.stopPropagation()}>
        <div class="spread">
          <div class="tabs" role="tablist">
            {(['faction', 'diplomacy', 'log', 'help'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={p === t} class={p === t ? 'on' : ''} onClick={() => (session.panel.value = t)}>
                {TITLES[t]}
              </button>
            ))}
          </div>
          <button class="btn ghost small" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        {p === 'faction' || p === 'victory' ? <Overview session={session} /> : null}
        {p === 'diplomacy' && <Diplomacy session={session} />}
        {p === 'log' && <Chronicle session={session} focus={focus} />}
        {p === 'help' && <Help />}
      </div>
    </div>
  );
}

function Overview({ session }: { session: CampaignSession }) {
  const s = session.s;
  const f = session.player;
  const fd = factionDef(f);
  const st = victoryStatus(s, f);
  const ledger = factionLedger(s, f);
  const act = (r: { ok: boolean; reason?: string }) => {
    if (!r.ok) session.say(r.reason ?? 'Cannot');
    session.bump();
  };
  return (
    <div class="fp-body">
      <section>
        <h2 style={{ color: OWNER_COLOR[f] }}>{fd.name}</h2>
        <p class="muted">{fd.essence}</p>
        <h3>
          Victory: {st.name} <small class="muted">({Math.round(st.progress * 100)}%)</small>
        </h3>
        <p class="small muted">{st.desc}</p>
        <ul class="checklist">
          {st.lines.map((l) => (
            <li key={l.label} class={l.ok ? 'ok' : ''}>
              {l.label} {l.detail && <span class="muted">({l.detail})</span>}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>{fd.resource.name}</h3>
        <p class="small muted">{fd.resource.desc}</p>
        {f === 'choir' && <Choir session={session} act={act} />}
        {f === 'hush' && <Hush session={session} />}
        {f === 'vesperate' && <Vesperate session={session} act={act} />}
        {f === 'drift' && <Drift session={session} />}
      </section>
      <section>
        <h3>Last Toll's ledger</h3>
        <table class="ledger">
          <tbody>
            {ledger.lines.map((l) => (
              <tr key={l.label}>
                <td>{l.label}</td>
                <td class="num">{l.coin ? `${l.coin > 0 ? '+' : ''}${fmtNum(l.coin)}` : ''}</td>
                <td class="num">{l.food ? `${l.food > 0 ? '+' : ''}${l.food} food` : ''}</td>
                <td class="num">{l.res ? `${l.res > 0 ? '+' : ''}${l.res}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3>The powers</h3>
        <table class="ledger">
          <thead>
            <tr>
              <th>Faction</th>
              <th class="num">Regions</th>
              <th class="num">Armies</th>
              <th class="num">Strength</th>
              <th>Victory</th>
            </tr>
          </thead>
          <tbody>
            {FACTION_IDS.map((o) => {
              const vs = victoryStatus(s, o);
              const alive = s.factions[o].alive;
              return (
                <tr key={o} class={alive ? '' : 'dead'}>
                  <td style={{ color: OWNER_COLOR[o] }}>{factionDef(o).short}</td>
                  <td class="num">{ownedRegions(s, o).length}</td>
                  <td class="num">{factionArmies(s, o).length}</td>
                  <td class="num">{fmtNum(factionArmies(s, o).reduce((t, a) => t + armyPower(a), 0))}</td>
                  <td>{alive ? (s.factions[o].finalStage ? <b class="bad">Final stage!</b> : `${Math.round(vs.progress * 100)}%`) : 'Fallen'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Choir({ session, act }: { session: CampaignSession; act: (r: { ok: boolean; reason?: string }) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const c = s.factions.choir;
  const lens = lensReady(s);
  return (
    <div>
      <p>
        Radiance <b>{fmtNum(c.res)}</b> · Zeal <b>{c.zeal}</b>
        {c.zeal >= 60 ? ' (a Crusade can be declared from an army)' : ''}
      </p>
      <div class="fp-grid">
        {(Object.keys(HYMNS) as (keyof typeof HYMNS)[]).map((h) => (
          <button key={h} class={`rp-opt ${c.hymn?.id === h ? 'on' : ''}`} disabled={!!c.hymn || c.res < HYMNS[h].cost} onClick={() => act(singHymn(s, h))}>
            <span>
              <b>{HYMNS[h].name}</b>
              <small class="muted">{HYMNS[h].desc}</small>
            </span>
            <span class="num gold">{c.hymn?.id === h ? `${c.hymn.turns} Tolls` : HYMNS[h].cost}</span>
          </button>
        ))}
      </div>
      <p class="small">
        Candles:{' '}
        {CANDLES.map((id) => (
          <span key={id} class="chip">
            {regionDef(id).settlement.replace('The Candle of ', '')}: {s.regions[id]!.owner === 'choir' ? 'ours' : s.regions[id]!.owner === 'free' ? 'free' : factionDef(s.regions[id]!.owner as FactionId).short}, {s.regions[id]!.lit ? 'lit' : 'dark'}
          </span>
        ))}
      </p>
      <button class="btn" disabled={!lens.ok} title={lens.ok ? 'Begin the next stage' : (lens as { reason: string }).reason} onClick={() => act(buildLensStage(s))}>
        Build Last Lens stage {c.lens + 1} ({LENS_COST.coin} coin, {LENS_COST.res} Radiance)
      </button>
    </div>
  );
}

function Hush({ session }: { session: CampaignSession }) {
  const s = session.s;
  const h = s.factions.hush;
  return (
    <div>
      <p>
        Dread <b>{h.res}</b> / 100.{' '}
        {h.res >= 50 ? 'Enemy regions near you lose order, and enemies fight you at −10% leadership.' : 'At 50, enemies near you lose order and fight you at −10% leadership.'}
      </p>
      <p class="small">
        The herds:{' '}
        {h.herds.map((x, i) => (
          <span key={i} class="chip">
            {regionDef(x.region).name}: {x.size}
          </span>
        ))}
      </p>
      <p class="small muted">Armies and settlements in a herd's region eat for free. Hunting a herd with more than one party shrinks it. Hold the Listening at the Pole of Night or a captured Candle to push the Tilt nightward; extinguish the Candles to open the Turning.</p>
    </div>
  );
}

function Vesperate({ session, act }: { session: CampaignSession; act: (r: { ok: boolean; reason?: string }) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const v = s.factions.vesperate;
  const cur = s.turn % v.calendar.length;
  return (
    <div>
      <p>
        Hours <b>{fmtNum(v.res)}</b>. Now ringing: <b>{currentObservance(s) ? OBSERVANCES[currentObservance(s) as ObservanceId].name : 'nothing (lapsed)'}</b>
      </p>
      <div class="calendar">
        {v.calendar.map((o, i) => (
          <label key={i} class={i === cur ? 'now' : ''}>
            <span class="label">{i === cur ? 'Now' : `In ${(i - cur + v.calendar.length) % v.calendar.length}`}</span>
            <select disabled={i === cur} value={o} onChange={(e) => act(setObservance(s, i, (e.target as HTMLSelectElement).value as ObservanceId))}>
              {(Object.keys(OBSERVANCES) as ObservanceId[]).map((k) => (
                <option key={k} value={k}>
                  {OBSERVANCES[k].name}
                </option>
              ))}
            </select>
            <small class="muted">{OBSERVANCES[o].desc}</small>
          </label>
        ))}
      </div>
      <div class="houses">
        {(['carillon', 'lantern', 'weir'] as HouseId[]).map((hk) => (
          <div key={hk} class="house">
            <span class="label">House {hk[0]!.toUpperCase() + hk.slice(1)}</span>
            <div class="bar">
              <div style={{ width: `${v.houses[hk]}%`, background: v.houses[hk] < 20 || v.houses[hk] > 88 ? 'var(--bad)' : 'var(--gold)' }} />
            </div>
            <button class="btn small" onClick={() => act(giftHouse(s, hk))}>
              Gift (200)
            </button>
          </div>
        ))}
      </div>
      <p class="small muted">A House grown too strong or too weak may take a town out of the Vesperate.</p>
      <button class="btn" disabled={v.greatTollCooldown > 0} onClick={() => act(greatToll(s))} title="Pulls the Tilt one point back toward 0">
        Ring the Great Toll ({GREAT_TOLL.coin} coin, {GREAT_TOLL.res} Hours){v.greatTollCooldown ? ` · ${v.greatTollCooldown} Tolls` : ''}
      </button>
    </div>
  );
}

function Drift({ session }: { session: CampaignSession }) {
  const s = session.s;
  const d = s.factions.drift;
  const moorings = REGIONS.filter((r) => s.regions[r.id]!.mooring);
  return (
    <div>
      <p>
        Renown <b>{fmtNum(d.res)}</b> / 1,000 · full migrations: <b>{d.migrations}</b> · sails allowed: <b>{armyCap(s, 'drift')}</b>
      </p>
      <p class="small">
        Moorings:{' '}
        {moorings.length ? (
          moorings.map((r) => (
            <span key={r.id} class="chip">
              {r.settlement}
            </span>
          ))
        ) : (
          <span class="muted">none yet: demand tribute from free cities, or win one by force</span>
        )}
      </p>
      {factionArmies(s, 'drift').map((a) => (
        <p key={a.id} class="small">
          {a.name}: bands visited this migration {(a.bandsVisited ?? []).length} / 5
        </p>
      ))}
      <p class="small muted">A sail that passes through all five bands completes a migration: +100 Renown. Every 2 points of Tilt in either direction raise the wind everywhere.</p>
    </div>
  );
}

function Diplomacy({ session }: { session: CampaignSession }) {
  const s = session.s;
  const me = session.player;
  const deal = (kind: DealKind, to: FactionId, coin?: number): Deal => ({ kind, from: me, to, coin });
  const tryDeal = (d: Deal) => {
    if (d.kind === 'war') {
      const r = declareWar(s, me, d.to);
      if (!r.ok) session.say(r.reason);
    } else {
      const r = propose(s, d);
      session.say(r.accepted ? `${factionDef(d.to).short} accept.` : `${factionDef(d.to).short} refuse: they find it ${r.value.label}.`);
    }
    session.bump();
  };
  return (
    <div class="fp-body">
      {FACTION_IDS.filter((f) => f !== me).map((o) => {
        const rel = relation(s, me, o);
        const alive = s.factions[o].alive;
        const opts: { kind: DealKind; label: string; coin?: number }[] = [];
        if (rel.stance === 'war') opts.push({ kind: 'peace', label: 'Offer peace' }, { kind: 'peace', label: 'Offer peace + 500 coin', coin: 500 });
        else {
          if (!rel.trade) opts.push({ kind: 'trade', label: 'Propose trade' });
          if (rel.stance === 'peace') opts.push({ kind: 'alliance', label: 'Propose alliance' });
          if (rel.stance === 'alliance') opts.push({ kind: 'breakAlliance', label: 'End the alliance' });
          opts.push({ kind: 'gift', label: 'Send 300 coin', coin: 300 });
          opts.push({ kind: 'war', label: 'Declare war' });
        }
        return (
          <section key={o} class={`dip ${alive ? '' : 'dead'}`}>
            <div class="spread">
              <h3 style={{ color: OWNER_COLOR[o] }}>{factionDef(o).name}</h3>
              <span class={`chip ${rel.stance === 'war' ? 'bad' : rel.stance === 'alliance' ? 'good' : ''}`}>
                {alive ? rel.stance : 'fallen'}
                {rel.trade ? ' · trade' : ''}
              </span>
            </div>
            <div class="bar opinion" title={`Opinion ${rel.opinion}`}>
              <div style={{ left: '50%', width: `${Math.abs(rel.opinion) / 2}%`, transform: rel.opinion < 0 ? 'translateX(-100%)' : undefined, background: rel.opinion < 0 ? 'var(--bad)' : 'var(--good)' }} />
            </div>
            <small class="muted">
              Opinion {rel.opinion > 0 ? '+' : ''}
              {rel.opinion}
              {s.factions[o].finalStage ? ' · in their final victory stage' : ''}
            </small>
            {alive && (
              <div class="row">
                {opts.map((x) => {
                  const d = deal(x.kind, o, x.coin);
                  const v = x.kind === 'war' || x.kind === 'breakAlliance' ? null : valueDeal(s, d);
                  return (
                    <button key={x.label} class={`btn small ${x.kind === 'war' ? 'danger' : ''}`} title={v ? `They would find it ${v.label}: ${v.why.join('; ')}` : ''} onClick={() => tryDeal(d)}>
                      {x.label}
                      {v && <em class={`deal ${v.label}`}> {v.label}</em>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Chronicle({ session, focus }: { session: CampaignSession; focus: (r: string) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const events = s.events.filter((e) => !e.faction || e.faction === session.player).slice(-120).reverse();
  return (
    <ul class="chronicle">
      {events.map((e, i) => (
        <li key={i} class={`ev ev-${e.kind}`}>
          <span class="muted num">T{e.turn}</span> {e.text}
          {e.region && (
            <button
              class="btn ghost small"
              onClick={() => {
                focus(e.region!);
                session.panel.value = 'none';
              }}
            >
              show
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Help() {
  return (
    <div class="fp-body help">
      <section>
        <h3>The Toll</h3>
        <p>Each turn is a Toll. Move and fight with your armies, build in your settlements, then End the Toll: the other powers move, coin and food arrive, cities grow or riot, and the Tilt creeps.</p>
        <h3>Armies</h3>
        <p>Click an army, then click a region to march; a full Toll carries an army two regions. Marching into enemies starts a battle: fight it yourself, or auto-resolve it with the real battle simulation. Entering a hostile settlement's land lets you assault it or raid the countryside. Up to 16 units plus a lord; each extra copy of a unit adds 5% upkeep to every copy.</p>
        <h3>The sun decides</h3>
        <p>The direction you attack from sets where the sun stands in battle: attack northward and it is at your back; attack southward and it is in your eyes. Each region's band sets the light, and the Gale Roads blow a gale.</p>
      </section>
      <section>
        <h3>Settlements</h3>
        <p>Major settlements grow to level 4 with up to 6 buildings, minor ones to level 3. Higher levels unlock higher unit tiers. Keep public order above −20 or the region revolts. Food feeds armies and grows cities; the light band sets the harvest.</p>
        <h3>The Tilt</h3>
        <p>From −5 (nightward) to +5 (sunward). Each point moves every region a fifth of a band, so border regions flip first. Choir wonders and pilgrimages push it sunward, Hush rituals nightward, and the Vesperate Great Toll pulls it back to 0. After Toll 70 the Great Shudder throws it about.</p>
        <h3>Winning</h3>
        <p>Each faction has its own victory, and final stages open on Toll 50. When anyone begins theirs, every rival fights them at +15% leadership. Or destroy everyone.</p>
      </section>
    </div>
  );
}

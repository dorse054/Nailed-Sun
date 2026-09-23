import { useState } from 'preact/hooks';
import type { CampaignSession } from './session';
import { factionDef, unitDef } from '../../data/index';
import { BANDS, WIND_RULES } from '../../data/rules';
import { BAND_IDS, WIND_NAMES } from '../../data/schema';
import { LANDMARKS, RESOURCES, regionDef, CANDLES, POLE, NAIL_SPIRE } from '../../campaign/regions';
import { bandIndex, bandPosition, maxLevel, orderLines, regionWind, regionYield, wallLevel, GROWTH_NEEDED, LEVEL_COST, herdIn } from '../../campaign/rules';
import { chainDef } from '../../campaign/buildings';
import {
  build,
  buildOptions,
  canRaiseArmy,
  canUpgradeSettlement,
  demolish,
  extinguish,
  listen,
  pilgrimage,
  raiseArmy,
  relight,
  upgradeSettlement,
  RAISE_COST,
  PILGRIMAGE_COST,
} from '../../campaign/actions';
import { garrisonFor } from '../../campaign/battles';
import { armiesIn, fmtNum } from '../../campaign/state';
import { UnitIcon } from '../../ui/UnitIcon';
import { OWNER_COLOR } from './campaignMap';

export function RegionPanel({ session, region, focus }: { session: CampaignSession; region: string; focus: (r: string) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const def = regionDef(region);
  const st = s.regions[region]!;
  const bi = bandIndex(s, region);
  const band = BANDS[BAND_IDS[bi]!];
  const mine = st.owner === session.player;
  const vis = session.visibility();
  const armies = armiesIn(s, region).filter((a) => vis.armies.has(a.id));
  const wind = regionWind(s, region);
  const pos = bandPosition(s, region);
  // How far the Tilt must move to flip this region's band.
  const toBrighter = Math.ceil((1 - pos) * 5 - 1e-9);
  const toDarker = Math.floor(pos * 5 + 1e-9) + 1;
  const act = (r: { ok: boolean; reason?: string } | { ok: false; reason: string }) => {
    if (!r.ok) session.say((r as { reason: string }).reason);
    session.bump();
  };
  const ownerName = st.owner === 'free' ? (def.settlement ? 'Free folk' : 'No one') : factionDef(st.owner).name;
  return (
    <div class="rp">
      <header class="rp-head">
        <div>
          <h2>{def.settlement || def.name}</h2>
          {def.settlement && <div class="muted">{def.name}</div>}
        </div>
        <button class="btn ghost small" onClick={() => session.selectRegion(null)} aria-label="Close">
          ✕
        </button>
      </header>
      <div class="chips">
        <span class="chip" style={{ borderColor: OWNER_COLOR[st.owner], color: OWNER_COLOR[st.owner] }}>
          {ownerName}
        </span>
        <span class={`chip band-chip band-${BAND_IDS[bi]}`}>{band.name}</span>
        <span class="chip">{WIND_NAMES[wind]}</span>
        {def.galeRoad && <span class="chip">Gale Road</span>}
        {def.river && <span class="chip">River</span>}
        {st.mooring && <span class="chip" style={{ color: OWNER_COLOR.drift }}>Drift mooring</span>}
        {st.nightfall ? <span class="chip bad">Nightfall ({st.nightfall})</span> : null}
      </div>
      <p class="rp-desc">{def.desc}</p>
      {def.landmark && (
        <div class="rp-landmark">
          <b>{LANDMARKS[def.landmark].name}</b>
          {CANDLES.includes(region) && <span class={st.lit ? 'lit' : 'dark'}> · {st.lit ? 'burning' : 'extinguished'}</span>}
          <div class="muted small">{LANDMARKS[def.landmark].desc}</div>
        </div>
      )}
      <div class="rp-grid">
        <div>
          <span class="label">Light</span>
          <div>
            {band.name.replace('The ', '')} · {['Dark', 'Dim', 'Dusk', 'Bright', 'Blaze'][bi]}
          </div>
          <small class="muted">
            {bi < 4 && `Brighter at Tilt ${fmtTilt(s.tilt + toBrighter)}`}
            {bi < 4 && bi > 0 && ' · '}
            {bi > 0 && `darker at ${fmtTilt(s.tilt - toDarker)}`}
          </small>
        </div>
        <div>
          <span class="label">Wind</span>
          <div>{WIND_NAMES[wind]}</div>
          <small class="muted">{wind === 0 ? 'No range effect' : `±${Math.round(WIND_RULES[wind].rangePct)}% range, blowing sunward`}</small>
        </div>
        <div>
          <span class="label">Resource</span>
          <div>{RESOURCES[def.resource].name}</div>
          <small class="muted">{RESOURCES[def.resource].desc}</small>
        </div>
        {herdIn(s, region) > 0 && (
          <div>
            <span class="label">Herds</span>
            <div>{herdIn(s, region)} head</div>
            <small class="muted">Food for the Hush while they pass</small>
          </div>
        )}
      </div>

      {def.settlement && <Settlement session={session} region={region} mine={mine} act={act} />}

      {mine && <Rituals session={session} region={region} act={act} />}

      {armies.length > 0 && (
        <section>
          <h3>Armies here</h3>
          {armies.map((a) => (
            <button key={a.id} class="rp-army" onClick={() => session.selectArmy(a.id)}>
              <span class="camp-dot" style={{ background: OWNER_COLOR[a.faction] }} />
              <b>{a.name}</b>
              <span class="muted">
                {a.lord.name} · {a.units.length} units
              </span>
            </button>
          ))}
        </section>
      )}

      {mine && (
        <section class="row">
          <button
            class="btn"
            disabled={!canRaiseArmy(s, session.player, region).ok}
            title={canRaiseArmy(s, session.player, region).ok ? 'A new lord and an empty army' : (canRaiseArmy(s, session.player, region) as { reason: string }).reason}
            onClick={() => {
              const r = raiseArmy(s, session.player, region);
              if (!r.ok) session.say(r.reason);
              else session.selectArmy(r.army.id);
            }}
          >
            Raise an army ({RAISE_COST})
          </button>
          <button class="btn ghost" onClick={() => focus(region)}>
            Center
          </button>
        </section>
      )}
    </div>
  );
}

function fmtTilt(t: number): string {
  return t > 0 ? `+${t}` : `${t}`;
}

function Settlement({ session, region, mine, act }: { session: CampaignSession; region: string; mine: boolean; act: (r: { ok: boolean }) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const st = s.regions[region]!;
  const def = regionDef(region);
  const [slot, setSlot] = useState<number | null>(null);
  const y = regionYield(s, region);
  const lines = orderLines(s, region);
  const orderDelta = lines.reduce((t, l) => t + l.value, 0);
  const up = canUpgradeSettlement(s, region);
  const need = GROWTH_NEEDED[st.level] ?? 0;
  const walls = wallLevel(s, region);
  const garrison = garrisonFor(s, region);
  const visible = mine || session.visibility().regions.has(region);
  return (
    <section class="rp-settle">
      <div class="spread">
        <h3>
          {def.major ? 'Major' : 'Minor'} settlement · level {st.level}
          {walls > 0 && ` · walls ${walls}`}
        </h3>
      </div>
      {mine && (
        <>
          <div class="rp-yield">
            <span>
              <span class="label">Coin</span> <b class="num">{fmtNum(y.coin)}</b>
            </span>
            <span>
              <span class="label">Food</span> <b class={`num ${y.food < 0 ? 'neg' : ''}`}>{y.food > 0 ? '+' : ''}{y.food}</b>
            </span>
            <span>
              <span class="label">{factionDef(session.player).resource.name}</span> <b class="num">{y.res}</b>
            </span>
          </div>
          <div class="rp-order" title={lines.map((l) => `${l.label}: ${l.value > 0 ? '+' : ''}${l.value}`).join('\n')}>
            <span class="label">Public order</span>
            <div class="bar order">
              <div style={{ left: '50%', width: `${Math.abs(st.order) * 2.5}%`, transform: st.order < 0 ? 'translateX(-100%)' : undefined, background: st.order < 0 ? 'var(--bad)' : 'var(--good)' }} />
            </div>
            <small class="num">
              {st.order > 0 ? '+' : ''}
              {Math.round(st.order)} ({orderDelta >= 0 ? '+' : ''}
              {Math.round(orderDelta * 10) / 10} a Toll){st.order <= -12 && ' · revolt looms at −20'}
            </small>
            <ul class="rp-lines">
              {lines.map((l) => (
                <li key={l.label}>
                  {l.label} <b class={l.value < 0 ? 'neg' : 'pos'}>{l.value > 0 ? '+' : ''}{l.value}</b>
                </li>
              ))}
            </ul>
          </div>
          <div class="rp-growth">
            <span class="label">Growth</span>
            {st.level < maxLevel(region) ? (
              <>
                <div class="bar">
                  <div style={{ width: `${Math.min(100, (st.growth / need) * 100)}%` }} />
                </div>
                <button class="btn small" disabled={!up.ok} title={up.ok ? `Grow to level ${st.level + 1}` : (up as { reason: string }).reason} onClick={() => act(upgradeSettlement(s, region))}>
                  Level {st.level + 1} ({LEVEL_COST[st.level]})
                </button>
              </>
            ) : (
              <small class="muted">At its greatest size</small>
            )}
          </div>
        </>
      )}
      {st.owner === 'free' || !mine ? (
        visible && (
          <div>
            <span class="label">Garrison</span>
            <div class="rp-garrison">
              {garrison.map((g, i) => (
                <UnitIcon key={i} def={unitDef(g)} size={24} side={1} />
              ))}
            </div>
          </div>
        )
      ) : null}
      {(mine || st.owner !== 'free') && (
        <div class="rp-slots">
          {st.slots.map((sl, i) => {
            const c = sl ? chainDef(sl.chain) : null;
            const name = c ? (sl!.level > 0 ? c.names[sl!.level - 1] : c.names[0]) : 'Empty plot';
            return (
              <button key={i} class={`rp-slot ${sl ? '' : 'empty'} ${slot === i ? 'on' : ''}`} disabled={!mine} onClick={() => setSlot(slot === i ? null : i)}>
                <b>{name}</b>
                <small>{sl ? (sl.building ? `building level ${sl.building.toLevel}…` : `level ${sl.level}`) : mine ? 'build here' : ''}</small>
              </button>
            );
          })}
        </div>
      )}
      {mine && slot !== null && <BuildMenu session={session} region={region} slot={slot} close={() => setSlot(null)} act={act} />}
    </section>
  );
}

function BuildMenu({ session, region, slot, close, act }: { session: CampaignSession; region: string; slot: number; close: () => void; act: (r: { ok: boolean }) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const opts = buildOptions(s, region, slot);
  const cur = s.regions[region]!.slots[slot];
  const resName = factionDef(session.player).resource.name;
  return (
    <div class="rp-build">
      {cur && (
        <div class="muted small">
          {chainDef(cur.chain).desc}
        </div>
      )}
      {opts.length === 0 && <div class="muted small">Fully built.</div>}
      {opts.map((o) => (
        <button
          key={o.chain.id}
          class="rp-opt"
          disabled={!o.ok}
          title={o.ok ? o.chain.desc : o.reason}
          onClick={() => {
            act(build(s, region, slot, o.chain.id));
            close();
          }}
        >
          <span>
            <b>{o.chain.names[o.level - 1]}</b>
            <small class="muted">{o.ok ? effectText(o.chain.effects[o.level - 1]!) || o.chain.desc : o.reason}</small>
          </span>
          <span class="num gold">
            {o.cost}
            {o.resCost ? ` · ${o.resCost} ${resName}` : ''}
          </span>
        </button>
      ))}
      {cur && (
        <button
          class="btn ghost small"
          onClick={() => {
            act(demolish(s, region, slot));
            close();
          }}
        >
          Demolish
        </button>
      )}
    </div>
  );
}

export function effectText(e: import('../../campaign/buildings').BuildingEffects): string {
  const out: string[] = [];
  if (e.coin) out.push(`+${e.coin} coin`);
  if (e.food) out.push(`+${e.food} food`);
  if (e.order) out.push(`+${e.order} order`);
  if (e.growth) out.push(`+${e.growth} growth`);
  if (e.res) out.push(`+${e.res} resource`);
  if (e.replenish) out.push(`+${e.replenish}% replenishment`);
  if (e.walls) out.push(`walls ${e.walls}`);
  if (e.garrison) out.push(`+${e.garrison} garrison`);
  if (e.vision) out.push(`sees ${e.vision} regions`);
  if (e.herdFood) out.push(`+${e.herdFood} food per herd head`);
  if (e.bellRange) out.push('Bell Range');
  if (e.canal) out.push('canals');
  if (e.tilt) out.push(`Tilt ${e.tilt > 0 ? '+' : ''}${e.tilt} a Toll`);
  if (e.rank) out.push(`recruits at rank ${e.rank}`);
  if (e.moves) out.push(`+${e.moves}% movement`);
  if (e.recruitPct) out.push(`−${e.recruitPct}% recruit cost`);
  return out.join(', ');
}

function Rituals({ session, region, act }: { session: CampaignSession; region: string; act: (r: { ok: boolean }) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const f = session.player;
  const st = s.regions[region]!;
  const buttons: preact.JSX.Element[] = [];
  if (f === 'choir' && (CANDLES.includes(region) || region === NAIL_SPIRE)) {
    if (CANDLES.includes(region) && !st.lit)
      buttons.push(
        <button key="relight" class="btn" onClick={() => act(relight(s, region))}>
          Relight the Candle (120 Radiance)
        </button>,
      );
    buttons.push(
      <button key="pil" class="btn" disabled={(st.ritualCooldown ?? 0) > 0} onClick={() => act(pilgrimage(s, region))} title="Pushes the Tilt sunward">
        Pilgrimage ({PILGRIMAGE_COST} Radiance){st.ritualCooldown ? ` · ${st.ritualCooldown} Tolls` : ''}
      </button>,
    );
  }
  if (f === 'hush' && (region === POLE || CANDLES.includes(region))) {
    if (CANDLES.includes(region) && st.lit)
      buttons.push(
        <button key="ext" class="btn" onClick={() => act(extinguish(s, region))}>
          Extinguish the Candle
        </button>,
      );
    buttons.push(
      <button key="listen" class="btn" disabled={(st.ritualCooldown ?? 0) > 0} onClick={() => act(listen(s, region))} title="Pushes the Tilt nightward">
        The Listening (300 coin){st.ritualCooldown ? ` · ${st.ritualCooldown} Tolls` : ''}
      </button>,
    );
  }
  if (!buttons.length) return null;
  return (
    <section>
      <h3>Rites</h3>
      <div class="row">{buttons}</div>
    </section>
  );
}

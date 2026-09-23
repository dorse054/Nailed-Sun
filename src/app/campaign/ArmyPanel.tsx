import { useState } from 'preact/hooks';
import type { CampaignSession } from './session';
import type { ArmyState } from '../../campaign/types';
import { factionDef, unitDef } from '../../data/index';
import {
  MAX_UNITS,
  TRAITS,
  buyTrait,
  cityBuild,
  cityBuildOptions,
  crusade,
  demandTribute,
  disband,
  hostileArmiesIn,
  hostileSettlement,
  recruit,
  recruitOptions,
  recruitSite,
  setStance,
  transfer,
  upgradeCity,
  CITY_COST,
  CRUSADE_ZEAL,
} from '../../campaign/actions';
import { armyPower, armyUpkeep, attrition, duplicatePenalty, maxMoves, regionStance, replenishRate } from '../../campaign/rules';
import { chainDef } from '../../campaign/buildings';
import { garrisonPower } from '../../campaign/battles';
import { armiesIn, fmtNum } from '../../campaign/state';
import { regionDef, REGIONS } from '../../campaign/regions';
import { UnitIcon } from '../../ui/UnitIcon';
import { OWNER_COLOR } from './campaignMap';
import { effectText } from './RegionPanel';

export function ArmyPanel({ session, army }: { session: CampaignSession; army: ArmyState }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const mine = army.faction === session.player;
  const [tab, setTab] = useState<'units' | 'recruit' | 'city'>('units');
  const fd = factionDef(army.faction);
  const act = (r: { ok: boolean; reason?: string }) => {
    if (!r.ok) session.say(r.reason ?? 'Cannot');
    session.bump();
  };
  const place = regionDef(army.region);
  const att = attrition(s, army);
  const rep = replenishRate(s, army);
  const power = armyPower(army);
  if (!mine) {
    return (
      <div class="ap">
        <header class="rp-head">
          <div>
            <h2 style={{ color: OWNER_COLOR[army.faction] }}>{army.name}</h2>
            <div class="muted">
              {fd.name} · {army.lord.name}
            </div>
          </div>
          <button class="btn ghost small" onClick={() => session.selectArmy(null)} aria-label="Close">
            ✕
          </button>
        </header>
        <div class="muted small">In {place.settlement || place.name}. Strength about {fmtNum(power)}.</div>
        <div class="ap-units">
          {army.units.map((u, i) => (
            <div key={i} class="ap-unit enemy" title={unitDef(u.def).name}>
              <UnitIcon def={unitDef(u.def)} size={30} side={1} />
              <div class="bar thin">
                <div style={{ width: `${u.strength * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const site = recruitSite(s, army);
  const hostileHere = hostileSettlement(s, army.region, army.faction);
  const enemiesHere = hostileArmiesIn(s, army.region, army.faction);
  const friends = armiesIn(s, army.region, army.faction).filter((a) => a.id !== army.id);
  return (
    <div class="ap">
      <header class="rp-head">
        <div>
          <h2 style={{ color: OWNER_COLOR[army.faction] }}>{army.name}</h2>
          <div class="muted">
            {army.lord.name}
            {army.lord.legendary && ' · legendary'}
            {army.lord.wins > 0 && ` · ${army.lord.wins} victories`}
          </div>
        </div>
        <button class="btn ghost small" onClick={() => session.selectArmy(null)} aria-label="Close">
          ✕
        </button>
      </header>
      <div class="ap-stats">
        <span title="Movement left this Toll">
          <span class="label">March</span>
          <div class="bar">
            <div style={{ width: `${(army.moves / maxMoves(army)) * 100}%`, background: 'var(--good)' }} />
          </div>
        </span>
        <span>
          <span class="label">Units</span> <b class="num">
            {army.units.length}/{MAX_UNITS}
          </b>
        </span>
        <span title="Coin per Toll">
          <span class="label">Upkeep</span> <b class="num">{armyUpkeep(army)}</b>
        </span>
        <span title="Replenishment per Toll">
          <span class="label">Heal</span> <b class="num">{Math.round(rep)}%</b>
        </span>
      </div>
      {att.pct > 0 && <div class="warnline">Attrition {att.pct}% a Toll: {att.why}.</div>}
      {army.lord.traits.length > 0 && (
        <div class="chips">
          {army.lord.traits.map((t) => (
            <span key={t} class="chip gold" title={TRAITS[t]?.desc}>
              {TRAITS[t]?.name ?? t}
            </span>
          ))}
        </div>
      )}
      <div class="ap-actions row">
        {hostileHere && !army.fought && (
          <button class="btn primary" onClick={() => void session.assaultHere(army.id)} title={`Garrison strength about ${fmtNum(garrisonPower(s, army.region))}`}>
            Assault {place.settlement}
          </button>
        )}
        {enemiesHere.length > 0 && !army.fought && (
          <button class="btn primary" onClick={() => void session.attackArmyHere(army.id)}>
            Attack the enemy here
          </button>
        )}
        {regionStance(s, army) === 'hostile' && (
          <button class={`btn ${army.stance === 'raid' ? 'on' : ''}`} onClick={() => act(setStance(s, army.id, army.stance === 'raid' ? 'march' : 'raid'))} title="Loot the countryside each Toll instead of fighting">
            {army.stance === 'raid' ? 'Raiding' : 'Raid'}
          </button>
        )}
        {army.faction === 'drift' && s.regions[army.region]!.owner === 'free' && place.settlement && !s.regions[army.region]!.mooring && (
          <button class="btn" onClick={() => act(demandTribute(s, army.id, armyPower, (r) => garrisonPower(s, r)))} title="A free city pays and grants a mooring if you bring twice its strength">
            Demand tribute
          </button>
        )}
        {army.faction === 'choir' && !army.crusade && s.factions.choir.zeal >= CRUSADE_ZEAL && <CrusadeButton session={session} army={army} />}
        {army.crusade && <span class="chip gold">Crusade on {regionDef(army.crusade.target).settlement} · {army.crusade.turns} Tolls</span>}
      </div>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'units'} class={tab === 'units' ? 'on' : ''} onClick={() => setTab('units')}>
          Units
        </button>
        <button role="tab" aria-selected={tab === 'recruit'} class={tab === 'recruit' ? 'on' : ''} onClick={() => setTab('recruit')}>
          Recruit
        </button>
        {army.city && (
          <button role="tab" aria-selected={tab === 'city'} class={tab === 'city' ? 'on' : ''} onClick={() => setTab('city')}>
            Wind-city
          </button>
        )}
      </div>
      {tab === 'units' && (
        <div class="ap-list">
          <div class="ap-row lord">
            <UnitIcon def={unitDef(army.lord.def)} size={30} />
            <div>
              <b>{army.lord.name}</b>
              <small class="muted">{unitDef(army.lord.def).roleLabel}</small>
            </div>
          </div>
          {army.units.map((u, i) => {
            const d = unitDef(u.def);
            return (
              <div key={i} class="ap-row">
                <UnitIcon def={d} size={30} />
                <div>
                  <b>
                    {d.name}
                    {u.rank > 0 && <span class="rank"> {'▲'.repeat(u.rank)}</span>}
                  </b>
                  <div class="bar thin" title={`${Math.round(u.strength * 100)}% strength`}>
                    <div style={{ width: `${u.strength * 100}%` }} />
                  </div>
                </div>
                <div class="ap-row-btns">
                  {friends.length > 0 && (
                    <button class="btn ghost small" title={`Send to ${friends[0]!.name}`} onClick={() => act(transfer(s, army.id, i, friends[0]!.id))}>
                      ⇄
                    </button>
                  )}
                  <button class="btn ghost small" title="Disband" onClick={() => act(disband(s, army.id, i))}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
          {army.units.length === 0 && <div class="muted small">No soldiers yet: recruit in your own settlement or next to one.</div>}
          <Traits session={session} army={army} act={act} />
        </div>
      )}
      {tab === 'recruit' && <Recruit session={session} army={army} siteOk={!!site} act={act} />}
      {tab === 'city' && army.city && <City session={session} army={army} act={act} />}
    </div>
  );
}

function Recruit({ session, army, siteOk, act }: { session: CampaignSession; army: ArmyState; siteOk: boolean; act: (r: { ok: boolean; reason?: string }) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const opts = recruitOptions(s, army.id);
  const resName = factionDef(army.faction).resource.name;
  const site = recruitSite(s, army);
  return (
    <div class="ap-recruit">
      <div class="muted small">
        {siteOk
          ? site?.region
            ? `Recruiting from ${regionDef(site.region).settlement}.`
            : 'Recruiting aboard the wind-city.'
          : army.faction === 'drift'
            ? 'Wind-cities cannot recruit in hostile land.'
            : 'Move into or next to one of your settlements to recruit.'}
      </div>
      {opts.map((o) => {
        const dup = duplicatePenalty(army, o.def.id);
        return (
          <button key={o.def.id} class="rp-opt" disabled={!o.ok} title={o.ok ? o.def.summary : o.reason} onClick={() => act(recruit(s, army.id, o.def.id))}>
            <UnitIcon def={o.def} size={28} />
            <span>
              <b>{o.def.name}</b>
              <small class="muted">
                {o.ok ? `${o.def.roleLabel} · tier ${o.def.tier}${dup ? ` · +${dup}% upkeep (copies)` : ''}` : o.reason}
              </small>
            </span>
            <span class="num gold">
              {o.coin}
              {o.res ? ` · ${o.res} ${resName}` : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function City({ session, army, act }: { session: CampaignSession; army: ArmyState; act: (r: { ok: boolean; reason?: string }) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const [slot, setSlot] = useState<number | null>(null);
  const city = army.city!;
  return (
    <div>
      <div class="spread">
        <span>
          Wind-city level <b>{city.level}</b>
        </span>
        {city.level < 3 && (
          <button class="btn small" onClick={() => act(upgradeCity(s, army.id))}>
            Raise to {city.level + 1} ({CITY_COST[city.level]} · {city.level === 1 ? 100 : 300} Renown)
          </button>
        )}
      </div>
      <div class="rp-slots">
        {city.slots.map((sl, i) => {
          const c = sl ? chainDef(sl.chain) : null;
          return (
            <button key={i} class={`rp-slot ${sl ? '' : 'empty'} ${slot === i ? 'on' : ''}`} onClick={() => setSlot(slot === i ? null : i)}>
              <b>{c ? c.names[Math.max(0, sl!.level - 1)] : 'Open deck'}</b>
              <small>{sl ? (sl.building ? `rigging level ${sl.building.toLevel}…` : `level ${sl.level}`) : 'build here'}</small>
            </button>
          );
        })}
      </div>
      {slot !== null && (
        <div class="rp-build">
          {cityBuildOptions(s, army.id, slot).map((o) => (
            <button
              key={o.chain.id}
              class="rp-opt"
              disabled={!o.ok}
              title={o.ok ? o.chain.desc : o.reason}
              onClick={() => {
                act(cityBuild(s, army.id, slot, o.chain.id));
                setSlot(null);
              }}
            >
              <span>
                <b>{o.chain.names[o.level - 1]}</b>
                <small class="muted">{o.ok ? effectText(o.chain.effects[o.level - 1]!) || o.chain.desc : o.reason}</small>
              </span>
              <span class="num gold">{o.cost}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Traits({ session, army, act }: { session: CampaignSession; army: ArmyState; act: (r: { ok: boolean; reason?: string }) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const avail = Object.entries(TRAITS).filter(([id, t]) => t.faction === army.faction && !army.lord.traits.includes(id));
  if (!avail.length) return null;
  return (
    <div class="ap-traits">
      {avail.map(([id, t]) => (
        <button key={id} class="btn small" title={t.desc} onClick={() => act(buyTrait(session.s, army.id, id))}>
          Equip: {t.name} ({t.cost})
        </button>
      ))}
    </div>
  );
}

function CrusadeButton({ session, army }: { session: CampaignSession; army: ArmyState }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const [open, setOpen] = useState(false);
  const s = session.s;
  const targets = REGIONS.filter((r) => r.settlement && s.regions[r.id]!.owner !== 'choir');
  if (!open)
    return (
      <button class="btn" onClick={() => setOpen(true)} title="One army pays 30% less upkeep while it marches on a named target">
        Declare a Crusade
      </button>
    );
  return (
    <select
      aria-label="Crusade target"
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (!v) return;
        const r = crusade(s, army.id, v);
        if (!r.ok) session.say(r.reason);
        setOpen(false);
        session.bump();
      }}
    >
      <option value="">Choose a target…</option>
      {targets.map((r) => (
        <option key={r.id} value={r.id}>
          {r.settlement}
        </option>
      ))}
    </select>
  );
}

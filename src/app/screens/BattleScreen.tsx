import { useEffect, useRef, useState } from 'preact/hooks';
import type { HourId } from '../../data/schema';
import { LIGHT_NAMES, WIND_NAMES } from '../../data/schema';
import { factionDef } from '../../data/index';
import { LIGHT_RULES, WIND_RULES } from '../../data/rules';
import { BattleSession } from '../battle/session';
import { go, type BattleRequest } from '../store';
import { Rose, roseLines } from '../../ui/Rose';
import { UnitIcon } from '../../ui/UnitIcon';
import type { Unit } from '../../sim/types';
import { moraleState } from '../../sim/morale';
import { hasMechanic } from '../../sim/mechanics';
import { tollActive } from '../../sim/stats';
import { formationSize } from '../../sim/army';
import { audio } from '../../audio/audio';
import { matchupNote } from '../../data/lore';

export function BattleScreen({ req }: { req: BattleRequest }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState<BattleSession | null>(null);
  useEffect(() => {
    const s = new BattleSession(req, canvas.current!);
    setSession(s);
    audio.ambient(factionDef(req.setup.armies[req.playerSide].faction).id, req.setup.map.wind);
    return () => {
      s.dispose();
      audio.ambient(null, 0);
    };
  }, [req]);
  return (
    <div class="screen" style={{ background: '#05060f' }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <canvas ref={canvas} class="backdrop" style={{ touchAction: 'none', cursor: 'crosshair' }} />
      </div>
      {session && <Hud s={session} />}
    </div>
  );
}

function Hud({ s }: { s: BattleSession }) {
  // Subscribe to the HUD tick.
  void s.hud.value;
  const [menu, setMenu] = useState(false);
  const b = s.battle;
  const fac = factionDef(b.sides[s.side].faction);
  const sel = s.selectedUnits();
  return (
    <>
      <TopBar s={s} onMenu={() => setMenu(true)} />
      {s.phase === 'deploy' && <DeployPanel s={s} />}
      {s.phase !== 'deploy' && fac.hours && s.req.mode !== 'replay' && s.req.mode !== 'demo' && <HourPicker s={s} />}
      <div class="hud-bottom">
        {sel.length === 1 && <UnitPanel s={s} u={sel[0]!} />}
        {sel.length > 1 && <GroupPanel s={s} units={sel} />}
        <UnitCards s={s} />
      </div>
      {s.message.value && (
        <div class="panel" style={{ position: 'absolute', left: '50%', top: '96px', transform: 'translateX(-50%)', padding: '6px 12px', fontSize: '13px' }}>
          {s.message.value}
        </div>
      )}
      {s.paused && s.phase === 'battle' && !menu && (
        <div class="center-banner">
          <h2 style={{ fontSize: '34px', color: 'var(--gold)', textShadow: '0 2px 12px #000' }}>Paused</h2>
          <div class="muted" style={{ textShadow: '0 1px 4px #000' }}>Space to resume. You can still give orders.</div>
        </div>
      )}
      {menu && <PauseMenu s={s} onClose={() => setMenu(false)} />}
      {s.phase === 'over' && <EndOverlay s={s} />}
    </>
  );
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function TopBar({ s, onMenu }: { s: BattleSession; onMenu: () => void }) {
  const b = s.battle;
  const t = b.terrain;
  const lines = roseLines(t.light, t.wind);
  const own = s.own().filter((u) => u.state === 'ready');
  let fx = 0;
  let fy = 0;
  for (const u of own) {
    fx += Math.cos(u.facing);
    fy += Math.sin(u.facing);
  }
  const facing = own.length ? Math.atan2(fy, fx) : undefined;
  const v0 = b.remainingValue(s.side);
  const v1 = b.remainingValue((1 - s.side) as 0 | 1);
  const total = Math.max(0.001, v0 + v1);
  const speeds = [0.5, 1, 2, 4];
  return (
    <div class="hud-top">
      <div class="panel rose-wrap">
        <Rose sunBearing={t.sunBearing} light={t.light} wind={t.wind} facing={facing} size={76} />
        <div class="rose-text">
          <div>
            <b style={{ color: 'var(--gold)' }}>{lines.light}</b> <span class="muted">· {bandName(t.band, t.steppe)}</span>
          </div>
          <div class="muted">{lines.lightFx}</div>
          <div>
            <b style={{ color: '#dff1ff' }}>{lines.wind}</b>
          </div>
          <div class="muted">{lines.windFx}</div>
        </div>
      </div>
      <div class="panel hud-cluster">
        <span class="clock num">{fmtTime(b.time)}</span>
        {s.phase === 'battle' && (
          <>
            <button class={`btn small ${s.paused ? 'on' : ''}`} onClick={() => (s.paused = !s.paused)} title="Pause (Space)" aria-label="Pause">
              {s.paused ? '▶' : '❚❚'}
            </button>
            {speeds.map((sp) => (
              <button key={sp} class={`btn small ${s.speed === sp && !s.paused ? 'on' : ''}`} onClick={() => ((s.speed = sp), (s.paused = false))}>
                {sp}×
              </button>
            ))}
          </>
        )}
        <div class="power" title="Share of each army still fighting, by value">
          <i style={{ width: `${(v0 / total) * 100}%`, background: 'var(--team-0)' }} />
          <i style={{ width: `${(v1 / total) * 100}%`, background: 'var(--team-1)' }} />
        </div>
      </div>
      <div class="panel hud-cluster">
        <button class="btn small" onClick={onMenu}>
          Menu
        </button>
      </div>
    </div>
  );
}

export function bandName(band: string, steppe: boolean): string {
  const n = band === 'longAfternoon' ? 'Long Afternoon' : band.charAt(0).toUpperCase() + band.slice(1);
  return steppe ? `Gale Roads, ${n}` : n;
}

/** Deployment is the first decision of every battle: read the sun and the wind. */
function DeployPanel({ s }: { s: BattleSession }) {
  const b = s.battle;
  const t = b.terrain;
  const own = s.own();
  const enemy = b.sides[(1 - s.side) as 0 | 1].faction;
  const me = b.sides[s.side].faction;
  let fx = 0;
  let fy = 0;
  for (const u of own) {
    fx += Math.cos(u.facing);
    fy += Math.sin(u.facing);
  }
  const facing = Math.atan2(fy, fx);
  const rel = Math.abs(Math.atan2(Math.sin(t.sunBearing - facing), Math.cos(t.sunBearing - facing)));
  const L = LIGHT_RULES[t.light];
  const W = WIND_RULES[t.wind];
  const tips: string[] = [];
  const glareBand = t.light === 2 || t.light === 3;
  if (glareBand) {
    if (rel < Math.PI / 4) tips.push(`Your line faces the sun: units facing it suffer glare (${L.glareAccuracyPct}% accuracy${L.glareMa ? `, ${L.glareMa} melee attack` : ''}).`);
    else if (rel > (Math.PI * 3) / 4) tips.push(`The sun is at your back: the enemy fights into the glare.`);
    else tips.push('The sun is on your flank: turn to attack from the side and neither line is blinded.');
  } else if (t.light === 4) tips.push('The sun stands overhead: no glare, but non-Choir units tire 50% faster.');
  else tips.push(`${LIGHT_NAMES[t.light]}: spotting ${Math.round((L.spotMult - 1) * 100)}%, beams at ${Math.round(L.beamMult * 100)}%.`);
  if (t.wind > 0) {
    const down = Math.cos(t.sunBearing - facing);
    if (down > 0.5) tips.push(`The wind blows toward the enemy: your missiles gain up to +${W.rangePct}% range.`);
    else if (down < -0.5) tips.push(`The wind blows in your face: your missiles lose up to ${W.rangePct}% range.`);
    else tips.push(`${WIND_NAMES[t.wind]} across the field: shots along it gain or lose up to ${W.rangePct}% range.`);
  } else tips.push('Calm: no wind on your shots; gliders sink and spores linger.');
  if (glareBand) tips.push('Long shadows fall nightward and never move: units standing in them stay hidden until an enemy comes within 60 m.');
  if (me === 'choir') tips.push('Mirrorflash: your mirror-shield units want to face the sun.');
  if (enemy === 'choir') tips.push('Against the Choir, attack from the side, never with the sun at your back.');
  const note = matchupNote(me, enemy);
  return (
    <div class="panel" style={{ position: 'absolute', top: 'calc(104px + env(safe-area-inset-top, 0px))', left: '50%', transform: 'translateX(-50%)', width: 'min(620px, calc(100% - 16px))', padding: '12px 16px', display: 'grid', gap: '8px' }}>
      <div class="spread">
        <h2 style={{ fontSize: '28px', color: 'var(--gold)' }}>Deployment</h2>
        <span class="chip gold">{factionDef(me).short} vs {factionDef(enemy).short}</span>
      </div>
      <ul style={{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '3px' }}>
        {tips.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      {note && <div class="muted" style={{ fontSize: '13px' }}>{note}</div>}
      <div class="muted" style={{ fontSize: '12.5px' }}>
        Drag your units to move them. Select units and right-drag to set a line and its facing. Right-click to move a selection.
      </div>
      <div class="row" style={{ justifyContent: 'flex-end' }}>
        <button class="btn" onClick={() => s.autoDeploy()}>
          Reset deployment
        </button>
        <button class="btn primary" onClick={() => s.startBattle()}>
          Start the battle
        </button>
      </div>
    </div>
  );
}

function HourPicker({ s }: { s: BattleSession }) {
  const b = s.battle;
  const st = b.sides[s.side];
  const fac = factionDef(st.faction);
  const iv = st.tollInterval;
  const left = Number.isFinite(iv) ? Math.max(0, iv - st.tollTimer) : null;
  const active = b.time - st.lastToll < 6;
  return (
    <div class="panel" style={{ position: 'absolute', right: '8px', top: 'calc(104px + env(safe-area-inset-top, 0px))', padding: '8px 10px', display: 'grid', gap: '6px', width: '210px' }}>
      <div class="spread">
        <b style={{ fontFamily: 'var(--display)', fontSize: '18px', color: 'var(--gold)' }}>The Toll</b>
        <span class={`chip ${active ? 'gold' : ''} num`}>{left === null ? 'silenced' : active ? 'ringing' : `${left.toFixed(0)} s`}</span>
      </div>
      {left !== null && (
        <div class="bar" style={{ height: '4px' }}>
          <i style={{ width: `${(1 - left / iv) * 100}%`, background: 'var(--gold)' }} />
        </div>
      )}
      <div style={{ display: 'grid', gap: '4px' }}>
        {fac.hours!.map((h) => (
          <button key={h.id} class={`btn small ${st.hour === h.id ? 'on' : ''}`} style={{ justifyContent: 'space-between' }} onClick={() => s.setHour(h.id as HourId)} title={h.desc}>
            <span>{h.name.replace('Hour of ', '')}</span>
            <span class="muted" style={{ fontSize: '11px' }}>
              {h.desc.replace('.', '')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function UnitCards({ s }: { s: BattleSession }) {
  const units = s.own();
  return (
    <div class="panel cards" role="list">
      {units.map((u) => {
        const gone = u.alive <= 0 || u.state === 'dead' || u.state === 'fled' || u.state === 'shattered';
        const ms = moraleState(u);
        const sel = s.overlay.selected.has(u.id);
        const ammo = u.def.missile ? u.soldiers.reduce((a, x) => a + (x.alive ? x.ammo : 0), 0) / Math.max(1, u.alive * u.def.missile.ammo) : -1;
        return (
          <div
            key={u.id}
            role="listitem"
            class={`card ${sel ? 'sel' : ''} ${gone ? 'gone' : ''} ${u.state === 'routing' ? 'routing' : ''}`}
            title={`${u.def.name} · ${u.def.roleLabel}`}
            onClick={(e) => {
              if (gone) return;
              s.select([u.id], (e as MouseEvent).shiftKey);
            }}
            onDblClick={() => {
              const c = s.renderer.unitCenter(u, 1);
              s.renderer.camera.x = c.x;
              s.renderer.camera.y = c.y;
            }}
          >
            <UnitIcon def={u.def} size={34} />
            <div class="nm">{u.def.name}</div>
            <div class="bar">
              <i style={{ width: `${(u.alive / u.initial) * 100}%`, background: '#e8dcc0' }} />
            </div>
            <div class="bar">
              <i style={{ width: `${Math.max(0, (u.morale / Math.max(1, u.maxMorale)) * 100)}%`, background: ms === 'steady' ? 'var(--good)' : ms === 'wavering' ? 'var(--warn)' : 'var(--bad)' }} />
            </div>
            {ammo >= 0 && (
              <div class="bar">
                <i style={{ width: `${ammo * 100}%`, background: '#9fd0ff' }} />
              </div>
            )}
            {u.state === 'embarked' && <span class="chip" style={{ position: 'absolute', top: '2px', right: '2px', fontSize: '9px', padding: '0 4px' }}>aboard</span>}
            {u.concealed && <span style={{ position: 'absolute', top: '2px', left: '4px', color: '#b8a8ff', fontSize: '11px' }} title="Hidden">◐</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Live modifiers on a unit, with exact numbers. */
function modifierChips(s: BattleSession, u: Unit): { text: string; tone: string; title: string }[] {
  const b = s.battle;
  const out: { text: string; tone: string; title: string }[] = [];
  out.push({ text: LIGHT_NAMES[u.light], tone: u.light >= 3 ? 'gold' : u.light <= 1 ? '' : 'gold', title: 'Light here (natural light plus light and dark zones)' });
  out.push({ text: `${WIND_NAMES[u.wind]} wind`, tone: '', title: 'Wind here. It always blows sunward.' });
  if (u.stats.glareAcc < 0) out.push({ text: `Glare ${u.stats.glareAcc}%${u.stats.glareMa ? ` / ${u.stats.glareMa} MA` : ''}`, tone: 'bad', title: `Glare from ${u.stats.glareSource === 'sun' ? 'facing the sun' : u.stats.glareSource === 'noon' ? 'Walking Noon' : u.stats.glareSource === 'mirror' ? 'Mirrorflash' : 'mirror dazzle'}` });
  if (u.concealed) out.push({ text: 'Hidden', tone: 'good', title: 'The enemy cannot see this unit.' });
  if (tollActive(b, u)) out.push({ text: 'Toll', tone: 'gold', title: 'The Hour is in effect.' });
  if (u.chill > 0) out.push({ text: 'Chilled', tone: 'bad', title: '-20% speed and attack speed' });
  if (u.slow > 0) out.push({ text: `Slowed ${u.slowPct}%`, tone: 'bad', title: 'Tethered or entangled' });
  if (u.marked > 0) out.push({ text: 'Marked', tone: 'bad', title: 'Revealed; +10% damage from Hush stealth units' });
  if (u.grounded > 0) out.push({ text: 'Grounded', tone: 'bad', title: 'Pulled out of the sky' });
  if (u.fatigue >= 0.45) out.push({ text: u.fatigue >= 0.9 ? 'Exhausted' : u.fatigue >= 0.7 ? 'Tired' : 'Winded', tone: 'warn', title: 'Fatigue lowers attack, defense and speed' });
  if (u.stats.unbreakable) out.push({ text: 'Unbreakable', tone: 'good', title: 'Will not rout' });
  if (u.special.glide !== undefined) out.push({ text: `Glide ${Math.round(u.special.glide)} s`, tone: u.special.glide < 20 ? 'warn' : '', title: 'Glide time left. Drains fastest in Calm.' });
  if (u.special.sailsBurning) out.push({ text: 'Sails burning', tone: 'bad', title: '-50% speed until the crew puts them out' });
  if (u.special.elkHp !== undefined) out.push({ text: `Elk ${Math.round((u.special.elkHp / (u.special.elkMax || 1)) * 100)}%`, tone: u.special.elkHp <= 0 ? 'bad' : '', title: 'Kill the elk team and it is immobile' });
  for (const bf of u.buffs) if (bf.tag === 'fear') out.push({ text: 'Afraid', tone: 'bad', title: '-15% leadership' });
  return out;
}

function UnitPanel({ s, u }: { s: BattleSession; u: Unit }) {
  const ms = moraleState(u);
  const w = s.battle.weaponOf(u);
  const lead = u.soldiers.find((x) => x.alive);
  const fac = factionDef(u.faction);
  return (
    <div class="panel unit-panel">
      <div class="spread">
        <div class="row" style={{ gap: '10px' }}>
          <UnitIcon def={u.def} size={40} />
          <div>
            <h3>{u.def.name}</h3>
            <div class="label">
              {u.def.roleLabel} · {fac.short}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', justifyItems: 'end', gap: '2px' }}>
          <span class={`chip ${ms === 'steady' ? 'good' : ms === 'wavering' ? 'warn' : 'bad'}`}>{u.state === 'routing' ? 'Routing' : u.state === 'shattered' ? 'Shattered' : ms === 'steady' ? 'Steady' : 'Wavering'}</span>
          <span class="num muted" style={{ fontSize: '12px' }}>
            {u.alive}/{u.initial} {u.def.category === 'colossus' && lead ? `· ${Math.round((lead.hp / lead.maxHp) * 100)}% hp` : ''}
          </span>
        </div>
      </div>
      <div class="stats num">
        <div>
          <span class="muted">Attack</span>
          <b>{Math.round((u.def.ma + u.stats.ma + u.stats.glareMa) * u.stats.maMult)}</b>
        </div>
        <div>
          <span class="muted">Defense</span>
          <b>{Math.round((u.def.md + u.stats.md) * u.stats.mdMult)}</b>
        </div>
        <div>
          <span class="muted">Armor</span>
          <b>{u.def.armor + u.stats.armorAdd}</b>
        </div>
        <div>
          <span class="muted">Morale</span>
          <b>{Math.max(0, Math.round((u.morale / Math.max(1, u.maxMorale)) * 100))}%</b>
        </div>
        <div>
          <span class="muted">Speed</span>
          <b>{(u.def.speed * u.stats.speedMult).toFixed(1)}</b>
        </div>
        <div>
          <span class="muted">Charge</span>
          <b>{Math.round(u.def.charge + u.stats.chargeBonus)}</b>
        </div>
        {w && (
          <>
            <div>
              <span class="muted">Range</span>
              <b>{Math.round(w.range * u.stats.rangeMult)}</b>
            </div>
            <div>
              <span class="muted">Ammo</span>
              <b>{Math.round((u.soldiers.reduce((a, x) => a + (x.alive ? x.ammo : 0), 0) / Math.max(1, u.alive * w.ammo)) * 100)}%</b>
            </div>
          </>
        )}
      </div>
      <div class="mods">
        {modifierChips(s, u).map((c) => (
          <span key={c.text} class={`chip ${c.tone}`} title={c.title}>
            {c.text}
          </span>
        ))}
      </div>
      <div class="abilities">
        {(u.def.abilities ?? []).map((a, i) => {
          const st = u.abilities.find((x) => x.def.id === a.id)!;
          const frac = a.cooldown > 0 && st.cooldown > 0 ? st.cooldown / a.cooldown : 0;
          const used = st.uses <= 0;
          return (
            <button
              key={a.id}
              class={`btn small ability ${st.on ? 'on' : ''} ${s.targeting?.ability.id === a.id ? 'on' : ''}`}
              disabled={used || s.phase !== 'battle' || u.state !== 'ready'}
              onClick={() => s.useAbility(u, a)}
              title={`${a.name}: ${a.desc}${a.cooldown ? ` (cooldown ${a.cooldown} s)` : ''}`}
            >
              <kbd>{i + 1}</kbd> {a.name}
              {frac > 0 && <span class="cd" style={{ width: `${frac * 100}%` }} />}
            </button>
          );
        })}
      </div>
      <div class="row">
        <button class={`btn small ${u.running ? 'on' : ''}`} onClick={() => s.toggleRun()} title="Run or walk (R)">
          {u.running ? 'Running' : 'Walking'}
        </button>
        {u.def.missile && (
          <>
            <button class={`btn small ${u.fireAtWill ? 'on' : ''}`} onClick={() => s.toggleFire()} title="Fire at will (F)">
              Fire at will
            </button>
            <button class={`btn small ${u.special.meleeMode ? 'on' : ''}`} onClick={() => s.toggleMelee()} title="Melee mode (M)">
              Melee
            </button>
          </>
        )}
        <button class="btn small" onClick={() => s.halt()} title="Halt (H)">
          Halt
        </button>
        {u.state === 'embarked' && (
          <button class="btn small" onClick={() => s.issue({ type: 'disembark', unit: u.id })}>
            Disembark
          </button>
        )}
      </div>
      <div class="muted" style={{ fontSize: '12.5px' }}>
        {u.def.summary}
      </div>
    </div>
  );
}

function GroupPanel({ s, units }: { s: BattleSession; units: Unit[] }) {
  const alive = units.reduce((a, u) => a + u.alive, 0);
  const width = units.reduce((a, u) => a + formationSize(u).width, 0);
  return (
    <div class="panel unit-panel">
      <div class="spread">
        <h3>{units.length} units selected</h3>
        <span class="num muted">{alive} soldiers · {Math.round(width)} m of front</span>
      </div>
      <div class="row">
        <button class={`btn small ${units.every((u) => u.running) ? 'on' : ''}`} onClick={() => s.toggleRun()}>
          Run
        </button>
        <button class="btn small" onClick={() => s.toggleFire()}>
          Fire at will
        </button>
        <button class="btn small" onClick={() => s.halt()}>
          Halt
        </button>
      </div>
      <div class="muted" style={{ fontSize: '12.5px' }}>
        Right-drag to lay the group out along a line. Units keep their left-to-right order.
      </div>
    </div>
  );
}

function PauseMenu({ s, onClose }: { s: BattleSession; onClose: () => void }) {
  const wasPaused = useRef(s.paused);
  useEffect(() => {
    s.paused = true;
    return () => {
      s.paused = wasPaused.current;
    };
  }, [s]);
  return (
    <div class="modal-veil" onClick={onClose}>
      <div class="panel modal" onClick={(e) => e.stopPropagation()}>
        <h2>Battle</h2>
        <div class="muted">
          Mouse: left-click selects, drag a box to select many, right-click moves or attacks, right-drag lays out a line. Wheel zooms, WASD or arrows pan. Keys: Space pause, R run, F fire at will, H halt, M melee, 1-3 abilities, +/- speed.
        </div>
        <div class="row">
          <button class="btn primary" onClick={onClose}>
            Resume
          </button>
          {s.phase === 'battle' && s.req.mode !== 'replay' && s.req.mode !== 'demo' && (
            <button
              class="btn danger"
              onClick={() => {
                s.battle.finish((1 - s.side) as 0 | 1, 'withdraw');
                onClose();
              }}
            >
              Concede the field
            </button>
          )}
          <button class="btn" onClick={() => go({ name: 'menu' })}>
            Quit to menu
          </button>
        </div>
      </div>
    </div>
  );
}

function EndOverlay({ s }: { s: BattleSession }) {
  const r = s.battle.result!;
  const won = r.winner === s.side;
  const draw = r.winner === -1;
  const mine = r.sides[s.side];
  const theirs = r.sides[(1 - s.side) as 0 | 1];
  const title = draw ? 'Stalemate' : won ? (theirs.costLost / Math.max(1, theirs.costStart) > 0.7 && mine.costLost / Math.max(1, mine.costStart) < 0.3 ? 'Heroic Victory' : 'Victory') : 'Defeat';
  const reason = r.reason === 'rout' ? (won ? 'The enemy army is broken.' : 'Your army is broken.') : r.reason === 'capture' ? 'The settlement has fallen.' : r.reason === 'withdraw' ? 'The field was conceded.' : 'Time ran out.';
  const done = () => {
    if (s.req.onDone) s.req.onDone(r, s.battle.log, s.req.setup);
    else go({ name: 'results', req: s.req, result: r, log: s.battle.log, setup: s.req.setup });
  };
  return (
    <div class="modal-veil">
      <div class="panel modal" style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: '44px', color: won ? 'var(--gold)' : draw ? 'var(--text)' : 'var(--bad)' }}>{title}</h2>
        <div>{reason}</div>
        <div class="row num" style={{ justifyContent: 'center', gap: '24px' }}>
          <div>
            <div class="label">your losses</div>
            <b>
              {mine.soldiersLost} / {mine.soldiersStart}
            </b>
          </div>
          <div>
            <div class="label">enemy losses</div>
            <b>
              {theirs.soldiersLost} / {theirs.soldiersStart}
            </b>
          </div>
          <div>
            <div class="label">time</div>
            <b>{fmtTime(r.time)}</b>
          </div>
        </div>
        <div class="row" style={{ justifyContent: 'center' }}>
          <button class="btn primary" onClick={done}>
            {s.req.onDone ? 'Continue' : 'Battle report'}
          </button>
          {!s.req.onDone && (
            <button class="btn" onClick={() => go({ name: 'menu' })}>
              Main menu
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { hasMechanic };

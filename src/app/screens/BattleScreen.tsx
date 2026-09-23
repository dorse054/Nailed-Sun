import { useEffect, useRef, useState } from 'preact/hooks';
import type { HourId } from '../../data/schema';
import { LIGHT_NAMES, WIND_NAMES } from '../../data/schema';
import { factionDef } from '../../data/index';
import { LIGHT_RULES, WIND_RULES } from '../../data/rules';
import { BattleSession } from '../battle/session';
import { go, settings, type BattleRequest } from '../store';
import { Minimap } from '../battle/Minimap';
import { Rose, roseLines } from '../../ui/Rose';
import { UnitIcon } from '../../ui/UnitIcon';
import type { Unit } from '../../sim/types';
import { moraleState } from '../../sim/morale';
import { hasMechanic } from '../../sim/mechanics';
import { activePassives, tollActive } from '../../sim/stats';
import { tollInterval } from '../../sim/toll';
import { modsText, zoneName } from '../codex/format';
import { signal } from '@preact/signals';
import { formationSize } from '../../sim/army';
import { audio } from '../../audio/audio';
import { matchupNote } from '../../data/lore';
import { TutorialLayer } from '../tutorial/TutorialLayer';
import { claudeStatus } from '../claude';
import { legendById } from '../legends';
import { MedalChip, medalTerms } from './Legends';

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
      {session && req.tutorial && <TutorialLayer s={session} />}
    </div>
  );
}

function Hud({ s }: { s: BattleSession }) {
  // Subscribe to the HUD tick.
  void s.hud.value;
  const menu = s.menuOpen.value;
  const setMenu = (v: boolean) => (s.menuOpen.value = v);
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
        {TOUCH && s.req.mode !== 'replay' && s.req.mode !== 'demo' && <TouchModes s={s} />}
        <div class="cards-row">
          {settings.value.minimap && !TOUCH && <Minimap s={s} />}
          <UnitCards s={s} />
        </div>
      </div>
      <div class="hud-notes">
        {s.message.value && <div class="panel hud-flash">{s.message.value}</div>}
        <Herald s={s} />
      </div>
      {s.req.mode === 'demo' && s.req.briefing && s.phase === 'battle' && b.time < 10 && (
        <div class="center-banner watch-briefing">
          <h2>{s.req.briefing.title}</h2>
          <p>{s.req.briefing.text}</p>
        </div>
      )}
      {s.paused && s.phase === 'battle' && !menu && (
        <div class="center-banner">
          <h2 style={{ fontSize: '34px', color: 'var(--gold)', textShadow: '0 2px 12px #000' }}>Paused</h2>
          <div class="muted" style={{ textShadow: '0 1px 4px #000' }}>{TOUCH ? 'Tap ▶ to resume.' : 'Space to resume.'} You can still give orders.</div>
        </div>
      )}
      {menu && <PauseMenu s={s} onClose={() => setMenu(false)} />}
      {s.phase === 'over' && !s.req.tutorial && <EndOverlay s={s} />}
    </>
  );
}

/** A general's order to the army, heard across the field. */
function Herald({ s }: { s: BattleSession }) {
  const h = s.herald.value;
  if (!h) return null;
  const mine = h.side === s.side;
  return (
    <div class={`panel herald ${mine ? 'own' : 'foe'} ${h.stance}`} role="status">
      <span class="who">{h.who}</span>
      <span class="words">“{h.text}”</span>
    </div>
  );
}

/** Touch screens: no hover, no Shift key, no right button. */
const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const TOUCH_MODES = [
  { id: 'pan', label: 'Pan', title: 'Drag moves the view. Tap a unit to select it, then tap the ground or an enemy to order it.' },
  { id: 'select', label: 'Select', title: 'Taps add or remove units; drag on the ground to box-select.' },
  { id: 'line', label: 'Line', title: 'Drag on the ground to lay the selection out along a line; tap to move or attack.' },
] as const;

/** One finger's job on a touch screen is a mode. */
function TouchModes({ s }: { s: BattleSession }) {
  return (
    <div class="panel touch-modes" role="radiogroup" aria-label="What a finger does">
      {TOUCH_MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={s.touchMode === m.id}
          class={`btn small ${s.touchMode === m.id ? 'on' : ''}`}
          title={m.title}
          onClick={() => {
            s.touchMode = m.id;
            s.hud.value++;
          }}
        >
          {m.label}
        </button>
      ))}
      <button class="btn small" title="Select every unit that can take orders" onClick={() => s.select(s.own().filter((u) => u.alive > 0 && (u.state === 'ready' || u.state === 'embarked')).map((u) => u.id))}>
        All
      </button>
    </div>
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
            <button class={`btn small ${s.paused ? 'on' : ''}`} onClick={() => (s.paused = !s.paused)} title="Pause (Space)" aria-label="Pause" data-tut="pause">
              {s.paused ? '▶' : '❚❚'}
            </button>
            {speeds.map((sp) => (
              <button key={sp} class={`btn small ${s.speed === sp && !s.paused ? 'on' : ''}`} onClick={() => ((s.speed = sp), (s.paused = false))} data-tut={`speed-${sp}`}>
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

/** What a landmark's ground means for the battle, said at deployment. */
function landmarkTip(t: BattleSession['battle']['terrain']): string | null {
  switch (t.landmark) {
    case 'nailSpire':
      return 'The Nail Spire stands at the heart of the field, said to pin the sun. Nothing passes through it.';
    case 'candle':
      return t.setup.glow
        ? 'A lit Candle burns at the heart of the field: within 170 m the light is at least Dusk, for friend and foe. Creatures drawn to flame will go to it.'
        : 'A dead Candle stands at the heart of the field, dark since the Hush put it out.';
    case 'stoppedDial':
      return 'The Stopped Dial stands at the heart of the field. Its shadow has moved one notch.';
    case 'pole':
      return 'The Pole of Night: the darkest place in the world, its black obelisk at the heart of the field.';
    case 'umbralVale':
      return 'An Umbral Vale: canyon walls close both flanks, and inside the light never rises above Dim.';
    case 'mistfalls':
      return 'The Mistfalls: a river cuts across the field. Cross at the fords.';
    case 'leaningWood':
      return 'The Leaning Wood: colossal trees bowed sunward, and deep cover almost everywhere.';
    case 'rimeSea':
      return 'The Rime Sea: frozen ocean, broken by ridges of ice.';
    case 'kiteFields':
      return 'The Kite Fields, where the Drift gather for their moots.';
    case 'vents':
      return 'Steam vents crack the ground across the field.';
    case 'furnaces':
      return 'Glass furnaces and their chimneys stand across the field.';
    default:
      return null;
  }
}

/** Deployment is the first decision of every battle: read the sun and the wind. */
function DeployPanel({ s }: { s: BattleSession }) {
  // Reading a signal memoizes this panel by props, so follow the HUD ticks too.
  void s.hud.value;
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
  const place = landmarkTip(t);
  if (place) tips.push(place);
  const glareBand = t.light === 2 || t.light === 3;
  if (glareBand) {
    if (rel < Math.PI / 4)
      tips.push(me === 'choir' ? 'Your line faces the sun. The Choir never suffer glare, but with the sun at their backs the enemy is not blinded either.' : `Your line faces the sun: units facing it suffer glare (${L.glareAccuracyPct}% accuracy${L.glareMa ? `, ${L.glareMa} melee attack` : ''}).`);
    else if (rel > (Math.PI * 3) / 4) tips.push(`The sun is at your back: the enemy fights into the glare.`);
    else tips.push(me === 'choir' ? 'The sun is on your flank: turn to put it at your back and the enemy fights into the glare.' : 'The sun is on your flank: turn to attack from the side and neither line is blinded.');
  } else if (t.light === 4) tips.push(`The sun stands overhead: no glare, but non-Choir units tire ${Math.round((L.fatigueMult - 1) * 100)}% faster.`);
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
  const open = deployTips.value ?? !matchMedia('(max-width: 720px), (max-height: 560px)').matches;
  const touch = matchMedia('(pointer: coarse)').matches;
  return (
    <div class={`panel deploy-panel ${open ? 'open' : ''}`}>
      <div class="spread">
        <h2>Deployment</h2>
        <span class="chip gold">
          {factionDef(me).short} vs {factionDef(enemy).short}
        </span>
      </div>
      {s.req.briefing && (
        <div class="briefing">
          <b>{s.req.briefing.title}</b>
          <p>{s.req.briefing.text}</p>
        </div>
      )}
      {(s.general.waiting || s.general.speech) && (
        <p class={`general-says ${s.general.speech ? '' : 'waiting'}`}>
          {s.general.speech ? (
            <>
              <span class="muted">{factionDef(enemy).short} general:</span> “{s.general.speech}”{' '}
              <span class="jev-mark" title="The enemy general's plan and words come from Claude">
                ✦ Claude
              </span>
            </>
          ) : (
            'The enemy general studies the field…'
          )}
        </p>
      )}
      {open && (s.counsel.busy || s.counsel.tips || s.counsel.failed) && (
        <div class="counsel">
          {s.counsel.tips ? (
            <>
              <div class="counsel-head">
                Your adviser
                <span class="jev-mark" title="Counsel from Claude, from the field and both armies">
                  ✦ Claude
                </span>
              </div>
              <ul>
                {s.counsel.tips.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          ) : s.counsel.busy ? (
            <p class="general-says waiting">Your adviser studies the field…</p>
          ) : (
            <p class="muted">{claudeStatus.value === 'refused' ? 'Claude isn’t allowed on this page right now.' : 'Your adviser has nothing to say. Try again later.'}</p>
          )}
        </div>
      )}
      {open && (
        <div class="deploy-tips">
          <ul>
            {tips.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          {note && <div class="muted" style={{ fontSize: '13px' }}>{note}</div>}
          <div class="muted" style={{ fontSize: '12.5px' }}>
            {touch
              ? 'Drag your units to place them. Tap a unit to select it, then tap the ground to send it there; Line mode lays a selection out along a drag. Pinch to zoom.'
              : 'Drag your units to move them. Select units and right-drag to set a line and its facing. Right-click to move a selection. Enter starts the battle.'}
          </div>
        </div>
      )}
      <div class="row deploy-actions">
        <button class="btn small ghost" onClick={() => (deployTips.value = !open)} aria-expanded={open}>
          {open ? 'Hide tips' : 'Tips'}
        </button>
        {claudeStatus.value === 'ready' && !s.req.tutorial && !s.counsel.tips && (
          <button
            class="btn small ghost"
            disabled={s.counsel.busy}
            onClick={() => {
              // The answer shows with the tips: open them.
              deployTips.value = true;
              s.askCounsel();
            }}
            title="Ask Claude for three tips on how to fight this battle"
          >
            ✦ Counsel
          </button>
        )}
        <button class="btn" onClick={() => s.autoDeploy()}>
          Reset
        </button>
        <button class="btn primary" onClick={() => s.startBattle()}>
          Start the battle
        </button>
      </div>
    </div>
  );
}

/** Deployment tips start folded on small screens, where they would hide the army. */
const deployTips = signal<boolean | null>(null);

function HourPicker({ s }: { s: BattleSession }) {
  const b = s.battle;
  const st = b.sides[s.side];
  const fac = factionDef(st.faction);
  // Before the first tick the side's interval is not set yet: work it out.
  const iv = b.tick === 0 ? tollInterval(b, s.side) : st.tollInterval;
  const left = Number.isFinite(iv) ? Math.max(0, iv - st.tollTimer) : null;
  const active = b.time - st.lastToll < 6;
  // Small screens fold the Hours away to one line; tutorials keep them open to point at.
  void s.hud.value;
  const open = !!s.req.tutorial || (hoursOpen.value ?? !matchMedia('(max-width: 720px), (max-height: 560px)').matches);
  const hour = fac.hours!.find((h) => h.id === st.hour);
  return (
    <div class={`panel hour-picker ${open ? '' : 'folded'}`} data-tut="hours">
      <button class="spread hour-head" onClick={() => (hoursOpen.value = !open)} aria-expanded={open} title={open ? 'Fold the Hours' : 'Choose the Hour'}>
        <b>{open ? 'The Toll' : (hour?.name.replace('Hour of ', '').replace(/^the\b/, 'The') ?? 'The Toll')}</b>
        <span class={`chip ${active ? 'gold' : ''} num`}>{left === null ? 'silenced' : active ? 'ringing' : `${left.toFixed(0)} s`}</span>
      </button>
      {left !== null && (
        <div class="bar" style={{ height: '4px' }}>
          <i style={{ width: `${(1 - left / iv) * 100}%`, background: 'var(--gold)' }} />
        </div>
      )}
      {open && <div style={{ display: 'grid', gap: '4px' }}>
        {fac.hours!.map((h) => (
          <button key={h.id} class={`btn small ${st.hour === h.id ? 'on' : ''}`} style={{ justifyContent: 'space-between' }} onClick={() => s.setHour(h.id as HourId)} title={h.desc} data-tut={`hour-${h.id}`}>
            <span>{h.name.replace('Hour of ', '').replace(/^the\b/, 'The')}</span>
            <span class="muted" style={{ fontSize: '11px' }}>
              {h.desc.replace('.', '')}
            </span>
          </button>
        ))}
      </div>}
    </div>
  );
}

/** Whether the Toll panel shows its Hours (null: open on large screens, folded on small). */
const hoursOpen = signal<boolean | null>(null);

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
            data-unit={u.id}
            title={`${u.def.name} · ${u.def.roleLabel}`}
            onClick={(e) => {
              if (gone) return;
              // Select mode (touch) toggles cards in and out of the selection.
              if (s.touchMode === 'select' && s.overlay.selected.has(u.id)) {
                s.overlay.selected.delete(u.id);
                s.hud.value++;
                return;
              }
              s.select([u.id], (e as MouseEvent).shiftKey || s.touchMode === 'select');
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
  const passives = activePassives(b, u);
  const effects = (keys: ('lightMin' | 'lightMax' | 'windMin' | 'windMax')[]) =>
    passives.filter((p) => p.when && keys.some((k) => p.when![k] !== undefined)).map((p) => `${p.name}: ${modsText(p.mods).join(', ')}.`);
  const L = LIGHT_RULES[u.light];
  const lightFx = [`${L.name} light here. ${L.note}`, ...effects(['lightMin', 'lightMax'])];
  // Light-gated bonuses this light switches off: the reason to move into (or out of) the dark.
  const seenLight = u.stats.ignoreDarkness ? Math.max(u.light, 2) : u.light;
  for (const p of [...factionDef(u.faction).traits, ...(u.def.passives ?? [])]) {
    const c = p.when;
    if (!c || (c.lightMin === undefined && c.lightMax === undefined)) continue;
    if ((c.lightMin === undefined || seenLight >= c.lightMin) && (c.lightMax === undefined || seenLight <= c.lightMax)) continue;
    // A penalty that is switched off is not worth a line.
    if (modsText(p.mods).some((t) => /^[-−]/.test(t))) continue;
    const span = c.lightMin !== undefined && c.lightMax !== undefined ? (c.lightMin === c.lightMax ? LIGHT_NAMES[c.lightMin] : `${LIGHT_NAMES[c.lightMin]} to ${LIGHT_NAMES[c.lightMax]}`) : c.lightMax !== undefined ? `${LIGHT_NAMES[c.lightMax]} or darker` : `${LIGHT_NAMES[c.lightMin!]} or brighter`;
    lightFx.push(`${p.name} is off here (needs ${span}).`);
  }
  out.push({ text: LIGHT_NAMES[u.light], tone: u.light >= 3 ? 'gold' : u.light <= 1 ? '' : 'gold', title: lightFx.join(' ') });
  const W = WIND_RULES[u.wind];
  const windFx = [`${W.name} here, blowing sunward.`];
  if (s.battle.weaponOf(u) && W.rangePct) windFx.push(`Shots downwind +${W.rangePct}% range, upwind -${W.rangePct}%.`);
  windFx.push(W.note, ...effects(['windMin', 'windMax']));
  out.push({ text: `${WIND_NAMES[u.wind]} wind`, tone: '', title: windFx.join(' ') });
  if (u.stats.glareAcc < 0) out.push({ text: `Glare ${u.stats.glareAcc}%${u.stats.glareMa ? ` / ${u.stats.glareMa} MA` : ''}`, tone: 'bad', title: `Glare from ${u.stats.glareSource === 'sun' ? 'facing the sun' : u.stats.glareSource === 'noon' ? 'Walking Noon' : u.stats.glareSource === 'mirror' ? 'Mirrorflash' : 'mirror dazzle'}: ${u.stats.glareAcc}% missile accuracy${u.stats.glareMa ? `, ${u.stats.glareMa} melee attack` : ''}.` });
  if (u.concealed) out.push({ text: 'Hidden', tone: 'good', title: 'The enemy cannot see this unit.' });
  if (tollActive(b, u)) {
    const hour = factionDef(u.faction).hours?.find((h) => h.id === b.sides[u.side].hour);
    out.push({ text: 'Toll', tone: 'gold', title: hour ? `${hour.name}, for 6 s after the bell: ${modsText(hour.mods).join(', ')}.` : 'The Hour is in effect.' });
  }
  // Zone auras over this unit: light and dark zones, bells, spores.
  const seen = new Set<string>();
  for (const z of b.zones) {
    if (!z.enabled || seen.has(z.def.id)) continue;
    if ((u.x - z.x) ** 2 + (u.y - z.y) ** 2 > z.radius * z.radius) continue;
    if (z.def.affects && !z.def.affects.includes(u.def.category)) continue;
    const mods = z.side === u.side ? z.def.allyMods : z.def.enemyMods;
    const fx = [...(mods ? modsText(mods) : []), ...(z.side !== u.side && z.def.drain ? [`-${z.def.drain} morale/s`] : []), ...(z.side !== u.side && z.def.reveals ? ['revealed'] : [])];
    if (!fx.length) continue;
    seen.add(z.def.id);
    out.push({ text: zoneName(z.def.id), tone: z.side === u.side ? 'good' : 'bad', title: `${zoneName(z.def.id)}: ${fx.join(', ')}.` });
  }
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

/** Phones can fold the unit panel down to its name, abilities and orders. */
/** Whether the unit panel is folded (null: folded on short screens, where it would cover the field). */
const panelFolded = signal<boolean | null>(null);
const SHORT = typeof matchMedia === 'function' && matchMedia('(max-height: 480px)').matches;

/** The chip the player tapped for its exact numbers (touch screens have no hover). */
const explain = signal<{ unit: number; text: string } | null>(null);

function UnitPanel({ s, u }: { s: BattleSession; u: Unit }) {
  // Reading a signal memoizes this panel by props, so follow the HUD ticks too.
  void s.hud.value;
  const chips = modifierChips(s, u);
  const shown = explain.value?.unit === u.id ? explain.value.text : null;
  const why = shown ? chips.find((c) => c.text === shown) : undefined;
  const ms = moraleState(u);
  const w = s.battle.weaponOf(u);
  const lead = u.soldiers.find((x) => x.alive);
  const fac = factionDef(u.faction);
  const folded = panelFolded.value ?? SHORT;
  return (
    <div class={`panel unit-panel ${folded ? 'folded' : ''}`}>
      <div class="spread">
        <div class="row" style={{ gap: '10px' }}>
          <button class="btn small ghost panel-fold" onClick={() => (panelFolded.value = !folded)} aria-expanded={!folded} title={folded ? 'Show stats and details' : 'Fold the panel to see more of the field'}>
            {folded ? '▸' : '▾'}
          </button>
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
        {chips.map((c) => (
          <button
            type="button"
            key={c.text}
            class={`chip ${c.tone} ${shown === c.text ? 'on' : ''}`}
            title={c.title}
            onClick={() => (explain.value = shown === c.text ? null : { unit: u.id, text: c.text })}
          >
            {c.text}
          </button>
        ))}
      </div>
      {why && <div class="chip-why">{why.title}</div>}
      <div class="abilities">
        {(u.def.abilities ?? []).map((a, i) => {
          const st = u.abilities.find((x) => x.def.id === a.id)!;
          const frac = a.cooldown > 0 && st.cooldown > 0 ? st.cooldown / a.cooldown : 0;
          const used = st.uses <= 0;
          return (
            <button
              key={a.id}
              class={`btn small ability ${st.on ? 'on' : ''} ${s.targeting?.ability.id === a.id ? 'on' : ''}`}
              data-ability={a.id}
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
        {TOUCH ? 'Switch to Line and drag to lay the group out along a line.' : 'Right-drag to lay the group out along a line.'} Units keep their left-to-right order.
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
  // A remnant that can't win (fled, routed or kited to pieces) needn't be chased to the timer.
  const theirs = s.battle.remainingValue((1 - s.side) as 0 | 1);
  const claimable = s.phase === 'battle' && !s.req.tutorial && s.req.mode !== 'replay' && s.req.mode !== 'demo' && theirs < 0.35 && s.battle.remainingValue(s.side) >= theirs * 2 + 0.1;
  return (
    <div class="modal-veil" onClick={onClose}>
      <div class="panel modal" onClick={(e) => e.stopPropagation()}>
        <h2>Battle</h2>
        <div class="muted">
          {TOUCH
            ? 'Touch: tap a unit to select it, then tap the ground or an enemy to order it. Drag to pan, pinch to zoom. The Select button makes taps add units and a drag draw a box; Line makes a drag lay the selection out along a line. All selects every unit.'
            : 'Mouse: left-click selects, drag a box to select many, right-click moves or attacks, right-drag lays out a line. Wheel zooms, WASD or arrows pan. Keys: Space pause, Esc menu, R run, F fire at will, H halt, M melee, 1-3 abilities, +/- speed, Tab next unit, P picture.'}
        </div>
        <div class="row">
          <button class="btn primary" onClick={onClose}>
            Resume
          </button>
          {claimable && (
            <button
              class="btn"
              title="What is left of the enemy can no longer win: end the battle as a victory"
              onClick={() => {
                s.battle.finish(s.side, 'rout');
                onClose();
              }}
            >
              Claim the field
            </button>
          )}
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
          <button class="btn" onClick={() => void s.savePicture()} title="Save the field as it looks now as a picture (P)">
            Save a picture
          </button>
          <button class="btn" onClick={() => go({ name: 'menu' })}>
            Quit to menu
          </button>
        </div>
        <Adviser s={s} />
      </div>
    </div>
  );
}

/** The adviser in the pause menu: two or three orders for the battle as it stands. */
function Adviser({ s }: { s: BattleSession }) {
  void s.hud.value;
  const a = s.advice;
  const can = s.phase === 'battle' && !s.req.tutorial && s.req.mode !== 'replay' && s.req.mode !== 'demo';
  if (!can || (claudeStatus.value !== 'ready' && !a.tips && !a.failed)) return null;
  // Advice goes stale as the battle moves on.
  const fresh = a.tips && s.battle.time - a.at < 20;
  return (
    <div class="counsel adviser">
      {a.tips && (
        <>
          <div class="counsel-head">
            Your adviser{fresh ? '' : `, at ${fmtTime(a.at)}`}
            <span class="jev-mark" title="Counsel from Claude, from where every unit stands">
              ✦ Claude
            </span>
          </div>
          <ul>
            {a.tips.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      )}
      {a.busy ? (
        <p class="general-says waiting">Your adviser studies the field…</p>
      ) : (
        <div class="row">
          <button class="btn small" disabled={claudeStatus.value !== 'ready'} onClick={() => s.askAdvice()} title="Ask Claude what to do now, from where every unit stands">
            {a.tips ? '✦ Ask again' : '✦ Ask your adviser'}
          </button>
          {a.failed && <span class="muted">{claudeStatus.value === 'refused' ? 'Claude isn’t allowed on this page right now.' : 'Your adviser has nothing to say. Try again.'}</span>}
        </div>
      )}
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
  const legend = s.req.legend ? legendById(s.req.legend) : undefined;
  const done = () => {
    if (s.req.onDone) s.req.onDone(r, s.battle.log, s.req.setup, s.moments, s.strength);
    else go({ name: 'results', req: s.req, result: r, log: s.battle.log, setup: s.req.setup, moments: s.moments, strength: s.strength });
  };
  return (
    <div class="modal-veil">
      <div class="panel modal" style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: '44px', color: won ? 'var(--gold)' : draw ? 'var(--text)' : 'var(--bad)' }}>{title}</h2>
        <div>{reason}</div>
        {s.feats.length > 0 && (
          <div class="feats-earned" role="status">
            {s.feats.map((f) => (
              <div key={f.id}>
                <span class="feat-star">★</span> Feat: <b>{f.name}</b> <span class="muted">{f.how}</span>
              </div>
            ))}
          </div>
        )}
        {legend && (
          <div class="legend-medal">
            {s.medal ? (
              <>
                <MedalChip medal={s.medal} /> {s.medalBest ? 'Your best yet in this Legend.' : 'Not better than your best.'}
              </>
            ) : (
              'No medal: the Legend must be won.'
            )}
            <div class="muted">{medalTerms(legend)}</div>
          </div>
        )}
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

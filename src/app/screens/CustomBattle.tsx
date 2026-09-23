import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BandId, FactionId, UnitDef, WindLevel } from '../../data/schema';
import { BAND_IDS, FACTION_IDS, LIGHT_NAMES, WIND_NAMES } from '../../data/schema';
import { FACTIONS, recruitable, unitDef } from '../../data/index';
import { BANDS, ARMY } from '../../data/rules';
import { Rng } from '../../core/rng';
import { Terrain, type MapSetup } from '../../sim/terrain';
import { bakeTerrain } from '../../render/terrainArt';
import { generateArmy } from '../../game/armyGen';
import type { BattleSetup, UnitSpec } from '../../sim/types';
import { go, load, save, settings } from '../store';
import { Rose, roseLines } from '../../ui/Rose';
import { UnitIcon } from '../../ui/UnitIcon';
import { audio } from '../../audio/audio';
import { matchupNote } from '../../data/lore';

type SunChoice = 'eyes' | 'back' | 'left' | 'right' | 'random';
type Preset = NonNullable<MapSetup['preset']>;

interface Config {
  band: BandId;
  steppe: boolean;
  wind: WindLevel;
  sun: SunChoice;
  preset: Preset;
  seed: number;
  budget: number;
  scale: number;
  me: FactionId;
  foe: FactionId;
  mine: string[];
  theirs: string[] | null;
  kind: BattleKind;
}

const SUNS: { id: SunChoice; label: string; bearing: number }[] = [
  { id: 'eyes', label: 'In your eyes', bearing: -Math.PI / 2 },
  { id: 'back', label: 'At your back', bearing: Math.PI / 2 },
  { id: 'left', label: 'On your left', bearing: Math.PI },
  { id: 'right', label: 'On your right', bearing: 0 },
  { id: 'random', label: 'Random', bearing: 0 },
];

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'default', label: 'Mixed' },
  { id: 'open', label: 'Open' },
  { id: 'wooded', label: 'Wooded' },
  { id: 'hilly', label: 'Hilly' },
  { id: 'river', label: 'River' },
];

const BUDGETS = [6000, 9000, 12000, 18000];

type BattleKind = 'field' | 'assault' | 'defend';

const KINDS: { id: BattleKind; label: string; note: string }[] = [
  { id: 'field', label: 'Field battle', note: 'Open ground; rout the enemy.' },
  { id: 'assault', label: 'Assault a town', note: 'The enemy holds walls. Climb, batter the gates, and hold the square for a minute.' },
  { id: 'defend', label: 'Hold a town', note: 'You hold the walls and the square until time runs out.' },
];

/** Walls around the map's middle; side 0 is you. */
function fortFor(kind: BattleKind): MapSetup['fort'] {
  if (kind === 'field') return undefined;
  return { defender: kind === 'assault' ? 1 : 0, radius: 170 };
}

function defaults(): Config {
  const seed = Math.floor(Math.random() * 1e6);
  const rng = new Rng(seed);
  return {
    band: 'gloaming',
    steppe: false,
    wind: 1,
    sun: 'left',
    preset: 'default',
    seed,
    budget: ARMY.customBudget,
    scale: settings.value.unitScale,
    me: 'vesperate',
    foe: 'choir',
    mine: generateArmy('vesperate', ARMY.customBudget, rng).map((s) => s.def),
    theirs: null,
    kind: 'field',
  };
}

function bearingFor(c: Config): number {
  if (c.sun !== 'random') return SUNS.find((s) => s.id === c.sun)!.bearing;
  return new Rng(`sun${c.seed}`).range(-Math.PI, Math.PI);
}

function cost(ids: string[]): number {
  return ids.reduce((a, id) => a + unitDef(id).cost, 0);
}

export function CustomBattle() {
  const [c, setC] = useState<Config>(() => {
    const saved = load<Config | null>('nailedsun.custom', null);
    return saved && saved.mine ? { ...defaults(), ...saved } : defaults();
  });
  const set = (p: Partial<Config>) => setC((o) => ({ ...o, ...p }));
  useEffect(() => {
    save('nailedsun.custom', c);
  }, [c]);
  const bearing = bearingFor(c);
  const light = BANDS[c.band].light;
  const lines = roseLines(light, c.wind);
  const enemy = useMemo(() => c.theirs ?? generateArmy(c.foe, c.budget, new Rng(`${c.seed}:${c.foe}:${c.budget}`)).map((s) => s.def), [c.theirs, c.foe, c.budget, c.seed]);
  const spent = cost(c.mine);
  const lord = FACTIONS[c.me].lord;
  const units = c.mine.filter((id) => id !== lord.id);
  const canFight = c.mine.includes(lord.id) && spent <= c.budget && units.length > 0 && units.length <= ARMY.maxUnits;

  const pickFaction = (f: FactionId) => {
    if (f === c.me) return;
    const rng = new Rng(`${c.seed}:${f}`);
    set({ me: f, mine: generateArmy(f, c.budget, rng).map((s) => s.def), foe: c.foe === f ? FACTION_IDS.find((x) => x !== f)! : c.foe });
  };

  const add = (u: UnitDef) => {
    if (u.role === 'colossus' && c.mine.some((id) => unitDef(id).role === 'colossus')) return;
    if (units.length >= ARMY.maxUnits) return;
    if (spent + u.cost > c.budget) return;
    audio.ui('click');
    set({ mine: [...c.mine, u.id] });
  };
  /** Remove the i-th unit (the lord is never removed). */
  const removeAt = (i: number) => {
    const next = [...c.mine];
    let seen = -1;
    for (let k = 0; k < next.length; k++) {
      if (next[k] === lord.id) continue;
      seen++;
      if (seen === i) {
        next.splice(k, 1);
        break;
      }
    }
    set({ mine: next });
  };

  const fight = () => {
    audio.unlock();
    const specs = (ids: string[]): UnitSpec[] => {
      const l = ids.filter((id) => unitDef(id).role === 'lord');
      const rest = ids.filter((id) => unitDef(id).role !== 'lord');
      return [...l, ...rest].map((def) => ({ def }));
    };
    const fort = fortFor(c.kind);
    const setup: BattleSetup = {
      seed: c.seed,
      map: { seed: c.seed, band: c.band, wind: c.wind, sunBearing: bearing, steppe: c.steppe, preset: c.preset, fort },
      armies: [
        { faction: c.me, controller: 'player', units: specs(c.mine) },
        { faction: c.foe, controller: 'ai', units: specs(enemy) },
      ],
      unitScale: c.scale,
    };
    if (fort) {
      setup.attacker = fort.defender === 1 ? 0 : 1;
      setup.timeLimit = 25 * 60;
    }
    go({ name: 'battle', req: { setup, playerSide: 0, mode: 'custom' } });
  };

  return (
    <div class="screen setup-screen scroll">
      <header class="setup-head">
        <button class="btn ghost" onClick={() => go({ name: 'menu' })}>
          ← Menu
        </button>
        <h1>Custom Battle</h1>
        <button class="btn primary" disabled={!canFight} onClick={fight}>
          Deploy
        </button>
      </header>
      <div class="setup-grid">
        <section class="panel setup-col">
          <h2>The field</h2>
          <div class="field-top">
            <MapPreview band={c.band} steppe={c.steppe} wind={c.wind} bearing={bearing} preset={c.preset} seed={c.seed} kind={c.kind ?? 'field'} />
            <div class="field-rose">
              <Rose sunBearing={bearing} light={light} wind={c.wind} facing={-Math.PI / 2} size={96} />
              <div class="rose-text" style={{ display: 'grid' }}>
                <b style={{ color: 'var(--gold)' }}>{lines.light}</b>
                <span class="muted">{lines.lightFx}</span>
                <b style={{ color: '#dff1ff' }}>{lines.wind}</b>
                <span class="muted">{lines.windFx}</span>
              </div>
            </div>
          </div>
          <div class="label">battle</div>
          <div class="seg" role="radiogroup" aria-label="Battle type">
            {KINDS.map((k) => (
              <button key={k.id} role="radio" aria-checked={(c.kind ?? 'field') === k.id} class={`btn small ${(c.kind ?? 'field') === k.id ? 'on' : ''}`} onClick={() => set({ kind: k.id })} title={k.note}>
                {k.label}
              </button>
            ))}
          </div>
          <span class="muted small">{KINDS.find((k) => k.id === (c.kind ?? 'field'))!.note}</span>
          <div class="label">light band</div>
          <div class="seg">
            {BAND_IDS.map((b) => (
              <button key={b} class={`band-btn ${c.band === b ? 'on' : ''}`} onClick={() => set({ band: b })} title={`${BANDS[b].sun}. ${BANDS[b].land}.`}>
                <i class={`swatch band-${b}`} />
                <span>{BANDS[b].name.replace('The ', '')}</span>
                <small class="muted">{LIGHT_NAMES[BANDS[b].light]}</small>
              </button>
            ))}
          </div>
          <label class="row" style={{ gap: '6px' }}>
            <input id="steppe" type="checkbox" checked={c.steppe} onChange={(e) => set({ steppe: (e.target as HTMLInputElement).checked })} />
            <span>Fight on the Gale Roads (open steppe)</span>
          </label>
          <div class="label">wind (always blows sunward)</div>
          <div class="seg">
            {([0, 1, 2] as WindLevel[]).map((w) => (
              <button key={w} class={`btn small ${c.wind === w ? 'on' : ''}`} onClick={() => set({ wind: w })}>
                {WIND_NAMES[w]}
              </button>
            ))}
          </div>
          <div class="label">the sun, as you deploy</div>
          <div class="seg">
            {SUNS.map((s) => (
              <button key={s.id} class={`btn small ${c.sun === s.id ? 'on' : ''}`} onClick={() => set({ sun: s.id })}>
                {s.label}
              </button>
            ))}
          </div>
          <div class="label">ground</div>
          <div class="seg">
            {PRESETS.map((p) => (
              <button key={p.id} class={`btn small ${c.preset === p.id ? 'on' : ''}`} onClick={() => set({ preset: p.id })}>
                {p.label}
              </button>
            ))}
            <button class="btn small" onClick={() => set({ seed: Math.floor(Math.random() * 1e6) })} title="New map">
              New map
            </button>
          </div>
          <div class="label">unit size</div>
          <div class="seg">
            {[
              { v: 0.5, l: 'Small' },
              { v: 0.75, l: 'Medium' },
              { v: 1, l: 'Large' },
            ].map((o) => (
              <button key={o.v} class={`btn small ${c.scale === o.v ? 'on' : ''}`} onClick={() => set({ scale: o.v })}>
                {o.l}
              </button>
            ))}
          </div>
        </section>

        <section class="panel setup-col">
          <div class="spread">
            <h2>Your army</h2>
            <span class={`chip ${spent > c.budget ? 'bad' : 'gold'} num`}>
              {spent.toLocaleString()} / {c.budget.toLocaleString()}
            </span>
          </div>
          <FactionTabs value={c.me} onPick={pickFaction} />
          <div class="label">budget</div>
          <div class="seg">
            {BUDGETS.map((b) => (
              <button key={b} class={`btn small ${c.budget === b ? 'on' : ''}`} onClick={() => set({ budget: b, mine: generateArmy(c.me, b, new Rng(`${c.seed}:${b}`)).map((s) => s.def) })}>
                {b.toLocaleString()}
              </button>
            ))}
          </div>
          <div class="army-list">
            <ArmyRow def={lord} note="Your general" />
            {units.map((id, i) => (
              <ArmyRow key={`${id}${i}`} def={unitDef(id)} onRemove={() => removeAt(i)} />
            ))}
          </div>
          <div class="spread">
            <span class="muted num">
              {units.length} / {ARMY.maxUnits} units
            </span>
            <div class="row">
              <button class="btn small" onClick={() => set({ mine: [lord.id] })}>
                Clear
              </button>
              <button class="btn small" onClick={() => set({ mine: generateArmy(c.me, c.budget, new Rng(Math.random())).map((s) => s.def) })}>
                Auto-fill
              </button>
            </div>
          </div>
          <div class="label">recruit</div>
          <div class="recruit">
            {recruitable(c.me).map((u) => {
              const blocked = (u.role === 'colossus' && c.mine.some((id) => unitDef(id).role === 'colossus')) || spent + u.cost > c.budget || units.length >= ARMY.maxUnits;
              return (
                <button key={u.id} class="recruit-card" disabled={blocked} onClick={() => add(u)} title={`${u.name}: ${u.summary}`}>
                  <UnitIcon def={u} size={30} />
                  <span class="rc-name">{u.name}</span>
                  <span class="rc-role muted">{u.roleLabel}</span>
                  <span class="rc-cost num">{u.cost}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section class="panel setup-col">
          <h2>The enemy</h2>
          <FactionTabs value={c.foe} onPick={(f) => set({ foe: f, theirs: null })} />
          {matchupNote(c.me, c.foe) && <p class="muted" style={{ margin: 0 }}>{matchupNote(c.me, c.foe)}</p>}
          <div class="spread">
            <span class="label">their army, built by the AI</span>
            <button class="btn small" onClick={() => set({ theirs: generateArmy(c.foe, c.budget, new Rng(Math.random())).map((s) => s.def) })}>
              Re-roll
            </button>
          </div>
          <div class="army-list">
            {enemy.map((id, i) => (
              <ArmyRow key={`${id}${i}`} def={unitDef(id)} side={1} />
            ))}
          </div>
          <span class="muted num">{cost(enemy).toLocaleString()} points</span>
        </section>
      </div>
    </div>
  );
}

function FactionTabs({ value, onPick }: { value: FactionId; onPick: (f: FactionId) => void }) {
  return (
    <div class="faction-tabs" role="tablist">
      {FACTION_IDS.map((f) => {
        const fd = FACTIONS[f];
        return (
          <button key={f} role="tab" aria-selected={value === f} class={`faction-tab ${value === f ? 'on' : ''}`} style={{ '--fc': fd.palette.glow } as never} onClick={() => onPick(f)}>
            <b>{fd.short}</b>
            <small>{fd.motto}</small>
          </button>
        );
      })}
    </div>
  );
}

function ArmyRow({ def, onRemove, note, side = 0 }: { def: UnitDef; onRemove?: () => void; note?: string; side?: 0 | 1 }) {
  return (
    <div class="army-row">
      <UnitIcon def={def} size={26} side={side} />
      <span class="ar-name">{def.name}</span>
      <span class="muted ar-role">{note ?? def.roleLabel}</span>
      <span class="num ar-cost">{def.cost}</span>
      {onRemove ? (
        <button class="btn small ghost" onClick={onRemove} aria-label={`Remove ${def.name}`}>
          ×
        </button>
      ) : (
        <span style={{ width: '28px' }} />
      )}
    </div>
  );
}

/** A small baked preview of the actual map, shadows and all. */
function MapPreview({ band, steppe, wind, bearing, preset, seed, kind }: { band: BandId; steppe: boolean; wind: WindLevel; bearing: number; preset: Preset; seed: number; kind: BattleKind }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      const t = new Terrain({ seed, band, wind, sunBearing: bearing, steppe, preset, fort: fortFor(kind) });
      const art = bakeTerrain(t, 0.3);
      const c = ref.current;
      if (!c) return;
      c.width = art.canvas.width;
      c.height = art.canvas.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(art.canvas, 0, 0);
      // Deployment zones.
      for (const side of [0, 1] as const) {
        const z = t.deployZone(side);
        ctx.strokeStyle = side === 0 ? '#5aa9ff' : '#ff6b5a';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(z.x * art.scale, z.y * art.scale, z.w * art.scale, z.h * art.scale);
      }
    }, 60);
    return () => clearTimeout(id);
  }, [band, steppe, wind, bearing, preset, seed, kind]);
  return <canvas ref={ref} class="map-preview" aria-label="Map preview: your deployment zone is blue, the enemy's red" />;
}

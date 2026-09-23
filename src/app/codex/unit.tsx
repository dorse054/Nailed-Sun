/**
 * Codex: one unit in full. Stats, missiles, abilities, passives and named
 * mechanics, all read from its UnitDef.
 */
import type { ComponentChildren } from 'preact';
import type { AbilityDef, FactionDef, MeleeWeapon, MissileWeapon, Role, UnitDef } from '../../data/schema';
import { allFactionUnits } from '../../data/index';
import { COUNTERS } from '../../data/lore';
import { UnitIcon } from '../../ui/UnitIcon';
import {
  abilityFacts,
  CATEGORY_NAMES,
  damageText,
  meters,
  missileFlags,
  num,
  onHitText,
  pct,
  secs,
  signed,
  SIZE_NAMES,
  stanceText,
  TRAJECTORY_NAMES,
  unitMechanics,
} from './format';
import { FactionLink, Items, type Nav, Section, TableWrap } from './ui';

/** Unit roles as the counters table names them. */
const COUNTER_ROLE: Partial<Record<Role, string>> = {
  line: 'Line infantry',
  antiLarge: 'Anti-large infantry',
  shock: 'Shock infantry',
  missile: 'Missile infantry',
  shockCav: 'Shock cavalry',
  missileCav: 'Missile cavalry',
  monster: 'Monsters',
  artillery: 'Artillery',
  flyer: 'Flyers',
  colossus: 'Colossus',
};

export function UnitPage({ u, f, nav }: { u: UnitDef; f: FactionDef; nav: Nav }) {
  const all = allFactionUnits(f);
  const i = all.findIndex((x) => x.id === u.id);
  const prev = all[(i - 1 + all.length) % all.length]!;
  const next = all[(i + 1) % all.length]!;
  const counter = COUNTERS.find((c) => c.role === COUNTER_ROLE[u.role]);
  const mechanics = unitMechanics(u);
  const altName = u.abilities?.find((a) => a.stance?.altMissile)?.name;
  return (
    <>
      <p class="cx-back">
        <FactionLink f={f} nav={nav}>
          <span aria-hidden="true">← </span>
          {f.name}
        </FactionLink>
      </p>
      <header class="cx-uhero">
        <div class="cx-stage lg">
          <UnitIcon def={u} size={120} sprite />
        </div>
        <div class="cx-uhero-text">
          <p class="cx-kicker">
            {u.roleLabel}
            {u.character?.title ? ` · ${u.character.title}` : ''}
          </p>
          <h1 tabIndex={-1}>{u.name}</h1>
          <div class="cx-chips">
            <span class="chip gold">Tier {u.tier}</span>
            <span class="chip">Cost {num(u.cost)}</span>
            <span class="chip">{CATEGORY_NAMES[u.category]}</span>
            <span class="chip">{f.short}</span>
          </div>
        </div>
      </header>
      <p class="cx-lede">{u.summary}</p>
      <p class="cx-look">
        <span class="label">look</span> {u.look}
      </p>

      <div class="cx-ubody">
        <div class="cx-uside">
          <Section id="cx-u-stats" title="Stats">
            <StatsTable u={u} />
          </Section>
          {u.missile && (
            <Section id="cx-u-missile" title="Missile weapon">
              <MissileTable w={u.missile} label={`${u.name}: missile weapon`} />
            </Section>
          )}
          {u.altMissile && (
            <Section id="cx-u-alt" title={altName ? `${altName} (alternate)` : 'Alternate ammunition'}>
              <MissileTable w={u.altMissile} label={`${u.name}: alternate ammunition`} />
            </Section>
          )}
          {u.leader?.missile && (
            <Section id="cx-u-lmissile" title="The lord's missile weapon">
              <MissileTable w={u.leader.missile} label={`${u.name}: the lord's missile weapon`} />
            </Section>
          )}
        </div>
        <div class="cx-umain">
          {u.abilities?.length ? (
            <Section id="cx-u-abilities" title="Abilities">
              <div class="cx-abilities">
                {u.abilities.map((a) => (
                  <AbilityCard key={a.id} a={a} />
                ))}
              </div>
            </Section>
          ) : null}
          {u.passives?.length ? (
            <Section id="cx-u-passives" title="Passives">
              <Items items={u.passives} />
            </Section>
          ) : null}
          {mechanics.length ? (
            <Section id="cx-u-mechanics" title="Mechanics">
              <Items items={mechanics} />
            </Section>
          ) : null}
          {counter && (
            <Section id="cx-u-counters" title="Counters">
              <dl class="cx-dl">
                <dt>Role</dt>
                <dd>{counter.role}</dd>
                <dt>Beats</dt>
                <dd>{counter.beats}</dd>
                <dt>Loses to</dt>
                <dd>{counter.losesTo}</dd>
              </dl>
            </Section>
          )}
          <Section id="cx-u-traits" title={`${f.short} traits`}>
            <p class="cx-note">
              Faction-wide rules from <FactionLink f={f} nav={nav} />.
            </p>
            <Items items={f.traitText} />
          </Section>
        </div>
      </div>

      <nav class="cx-pager" aria-label={`More ${f.short} units`}>
        <button type="button" class="cx-pager-btn" onClick={() => nav(prev.id)}>
          <span class="label">
            <span aria-hidden="true">← </span>previous
          </span>
          <b>{prev.name}</b>
        </button>
        <button type="button" class="cx-pager-btn next" onClick={() => nav(next.id)}>
          <span class="label">
            next<span aria-hidden="true"> →</span>
          </span>
          <b>{next.name}</b>
        </button>
      </nav>
    </>
  );
}

type Row = { label: string; unit: ComponentChildren; lord?: ComponentChildren };

/** Body and melee stats. Lords get a second column for the character. */
function StatsTable({ u }: { u: UnitDef }) {
  const L = u.leader;
  const rows: Row[] = [];
  const row = (label: string, unit: ComponentChildren, lord?: ComponentChildren) => rows.push({ label, unit, lord });
  const w = u.weapon;
  const lw = L?.weapon;
  /** A weapon row shown only when the unit or its lord has the property. */
  const opt = (label: string, get: (x: MeleeWeapon) => string | null) => {
    const a = get(w);
    const b = lw ? get(lw) : null;
    if (a === null && b === null) return;
    row(label, a ?? '—', lw ? (b ?? '—') : undefined);
  };

  row('Soldiers', num(L ? u.soldiers - 1 : u.soldiers), L ? '1' : undefined);
  row('HP per soldier', num(u.hp), L && num(L.hp));
  row('Armor', num(u.armor), L && num(L.armor));
  if (u.shield) row('Shield', `${pct(u.shield)} missile block from the front`);
  row('Melee attack', num(u.ma), L && num(L.ma));
  row('Melee defense', num(u.md), L && num(L.md));
  row('Weapon damage', damageText(w.base, w.ap, w.type), lw && damageText(lw.base, lw.ap, lw.type));
  opt('Bonus vs large', (x) => (x.vsLarge ? signed(x.vsLarge) : null));
  opt('Bonus vs infantry', (x) => (x.vsInfantry ? signed(x.vsInfantry) : null));
  row('Attack interval', secs(w.interval), lw && secs(lw.interval));
  opt('Reach', (x) => (x.reach ? meters(x.reach) : null));
  opt('Splash', (x) => (x.splash ? `Up to ${x.splash.targets} soldiers per swing, within ${meters(x.splash.radius)}` : null));
  opt('On hit', (x) => (x.onHit?.length ? x.onHit.map(onHitText).join('. ') : null));
  row('Charge bonus', num(u.charge));
  row('Mass', num(u.mass), L && num(L.mass));
  row('Speed', `${num(u.speed)} m/s (walking ${num(u.speed / 2)})`);
  row('Leadership', num(u.leadership));
  row('Size class', SIZE_NAMES[u.size], L && SIZE_NAMES[L.size]);

  return (
    <TableWrap label={`${u.name}: stats`}>
      <table class="cx-table cx-kv">
        {L && (
          <thead>
            <tr>
              <th scope="col">Stat</th>
              <th scope="col">Bodyguard</th>
              <th scope="col">Lord</th>
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              {L && r.lord !== undefined ? (
                <>
                  <td>{r.unit}</td>
                  <td>{r.lord}</td>
                </>
              ) : (
                <td colSpan={L ? 2 : 1}>{r.unit}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function MissileTable({ w, label }: { w: MissileWeapon; label: string }) {
  const rows: [string, ComponentChildren][] = [];
  rows.push(['Range', `${meters(w.range)}${w.minRange ? `, minimum ${meters(w.minRange)}` : ''}`]);
  if (w.windRange) rows.push(['Range by wind', `${meters(w.windRange.down)} downwind, ${meters(w.windRange.up)} upwind, ${meters(w.windRange.calm)} in Calm`]);
  rows.push(['Ammunition', `${num(w.ammo)} shots`]);
  rows.push(['Reload', secs(w.reload)]);
  rows.push(['Accuracy', pct(w.accuracy)]);
  rows.push(['Damage', damageText(w.damage, w.ap, w.type)]);
  if (w.vsLarge) rows.push(['Bonus vs large', signed(w.vsLarge)]);
  rows.push(['Trajectory', TRAJECTORY_NAMES[w.trajectory]]);
  if (w.splash) rows.push(['Splash radius', meters(w.splash)]);
  const flags = missileFlags(w);
  if (flags.length)
    rows.push([
      'Special',
      <ul class="cx-flags">
        {flags.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>,
    ]);
  return (
    <TableWrap label={label}>
      <table class="cx-table cx-kv">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function AbilityCard({ a }: { a: AbilityDef }) {
  const stance = stanceText(a);
  const facts = abilityFacts(a);
  return (
    <article class="cx-ability">
      <h3>{a.name}</h3>
      <div class="cx-chips">
        {facts.map((t, i) => (
          <span key={i} class={`chip ${i === 0 ? 'gold' : ''}`}>
            {t}
          </span>
        ))}
      </div>
      <p>{a.desc}</p>
      {stance.length > 0 && (
        <p class="cx-small">
          <span class="label">while on</span> {stance.join(', ')}
        </p>
      )}
    </article>
  );
}

/**
 * Codex: the battlefield. Light, wind, shadow and zones, the combat math,
 * damage types, morale and counters, from src/data/rules.ts, zones.ts and lore.ts.
 */
import { Fragment, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { DamageType, LightLevel, Mechanic, UnitDef, WindLevel } from '../../data/schema';
import { LIGHT_NAMES, WIND_NAMES } from '../../data/schema';
import { allUnits, FACTIONS, hasUnit, unitDef } from '../../data/index';
import {
  ARTIFICIAL_GLARE,
  COMBAT,
  FOREST_REVEAL_RANGE,
  GLARE_HALF_ANGLE_DEG,
  LIGHT_RULES,
  MORALE,
  SHADOW_REVEAL_RANGE,
  STEALTH_REVEAL_RANGE,
  VISIBILITY_LINGER,
  WIND_RULES,
} from '../../data/rules';
import { ANTI_FRUSTRATION, COUNTERS, PILLARS, SIGNATURE_MOMENTS } from '../../data/lore';
import { ZONES } from '../../data/zones';
import { Rose, roseLines } from '../../ui/Rose';
import { DAMAGE_NAMES, meters, num, onHitText, pct, secs, signed, unitDamageTypes, zoneEffects, zoneLight, zoneMakers } from './format';
import { FactionLink, Items, type Nav, PageHead, Section, TableWrap, Toc, UnitLink, UnitLinks } from './ui';

const LEVELS: LightLevel[] = [0, 1, 2, 3, 4];
const WINDS: WindLevel[] = [0, 1, 2];

const withMechanic = (kind: Mechanic['kind']): UnitDef[] => allUnits().filter((u) => u.mechanics?.some((m) => m.kind === kind));

export function BattlefieldPage({ nav }: { nav: Nav }) {
  const world = PILLARS[0];
  return (
    <>
      <PageHead title="The Battlefield">
        {world && <p class="cx-lede">{world.desc}</p>}
        <Toc
          items={[
            { id: 'cx-b-rose', label: 'The Rose' },
            { id: 'cx-b-light', label: 'Light' },
            { id: 'cx-b-wind', label: 'Wind' },
            { id: 'cx-b-shadow', label: 'Shadows' },
            { id: 'cx-b-zones', label: 'Zones' },
            { id: 'cx-b-math', label: 'Combat math' },
            { id: 'cx-b-damage', label: 'Damage types' },
            { id: 'cx-b-morale', label: 'Morale' },
            { id: 'cx-b-counters', label: 'Counters' },
            { id: 'cx-b-moments', label: 'Signature moments' },
            { id: 'cx-b-fair', label: 'Anti-frustration' },
          ]}
        />
      </PageHead>
      <Section id="cx-b-rose" title="The Sun-and-Wind Rose">
        <RoseExplorer />
      </Section>
      <LightSection nav={nav} />
      <WindSection nav={nav} />
      <ShadowSection nav={nav} />
      <ZoneSection nav={nav} />
      <MathSection nav={nav} />
      <DamageSection nav={nav} />
      <MoraleSection />
      <Section id="cx-b-counters" title="Counters">
        <p class="cx-note">Every role beats some roles and loses to others. Each unit page shows where that unit sits.</p>
        <TableWrap label="Counters">
          <table class="cx-table">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Beats</th>
                <th scope="col">Loses to</th>
              </tr>
            </thead>
            <tbody>
              {COUNTERS.map((c) => (
                <tr key={c.role}>
                  <th scope="row">{c.role}</th>
                  <td class="cx-text">{c.beats}</td>
                  <td class="cx-text">{c.losesTo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>
      <Section id="cx-b-moments" title="Signature moments">
        <Items items={SIGNATURE_MOMENTS} />
      </Section>
      <Section id="cx-b-fair" title="Anti-frustration rules">
        <ul class="cx-bullets">
          {ANTI_FRUSTRATION.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/** The battle compass, with the light and wind picked by the reader. */
function RoseExplorer() {
  const [light, setLight] = useState<LightLevel>(2);
  const [wind, setWind] = useState<WindLevel>(1);
  const lines = roseLines(light, wind);
  return (
    <div class="cx-rose">
      <div class="cx-rose-dial">
        <Rose sunBearing={-Math.PI / 4} light={light} wind={wind} size={136} />
      </div>
      <div class="cx-rose-body">
        <div class="cx-seg" role="group" aria-label="Light level">
          <span class="label">light</span>
          {LEVELS.map((l) => (
            <button key={l} type="button" class={`btn small ${light === l ? 'on' : ''}`} aria-pressed={light === l} onClick={() => setLight(l)}>
              {LIGHT_NAMES[l]}
            </button>
          ))}
        </div>
        <div class="cx-seg" role="group" aria-label="Wind strength">
          <span class="label">wind</span>
          {WINDS.map((w) => (
            <button key={w} type="button" class={`btn small ${wind === w ? 'on' : ''}`} aria-pressed={wind === w} onClick={() => setWind(w)}>
              {WIND_NAMES[w]}
            </button>
          ))}
        </div>
        <div class="cx-rose-read" aria-live="polite">
          <p>
            <b>{lines.light}.</b> {lines.lightFx}
          </p>
          <p>
            <b>{lines.wind}.</b> {lines.windFx}.
          </p>
        </div>
        <p class="cx-note">
          Deployment and the battle screen show this compass. The sun sits on its rim, or overhead in Blaze; in Dim and Dark only a faint glow marks it. The shaded wedge is
          the glare cone, the chevrons show the wind's strength, and the dark stroke points the way shadows fall.
        </p>
      </div>
    </div>
  );
}

function LightSection({ nav }: { nav: Nav }) {
  const glassblind = Object.values(FACTIONS).filter((f) => f.mechanics?.some((m) => m.kind === 'glassblind'));
  const blind = withMechanic('blind');
  return (
    <Section id="cx-b-light" title="Light">
      <p class="cx-note">
        Every battle has one of five light levels. Glare applies when a unit faces within {GLARE_HALF_ANGLE_DEG}° of the sun: missile units check where they shoot, melee
        units where they fight.
      </p>
      <TableWrap label="Light levels">
        <table class="cx-table">
          <thead>
            <tr>
              <th scope="col">Light</th>
              <th scope="col">Glare, facing the sun</th>
              <th scope="col">Spotting range</th>
              <th scope="col">Beams</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {LEVELS.map((l) => {
              const r = LIGHT_RULES[l];
              return (
                <tr key={l}>
                  <th scope="row">{r.name}</th>
                  <td>{r.glareAccuracyPct ? `${signed(r.glareAccuracyPct, '%')} accuracy${r.glareMa ? `, ${signed(r.glareMa)} melee attack` : ''}` : 'None'}</td>
                  <td>{r.spotMult === 1 ? 'Normal' : signed(Math.round((r.spotMult - 1) * 100), '%')}</td>
                  <td>{pct(r.beamMult)}</td>
                  <td class="cx-text">{r.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <ul class="cx-bullets">
        <li>
          Walking Noon casts artificial glare: enemies facing it get {signed(ARTIFICIAL_GLARE.accuracyPct, '%')} accuracy and {signed(ARTIFICIAL_GLARE.ma)} melee attack.
        </li>
        {(glassblind.length > 0 || blind.length > 0) && (
          <li>
            Never dazzled:{' '}
            {glassblind.map((f, i) => (
              <span key={f.id}>
                {i > 0 && ', '}
                <FactionLink f={f} nav={nav}>
                  every {f.short} unit
                </FactionLink>{' '}
                (Glassblind)
              </span>
            ))}
            {glassblind.length > 0 && blind.length > 0 && ' and '}
            {blind.length > 0 && (
              <>
                <UnitLinks units={blind} nav={nav} /> (Blind)
              </>
            )}
            .
          </li>
        )}
      </ul>
    </Section>
  );
}

function WindSection({ nav }: { nav: Nav }) {
  return (
    <Section id="cx-b-wind" title="Wind">
      <p class="cx-note">The wind always blows sunward. Its direction never changes; only its strength does.</p>
      <TableWrap label="Wind strengths">
        <table class="cx-table">
          <thead>
            <tr>
              <th scope="col">Wind</th>
              <th scope="col">Missile range</th>
              <th scope="col">Accuracy</th>
              <th scope="col">Flyers</th>
              <th scope="col">Fire spreads</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {WINDS.map((w) => {
              const r = WIND_RULES[w];
              return (
                <tr key={w}>
                  <th scope="row">{r.name}</th>
                  <td>{r.rangePct ? `${signed(r.rangePct, '%')} downwind, ${signed(-r.rangePct, '%')} upwind` : 'No change'}</td>
                  <td class="cx-nowrap">{r.accuracyPct ? signed(r.accuracyPct, '%') : 'No change'}</td>
                  <td>{r.flyerDownwindSpeedPct ? `${signed(r.flyerDownwindSpeedPct, '%')} speed downwind` : 'No change'}</td>
                  <td>{r.fireSpreadSeconds ? `One step sunward every ${secs(r.fireSpreadSeconds)}` : 'No'}</td>
                  <td class="cx-text">{r.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <p class="cx-note">
        Beams ignore the wind. <FactionLink f={FACTIONS.drift} nav={nav}>The Drift</FactionLink> are built to ride it.
      </p>
    </Section>
  );
}

function ShadowSection({ nav }: { nav: Nav }) {
  const lit = LEVELS.filter((l) => LIGHT_RULES[l].sunElevation !== null && l !== 4);
  // Who stays hidden while attacking: quiet shooters, and abilities that force stealth.
  const quietShooters = allUnits().filter((u) => u.mechanics?.some((m) => m.kind === 'stealth' && m.revealOnFire === 'notInDark'));
  const hiders = allUnits().flatMap((u) =>
    (u.abilities ?? []).filter((a) => a.effects.some((e) => e.kind === 'buff' && e.mods.forceHidden)).map((a) => ({ u, a })),
  );
  const exceptions: ComponentChildren[] = [];
  if (quietShooters.length)
    exceptions.push(
      <>
        <UnitLinks units={quietShooters} nav={nav} /> shooting in the Dark
      </>,
    );
  for (const { u, a } of hiders)
    exceptions.push(
      <>
        <UnitLink u={u} nav={nav} /> during {a.name}
      </>,
    );
  return (
    <Section id="cx-b-shadow" title="Shadows">
      <ul class="cx-bullets">
        <li>
          Shadows never move, and they fall only in {lit.map((l) => LIGHT_NAMES[l]).join(' and ')} light, where the sun stands{' '}
          {lit.map((l, i) => (
            <span key={l}>
              {i > 0 && (i === lit.length - 1 ? ' and ' : ', ')}
              {LIGHT_RULES[l].sunElevation}°
            </span>
          ))}{' '}
          above the horizon.
        </li>
        <li>Units standing in shadow stay hidden until an enemy comes within {meters(SHADOW_REVEAL_RANGE)}.</li>
        <li>Units standing in forest stay hidden until an enemy comes within {meters(FOREST_REVEAL_RANGE)}.</li>
        <li>Stealth units in darkness are revealed only within {meters(STEALTH_REVEAL_RANGE)}.</li>
        <li>
          Fighting or shooting reveals a hidden unit
          {exceptions.map((x, i) => (
            <Fragment key={i}>
              {i === 0 ? ', except ' : i === exceptions.length - 1 ? ' and ' : ', '}
              {x}
            </Fragment>
          ))}
          .
        </li>
        <li>A unit stays visible for {secs(VISIBILITY_LINGER)} after the enemy last spotted it.</li>
      </ul>
    </Section>
  );
}

function ZoneSection({ nav }: { nav: Nav }) {
  const zones = Object.values(ZONES).filter((z) => z.light);
  return (
    <Section id="cx-b-zones" title="Light and dark zones">
      <p class="cx-note">
        Light zones set a floor on the light ("at least"); dark zones set a ceiling ("at most"). Where zones overlap, the higher intensity wins; equal intensities cancel and the
        map's natural light returns.
      </p>
      <TableWrap label="Light and dark zones">
        <table class="cx-table">
          <thead>
            <tr>
              <th scope="col">Zone</th>
              <th scope="col">Light</th>
              <th scope="col">Intensity</th>
              <th scope="col">Radius</th>
              <th scope="col">Also</th>
              <th scope="col">Made by</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => {
              const made = zoneMakers(z.id);
              const fx = zoneEffects(z);
              return (
                <tr key={z.id}>
                  <th scope="row" class="cx-nowrap">
                    {z.name}
                  </th>
                  <td class="cx-nowrap">{zoneLight(z)}</td>
                  <td>{z.light!.intensity}</td>
                  <td class="cx-nowrap">{made.radius}</td>
                  <td class="cx-text">{fx.length ? `${fx.join('. ')}.` : '—'}</td>
                  <td class="cx-text">{made.units.length ? <UnitLinks units={made.units} nav={nav} /> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </Section>
  );
}

function MathSection({ nav }: { nav: Nav }) {
  const two = (x: number) => x.toFixed(2);
  const atk = hasUnit('vesperate.knellguard') ? unitDef('vesperate.knellguard') : null;
  const tgt = hasUnit('choir.mirrorWardens') ? unitDef('choir.mirrorWardens') : null;
  return (
    <Section id="cx-b-math" title="Combat math">
      <div class="cx-formulas">
        <figure class="cx-formula">
          <figcaption class="label">chance to hit, per melee attack</figcaption>
          <code>
            P<sub>hit</sub> = min({two(COMBAT.hitMax)}, max({two(COMBAT.hitMin)}, {two(COMBAT.hitBase)} + (MA − MD)/100))
          </code>
        </figure>
        <figure class="cx-formula">
          <figcaption class="label">damage per hit</figcaption>
          <code>
            D = B(1 − u·A/100) + AP, &nbsp;u ~ U({num(COMBAT.armorRollMin)}, {num(COMBAT.armorRollMax)})
          </code>
        </figure>
      </div>
      <dl class="cx-dl cx-legend">
        <dt>MA</dt>
        <dd>The attacker's melee attack, plus its charge bonus while the charge lasts.</dd>
        <dt>MD</dt>
        <dd>The target's melee defense.</dd>
        <dt>B</dt>
        <dd>The weapon's base damage. Armor reduces it.</dd>
        <dt>AP</dt>
        <dd>The weapon's armor-piercing damage. Armor can't stop it.</dd>
        <dt>A</dt>
        <dd>The target's armor.</dd>
        <dt>u</dt>
        <dd>
          A fresh random number for every hit, from {num(COMBAT.armorRollMin)} to {num(COMBAT.armorRollMax)}.
          {tgt && ` Armor ${tgt.armor}, as on ${tgt.name}, stops ${num(tgt.armor * COMBAT.armorRollMin)}% to ${num(tgt.armor * COMBAT.armorRollMax)}% of B.`}
        </dd>
      </dl>
      {atk && tgt && <WorkedExample atk={atk} tgt={tgt} nav={nav} />}
      <ul class="cx-bullets">
        <li>
          From the flank, the target's MD counts at {pct(COMBAT.flankMdMult)}; from the rear, at {pct(COMBAT.rearMdMult)}.
        </li>
        <li>A charge adds its bonus to MA and to damage on impact, then fades over {secs(COMBAT.chargeDuration)}.</li>
        <li>Glare, light, wind and ability modifiers change MA, MD and damage before these formulas run.</li>
        <li>Missile hits use the same damage formula. Shields give a chance to block shots from the front.</li>
      </ul>
    </Section>
  );
}

function WorkedExample({ atk, tgt, nav }: { atk: UnitDef; tgt: UnitDef; nav: Nav }) {
  const raw = COMBAT.hitBase + (atk.ma - tgt.md) / 100;
  const p = Math.min(COMBAT.hitMax, Math.max(COMBAT.hitMin, raw));
  const w = atk.weapon;
  const hit = (u: number) => w.base * (1 - (u * tgt.armor) / 100) + w.ap;
  return (
    <div class="cx-callout">
      <b>Example</b>
      <span>
        <UnitLink u={atk} nav={nav} /> (MA {atk.ma}, {num(w.base)} + {num(w.ap)} AP) attack <UnitLink u={tgt} nav={nav} /> (MD {tgt.md}, armor {tgt.armor}). They hit{' '}
        {pct(p)} of the time, for {Math.round(hit(COMBAT.armorRollMax))} to {Math.round(hit(COMBAT.armorRollMin))} damage per hit; the {num(w.ap)} AP always gets through.
      </span>
    </div>
  );
}

function DamageSection({ nav }: { nav: Nav }) {
  const brittle = withMechanic('brittle');
  const fireWeak = withMechanic('fireVulnerable');
  const heatProof = withMechanic('heatImmune');
  const firePct = (u: UnitDef) => {
    const m = u.mechanics?.find((x) => x.kind === 'fireVulnerable');
    return m && m.kind === 'fireVulnerable' ? `(${signed(m.pct, '%')})` : '';
  };
  const brittlePct = signed(Math.round((COMBAT.brittleMult - 1) * 100), '%');
  const chill = onHitText({ kind: 'chill' }).replace('Chill: ', '');
  const dealers = (t: DamageType) => allUnits().filter((u) => unitDamageTypes(u).has(t));
  const types: { t: DamageType; desc: string; weak: UnitDef[]; weakNote?: (u: UnitDef) => string }[] = [
    { t: 'normal', desc: 'Plain physical damage. Armor reduces the base part of every hit.', weak: [] },
    {
      t: 'fire',
      desc: 'Many fire weapons set the ground alight. Burning ground hurts both sides and spreads sunward in Breeze and Gale.',
      weak: fireWeak,
      weakNote: firePct,
    },
    { t: 'cold', desc: `Brittle units take ${brittlePct}. Many cold attacks also Chill the target: ${chill}.`, weak: brittle },
    { t: 'resonance', desc: `Brittle units take ${brittlePct}, and shields don't block it.`, weak: brittle },
  ];
  return (
    <Section id="cx-b-damage" title="Damage types">
      <div class="cx-tiles two">
        {types.map(({ t, desc, weak, weakNote }) => (
          <div key={t} class={`cx-tile cx-dmg ${t}`}>
            <h3>{DAMAGE_NAMES[t]}</h3>
            <p>{desc}</p>
            {t === 'normal' ? (
              <p class="cx-small">
                <span class="label">dealt by</span> most units
              </p>
            ) : (
              <>
                <p class="cx-small">
                  <span class="label">dealt by</span> <UnitLinks units={dealers(t)} nav={nav} />
                </p>
                <p class="cx-small">
                  <span class="label">weak to it</span> <UnitLinks units={weak} nav={nav} note={weakNote} />
                </p>
                {t === 'fire' && heatProof.length > 0 && (
                  <p class="cx-small">
                    <span class="label">immune to burning ground</span> <UnitLinks units={heatProof} nav={nav} />
                  </p>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function MoraleSection() {
  const M = MORALE;
  const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  const per = (x: number) => `${signed(x, '%')} per second`;
  return (
    <Section id="cx-b-morale" title="Morale">
      <TableWrap label="Morale states">
        <table class="cx-table">
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">When</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Steady</th>
              <td class="cx-text">Leadership at {pct(M.waveringAt)} of its maximum or more.</td>
            </tr>
            <tr>
              <th scope="row">Wavering</th>
              <td class="cx-text">Leadership below {pct(M.waveringAt)}. The unit still fights.</td>
            </tr>
            <tr>
              <th scope="row">Routing</th>
              <td class="cx-text">
                Leadership hits 0: the unit breaks and flees. If nothing presses it for {secs(M.rallyDelay)}, it rallies with {pct(M.rallyMorale)} leadership.
              </td>
            </tr>
            <tr>
              <th scope="row">Shattered</th>
              <td class="cx-text">
                A unit that routs for the {ordinal(M.shatterRouts)} time, or breaks with fewer than {pct(M.shatterStrength)} of its soldiers, is Shattered and leaves the
                field.
              </td>
            </tr>
          </tbody>
        </table>
      </TableWrap>
      <h3 class="cx-sub">What moves leadership</h3>
      <p class="cx-note">Base rates, in percent of the unit's maximum leadership.</p>
      <TableWrap label="What moves leadership">
        <table class="cx-table">
          <thead>
            <tr>
              <th scope="col">Cause</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Casualties</th>
              <td class="cx-text">{signed(-M.casualtyShock, '%')} over the loss of the whole unit; each soldier lost costs its share</td>
            </tr>
            <tr>
              <th scope="row">Heavy recent losses</th>
              <td>{per(-M.heavyLossDrain)} or more</td>
            </tr>
            <tr>
              <th scope="row">Attacked in the flank</th>
              <td>{per(-M.flankDrain)}</td>
            </tr>
            <tr>
              <th scope="row">Attacked from the rear</th>
              <td>{per(-M.rearDrain)}</td>
            </tr>
            <tr>
              <th scope="row">Losing a melee</th>
              <td>Up to {per(-M.losingMeleeDrain)}</td>
            </tr>
            <tr>
              <th scope="row">Each routing ally within {meters(M.routingAllyRadius)}</th>
              <td>{per(-M.routingAllyDrain)}</td>
            </tr>
            <tr>
              <th scope="row">Your general killed</th>
              <td class="cx-text">
                {signed(-M.generalDeadShock, '%')} at once, then {per(-M.generalDeadDrain)}
              </td>
            </tr>
            <tr>
              <th scope="row">Winning a melee</th>
              <td>Up to {per(M.winningMeleeRegen)}</td>
            </tr>
            <tr>
              <th scope="row">Within {meters(M.generalAuraRadius)} of your general</th>
              <td>{per(M.generalAuraRegen)}</td>
            </tr>
            <tr>
              <th scope="row">Out of combat</th>
              <td>{per(M.outOfCombatRegen)}</td>
            </tr>
          </tbody>
        </table>
      </TableWrap>
    </Section>
  );
}

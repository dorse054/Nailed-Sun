/**
 * Codex: one page per faction, from its FactionDef, ending in a grid of every
 * unit it fields. Accents come from the faction's palette (see factionVars).
 */
import type { FactionDef } from '../../data/schema';
import { FACTION_IDS } from '../../data/schema';
import { allFactionUnits, FACTIONS } from '../../data/index';
import { matchupNote } from '../../data/lore';
import { FactionDot, FactionLink, Items, type Nav, Section, Toc, UnitCard } from './ui';

export function FactionPage({ f, nav }: { f: FactionDef; nav: Nav }) {
  const others = FACTION_IDS.filter((id) => id !== f.id).map((id) => FACTIONS[id]);
  // The campaign list usually repeats the resource in more detail; show it once.
  const resource = f.campaignText.find((c) => c.name === f.resource.name)?.desc ?? f.resource.desc;
  const campaign = f.campaignText.filter((c) => c.name !== f.resource.name);
  const count = allFactionUnits(f).length;
  return (
    <>
      <header class="cx-fhero">
        <p class="cx-kicker">Faction</p>
        <h1 tabIndex={-1}>{f.name}</h1>
        <p class="cx-motto">{f.motto}</p>
        <p class="cx-essence">{f.essence}</p>
        <p class="cx-lede">{f.pitch}</p>
      </header>
      <Toc
        items={[
          { id: 'cx-f-who', label: 'Who they are' },
          { id: 'cx-f-look', label: 'Look and sound' },
          { id: 'cx-f-traits', label: 'Battle traits' },
          { id: 'cx-f-play', label: 'How they play' },
          { id: 'cx-f-campaign', label: 'Campaign' },
          { id: 'cx-f-matchups', label: 'Matchups' },
          { id: 'cx-f-units', label: `Units (${count})` },
        ]}
      />

      <Section id="cx-f-who" title="Who they are">
        <div class="cx-prose">
          <p>{f.who}</p>
        </div>
      </Section>

      <Section id="cx-f-look" title="Look and sound">
        <dl class="cx-dl">
          <dt>Silhouette</dt>
          <dd>{f.look.silhouette}</dd>
          <dt>Palette</dt>
          <dd>
            {f.look.palette}
            <Swatches f={f} />
          </dd>
          <dt>Materials</dt>
          <dd>{f.look.materials}</dd>
          <dt>Architecture</dt>
          <dd>{f.look.architecture}</dd>
          <dt>Sound</dt>
          <dd>{f.look.sound}</dd>
        </dl>
      </Section>

      <Section id="cx-f-traits" title="Battle traits">
        <Items items={f.traitText} />
      </Section>

      <Section id="cx-f-play" title="How they play">
        <div class="cx-tiles three">
          <div class="cx-tile">
            <h3>Strengths</h3>
            <p>{f.strengths}</p>
          </div>
          <div class="cx-tile">
            <h3>Weaknesses</h3>
            <p>{f.weaknesses}</p>
          </div>
          <div class="cx-tile">
            <h3>Playstyle</h3>
            <p>{f.playstyle}</p>
          </div>
        </div>
      </Section>

      <Section id="cx-f-campaign" title="Campaign">
        <div class="cx-tiles two">
          <div class="cx-tile">
            <p class="label">resource</p>
            <h3>{f.resource.name}</h3>
            <p>{resource}</p>
          </div>
          <div class="cx-tile">
            <p class="label">victory</p>
            <h3>{f.victory.name}</h3>
            <p>{f.victory.desc}</p>
          </div>
        </div>
        <Items items={campaign} />
      </Section>

      <Section id="cx-f-matchups" title="Matchups">
        <ul class="cx-matchups">
          {others.map((o) => {
            const note = matchupNote(f.id, o.id);
            if (!note) return null;
            return (
              <li key={o.id}>
                <h3>
                  <FactionDot f={o} />
                  <span class="label">vs</span>
                  <FactionLink f={o} nav={nav} />
                </h3>
                <p>{note}</p>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="cx-f-units" title="Units">
        <h3 class="cx-sub">Army units</h3>
        <div class="cx-grid">
          {f.units.map((u) => (
            <UnitCard key={u.id} u={u} nav={nav} />
          ))}
        </div>
        <h3 class="cx-sub">Colossus, lord and heroes</h3>
        <div class="cx-grid">
          {[f.colossus, f.lord, ...f.heroes].map((u) => (
            <UnitCard key={u.id} u={u} nav={nav} />
          ))}
        </div>
      </Section>
    </>
  );
}

function Swatches({ f }: { f: FactionDef }) {
  const p = f.palette;
  const colors: [string, string][] = [
    ['primary', p.primary],
    ['secondary', p.secondary],
    ['metal', p.metal],
    ['glow', p.glow],
    ['dark', p.dark],
  ];
  return (
    <span class="cx-swatches" aria-hidden="true">
      {colors.map(([name, c]) => (
        <span key={name} class="cx-swatch">
          <i style={{ background: c }} />
          {name}
        </span>
      ))}
    </span>
  );
}

/**
 * Codex: the world. Myth, the Tilt, the five light bands, landmarks and the
 * design pillars, all from src/data/lore.ts and src/data/rules.ts.
 */
import { BAND_IDS, LIGHT_NAMES } from '../../data/schema';
import { FACTIONS } from '../../data/index';
import { BANDS, GALE_ROADS } from '../../data/rules';
import { BALANCE_TARGETS, LANDMARKS, LEGEND, MYTH, PHYSICS, PILLARS, PITCH, TAGLINE, TILT_SIDES, TILT_TEXT, WORLD } from '../../data/lore';
import { factionByName, signed } from './format';
import { FactionDot, FactionLink, type Nav, PageHead, Section, TableWrap, Toc } from './ui';

export function WorldPage({ nav }: { nav: Nav }) {
  return (
    <>
      <PageHead title="The World">
        <p class="cx-epigraph">{TAGLINE}</p>
        <p class="cx-lede">{PITCH}</p>
        <Toc
          items={[
            { id: 'cx-w-world', label: 'A stopped world' },
            { id: 'cx-w-myth', label: 'The myth' },
            { id: 'cx-w-tilt', label: 'The Tilt' },
            { id: 'cx-w-bands', label: 'Light bands' },
            { id: 'cx-w-landmarks', label: 'Landmarks' },
            { id: 'cx-w-pillars', label: 'Design pillars' },
          ]}
        />
      </PageHead>

      <Section id="cx-w-world" title="A stopped world">
        <div class="cx-prose">
          <p>{WORLD}</p>
          <p>{LEGEND}</p>
          <p>{PHYSICS}</p>
        </div>
      </Section>

      <Section id="cx-w-myth" title="The myth and the Shudder">
        <div class="cx-prose">
          {MYTH.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </Section>

      <Section id="cx-w-tilt" title="The Tilt">
        <div class="cx-prose">
          <p>{TILT_TEXT}</p>
        </div>
        <TiltScale />
        <ul class="cx-sides">
          {TILT_SIDES.map((s) => {
            const f = FACTIONS[s.faction];
            return (
              <li key={s.faction}>
                <span class="cx-sides-who">
                  <FactionDot f={f} />
                  <FactionLink f={f} nav={nav}>
                    {f.short}
                  </FactionLink>
                </span>
                <span>{s.desc}</span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="cx-w-bands" title="The five light bands">
        <p class="cx-note">From the night side to the day side. Each band has its own light level, the default light for battles fought there.</p>
        <TableWrap label="The five light bands">
          <table class="cx-table">
            <thead>
              <tr>
                <th scope="col">Band</th>
                <th scope="col">Light</th>
                <th scope="col">The sun</th>
                <th scope="col">Land and look</th>
                <th scope="col">Home of</th>
              </tr>
            </thead>
            <tbody>
              {BAND_IDS.map((id) => {
                const b = BANDS[id];
                const home = factionByName(b.home);
                return (
                  <tr key={id}>
                    <th scope="row" class="cx-nowrap">
                      <span class="cx-band">
                        <span class="cx-band-swatch" style={{ '--sky': b.colors.sky, '--ground': b.colors.ground }} aria-hidden="true" />
                        {b.name}
                      </span>
                    </th>
                    <td>{LIGHT_NAMES[b.light]}</td>
                    <td class="cx-text">{b.sun}</td>
                    <td class="cx-text">{b.land}</td>
                    <td>{home ? <FactionLink f={home} nav={nav}>{b.home}</FactionLink> : b.home}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        <div class="cx-callout">
          <b>{GALE_ROADS.name}</b>
          <span>
            {GALE_ROADS.desc} They cross all five bands. <FactionLink f={FACTIONS.drift} nav={nav}>Read about the Drift</FactionLink>
          </span>
        </div>
      </Section>

      <Section id="cx-w-landmarks" title="Landmarks">
        <TableWrap label="Landmarks">
          <table class="cx-table">
            <thead>
              <tr>
                <th scope="col">Landmark</th>
                <th scope="col">Where</th>
                <th scope="col">Why it matters</th>
              </tr>
            </thead>
            <tbody>
              {LANDMARKS.map((l) => (
                <tr key={l.name}>
                  <th scope="row">{l.name}</th>
                  <td>{l.where}</td>
                  <td class="cx-text">{l.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <p class="cx-note">
          Battles fought at a landmark are fought on its ground: the Nail Spire, a Candle, the Stopped Dial and the Pole of Night stand at the heart of the field; a lit Candle
          holds the light at Dusk around its peak for both armies, and draws creatures that follow flame; an Umbral Vale is a canyon walled on both flanks where the light never
          rises above Dim; the Mistfalls always cut the field with a river, the Leaning Wood is nearly all forest and the Rime Sea is broken by ice. Custom Battle can fight at
          any of them.
        </p>
      </Section>

      <Section id="cx-w-pillars" title="Design pillars">
        <div class="cx-tiles">
          {PILLARS.map((p) => (
            <div class="cx-tile" key={p.name}>
              <h3>{p.name}</h3>
              <p>{p.desc}</p>
            </div>
          ))}
        </div>
        <h3 class="cx-sub">Balance targets</h3>
        <p class="cx-note">How fair asymmetry is measured in automated simulation.</p>
        <TableWrap label="Balance targets">
          <table class="cx-table">
            <thead>
              <tr>
                <th scope="col">Test</th>
                <th scope="col">Target</th>
              </tr>
            </thead>
            <tbody>
              {BALANCE_TARGETS.map((t) => (
                <tr key={t.test}>
                  <td class="cx-text">{t.test}</td>
                  <td>{t.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>
    </>
  );
}

/** The Tilt runs from -5 (nightward) to +5 (sunward) and starts at 0. */
function TiltScale() {
  const steps = Array.from({ length: 11 }, (_, i) => i - 5);
  return (
    <figure class="cx-tilt">
      <div class="cx-tilt-bar" role="img" aria-label="The Tilt scale, from minus 5 nightward to plus 5 sunward, starting at 0">
        {steps.map((t) => (
          <span key={t} class={t === 0 ? 'on' : undefined}>
            {t === 0 ? '0' : signed(t)}
          </span>
        ))}
      </div>
      <figcaption>
        <span>Nightward</span>
        <span>Start</span>
        <span>Sunward</span>
      </figcaption>
    </figure>
  );
}

/**
 * The Codex: an encyclopedia of the world, the battlefield rules, the four
 * factions and every unit. Pages: 'world', 'battlefield', a faction id
 * ('choir') or a unit id ('choir.nailbearer'), passed as screen.page.
 */
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { FactionDef, FactionId, UnitDef } from '../../data/schema';
import { FACTION_IDS } from '../../data/schema';
import { FACTIONS, hasUnit, unitDef } from '../../data/index';
import { audio } from '../../audio/audio';
import { go } from '../store';
import { factionVars } from '../codex/format';
import { FactionDot, type Nav } from '../codex/ui';
import { WorldPage } from '../codex/world';
import { BattlefieldPage } from '../codex/battlefield';
import { FactionPage } from '../codex/faction';
import { UnitPage } from '../codex/unit';

type Page =
  | { kind: 'world'; id: 'world' }
  | { kind: 'battlefield'; id: 'battlefield' }
  | { kind: 'faction'; id: FactionId; faction: FactionDef }
  | { kind: 'unit'; id: string; unit: UnitDef; faction: FactionDef };

function resolve(page: string | undefined): Page {
  if (page === 'battlefield') return { kind: 'battlefield', id: 'battlefield' };
  if (page && (FACTION_IDS as readonly string[]).includes(page)) {
    const id = page as FactionId;
    return { kind: 'faction', id, faction: FACTIONS[id] };
  }
  if (page && hasUnit(page)) {
    const unit = unitDef(page);
    return { kind: 'unit', id: unit.id, unit, faction: FACTIONS[unit.faction] };
  }
  return { kind: 'world', id: 'world' };
}

/** Where each faction page was scrolled to, so "back" from a unit returns to its card. */
const scrollMemory = new Map<string, number>();

const TOP = [
  { id: 'world', label: 'World', hint: 'Myth, the Tilt, the bands' },
  { id: 'battlefield', label: 'Battlefield', hint: 'Light, wind, combat rules' },
];

export function Codex({ page }: { page?: string }) {
  const cur = resolve(page);
  const main = useRef<HTMLElement>(null);
  const navList = useRef<HTMLUListElement>(null);
  const last = useRef<Page | null>(null);
  const active = cur.kind === 'unit' ? cur.faction.id : cur.id;

  const nav: Nav = (to) => {
    audio.unlock();
    audio.ui('click');
    // The page already showing: back to its top.
    if (to === cur.id) {
      main.current?.scrollTo({ top: 0 });
      return;
    }
    if (cur.kind === 'faction' && main.current) scrollMemory.set(cur.id, main.current.scrollTop);
    go({ name: 'codex', page: to });
  };
  const toMenu = () => {
    audio.unlock();
    audio.ui('click');
    go({ name: 'menu' });
  };

  // On a new page: reset or restore the scroll position, and put focus
  // somewhere sensible if the element that had it went away with the old page.
  useLayoutEffect(() => {
    const el = main.current;
    if (!el) return;
    const before = last.current;
    last.current = cur;
    if (before && before.id === cur.id) return;
    const back = before?.kind === 'unit' && cur.kind === 'faction' && before.faction.id === cur.id;
    el.scrollTop = back ? (scrollMemory.get(cur.id) ?? 0) : 0;
    const focused = document.activeElement;
    if (focused && focused !== document.body && document.contains(focused)) return;
    const card = back ? el.querySelector<HTMLElement>(`[data-unit="${before.id}"]`) : null;
    (card ?? el.querySelector<HTMLElement>('h1'))?.focus({ preventScroll: true });
    // After paging through units the card may sit outside the restored view.
    card?.scrollIntoView({ block: 'nearest' });
  }, [cur.id]);

  // Keep the current section visible in the phone-width nav row.
  useEffect(() => {
    navList.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  // Escape goes up a level: unit to faction, anything else to the menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (cur.kind === 'unit') nav(cur.faction.id);
      else toMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div class="screen cx">
      <header class="cx-head">
        <div class="cx-brand">
          <b>Codex</b>
          <span>The world and every unit</span>
        </div>
        <button type="button" class="btn" onClick={toMenu}>
          Back to menu
        </button>
      </header>
      <nav class="cx-nav" aria-label="Codex">
        <ul ref={navList}>
          {TOP.map((t) => (
            <li key={t.id}>
              <button type="button" class="cx-nav-btn" aria-current={active === t.id ? 'page' : undefined} onClick={() => nav(t.id)}>
                <span class="cx-dot" aria-hidden="true" />
                <b>{t.label}</b>
                <small>{t.hint}</small>
              </button>
            </li>
          ))}
          <li class="cx-nav-group" aria-hidden="true">
            Factions
          </li>
          {FACTION_IDS.map((id) => {
            const f = FACTIONS[id];
            return (
              <li key={id}>
                <button type="button" class="cx-nav-btn" aria-current={active === id ? 'page' : undefined} onClick={() => nav(id)}>
                  <FactionDot f={f} />
                  <b>{f.short}</b>
                  <small>{f.essence}</small>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <main class="cx-main scroll" ref={main}>
        <div
          key={cur.id}
          class={`cx-page ${cur.kind === 'faction' || cur.kind === 'unit' ? 'cx-f' : ''}`}
          style={cur.kind === 'faction' || cur.kind === 'unit' ? factionVars(cur.faction) : undefined}
        >
          {cur.kind === 'world' && <WorldPage nav={nav} />}
          {cur.kind === 'battlefield' && <BattlefieldPage nav={nav} />}
          {cur.kind === 'faction' && <FactionPage f={cur.faction} nav={nav} />}
          {cur.kind === 'unit' && <UnitPage u={cur.unit} f={cur.faction} nav={nav} />}
        </div>
      </main>
    </div>
  );
}

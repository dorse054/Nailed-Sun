/**
 * Small building blocks shared by the Codex pages.
 */
import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { FactionDef, UnitDef } from '../../data/schema';
import { factionDef } from '../../data/index';
import { UnitIcon } from '../../ui/UnitIcon';
import { NBSP, num, readableAccent } from './format';

/** Opens a Codex page: 'world', 'battlefield', a faction id or a unit id. */
export type Nav = (page: string) => void;

/** Page title. The h1 takes focus when a page opens from a link inside the content. */
export function PageHead({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <header class="cx-phead">
      <h1 tabIndex={-1}>{title}</h1>
      {children}
    </header>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ComponentChildren }) {
  return (
    <section class="cx-sec" aria-labelledby={id}>
      <h2 id={id} tabIndex={-1}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Jump links to the sections of a long page. */
export function Toc({ items }: { items: { id: string; label: string }[] }) {
  const jump = (id: string) => {
    const h = document.getElementById(id);
    if (!h) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    h.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    h.focus({ preventScroll: true });
  };
  return (
    <nav class="cx-toc" aria-label="On this page">
      {items.map((it) => (
        <button key={it.id} type="button" class="btn small ghost" onClick={() => jump(it.id)}>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

/**
 * A table's own horizontal scroller, so wide tables never widen the page.
 * It joins the tab order only while it actually overflows.
 */
export function TableWrap({ label, children }: { label: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      if (el.scrollWidth > el.clientWidth + 1) el.setAttribute('tabindex', '0');
      else el.removeAttribute('tabindex');
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} class="cx-tw" role="region" aria-label={label}>
      {children}
    </div>
  );
}

/** Named rules or traits: a bold name and one sentence each. */
export function Items({ items }: { items: { name: string; desc: string }[] }) {
  return (
    <ul class="cx-items">
      {items.map((it, i) => (
        <li key={i}>
          <b>{it.name}</b>
          <span>{it.desc}</span>
        </li>
      ))}
    </ul>
  );
}

/** A faction's mark: its UI color token, glowing in its palette's light. */
export function FactionDot({ f }: { f: FactionDef }) {
  return <span class={`cx-dot ${f.id}`} style={{ '--dot-glow': f.palette.glow }} aria-hidden="true" />;
}

export function FactionLink({ f, nav, children }: { f: FactionDef; nav: Nav; children?: ComponentChildren }) {
  return (
    <button type="button" class="cx-link" style={{ '--fa': readableAccent(f) }} onClick={() => nav(f.id)}>
      {children ?? f.name}
    </button>
  );
}

export function UnitLink({ u, nav }: { u: UnitDef; nav: Nav }) {
  return (
    <button type="button" class="cx-link" style={{ '--fa': readableAccent(factionDef(u.faction)) }} onClick={() => nav(u.id)}>
      {u.name}
    </button>
  );
}

/**
 * "A, B and C" as links, each with an optional note such as "(+50%)".
 * Each comma stays on the line of its link: buttons are atomic inlines, so
 * the browser would otherwise wrap before the comma.
 */
export function UnitLinks({ units, nav, note }: { units: UnitDef[]; nav: Nav; note?: (u: UnitDef) => string }) {
  if (!units.length) return <span class="muted">None</span>;
  const n = units.length;
  return (
    <>
      {units.map((u, i) => (
        <Fragment key={u.id}>
          <span class="cx-nowrap">
            <UnitLink u={u} nav={nav} />
            {note && <span class="muted">{`${NBSP}${note(u)}`}</span>}
            {i < n - 2 ? ',' : ''}
          </span>
          {i < n - 1 ? (i === n - 2 ? ' and ' : ' ') : ''}
        </Fragment>
      ))}
    </>
  );
}

/** A clickable unit card: sprite with a role badge, name, role, tier and cost. */
export function UnitCard({ u, nav }: { u: UnitDef; nav: Nav }) {
  return (
    <button type="button" class="cx-card" data-unit={u.id} onClick={() => nav(u.id)}>
      <span class="cx-stage">
        <UnitIcon def={u} size={100} sprite />
        <span class="cx-role-badge">
          <UnitIcon def={u} size={26} />
        </span>
      </span>
      <span class="cx-card-name">{u.name}</span>
      <span class="cx-card-role">{u.roleLabel}</span>
      <span class="cx-card-meta num">
        <span>Tier {u.tier}</span>
        <span>
          <span class="label">cost</span> {num(u.cost)}
        </span>
      </span>
    </button>
  );
}

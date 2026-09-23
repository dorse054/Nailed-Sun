import { useEffect, useRef } from 'preact/hooks';
import type { CampaignSession } from './session';
import { CampaignMap, type MapView } from './campaignMap';
import { armyById } from '../../campaign/state';
import { regionDef } from '../../campaign/regions';
import { SHAPES } from '../../campaign/geometry';
import { TopBar } from './TopBar';
import { RegionPanel } from './RegionPanel';
import { ArmyPanel } from './ArmyPanel';
import { Prompts } from './Prompts';
import { FactionPanel } from './FactionPanel';
import { audio } from '../../audio/audio';

/**
 * The campaign map: pan by dragging, zoom with the wheel or a pinch, click
 * an army to select it, click (or right-click) a region to march there.
 */
export function CampaignScreen({ session }: { session: CampaignSession }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<CampaignMap | null>(null);
  const v = session.version.value;
  void v;

  useEffect(() => {
    const c = ref.current!;
    const map = new CampaignMap(c);
    mapRef.current = map;
    (globalThis as unknown as { __campMap?: CampaignMap }).__campMap = map;
    let raf = 0;
    const size = () => {
      const r = c.getBoundingClientRect();
      map.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1));
    };
    size();
    map.fit();
    // Start on the player's lands.
    const own = session.s.armies.find((a) => a.faction === session.player);
    if (own) {
      const r = regionDef(own.region);
      // Portrait screens start zoomed to fill the height, not letterboxed.
      const cover = Math.max(map.W / 1600, map.H / 1000);
      map.centerOn(r.x, r.y, Math.max(map.fitZoom() * 1.6, cover));
    }
    const ro = new ResizeObserver(() => {
      size();
      map.clamp();
    });
    ro.observe(c);

    const view = (): MapView => {
      const vis = session.visibility();
      return {
        selectedArmy: session.selArmy.value,
        selectedRegion: session.selRegion.value,
        hover: session.hover,
        hoverArmy: session.hoverArmy,
        reach: session.reach(),
        path: session.path,
        visibleArmies: vis.armies,
        visibleRegions: vis.regions,
        player: session.player,
      };
    };
    let cachedView: MapView | null = null;
    let viewVersion = -1;
    const frame = (now: number) => {
      if (viewVersion !== session.version.value || !cachedView) {
        cachedView = view();
        viewVersion = session.version.value;
      }
      cachedView.hover = session.hover;
      cachedView.hoverArmy = session.hoverArmy;
      cachedView.path = session.path;
      map.render(session.s, cachedView, now / 1000);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // ------------------------------------------------------------- input
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; cx: number; cy: number; moved: boolean; button: number } | null = null;
    let pinch: { d: number; zoom: number } | null = null;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: map.zoom };
        drag = null;
        return;
      }
      drag = { x: p.x, y: p.y, cx: map.x, cy: map.y, moved: false, button: e.button };
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        map.zoom = pinch.zoom * (d / Math.max(1, pinch.d));
        map.clamp();
        return;
      }
      if (drag) {
        const dx = p.x - drag.x;
        const dy = p.y - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 6) drag.moved = true;
        if (drag.moved) {
          map.x = drag.cx - dx / map.zoom;
          map.y = drag.cy - dy / map.zoom;
          map.clamp();
          c.style.cursor = 'grabbing';
        }
        return;
      }
      const hit = map.pick(session.s, cachedView ?? view(), p.x, p.y);
      if (hit.region !== session.hover) {
        session.hover = hit.region;
        session.previewPath(hit.region);
      }
      session.hoverArmy = hit.army;
      c.style.cursor = hit.army ? 'pointer' : session.selArmy.value && hit.region ? 'crosshair' : 'default';
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pinch) {
        if (pointers.size < 2) pinch = null;
        return;
      }
      const d = drag;
      drag = null;
      c.style.cursor = 'default';
      if (!d || d.moved) return;
      const p = local(e);
      click(p.x, p.y, d.button === 2 ? 'right' : 'left');
    };
    const click = (x: number, y: number, button: 'left' | 'right') => {
      if (session.busy.value || session.prompt.value) return;
      audio.unlock();
      const hit = map.pick(session.s, cachedView ?? view(), x, y);
      const sel = session.selArmy.value ? armyById(session.s, session.selArmy.value) : null;
      const mine = sel && sel.faction === session.player;
      // Right-click, or a click on another region with an army selected, marches.
      if (mine && hit.region && hit.region !== sel.region && (button === 'right' || !hit.army || armyById(session.s, hit.army)?.faction !== session.player)) {
        audio.ui('click');
        void session.moveSelected(hit.region);
        return;
      }
      if (hit.army) {
        audio.ui('click');
        session.selectArmy(hit.army === session.selArmy.value ? null : hit.army);
        return;
      }
      if (button === 'right') {
        session.selectArmy(null);
        return;
      }
      session.selectRegion(hit.region === session.selRegion.value && !session.selArmy.value ? null : hit.region);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const [mx, my] = map.toMap(p.x, p.y);
      map.zoom *= Math.exp(-e.deltaY * 0.0015);
      map.clamp();
      // Keep the point under the cursor fixed.
      const [nx, ny] = map.toMap(p.x, p.y);
      map.x += mx - nx;
      map.y += my - ny;
      map.clamp();
    };
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const step = 60 / map.zoom;
      if (e.key === 'Escape') {
        if (session.panel.value !== 'none') session.panel.value = 'none';
        else session.selectArmy(null);
      } else if (e.key === 'ArrowLeft' || e.key === 'a') map.x -= step;
      else if (e.key === 'ArrowRight' || e.key === 'd') map.x += step;
      else if (e.key === 'ArrowUp' || e.key === 'w') map.y -= step;
      else if (e.key === 'ArrowDown' || e.key === 's') map.y += step;
      else if (e.key === 'Enter' && !session.prompt.value && !session.busy.value) void session.endToll();
      else if (e.key === 'Tab') {
        e.preventDefault();
        cycleArmy(session, map);
      } else return;
      map.clamp();
    };
    c.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      c.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      c.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
    };
  }, [session]);

  const selArmy = session.selArmy.value ? armyById(session.s, session.selArmy.value) : null;
  const selRegion = session.selRegion.value;
  const focus = (region: string) => {
    const m = mapRef.current;
    if (!m) return;
    const sh = SHAPES[region]!;
    m.centerOn(sh.cx, sh.cy, Math.max(m.zoom, m.fitZoom() * 1.5));
  };
  return (
    <div class="screen campaign">
      <canvas ref={ref} class="campaign-map" aria-label="Campaign map" />
      <TopBar session={session} />
      {(selArmy || selRegion) && (
        <aside class="camp-side panel scroll">
          {selArmy ? <ArmyPanel session={session} army={selArmy} /> : selRegion ? <RegionPanel session={session} region={selRegion} focus={focus} /> : null}
        </aside>
      )}
      <div class="camp-end">
        <button class="btn primary big" disabled={!!session.busy.value || !!session.s.winner} onClick={() => void session.endToll()} title="End this Toll (Enter)">
          End Toll {session.s.turn}
        </button>
      </div>
      {session.panel.value !== 'none' && <FactionPanel session={session} focus={focus} />}
      {session.busy.value && (
        <div class="camp-busy panel" role="status">
          <span class="spinner" aria-hidden="true" />
          {session.busy.value}
        </div>
      )}
      {session.toast.value && (
        <div class="camp-toast panel" role="alert" key={session.toast.value.id}>
          {session.toast.value.text}
        </div>
      )}
      <Prompts session={session} focus={focus} />
    </div>
  );
}

function cycleArmy(session: CampaignSession, map: CampaignMap): void {
  const mine = session.s.armies.filter((a) => a.faction === session.player);
  if (!mine.length) return;
  const i = mine.findIndex((a) => a.id === session.selArmy.value);
  const next = mine[(i + 1) % mine.length]!;
  session.selectArmy(next.id);
  const r = regionDef(next.region);
  map.centerOn(r.x, r.y);
}

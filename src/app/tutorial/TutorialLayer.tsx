/**
 * The tutorial on top of a battle: a compact step panel, pointers on the
 * field and the HUD, and the closing dialog. BattleScreen renders it for
 * tutorial battles.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { factionDef } from '../../data/index';
import type { BattleSession } from '../battle/session';
import { go } from '../store';
import { audio } from '../../audio/audio';
import { nextTutorial, runFor, startTutorial } from './index';
import { FieldMarks, HudRings, marksBox, type FreeRect } from './overlay';
import { resolve, type TutorialRun } from './runner';
import type { View } from './types';
import './tutorial.css';

function isTouch(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function list(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

/** `**bold**` in step text. */
function rich(text: string): ComponentChildren {
  return text.split('**').map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

/** The part of the screen the HUD and the panel leave free. */
function freeRect(s: BattleSession, panel: HTMLElement | null): FreeRect {
  const W = s.renderer.camera.width;
  const H = s.renderer.camera.height;
  const free: FreeRect = { left: 0, top: 0, right: W, bottom: H };
  const top = document.querySelector('.hud-top')?.getBoundingClientRect();
  if (top) free.top = top.bottom;
  // The card row spans the screen; the unit panel only covers it when it is wide (phones).
  const cards = document.querySelector('.hud-bottom .cards')?.getBoundingClientRect();
  if (cards && cards.height > 0) free.bottom = cards.top;
  const unitPanel = document.querySelector('.hud-bottom .unit-panel')?.getBoundingClientRect();
  if (unitPanel && unitPanel.width > W * 0.6) free.bottom = Math.min(free.bottom, unitPanel.top);
  if (panel) {
    const p = panel.getBoundingClientRect();
    // A panel docked across the top pushes the free area down; one on the left pushes it right.
    if (p.width > W * 0.6) free.top = Math.max(free.top, p.bottom);
    else free.left = Math.max(free.left, p.right);
  }
  if (free.bottom - free.top < 120) free.top = Math.max(0, free.bottom - 120);
  return free;
}

interface CamGoal {
  x: number;
  y: number;
  zoom: number;
  fromX: number;
  fromY: number;
  fromZoom: number;
  t0: number;
}

/** The world area already shows inside the free part of the screen. */
function inView(s: BattleSession, v: View, free: FreeRect): boolean {
  const cam = s.renderer.camera;
  const a = cam.toScreen(v.x0, v.y0);
  const b = cam.toScreen(v.x1, v.y1);
  return a.x >= free.left && a.y >= free.top && b.x <= free.right && b.y <= free.bottom;
}

/** Where the camera should go to show a world area inside the free part of the screen. */
function framing(s: BattleSession, v: View, free: FreeRect, now: number, zoomIn = true): CamGoal {
  const cam = s.renderer.camera;
  const fw = Math.max(80, free.right - free.left - 24);
  const fh = Math.max(80, free.bottom - free.top - 24);
  let zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, Math.min(fw / (v.x1 - v.x0), fh / (v.y1 - v.y0))));
  if (!zoomIn) zoom = Math.min(zoom, cam.zoom);
  const fcx = (free.left + free.right) / 2;
  const fcy = (free.top + free.bottom) / 2;
  let x = (v.x0 + v.x1) / 2 - (fcx - cam.width / 2) / zoom;
  let y = (v.y0 + v.y1) / 2 - (fcy - cam.height / 2) / zoom;
  // Keep the edge of the map off screen when the view is smaller than the map.
  const t = s.battle.terrain;
  const hw = cam.width / 2 / zoom;
  const hh = cam.height / 2 / zoom;
  if (hw * 2 < t.width) x = Math.max(hw, Math.min(t.width - hw, x));
  if (hh * 2 < t.height) y = Math.max(hh, Math.min(t.height - hh, y));
  return {
    x,
    y,
    zoom,
    fromX: cam.x,
    fromY: cam.y,
    fromZoom: cam.zoom,
    t0: now,
  };
}

export function TutorialLayer({ s }: { s: BattleSession }) {
  const run = runFor(s.req);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!run || !root.current) return;
    const rootEl = root.current;
    const screenEl = rootEl.closest('.screen') as HTMLElement | null;
    let pendingView: View | null = null;
    let goal: CamGoal | null = null;
    // What the pointers were last framed for: the step, and the free area around them.
    let framedStep = -1;
    let framedFree: FreeRect | null = null;
    run.touch = isTouch();
    run.onView = (v) => {
      pendingView = v;
    };
    run.attach(s, performance.now());
    // For browser tests, like the session's window.__ns.
    (window as unknown as { __tut?: TutorialRun }).__tut = run;
    const marks = new FieldMarks(s.renderer.canvas.parentElement!);
    const rings = new HudRings(rootEl);
    let raf = 0;
    const loop = (now: number): void => {
      run.update(now);
      const free = freeRect(s, panel.current);
      // Frame the step's area once the panel shows the new step.
      if (pendingView) {
        goal = framing(s, pendingView, free, now);
        pendingView = null;
        framedStep = run.index;
        framedFree = free;
      }
      // Keep an action step's pointers clear of the HUD: when the step starts, and when a
      // panel opens or closes around them (on phones the unit panel covers half the field).
      const moved = !framedFree || Math.abs(free.top - framedFree.top) > 40 || Math.abs(free.bottom - framedFree.bottom) > 40 || Math.abs(free.left - framedFree.left) > 40;
      const act = run.status === 'running' ? run.step : undefined;
      if (!goal && act?.done && act.marks && !run.flashing && run.index < run.total - 1 && (framedStep !== run.index || moved)) {
        framedStep = run.index;
        framedFree = free;
        const box = marksBox(act.marks(run.ctx), s.renderer, s.side);
        if (box && !inView(s, box, free)) goal = framing(s, box, free, now, false);
      }
      if (goal) {
        const cam = s.renderer.camera;
        const k = Math.min(1, (now - goal.t0) / 450);
        const e = k * (2 - k);
        cam.zoom = goal.fromZoom + (goal.zoom - goal.fromZoom) * e;
        cam.x = goal.fromX + (goal.x - goal.fromX) * e;
        cam.y = goal.fromY + (goal.y - goal.fromY) * e;
        if (k >= 1) goal = null;
      }
      const st = run.status === 'running' ? run.step : undefined;
      marks.draw(st?.marks ? st.marks(run.ctx) : [], s.renderer, s.side, free, now);
      rings.draw(st ? list(resolve(st.hud, run.ctx)) : []);
      if (screenEl && panel.current) screenEl.style.setProperty('--tut-bottom', `${Math.round(panel.current.getBoundingClientRect().bottom)}px`);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
      if (run.status === 'running' && run.waitsForNext && !run.flashing) {
        e.preventDefault();
        run.next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      marks.dispose();
      rings.dispose();
      run.onView = null;
      run.detach();
    };
  }, [s, run]);

  if (!run) return null;
  // Re-render on step changes, and a few times a second for live readouts.
  void run.version.value;
  void s.hud.value;
  return (
    <div class="tut-layer" ref={root}>
      {run.status === 'running' ? <StepPanel s={s} run={run} panel={panel} /> : <EndDialog s={s} run={run} />}
    </div>
  );
}

function StepPanel({ s, run, panel }: { s: BattleSession; run: TutorialRun; panel: { current: HTMLDivElement | null } }) {
  void run.version.value;
  void s.hud.value;
  const [min, setMin] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(false), 3000);
    return () => clearTimeout(t);
  }, [leaving]);
  const st = run.step;
  if (!st) return null;
  const c = run.ctx;
  const def = run.def;
  const text = resolve(st.text, c) ?? '';
  const live = run.flashing ? null : (st.live?.(c) ?? null);
  const doneText = run.flashing ? resolve(st.doneText, c) : undefined;
  const msg = s.message.value;
  const pct = ((run.index + (run.flashing || run.reviewing ? 1 : 0)) / run.total) * 100;
  // Clicked buttons drop focus, so Space keeps pausing the battle.
  const act = (f: () => void) => (e: Event) => {
    (e.currentTarget as HTMLElement).blur();
    audio.unlock();
    audio.ui('click');
    f();
  };
  return (
    <div
      ref={panel}
      class={`panel tut-panel ${min ? 'min' : ''} ${run.holding ? 'holding' : ''} ${run.flashing ? 'flash' : ''}`}
      style={{ '--fc': `var(--${def.faction})` } as never}
      role="region"
      aria-label="Tutorial"
    >
      <div class="tut-head">
        <span class="tut-tag">{factionDef(def.faction).short} tutorial</span>
        <span class="tut-count num" aria-label={`Step ${run.index + 1} of ${run.total}`}>
          {run.index + 1} / {run.total}
        </span>
        <span class="tut-head-btns">
          <button class="btn small ghost tut-icon" onClick={act(() => setMin(!min))} aria-label={min ? 'Show the step' : 'Fold the panel'} title={min ? 'Show the step' : 'Fold the panel'}>
            {min ? '▾' : '▴'}
          </button>
          <button
            class={`btn small ghost ${leaving ? 'danger on' : ''}`}
            onClick={act(() => (leaving ? go({ name: 'tutorials' }) : setLeaving(true)))}
            title="Leave the tutorial"
          >
            {leaving ? 'Leave?' : 'Exit'}
          </button>
        </span>
      </div>
      <div class="tut-progress" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </div>
      <h3 class="tut-title">
        {run.flashing || run.reviewing ? <span class="tut-check">✓ </span> : null}
        {st.title}
      </h3>
      {!min && (
        <>
          <p class="tut-text" aria-live="polite">
            {rich(text)}
          </p>
          {live && <div class="tut-live num">{live}</div>}
          {doneText && <div class="tut-done">✓ {doneText}</div>}
          {msg && <div class="tut-msg">{msg}</div>}
          <div class="tut-foot">
            <button class="btn small ghost" disabled={run.index === 0 || run.flashing} onClick={act(() => run.back())}>
              Back
            </button>
            <span class="tut-foot-mid">{run.holding && <span class="chip">Paused while you read</span>}</span>
            {run.waitsForNext ? (
              <button class="btn small primary" onClick={act(() => run.next())} disabled={run.flashing}>
                {run.index === run.total - 1 ? 'Done' : 'Next'}
              </button>
            ) : st.noSkip || run.index === run.total - 1 ? null : (
              <button class="btn small ghost" onClick={act(() => run.skipStep())} disabled={run.flashing} title={st.auto ? 'Do this step for me' : 'Move on'}>
                Skip step
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function lossTitle(reason: string | undefined, winner: number | undefined): string {
  if (winner === -1) return 'A draw';
  if (reason === 'withdraw') return 'You left the field';
  if (reason === 'timeout') return 'Time ran out';
  return 'Your army broke';
}

function EndDialog({ s, run }: { s: BattleSession; run: TutorialRun }) {
  const def = run.def;
  const won = run.status === 'won';
  const r = s.battle.result;
  const next = nextTutorial(def.id);
  const mine = r?.sides[s.side];
  const theirs = r?.sides[(1 - s.side) as 0 | 1];
  const click = (f: () => void) => () => {
    audio.ui('click');
    f();
  };
  return (
    <div class="modal-veil tut-end">
      <div class="panel modal tut-end-card" role="dialog" aria-labelledby="tut-end-title" style={{ '--fc': `var(--${def.faction})` } as never}>
        <div class="tut-tag">{factionDef(def.faction).short} tutorial · {def.title}</div>
        <h2 id="tut-end-title">{won ? 'Tutorial complete' : lossTitle(r?.reason, r?.winner)}</h2>
        <p>{won ? 'You won the battle, and the lesson is yours.' : 'This time the enemy held the field. The lesson still stands: try it again.'}</p>
        {mine && theirs && (
          <div class="row num tut-end-stats">
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
              <b>{fmtTime(r!.time)}</b>
            </div>
          </div>
        )}
        <div>
          <div class="label">{won ? 'remember' : 'the idea'}</div>
          {won ? (
            <ul class="tut-recap">
              {def.recap.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p class="muted">{def.idea}</p>
          )}
        </div>
        <div class="row tut-end-btns">
          {won && next && (
            <button class="btn primary" onClick={click(() => startTutorial(next.id))}>
              Next: {next.title}
            </button>
          )}
          {!won && (
            <button class="btn primary" onClick={click(() => startTutorial(def.id))}>
              Try again
            </button>
          )}
          <button class={`btn ${won && !next ? 'primary' : ''}`} onClick={click(() => go({ name: 'tutorials' }))}>
            Back to tutorials
          </button>
        </div>
      </div>
    </div>
  );
}

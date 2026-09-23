/**
 * A battle in progress on screen: the simulation, its renderer, the fixed
 * 20 Hz step loop, deployment and every input gesture.
 */
import { signal } from '@preact/signals';
import type { AbilityDef, HourId } from '../../data/schema';
import { Battle } from '../../sim/battle';
import { DT } from '../../sim/constants';
import type { BattleSetup, Command, Side, Unit, UnitSpec } from '../../sim/types';
import { BattleAI } from '../../ai/battleAI';
import { aiOptions } from '../../ai/plan';
import { askAdvice, askCounsel, askGeneral, askGeneralMid, strengthRatio } from './claudeGeneral';
import { MomentLog, type Moment } from './moments';
import { noteBattle, noteLegend } from '../book';
import { legendById, medalFor, type Medal } from '../legends';
import { claudeStatus, saveFile } from '../claude';
import { layoutSlots, placeInFormation } from '../../sim/army';
import { castBlocker, casterPos, findAbility } from '../../sim/abilities';
import { BattleRenderer, emptyOverlay, type Overlay } from '../../render/battleRenderer';
import { groupMove, lineFormation, type Placement } from './orders';
import type { BattleRequest } from '../store';
import { settings } from '../store';
import type { FactionId } from '../../data/schema';
import { factionDef } from '../../data/index';
import { audio } from '../../audio/audio';

export type Phase = 'deploy' | 'battle' | 'over';

/** The enemy general thinks again at most every this many battle seconds, and this many times a battle. */
const MID_GAP = 30;
const MID_ASKS = 4;

/**
 * How much of the field is fighting, for the war drums: 0 a lull, 1 when a
 * fifth of both armies is locked in melee. Shooting counts for half.
 */
function fightingShare(b: Battle): number {
  let fighting = 0;
  let alive = 0;
  for (const u of b.units) {
    if (u.state !== 'ready' || u.alive <= 0) continue;
    alive += u.alive;
    fighting += Math.min(u.alive, u.engaged);
    if (u.engaged === 0 && b.time - u.lastFireTime < 2) fighting += u.alive * 0.5;
  }
  // Measured over AI battles: a fifth of the field fighting is about as hot as battles get.
  return alive ? Math.min(1, fighting / (alive * 0.22)) : 0;
}

/** What one AI general has seen and said during the battle, when Claude plays it. */
interface MidState {
  asks: number;
  lastAt: number;
  busy: boolean;
  contact: boolean;
  /** A watched battle's opening plan has been asked for. */
  opened: boolean;
  ratio: number;
  fallen: Set<number>;
  abort: AbortController | null;
}
const newMid = (): MidState => ({ asks: 0, lastAt: 0, busy: false, contact: false, opened: false, ratio: 0, fallen: new Set(), abort: null });

interface Targeting {
  unit: number;
  ability: AbilityDef;
}

export class BattleSession {
  battle: Battle;
  readonly renderer: BattleRenderer;
  readonly side: Side;
  phase: Phase;
  speed = 1;
  paused = false;
  readonly overlay: Overlay = emptyOverlay();
  readonly hud = signal(0);
  targeting: Targeting | null = null;
  hoverScreen: { x: number; y: number } | null = null;
  message = signal<string>('');
  /** The battle menu (Esc opens it when there is nothing to cancel). */
  readonly menuOpen = signal(false);
  private raf = 0;
  private acc = 0;
  private last = 0;
  private keys = new Set<string>();
  private lastHud = 0;
  private drag: {
    button: number;
    sx: number;
    sy: number;
    wx: number;
    wy: number;
    moved: boolean;
    onOwn: boolean;
    /** A touch in Select mode: taps add or remove units, a drag draws a box. */
    touchSelect?: boolean;
    startPositions?: Map<number, { x: number; y: number }>;
  } | null = null;
  /**
   * What one finger does on a touch screen, which has no Shift key or right
   * button: pan the view, select several units, or lay out a line.
   */
  touchMode: 'pan' | 'select' | 'line' = 'pan';
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; zoom: number; cx: number; cy: number; camX: number; camY: number } | null = null;
  private lastClick = { t: 0, unit: -1 };
  /** When the player last touched anything, for idle frame skipping. */
  private lastInput = 0;
  private lastDraw = 0;
  private lastCam = '';
  private disposed = false;
  private readonly canvas: HTMLCanvasElement;
  readonly req: BattleRequest;

  constructor(req: BattleRequest, canvas: HTMLCanvasElement) {
    this.req = req;
    this.canvas = canvas;
    this.side = req.playerSide;
    this.battle = new Battle(req.setup, { events: true, replay: req.replay });
    this.renderer = new BattleRenderer(canvas, this.battle, this.side);
    this.phase = req.skipDeploy ? 'battle' : 'deploy';
    if (req.mode === 'replay' || req.mode === 'demo') this.renderer.showAll = req.mode === 'demo';
    this.attachControllers();
    if (this.phase === 'deploy' && !req.tutorial && req.mode !== 'replay' && req.mode !== 'demo') this.consultGeneral();
    // Battles that skip deployment are already under way: the drums start with them.
    if (this.phase === 'battle') {
      audio.setFactions([this.battle.sides[0].faction, this.battle.sides[1].faction]);
      audio.drums(this.battle.sides[this.side].faction);
    }
    this.resize();
    this.frameCamera();
    if (this.phase === 'deploy') this.overlay.deployZone = this.battle.terrain.deployZone(this.side);
    this.bind();
    (window as unknown as { __ns?: BattleSession }).__ns = this;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private attachControllers(): void {
    const b = this.battle;
    this.ais = [null, null];
    for (const s of [0, 1] as Side[]) {
      const custom = this.req.controller?.(s);
      if (custom !== undefined) {
        b.setController(s, custom);
        continue;
      }
      const ctrl = b.setup.armies[s].controller;
      // Replays re-run the AI wherever it played, including both sides of a watched battle.
      const auto = this.req.mode === 'demo' || (ctrl === 'ai' && s !== this.side) || (this.req.mode === 'replay' && (s !== this.side || ctrl === 'ai'));
      if (auto) b.setController(s, (this.ais[s] = new BattleAI(aiOptions(b.setup.armies[s]))));
    }
  }

  private frameCamera(): void {
    const t = this.battle.terrain;
    const cam = this.renderer.camera;
    cam.fit(t.width, t.height);
    const portrait = cam.height > cam.width * 1.1;
    if (this.phase === 'deploy') {
      const z = t.deployZone(this.side);
      cam.x = z.x + z.w / 2;
      cam.y = z.y + z.h / 2 + (this.side === 0 ? -140 : 140);
      cam.zoom = portrait ? Math.max(cam.width / 1000, cam.height / 1000) : Math.min(cam.width / 1000, cam.height / 620);
    } else if (portrait) {
      // Phones: fill the height instead of letterboxing, centered on our army.
      cam.zoom = Math.max(cam.width / t.width, cam.height / t.height);
      const own = this.battle.units.filter((u) => u.side === this.side && u.alive > 0);
      if (own.length) {
        cam.x = own.reduce((s, u) => s + u.x, 0) / own.length;
        cam.y = own.reduce((s, u) => s + u.y, 0) / own.length - 120;
      }
    }
  }

  resize(): void {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.renderer.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1));
  }

  dispose(): void {
    this.disposed = true;
    audio.drums(null);
    this.general.abort?.abort();
    this.counsel.abort?.abort();
    this.advice.abort?.abort();
    for (const m of this.mids) m.abort?.abort();
    clearTimeout(this.heraldTimer);
    cancelAnimationFrame(this.raf);
    this.unbind();
  }

  /**
   * The enemy general's plan and words, from Claude when it is on, asked
   * while the player deploys. `waiting` shows until it answers; a plan that
   * comes after the battle starts is dropped.
   */
  readonly general: { abort?: AbortController; waiting: boolean; speech?: string; faction?: FactionId } = { waiting: false };

  /** The player's own adviser, asked from the deployment panel. */
  readonly counsel: { busy: boolean; tips: string[] | null; failed: boolean; abort?: AbortController } = { busy: false, tips: null, failed: false };

  askCounsel(): void {
    if (this.phase !== 'deploy' || this.counsel.busy || claudeStatus.value !== 'ready') return;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30000);
    Object.assign(this.counsel, { busy: true, failed: false, abort });
    this.hud.value++;
    void askCounsel(this.battle, this.side, abort.signal).then((tips) => {
      clearTimeout(timer);
      this.counsel.busy = false;
      if (this.disposed) return;
      if (tips) this.counsel.tips = tips;
      else this.counsel.failed = !abort.signal.aborted || this.phase === 'deploy';
      this.hud.value++;
    });
  }

  /** The adviser in the middle of the battle, asked from the pause menu: its orders, and when it gave them. */
  readonly advice: { busy: boolean; tips: string[] | null; failed: boolean; at: number; abort?: AbortController } = { busy: false, tips: null, failed: false, at: -1 };

  askAdvice(): void {
    if (this.phase !== 'battle' || this.advice.busy || claudeStatus.value !== 'ready') return;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30000);
    const at = this.battle.time;
    Object.assign(this.advice, { busy: true, failed: false, abort });
    this.hud.value++;
    void askAdvice(this.battle, this.side, abort.signal).then((tips) => {
      clearTimeout(timer);
      this.advice.busy = false;
      if (this.disposed) return;
      if (tips) Object.assign(this.advice, { tips, at });
      else this.advice.failed = true;
      this.hud.value++;
    });
  }

  private consultGeneral(): void {
    const s = ([0, 1] as Side[]).find((x) => x !== this.side && this.req.setup.armies[x].controller === 'ai' && !this.req.setup.armies[x].plan);
    if (s === undefined || !settings.value.claudeAI || claudeStatus.value !== 'ready') return;
    const abort = new AbortController();
    // A general who hasn't answered in 15 s never will: the scripted one decides.
    const timer = setTimeout(() => abort.abort(), 15000);
    Object.assign(this.general, { abort, waiting: true, faction: this.battle.sides[s].faction });
    void askGeneral(this.battle, s, abort.signal).then((plan) => {
      clearTimeout(timer);
      this.general.waiting = false;
      if (plan && this.phase === 'deploy' && !this.disposed) {
        this.req.setup.armies[s].plan = plan;
        this.general.speech = plan.speech;
      }
      this.hud.value++;
    });
  }

  /** A Legend's medal for this battle, once it is over, and whether it is the best yet. */
  medal: Medal | null = null;
  medalBest = false;

  /** When the war drums last heard how hot the fighting is. */
  private heatTick = 0;

  /** The battle's turning points, as they happen. */
  private momentLog: MomentLog | null = null;
  get moments(): Moment[] {
    return this.momentLog?.list ?? [];
  }

  /** The scripted general playing each side, where one does. */
  private ais: [BattleAI | null, BattleAI | null] = [null, null];
  /**
   * The AI generals during the battle, when Claude plays them: how often each
   * has thought again, the strength and the fallen it last saw, and the
   * question in flight.
   */
  private mids: [MidState, MidState] = [newMid(), newMid()];
  private midTick = 0;
  /** A general's latest words to its army, shown over the field for a few seconds. */
  readonly herald = signal<{ side: Side; who: string; text: string; stance: 'attack' | 'defend' } | null>(null);
  private heraldTimer = 0;

  /**
   * The sides whose general Claude may play during this battle: the enemy's
   * in a battle the player fights, both in a battle the player watches.
   */
  private midSides(): Side[] {
    const r = this.req;
    if (r.tutorial || r.mode === 'replay' || this.battle.terrain.fort) return [];
    if (r.mode === 'demo') return ([0, 1] as Side[]).filter((s) => this.ais[s]);
    const s = (1 - this.side) as Side;
    return r.setup.armies[s].controller === 'ai' && this.ais[s] ? [s] : [];
  }

  /**
   * Once a second of battle: has something happened that a general would
   * stop and think about? Most telling first: a colossus or a general falls,
   * the battle turns, the lines meet, or nobody will attack. A watched
   * battle also opens with both generals choosing a plan.
   */
  private watchGeneral(): void {
    const b = this.battle;
    if (b.tick - this.midTick < 20) return;
    this.midTick = b.tick;
    if (b.over || !settings.value.claudeAI || claudeStatus.value !== 'ready') return;
    for (const s of this.midSides()) this.watchSide(s);
  }

  private watchSide(s: Side): void {
    const b = this.battle;
    const m = this.mids[s];
    if (m.busy || m.asks >= MID_ASKS) return;
    // A fallen general gives no new orders: the army fights on as it was.
    if (b.sides[s].generalDead) return;
    if (!m.ratio) m.ratio = strengthRatio(b, s);
    const fell = b.units.filter((u) => (u.def.category === 'colossus' || u.isGeneral) && u.state !== 'ready' && u.state !== 'embarked' && u.state !== 'routing' && !m.fallen.has(u.id));
    const opening = this.req.mode === 'demo' && !m.opened;
    if (!opening && b.time - m.lastAt < MID_GAP) return;
    // Has the army come to blows yet (now, or since the general last thought)?
    const contact = b.units.some((u) => u.side === s && (u.engaged > 0 || u.lastMeleeTime > m.lastAt));
    const ratio = strengthRatio(b, s);
    let why: string | null = null;
    const ours = fell.find((u) => u.side === s);
    const theirs = fell.find((u) => u.side !== s);
    if (opening) why = 'The armies have just taken the field and face each other: choose how to open the battle.';
    else if (ours) why = `You have just lost ${ours.def.name}.`;
    else if (theirs) why = `Your army has just brought down their ${theirs.def.name}.`;
    else if (ratio < m.ratio * 0.72) why = 'The battle is turning against you.';
    else if (ratio > m.ratio * 1.38) why = 'The battle is turning your way.';
    else if (contact && !m.contact) why = 'The lines have met.';
    else if (!contact && !m.contact && b.time >= 90 && b.time - m.lastAt >= 75) why = 'The main lines have stood apart for a long while and neither has closed.';
    if (contact) m.contact = true;
    if (!why) return;
    m.opened = true;
    for (const u of fell) m.fallen.add(u.id);
    m.ratio = ratio;
    m.lastAt = b.time;
    m.asks++;
    m.busy = true;
    const stance = this.ais[s]!.currentStance;
    const abort = new AbortController();
    m.abort = abort;
    // A general who takes too long has missed the moment.
    const timer = setTimeout(() => abort.abort(), 12000);
    void askGeneralMid(b, s, why, stance, abort.signal, opening).then((plan) => {
      clearTimeout(timer);
      m.busy = false;
      if (!plan || this.disposed || b !== this.battle || b.over || this.phase !== 'battle' || b.sides[s].generalDead) return;
      // Pressing on as before needs no order; a new order to hold starts its patience afresh.
      if (plan.stance === stance && stance === 'attack' && !plan.speech) return;
      this.battle.issue(s, { type: 'plan', ...plan });
    });
  }

  /** Words waiting their turn over the field, and when the current ones went up. */
  private heraldQueue: { side: Side; who: string; text: string; stance: 'attack' | 'defend' }[] = [];
  private heraldAt = 0;

  /** A general spoke (live, or from a replay's log): show it over the field, one general at a time. */
  private heard(side: Side, stance: 'attack' | 'defend', text: string): void {
    const st = this.battle.sides[side];
    const who = st.general?.def.name ?? `${factionDef(st.faction).short} general`;
    this.heraldQueue.push({ side, who, text, stance });
    if (!this.herald.value) return this.nextHerald();
    // Someone else is waiting: the words on screen make way a little sooner.
    clearTimeout(this.heraldTimer);
    this.heraldTimer = window.setTimeout(this.nextHerald, Math.max(1500, this.heraldAt + 4500 - performance.now()));
  }

  private nextHerald = (): void => {
    const next = this.heraldQueue.shift() ?? null;
    this.herald.value = next;
    this.heraldAt = performance.now();
    clearTimeout(this.heraldTimer);
    if (next) this.heraldTimer = window.setTimeout(this.nextHerald, this.heraldQueue.length ? 4500 : 7000);
  };

  // ------------------------------------------------------------------ loop

  private loop = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const b = this.battle;
    if (this.phase === 'battle' && !this.paused) {
      if (this.momentLog?.battle !== b) this.momentLog = new MomentLog(b);
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= DT && n < 16) {
        b.step();
        const ev = b.takeEvents();
        if (ev.length) {
          this.renderer.effects.consume(ev, (id) => b.units[id]?.def.name ?? '', this.side);
          audio.events(ev, this.renderer.camera, this.side, (id) => b.units[id]);
          for (const e of ev) if (e.t === 'plan' && e.speech) this.heard(e.side, e.stance, e.speech);
        }
        this.momentLog.consume(ev);
        this.acc -= DT;
        n++;
        if (b.over) break;
      }
      if (n >= 16) this.acc = 0;
      this.watchGeneral();
      if (b.tick - this.heatTick >= 10) {
        this.heatTick = b.tick;
        audio.setHeat(fightingShare(b));
      }
      if (b.over) {
        this.phase = 'over';
        audio.drums(null);
        audio.battleEnd(b.result!.winner === this.side);
        if (this.req.mode === 'custom' || this.req.mode === 'campaign') noteBattle(b.sides[this.side].faction, b.result!.winner === this.side);
        const legend = this.req.legend ? legendById(this.req.legend) : undefined;
        if (legend) {
          this.medal = medalFor(legend, b.result!, this.side);
          this.medalBest = this.medal ? noteLegend(legend.id, this.medal) : false;
        }
        this.hud.value++;
      }
    }
    // The drums fall quiet while the battle waits.
    if (this.paused || this.phase !== 'battle') audio.setHeat(0);
    this.panCamera(dt);
    const alpha = this.phase === 'battle' && !this.paused ? Math.min(1, this.acc / DT) : 1;
    // A still scene (paused, deploying, over) with no input and no camera
    // movement redraws at about 15 fps instead of 60: phones keep their battery.
    const cam = this.renderer.camera;
    const camKey = `${cam.x.toFixed(2)},${cam.y.toFixed(2)},${cam.zoom.toFixed(4)},${cam.width},${cam.height}`;
    if (camKey !== this.lastCam) {
      this.lastCam = camKey;
      this.lastInput = now;
    }
    const still = this.phase !== 'battle' || this.paused;
    const idle = still && now - this.lastInput > 1500 && this.overlay.pings.length === 0 && this.keys.size === 0;
    if (!idle || now - this.lastDraw > 66) {
      this.lastDraw = now;
      this.renderer.frame(alpha, this.paused ? 0 : dt * (this.phase === 'battle' ? this.speed : 1), this.overlay);
    }
    if (now - this.lastHud > 150) {
      this.lastHud = now;
      this.hud.value++;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private panCamera(dt: number): void {
    const cam = this.renderer.camera;
    const sp = (700 / cam.zoom) * dt;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) cam.y -= sp;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) cam.y += sp;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) cam.x -= sp;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) cam.x += sp;
    cam.clamp(this.battle.terrain.width, this.battle.terrain.height);
  }

  // ------------------------------------------------------------- commands

  /** Sees every order the player gives (the tutorials watch them). */
  onIssue: ((cmd: Command) => void) | null = null;

  issue(cmd: Command): void {
    if (this.phase !== 'battle' || this.req.mode === 'replay' || this.req.mode === 'demo') return;
    this.battle.issue(this.side, cmd);
    this.onIssue?.(cmd);
  }

  own(): Unit[] {
    return this.battle.units.filter((u) => u.side === this.side);
  }

  selectedUnits(): Unit[] {
    return [...this.overlay.selected].map((id) => this.battle.units[id]!).filter((u) => u && u.alive > 0 && (u.state === 'ready' || u.state === 'embarked'));
  }

  select(ids: number[], add = false): void {
    this.lastInput = performance.now();
    if (!add) this.overlay.selected.clear();
    for (const id of ids) {
      const u = this.battle.units[id];
      if (u && u.side === this.side) this.overlay.selected.add(id);
    }
    this.targeting = null;
    this.overlay.abilityPreview = null;
    this.hud.value++;
  }

  toggleRun(): void {
    const us = this.selectedUnits();
    const on = !us.every((u) => u.running);
    for (const u of us) this.issue({ type: 'run', unit: u.id, on });
  }

  toggleFire(): void {
    const us = this.selectedUnits().filter((u) => u.def.missile);
    const on = !us.every((u) => u.fireAtWill);
    for (const u of us) this.issue({ type: 'fireAtWill', unit: u.id, on });
  }

  toggleMelee(): void {
    const us = this.selectedUnits().filter((u) => u.def.missile);
    const on = !us.every((u) => u.special.meleeMode);
    for (const u of us) this.issue({ type: 'meleeMode', unit: u.id, on });
  }

  halt(): void {
    for (const u of this.selectedUnits()) this.issue({ type: 'halt', unit: u.id });
  }

  withdraw(): void {
    for (const u of this.selectedUnits()) this.issue({ type: 'withdraw', unit: u.id });
  }

  setHour(hour: HourId): void {
    this.issue({ type: 'hour', side: this.side, hour });
    this.hud.value++;
  }

  useAbility(unit: Unit, ability: AbilityDef): void {
    if (this.phase !== 'battle') return;
    const a = findAbility(unit, ability.id);
    if (!a) return;
    if (ability.kind === 'toggle' || ability.target === 'self') {
      const why = castBlocker(this.battle, unit, a, unit.x, unit.y, unit.id);
      if (why) return this.flash(why);
      this.issue({ type: 'ability', unit: unit.id, ability: ability.id });
      audio.ui('ability');
      return;
    }
    this.targeting = { unit: unit.id, ability };
    this.flash(`${ability.name}: ${ability.target === 'enemy' ? 'click an enemy unit' : ability.target === 'ally' ? 'click a friendly unit' : 'click a point'}. Right-click cancels.`);
  }

  /**
   * Save the field as it looks now as a picture, with a line naming the
   * battle in the corner. The interface is drawn apart, so it isn't in it.
   */
  async savePicture(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      await this.makePicture();
    } finally {
      this.saving = false;
    }
  }

  private saving = false;

  private async makePicture(): Promise<void> {
    const src = this.canvas;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d');
    if (!ctx) return this.flash('No picture could be made here.');
    ctx.drawImage(src, 0, 0);
    const b = this.battle;
    const [a, z] = b.sides.map((x) => factionDef(x.faction).name);
    const t = Math.floor(b.time);
    const line = `Nailed Sun · ${this.req.title ?? `${a} against ${z}`} · ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const px = Math.max(12, Math.round(c.height / 60));
    ctx.font = `600 ${px}px Georgia, serif`;
    ctx.textBaseline = 'bottom';
    const w = ctx.measureText(line).width;
    ctx.fillStyle = 'rgba(10, 8, 20, 0.55)';
    ctx.fillRect(px * 0.6, c.height - px * 2.4, w + px * 1.2, px * 1.8);
    ctx.fillStyle = '#ffd27a';
    ctx.fillText(line, px * 1.2, c.height - px * 0.9);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (!blob) return this.flash('No picture could be made here.');
    const name = `nailed-sun-${b.sides.map((x) => x.faction).join('-vs-')}-${t}s.png`;
    const r = await saveFile(name, blob);
    if (r === 'saved') this.flash('Picture saved.');
    else if (r === 'failed') this.flash('The picture could not be saved here.');
  }

  flash(msg: string): void {
    this.message.value = msg;
    setTimeout(() => {
      if (this.message.value === msg) this.message.value = '';
    }, 2600);
  }

  // ------------------------------------------------------------ deployment

  autoDeploy(): void {
    if (this.phase !== 'deploy') return;
    const setup = structuredCloneSetup(this.req.setup);
    for (const s of setup.armies[this.side].units) {
      delete s.x;
      delete s.y;
      delete s.facing;
    }
    this.battle = new Battle(setup, { events: true });
    this.renderer.battle = this.battle;
    this.attachControllers();
    this.hud.value++;
  }

  /** Leave deployment: rebuild the battle from the deployed positions so replays are exact. */
  startBattle(): void {
    if (this.phase !== 'deploy') return;
    this.counsel.abort?.abort();
    // Too late for the general's counsel: the scripted general decides.
    if (this.general.waiting) {
      this.general.abort?.abort();
      this.general.waiting = false;
    }
    const setup = structuredCloneSetup(this.req.setup);
    const own = this.battle.units.filter((u) => u.side === this.side);
    setup.armies[this.side].units = own.map((u, i): UnitSpec => ({
      ...setup.armies[this.side].units[i]!,
      x: round2(u.x),
      y: round2(u.y),
      facing: round2(u.facing),
      files: u.files,
    }));
    this.req.setup = setup;
    this.battle = new Battle(setup, { events: true });
    this.renderer.battle = this.battle;
    this.attachControllers();
    this.phase = 'battle';
    this.overlay.deployZone = null;
    this.overlay.preview = [];
    audio.battleStart(this.battle.sides[this.side].faction, [this.battle.sides[0].faction, this.battle.sides[1].faction]);
    audio.drums(this.battle.sides[this.side].faction);
    this.hud.value++;
  }

  private placeNow(p: Placement): void {
    const u = this.battle.units[p.unit];
    if (!u) return;
    const z = this.battle.terrain.deployZone(this.side);
    u.x = Math.max(z.x, Math.min(z.x + z.w, p.x));
    u.y = Math.max(z.y, Math.min(z.y + z.h, p.y));
    u.facing = p.facing;
    u.files = p.files;
    u.slotsDirty = true;
    layoutSlots(u);
    placeInFormation(u);
  }

  // ------------------------------------------------------------------ input

  private bind(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.prevent);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
  }

  private unbind(): void {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.prevent);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
  }

  private prevent = (e: Event): void => e.preventDefault();
  private onResize = (): void => this.resize();

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onWheel = (e: WheelEvent): void => {
    this.lastInput = performance.now();
    e.preventDefault();
    const p = this.local(e);
    this.renderer.camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  };

  private onDown = (e: PointerEvent): void => {
    this.lastInput = performance.now();
    const p = this.local(e);
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, p);
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        const cam = this.renderer.camera;
        this.pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: cam.zoom, cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2, camX: cam.x, camY: cam.y };
        this.drag = null;
        return;
      }
    }
    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // The pointer can already be gone (a very quick tap); nothing to capture.
    }
    const w = this.renderer.camera.toWorld(p.x, p.y);
    const own = this.renderer.pick(p.x, p.y, (u) => u.side === this.side);
    const touch = e.pointerType === 'touch';
    // In Line mode a finger acts as the right button.
    const button = touch ? (this.touchMode === 'line' ? 2 : 0) : e.button;
    this.drag = { button, sx: p.x, sy: p.y, wx: w.x, wy: w.y, moved: false, onOwn: !!own && this.overlay.selected.has(own.id), touchSelect: touch && this.touchMode === 'select' };
    if (this.phase === 'deploy' && this.drag.button === 0 && own) {
      if (!this.overlay.selected.has(own.id)) this.select([own.id], e.shiftKey);
      this.drag.onOwn = true;
      this.drag.startPositions = new Map(this.selectedUnits().map((u) => [u.id, { x: u.x, y: u.y }]));
    }
  };

  private onMove = (e: PointerEvent): void => {
    this.lastInput = performance.now();
    const p = this.local(e);
    this.hoverScreen = p;
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, p);
      if (this.pinch && this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        const cam = this.renderer.camera;
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        cam.zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, this.pinch.zoom * (d / Math.max(1, this.pinch.d))));
        const cx = (a!.x + b!.x) / 2;
        const cy = (a!.y + b!.y) / 2;
        cam.x = this.pinch.camX - (cx - this.pinch.cx) / cam.zoom;
        cam.y = this.pinch.camY - (cy - this.pinch.cy) / cam.zoom;
        return;
      }
    }
    const cam = this.renderer.camera;
    const w = cam.toWorld(p.x, p.y);
    // Hover highlight and ability preview.
    if (!this.drag) {
      const u = this.renderer.pick(p.x, p.y);
      this.overlay.hover = u ? u.id : -1;
    }
    if (this.targeting) this.updateAbilityPreview(w.x, w.y);
    const d = this.drag;
    if (!d) return;
    if (Math.hypot(p.x - d.sx, p.y - d.sy) > 6) d.moved = true;
    if (!d.moved) return;
    // A finger on the ground pans, unless Select mode turns it into a selection box.
    const pan = d.button === 1 || (e.pointerType === 'touch' && d.button === 0 && !d.onOwn && !d.touchSelect);
    if (pan) {
      cam.x -= e.movementX / cam.zoom || 0;
      cam.y -= e.movementY / cam.zoom || 0;
      if (e.pointerType === 'touch') {
        cam.x = d.wx - (p.x - cam.width / 2) / cam.zoom;
        cam.y = d.wy - (p.y - cam.height / 2) / cam.zoom;
      }
      return;
    }
    if (d.button === 0) {
      if (this.phase === 'deploy' && d.onOwn && d.startPositions) {
        // Drag deployed units around the deployment zone.
        const dx = w.x - d.wx;
        const dy = w.y - d.wy;
        for (const u of this.selectedUnits()) {
          const s0 = d.startPositions.get(u.id);
          if (!s0) continue;
          this.placeNow({ unit: u.id, x: s0.x + dx, y: s0.y + dy, facing: u.facing, files: u.files, width: 0, depth: 0 });
        }
        return;
      }
      this.overlay.dragBox = { x0: d.sx, y0: d.sy, x1: p.x, y1: p.y };
    } else if (d.button === 2) {
      const units = this.selectedUnits();
      if (units.length) this.overlay.preview = lineFormation(units, d.wx, d.wy, w.x, w.y);
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.lastInput = performance.now();
    const p = this.local(e);
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.pinch) {
        if (this.touches.size < 2) this.pinch = null;
        this.drag = null;
        return;
      }
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const cam = this.renderer.camera;
    const w = cam.toWorld(p.x, p.y);
    if (d.button === 0) {
      if (this.overlay.dragBox) {
        const box = this.overlay.dragBox;
        this.overlay.dragBox = null;
        const x0 = Math.min(box.x0, box.x1);
        const x1 = Math.max(box.x0, box.x1);
        const y0 = Math.min(box.y0, box.y1);
        const y1 = Math.max(box.y0, box.y1);
        const ids: number[] = [];
        for (const u of this.own()) {
          if (u.alive <= 0 || (u.state !== 'ready' && u.state !== 'embarked')) continue;
          const c = this.renderer.unitCenter(u, 1);
          const s = cam.toScreen(c.x, c.y);
          if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) ids.push(u.id);
        }
        this.select(ids, e.shiftKey || !!d.touchSelect);
        return;
      }
      if (d.moved) return;
      if (this.targeting) {
        this.castTargeting(w.x, w.y, p);
        return;
      }
      const u = this.renderer.pick(p.x, p.y);
      if (e.pointerType === 'touch') {
        // Touch: tap own unit to select (Select mode adds or removes it);
        // tap ground or enemy to order the selection.
        if (u && u.side === this.side) this.clickSelect(u, e.shiftKey || !!d.touchSelect);
        else if (this.overlay.selected.size) this.orderAt(w.x, w.y, u);
        else this.select([]);
        return;
      }
      if (u && u.side === this.side) this.clickSelect(u, e.shiftKey);
      else if (!e.shiftKey) this.select([]);
    } else if (d.button === 2) {
      // Line mode on touch: a tap still aims an ability that is waiting for a target.
      if (this.targeting && e.pointerType === 'touch' && !d.moved) {
        this.castTargeting(w.x, w.y, p);
        return;
      }
      if (this.targeting) {
        this.targeting = null;
        this.overlay.abilityPreview = null;
        return;
      }
      const units = this.selectedUnits();
      if (!units.length) return;
      if (d.moved && this.overlay.preview.length) {
        const pl = this.overlay.preview;
        this.overlay.preview = [];
        this.applyPlacements(pl, e.altKey);
        return;
      }
      const u = this.renderer.pick(p.x, p.y);
      this.orderAt(w.x, w.y, u, e.altKey);
    }
  };

  private clickSelect(u: Unit, add: boolean): void {
    const now = performance.now();
    if (this.lastClick.unit === u.id && now - this.lastClick.t < 350) {
      // Double-click: select all units of the same type, or center the camera.
      const same = this.own().filter((o) => o.def.id === u.def.id && o.state === 'ready').map((o) => o.id);
      this.select(same.length > 1 ? same : [u.id], add);
      const c = this.renderer.unitCenter(u, 1);
      this.renderer.camera.x = c.x;
      this.renderer.camera.y = c.y;
    } else if (add && this.overlay.selected.has(u.id)) {
      this.overlay.selected.delete(u.id);
      this.hud.value++;
    } else this.select([u.id], add);
    this.lastClick = { t: now, unit: u.id };
    audio.ui('select');
  }

  private orderAt(x: number, y: number, target: Unit | null, walk = false): void {
    const units = this.selectedUnits();
    if (!units.length) return;
    if (this.phase === 'deploy') {
      for (const pl of groupMove(units, x, y)) this.placeNow(pl);
      return;
    }
    if (target && target.side !== this.side) {
      for (const u of units) this.issue({ type: 'attack', unit: u.id, target: target.id, run: true });
      this.overlay.pings.push({ x, y, t: this.renderer.now(), color: '#ff6b5a' });
      audio.ui('attack');
      return;
    }
    // Boarding Old Midnight or the Dreadsail.
    if (target && target.side === this.side && target.def.category === 'colossus') {
      let boarded = false;
      for (const u of units) {
        if (this.battle.canEmbark(u, target)) {
          this.issue({ type: 'embark', unit: u.id, target: target.id });
          boarded = true;
        }
      }
      if (boarded) return;
    }
    this.applyPlacements(groupMove(units, x, y), walk);
    this.overlay.pings.push({ x, y, t: this.renderer.now(), color: '#a0dc8c' });
  }

  private applyPlacements(pl: Placement[], walk = false): void {
    if (this.phase === 'deploy') {
      for (const p of pl) this.placeNow(p);
      return;
    }
    for (const p of pl) {
      const u = this.battle.units[p.unit];
      if (!u) continue;
      if (u.state === 'embarked') {
        this.issue({ type: 'disembark', unit: u.id });
        continue;
      }
      this.issue({ type: 'move', unit: p.unit, x: p.x, y: p.y, facing: p.facing, files: p.files, run: walk ? false : u.running });
    }
    audio.ui('move');
  }

  private abilityGeometry(): { shape: 'circle' | 'cone' | 'line'; radius: number; angle: number; width: number } {
    const t = this.targeting!;
    const def = t.ability;
    for (const e of def.effects) {
      if ('area' in e && e.area) {
        const a = e.area;
        if (a.shape === 'circle') return { shape: 'circle', radius: a.radius, angle: 0, width: 0 };
        if (a.shape === 'cone') return { shape: 'cone', radius: a.radius, angle: (a.angle * Math.PI) / 180, width: 0 };
        if (a.shape === 'line') return { shape: 'line', radius: a.length, angle: 0, width: a.width };
      }
      if (e.kind === 'zone') return { shape: 'circle', radius: zoneRadius(e.zone), angle: 0, width: 0 };
      if (e.kind === 'script') {
        if (e.name === 'noonLance') return { shape: 'cone', radius: 300, angle: Math.PI / 2, width: 0 };
        if (e.name === 'thousandEyes') return { shape: 'cone', radius: 220, angle: (Math.PI * 2) / 3, width: 0 };
        if (e.name === 'dive') return { shape: 'line', radius: 60, angle: 0, width: 16 };
      }
    }
    return { shape: 'circle', radius: 8, angle: 0, width: 0 };
  }

  private updateAbilityPreview(x: number, y: number): void {
    const t = this.targeting!;
    const u = this.battle.units[t.unit];
    if (!u) return;
    const o = casterPos(u);
    const a = findAbility(u, t.ability.id);
    const g = this.abilityGeometry();
    let ok = true;
    if (a) {
      const target = this.renderer.pick(this.hoverScreen?.x ?? 0, this.hoverScreen?.y ?? 0);
      ok = castBlocker(this.battle, u, a, x, y, target?.id) === null;
    }
    const center = g.shape === 'circle' && t.ability.target === 'point';
    this.overlay.abilityPreview = { shape: g.shape, x, y, ox: o.x, oy: o.y, radius: g.radius, angle: g.angle, width: g.width, ok: ok || !center };
    if (!center && g.shape === 'circle') this.overlay.abilityPreview.x = o.x;
    if (!center && g.shape === 'circle') this.overlay.abilityPreview.y = o.y;
  }

  private castTargeting(x: number, y: number, p: { x: number; y: number }): void {
    const t = this.targeting!;
    const u = this.battle.units[t.unit];
    if (!u) return;
    const a = findAbility(u, t.ability.id);
    if (!a) return;
    let target: number | undefined;
    if (t.ability.target === 'enemy' || t.ability.target === 'ally') {
      const picked = this.renderer.pick(p.x, p.y, (o) => (t.ability.target === 'enemy' ? o.side !== this.side : o.side === this.side));
      if (!picked) return this.flash('Click a unit.');
      target = picked.id;
    }
    const why = castBlocker(this.battle, u, a, x, y, target);
    if (why) return this.flash(why);
    this.issue({ type: 'ability', unit: u.id, ability: t.ability.id, x, y, target });
    audio.ui('ability');
    this.targeting = null;
    this.overlay.abilityPreview = null;
  }

  private onKey = (e: KeyboardEvent): void => {
    this.lastInput = performance.now();
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    this.keys.add(e.code);
    const units = this.selectedUnits();
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (this.phase === 'battle') this.paused = !this.paused;
        break;
      case 'Escape':
        if (this.menuOpen.value) this.menuOpen.value = false;
        else if (this.targeting) {
          this.targeting = null;
          this.overlay.abilityPreview = null;
        } else if (this.overlay.selected.size) this.select([]);
        else if (this.phase !== 'over' && !this.req.tutorial) this.menuOpen.value = true;
        break;
      case 'Enter':
      case 'NumpadEnter':
        // Deployed: to battle (unless Enter is pressing a focused button).
        if (e.target instanceof HTMLElement && e.target.closest('button, a, textarea')) break;
        if (e.repeat || this.menuOpen.value) break;
        if (this.phase === 'deploy' && !this.req.tutorial) this.startBattle();
        break;
      case 'KeyR':
        this.toggleRun();
        break;
      case 'KeyF':
        this.toggleFire();
        break;
      case 'KeyH':
      case 'Backspace':
        this.halt();
        break;
      case 'KeyM':
        this.toggleMelee();
        break;
      case 'KeyP':
        if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) void this.savePicture();
        break;
      case 'Equal':
      case 'NumpadAdd':
      case 'Period':
        this.speed = Math.min(8, this.speed * 2);
        break;
      case 'Minus':
      case 'NumpadSubtract':
      case 'Comma':
        this.speed = Math.max(0.25, this.speed / 2);
        break;
      case 'KeyA':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.select(this.own().filter((u) => u.state === 'ready' && u.alive > 0).map((u) => u.id));
        }
        break;
      case 'Tab': {
        e.preventDefault();
        const list = this.own().filter((u) => u.state === 'ready' && u.alive > 0);
        if (!list.length) break;
        const cur = units[0];
        const i = cur ? list.indexOf(cur) : -1;
        const next = list[(i + 1) % list.length]!;
        this.select([next.id]);
        const c = this.renderer.unitCenter(next, 1);
        this.renderer.camera.x = c.x;
        this.renderer.camera.y = c.y;
        break;
      }
      default:
        if (e.code.startsWith('Digit') && units.length === 1) {
          const n = Number(e.code.slice(5)) - 1;
          const ab = units[0]!.def.abilities?.[n];
          if (ab) this.useAbility(units[0]!, ab);
        }
    }
    this.hud.value++;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.lastInput = performance.now();
    this.keys.delete(e.code);
  };
}

function zoneRadius(id: string): number {
  const map: Record<string, number> = { sunpatch: 40, listenerVeil: 40, kindleLight: 40, blindingDust: 45, gust: 100, signal: 45, burning: 9, verse: 80 };
  return map[id] ?? 30;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function structuredCloneSetup(s: BattleSetup): BattleSetup {
  return JSON.parse(JSON.stringify(s)) as BattleSetup;
}

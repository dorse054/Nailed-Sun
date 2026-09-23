/**
 * The live campaign: its state, what the player has selected, the map
 * view, and the turn flow. It outlives the campaign screen, which unmounts
 * while the player fights a battle and remounts after.
 */
import { signal } from '@preact/signals';
import type { FactionId } from '../../data/schema';
import type { BattleResult } from '../../sim/types';
import type { BattleReport, CampaignState, PendingBattle } from '../../campaign/types';
import type { Deal, DealValue } from '../../campaign/diplomacy';
import { newCampaign } from '../../campaign/setup';
import { endTurn, resolveBattles, type PlayerBattleOutcome, type TurnHooks } from '../../campaign/controller';
import { scriptedAI } from '../../campaign/ai';
import { AUTO_SCALE, prepareBattle } from '../../campaign/battles';
import { assault, makeBattle, moveArmy } from '../../campaign/actions';
import { findPath, reachable } from '../../campaign/rules';
import { armyById, playerEvents } from '../../campaign/state';
import { armyVisible, visibleRegions } from '../../campaign/vision';
import { regionDef } from '../../campaign/regions';
import { detachHero, heroById, heroReach, heroes, heroesNewToll, heroVision, moveHero } from '../../campaign/heroes';
import { simulate } from '../../sim/pool';
import { go, loadRaw, remove, save, settings } from '../store';
import { factionDef } from '../../data/index';
import { audio } from '../../audio/audio';

const SAVE_KEY = 'nailedsun.campaign.v1';

export type Prompt =
  | { kind: 'battle'; pb: PendingBattle; attacking: boolean; resolve: (o: PlayerBattleOutcome) => void }
  | { kind: 'settlement'; army: string; region: string }
  | { kind: 'summary'; turn: number }
  | { kind: 'reports'; reports: BattleReport[] }
  | { kind: 'offer'; deal: Offer; value: DealValue; resolve: (yes: boolean) => void }
  | { kind: 'end' };

/** A deal an AI faction puts to the player; `demand` means the player would pay. */
export type Offer = Deal & { demand?: boolean };

export type Panel = 'none' | 'faction' | 'diplomacy' | 'log' | 'victory' | 'help';

export class CampaignSession {
  version = signal(0);
  selArmy = signal<string | null>(null);
  selRegion = signal<string | null>(null);
  /** A lone hero selected on the map. */
  selHero = signal<string | null>(null);
  prompt = signal<Prompt | null>(null);
  busy = signal<string | null>(null);
  toast = signal<{ text: string; id: number } | null>(null);
  panel = signal<Panel>('none');
  hover: string | null = null;
  hoverArmy: string | null = null;
  path: string[] | null = null;
  private vis: { regions: Set<string>; armies: Set<string> } | null = null;
  private toastId = 0;

  constructor(public s: CampaignState) {}

  get player(): FactionId {
    return this.s.player;
  }

  bump(): void {
    this.vis = null;
    this.version.value++;
  }

  visibility(): { regions: Set<string>; armies: Set<string> } {
    if (this.vis) return this.vis;
    const regions = visibleRegions(this.s, this.player);
    for (const r of heroVision(this.s, this.player)) regions.add(r);
    const armies = new Set(this.s.armies.filter((a) => armyVisible(this.s, this.player, a, regions)).map((a) => a.id));
    this.vis = { regions, armies };
    return this.vis;
  }

  say(text: string): void {
    this.toast.value = { text, id: ++this.toastId };
    const id = this.toastId;
    setTimeout(() => {
      if (this.toast.value?.id === id) this.toast.value = null;
    }, 3200);
  }

  // ------------------------------------------------------------ selection

  selectArmy(id: string | null): void {
    this.selArmy.value = id;
    if (id) this.selHero.value = null;
    if (id) {
      const a = armyById(this.s, id);
      this.selRegion.value = a ? a.region : null;
    }
    this.path = null;
    this.bump();
  }

  selectRegion(id: string | null): void {
    this.selRegion.value = id;
    this.selArmy.value = null;
    this.selHero.value = null;
    this.path = null;
    this.bump();
  }

  reach(): Record<string, number> | null {
    const id = this.selArmy.value;
    if (!id) return null;
    const a = armyById(this.s, id);
    if (!a || a.faction !== this.player || a.moves <= 0) return null;
    return reachable(this.s, a);
  }

  previewPath(to: string | null): void {
    const id = this.selArmy.value;
    const a = id ? armyById(this.s, id) : null;
    if (!a || !to || a.faction !== this.player || to === a.region) {
      this.path = null;
      return;
    }
    const p = findPath(this.s, a, to);
    this.path = p ? [a.region, ...p.map((x) => x.region)] : null;
  }

  // ------------------------------------------------------------- orders

  async moveSelected(to: string): Promise<void> {
    if (this.busy.value) return;
    const id = this.selArmy.value;
    const a = id ? armyById(this.s, id) : null;
    if (!a || a.faction !== this.player) return;
    const r = moveArmy(this.s, a.id, to);
    if (!r.ok) {
      this.say(r.reason);
      return;
    }
    this.path = null;
    this.selRegion.value = a.region;
    this.bump();
    if (r.battle) await this.fightThrough([r.battle], true);
    else if (r.atSettlement) this.prompt.value = { kind: 'settlement', army: a.id, region: r.atSettlement };
  }

  async assaultHere(armyId: string): Promise<void> {
    const r = assault(this.s, armyId);
    if (!r.ok) {
      this.say(r.reason);
      return;
    }
    this.prompt.value = null;
    await this.fightThrough([r.battle], true);
  }

  /** Attack the enemy army standing in the same region. */
  async attackArmyHere(armyId: string): Promise<void> {
    const a = armyById(this.s, armyId);
    if (!a) return;
    const pb = makeBattle(this.s, a, a.from ?? a.region, a.region);
    await this.fightThrough([pb], true);
  }

  // ----------------------------------------------------------- lone heroes

  selectHero(id: string | null): void {
    this.selHero.value = id;
    this.selArmy.value = null;
    const h = id ? heroById(this.s, id) : null;
    if (h) this.selRegion.value = h.region;
    this.path = null;
    this.bump();
  }

  /** Where the selected hero can travel this Toll. */
  heroReach(): Record<string, number> | null {
    const h = this.selHero.value ? heroById(this.s, this.selHero.value) : null;
    return h && h.faction === this.player ? heroReach(this.s, h) : null;
  }

  heroOrder(r: { ok: boolean; reason?: string }): void {
    if (!r.ok && r.reason) this.say(r.reason);
    this.save();
    this.bump();
  }

  moveHeroTo(region: string): void {
    const id = this.selHero.value;
    if (!id || this.busy.value) return;
    const r = moveHero(this.s, id, region);
    if (r.ok) this.selRegion.value = region;
    this.heroOrder(r);
  }

  /** Send a hero out of an army: it is selected, ready to travel next Toll. */
  sendHero(armyId: string, index: number): void {
    const before = new Set(heroes(this.s).map((h) => h.id));
    const r = detachHero(this.s, armyId, index);
    this.heroOrder(r);
    const h = heroes(this.s).find((x) => !before.has(x.id));
    if (h) this.selectHero(h.id);
  }

  /** An AI faction puts a deal to the player: resolves true if they accept. */
  askOffer(deal: Offer, value: DealValue): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.prompt.value = {
        kind: 'offer',
        deal,
        value,
        resolve: (yes) => {
          this.prompt.value = null;
          resolve(yes);
        },
      };
    });
  }

  private hooks(attacking: boolean): TurnHooks {
    return {
      playerBattle: (_s, pb) =>
        new Promise<PlayerBattleOutcome>((resolve) => {
          this.prompt.value = { kind: 'battle', pb, attacking: attacking && pb.attacker.faction === this.player, resolve };
        }),
      progress: (f) => {
        this.busy.value = `${factionDef(f).name} are moving…`;
      },
    };
  }

  private async fightThrough(pbs: PendingBattle[], attacking: boolean): Promise<void> {
    const reports = await resolveBattles(this.s, pbs, this.hooks(attacking));
    this.afterBattles(reports);
  }

  private afterBattles(reports: BattleReport[]): void {
    this.bump();
    const mine = reports.filter((r) => r.attacker === this.player || r.defender === this.player);
    if (mine.length) {
      this.prompt.value = { kind: 'reports', reports: mine };
      // Fought battles already sounded their ending on the field.
      const last = mine[mine.length - 1]!;
      if (!last.fought) audio.battleEnd(last.winner === this.player);
    }
    else if (this.prompt.value?.kind === 'battle') this.prompt.value = null;
  }

  /** The player chose: fight it on the field. */
  fight(p: Extract<Prompt, { kind: 'battle' }>, driftChoice?: 'sack' | 'moor'): void {
    const prep = prepareBattle(this.s, p.pb, { auto: false, unitScale: settings.value.unitScale });
    const place = regionDef(p.pb.region).settlement || regionDef(p.pb.region).name;
    this.prompt.value = null;
    go({
      name: 'battle',
      req: {
        setup: prep.setup,
        playerSide: prep.playerSide ?? 0,
        mode: 'campaign',
        title: `Battle of ${place}`,
        onDone: (result: BattleResult) => {
          p.resolve({ prep, result, fought: true, driftChoice });
          go({ name: 'campaign' });
        },
      },
    });
  }

  /** The player chose: let the simulation decide. */
  async auto(p: Extract<Prompt, { kind: 'battle' }>, driftChoice?: 'sack' | 'moor'): Promise<void> {
    const prep = prepareBattle(this.s, p.pb, { auto: true, unitScale: AUTO_SCALE });
    this.busy.value = 'The battle is joined…';
    this.prompt.value = null;
    const result = await simulate(prep.setup);
    this.busy.value = null;
    p.resolve({ prep, result, fought: false, driftChoice });
  }

  /** The player backs off from an attack they started. */
  standDown(p: Extract<Prompt, { kind: 'battle' }>): void {
    this.prompt.value = null;
    p.resolve({ prep: null as never, result: null as never, fought: false, cancelled: true });
  }

  // --------------------------------------------------------------- turns

  async endToll(): Promise<void> {
    if (this.busy.value || this.s.winner) return;
    this.selArmy.value = null;
    this.selHero.value = null;
    this.path = null;
    this.busy.value = 'The world turns…';
    audio.toll();
    try {
      await endTurn(this.s, this.hooks(false), scriptedAI);
      heroesNewToll(this.s);
    } finally {
      this.busy.value = null;
    }
    this.save();
    this.bump();
    if (this.s.winner || !this.s.factions[this.player].alive) this.prompt.value = { kind: 'end' };
    else if (playerEvents(this.s, this.s.turn - 1).length || playerEvents(this.s).length) this.prompt.value = { kind: 'summary', turn: this.s.turn };
  }

  save(): boolean {
    return save(SAVE_KEY, this.s);
  }
}

export let active: CampaignSession | null = null;

function expose(): void {
  // For automated checks in the browser.
  (globalThis as unknown as { __camp?: CampaignSession | null }).__camp = active;
}

export function startCampaign(faction: FactionId, difficulty: CampaignState['difficulty'], seed: number): CampaignSession {
  const s = newCampaign({ faction, difficulty, seed });
  active = new CampaignSession(s);
  active.save();
  active.prompt.value = { kind: 'summary', turn: 1 };
  expose();
  return active;
}

export function savedCampaign(): CampaignState | null {
  const s = loadRaw<CampaignState>(SAVE_KEY);
  return s && s.version === 1 && s.factions && s.regions ? s : null;
}

export function continueCampaign(): CampaignSession | null {
  const s = savedCampaign();
  if (!s) return null;
  active = new CampaignSession(s);
  expose();
  return active;
}

/** Picks up a campaign carried over from before the page was updated. */
export function resumeCampaign(s: CampaignState): CampaignSession {
  active = new CampaignSession(s);
  expose();
  return active;
}

/** The saved campaign as a file, to keep or to carry to another device. */
export function campaignFile(): { name: string; json: string } | null {
  const s = active?.s ?? savedCampaign();
  if (!s) return null;
  return { name: `nailed-sun-${s.player}-toll-${s.turn}.json`, json: JSON.stringify({ kind: 'nailed-sun-campaign', version: 1, state: s }) };
}

/** Read a campaign file: the state if it is one, or what is wrong with it. */
export function readCampaignFile(text: string): { state: CampaignState } | { error: string } {
  let j: { kind?: string; state?: CampaignState };
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    return { error: 'That file is not a campaign save.' };
  }
  const s = j?.kind === 'nailed-sun-campaign' ? j.state : undefined;
  if (!s || s.version !== 1 || !s.factions || !s.regions || !s.player) return { error: 'That file is not a Nailed Sun campaign save.' };
  return { state: s };
}

/** Make a campaign from a file the saved campaign. False if this browser would not store it. */
export function importCampaign(s: CampaignState): boolean {
  if (!save(SAVE_KEY, s)) return false;
  active = null;
  return true;
}

export function abandonCampaign(): void {
  active = null;
  remove(SAVE_KEY);
}

export function leaveCampaign(): void {
  active?.save();
  active = null;
}

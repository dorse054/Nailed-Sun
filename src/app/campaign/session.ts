/**
 * The live campaign: its state, what the player has selected, the map
 * view, and the turn flow. It outlives the campaign screen, which unmounts
 * while the player fights a battle and remounts after.
 */
import { signal } from '@preact/signals';
import type { FactionId } from '../../data/schema';
import type { BattleResult } from '../../sim/types';
import type { BattleReport, CampaignState, PendingBattle } from '../../campaign/types';
import { newCampaign } from '../../campaign/setup';
import { endTurn, resolveBattles, type PlayerBattleOutcome, type TurnHooks } from '../../campaign/controller';
import { scriptedAI } from '../../campaign/ai';
import { AUTO_SCALE, prepareBattle } from '../../campaign/battles';
import { assault, makeBattle, moveArmy } from '../../campaign/actions';
import { findPath, reachable } from '../../campaign/rules';
import { armyById, playerEvents } from '../../campaign/state';
import { armyVisible, visibleRegions } from '../../campaign/vision';
import { regionDef } from '../../campaign/regions';
import { simulate } from '../../sim/pool';
import { go, loadRaw, remove, save, settings } from '../store';
import { factionDef } from '../../data/index';

const SAVE_KEY = 'nailedsun.campaign.v1';

export type Prompt =
  | { kind: 'battle'; pb: PendingBattle; attacking: boolean; resolve: (o: PlayerBattleOutcome) => void }
  | { kind: 'settlement'; army: string; region: string }
  | { kind: 'summary'; turn: number }
  | { kind: 'reports'; reports: BattleReport[] }
  | { kind: 'end' };

export type Panel = 'none' | 'faction' | 'diplomacy' | 'log' | 'victory' | 'help';

export class CampaignSession {
  version = signal(0);
  selArmy = signal<string | null>(null);
  selRegion = signal<string | null>(null);
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
    if (mine.length) this.prompt.value = { kind: 'reports', reports: mine };
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
    this.path = null;
    this.busy.value = 'The world turns…';
    try {
      await endTurn(this.s, this.hooks(false), scriptedAI);
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

export function abandonCampaign(): void {
  active = null;
  remove(SAVE_KEY);
}

export function leaveCampaign(): void {
  active?.save();
  active = null;
}

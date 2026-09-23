/**
 * Headless campaign: every faction played by the scripted AI, battles
 * auto-resolved. Checks the campaign runs start to finish and prints how
 * the factions fare over time.
 *
 *   npx tsx tools/campaign-sim.ts [seed] [tolls] [scale]
 */
import { newCampaign } from '../src/campaign/setup';
import { endTurn, resolveBattles, type TurnHooks } from '../src/campaign/controller';
import { scriptedAI } from '../src/campaign/ai';
import { prepareBattle } from '../src/campaign/battles';
import { simulateNow } from '../src/sim/pool';
import { FACTION_IDS } from '../src/data/schema';
import { ownedRegions } from '../src/campaign/state';
import { armyPower } from '../src/campaign/rules';
import { factionLedger, ledgerNet } from '../src/campaign/turn';
import { chainDef } from '../src/campaign/buildings';

const seed = Number(process.argv[2] ?? 1);
const tolls = Number(process.argv[3] ?? 60);
const scale = Number(process.argv[4] ?? 0.25);
/** SIM_VERBOSE=1 also prints each Toll's world news (captures, wars, Tilt, victory stages). */
const verbose = !!process.env.SIM_VERBOSE;

const s = newCampaign({ faction: 'vesperate', seed });
// The "player" is played by the AI too.
const hooks: TurnHooks = {
  async playerBattle(st, pb) {
    const prep = prepareBattle(st, pb, { auto: true, unitScale: scale });
    return { prep, result: simulateNow(prep.setup), fought: false };
  },
  // The AI-played "player" answers offers as an AI faction would.
  async offer(_st, _deal, value) {
    return value.value >= 0;
  },
};

// s.reports keeps only the last 60 battles: count them by id instead.
const seen = new Set<string>();
let battles = 0;
const countReports = () => {
  for (const r of s.reports) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    battles++;
  }
};

const history: { turn: number; tilt: number; regions: Record<string, number> }[] = [];
// First Toll each faction reached a milestone.
const firsts: Record<string, Record<string, number>> = Object.fromEntries(FACTION_IDS.map((f) => [f, {}]));
const mark = (f: string, what: string) => {
  firsts[f]![what] ??= s.turn;
};
const milestones = () => {
  for (const f of FACTION_IDS) {
    const fs = s.factions[f];
    const slots = [...Object.values(s.regions).filter((r) => r.owner === f).flatMap((r) => r.slots), ...s.armies.filter((a) => a.faction === f).flatMap((a) => a.city?.slots ?? [])];
    if (slots.some((x) => x && x.level > 0 && chainDef(x.chain).kind === 'wonder')) mark(f, 'wonder');
    if (fs.colossus.built) mark(f, 'colossus');
    if (fs.finalStage) mark(f, 'final');
    if (!fs.alive) mark(f, 'fell');
    if (f === 'drift' && fs.res >= 1000) mark(f, 'renown1000');
  }
  if (s.tilt !== 0) mark('world', `tilt${s.tilt > 0 ? '+' : '-'}1`);
  if (Math.abs(s.tilt) >= 2) mark('world', `tilt${s.tilt > 0 ? '+' : '-'}2`);
  if (Math.abs(s.tilt) >= 3) mark('world', `tilt${s.tilt > 0 ? '+' : '-'}3`);
};
firsts.world = {};
const t0 = Date.now();
for (let t = 0; t < tolls && !s.winner; t++) {
  // The player's own Toll, played by the AI.
  await scriptedAI(s, s.player, { battles: (pbs) => resolveBattles(s, pbs, hooks) });
  countReports();
  await endTurn(s, hooks, scriptedAI);
  countReports();
  milestones();
  if (verbose) {
    // The big news of the Toll that just ended.
    for (const e of s.events) {
      if (e.turn !== s.turn - 1 || e.faction || e.kind === 'battle' || e.kind === 'info' || e.kind === 'loss') continue;
      console.log(`    T${e.turn} [${e.kind}] ${e.text}`);
    }
  }
  if (s.turn % 5 === 0 || s.winner) {
    const regions: Record<string, number> = {};
    const row = FACTION_IDS.map((f) => {
      const fs = s.factions[f];
      const arm = s.armies.filter((a) => a.faction === f);
      const pow = Math.round(arm.reduce((x, a) => x + armyPower(a), 0) / 1000);
      const units = arm.reduce((x, a) => x + a.units.length, 0);
      regions[f] = ownedRegions(s, f).length;
      const net = ledgerNet(factionLedger(s, f));
      return `${f.slice(0, 4)}:${fs.alive ? '' : 'DEAD '}r${regions[f]} a${arm.length}/${units}u(${pow}k) c${Math.round(fs.coin)}${net.coin >= 0 ? '+' : ''}${Math.round(net.coin)} f${Math.round(fs.food)}${net.food >= 0 ? '+' : ''}${Math.round(net.food)} x${Math.round(fs.res)}${fs.finalStage ? ' FINAL' : ''}`;
    }).join(' | ');
    history.push({ turn: s.turn, tilt: s.tilt, regions });
    const wars = Object.entries(s.relations)
      .filter(([k, r]) => r.stance === 'war' && k.split('|').every((f) => s.factions[f as 'choir'].alive))
      .map(([k]) => k.split('|').map((f) => f.slice(0, 1).toUpperCase()).join(''));
    console.log(`T${String(s.turn).padStart(3)} tilt ${s.tilt}(${Math.round(s.tiltProgress)}) free ${ownedRegions(s, 'free').length} battles ${battles} wars ${wars.join(',') || '-'} | ${row}`);
  }
}
console.log(`winner: ${JSON.stringify(s.winner)} after ${((Date.now() - t0) / 1000).toFixed(0)} s, ${battles} battles`);
const kinds: Record<string, number> = {};
for (const e of s.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
console.log(kinds);
console.log('regions by Toll:', FACTION_IDS.map((f) => `${f.slice(0, 4)} ${history.map((h) => h.regions[f]).join(',')}`).join(' | '));
console.log('tilt by Toll:', history.map((h) => `T${h.turn}:${h.tilt}`).join(' '));
console.log('firsts:', Object.entries(firsts).map(([f, m]) => `${f.slice(0, 5)} ${Object.entries(m).map(([k, t]) => `${k}@${t}`).join(' ') || '-'}`).join(' | '));
for (const e of s.events.slice(-25)) console.log(`  T${e.turn} [${e.kind}] ${e.text}`);

/**
 * Headless campaign: every faction played by the scripted AI, battles
 * auto-resolved. Checks the campaign runs start to finish.
 *
 *   npx tsx tools/campaign-sim.ts [seed] [tolls] [scale]
 */
import { newCampaign } from '../src/campaign/setup';
import { endTurn, type TurnHooks } from '../src/campaign/controller';
import { scriptedAI } from '../src/campaign/ai';
import { prepareBattle } from '../src/campaign/battles';
import { simulateNow } from '../src/sim/pool';
import { FACTION_IDS } from '../src/data/schema';
import { ownedRegions } from '../src/campaign/state';
import { armyPower } from '../src/campaign/rules';

const seed = Number(process.argv[2] ?? 1);
const tolls = Number(process.argv[3] ?? 60);
const scale = Number(process.argv[4] ?? 0.25);

const s = newCampaign({ faction: 'vesperate', seed });
// The "player" is played by the AI too.
const hooks: TurnHooks = {
  async playerBattle(st, pb) {
    const prep = prepareBattle(st, pb, { auto: true, unitScale: scale });
    return { prep, result: simulateNow(prep.setup), fought: false };
  },
};

let battles = 0;
const t0 = Date.now();
for (let t = 0; t < tolls && !s.winner; t++) {
  const before = s.reports.length;
  // The player's own Toll, played by the AI.
  await scriptedAI(s, s.player, { battles: async (pbs) => {
    const { resolveBattles } = await import('../src/campaign/controller');
    return resolveBattles(s, pbs, hooks);
  } });
  await endTurn(s, hooks, scriptedAI);
  battles += s.reports.length - before;
  if (s.turn % 5 === 0 || s.winner) {
    const row = FACTION_IDS.map((f) => {
      const fs = s.factions[f];
      const arm = s.armies.filter((a) => a.faction === f);
      const pow = Math.round(arm.reduce((x, a) => x + armyPower(a), 0) / 1000);
      return `${f.slice(0, 4)}:${fs.alive ? '' : 'DEAD '}r${ownedRegions(s, f).length} a${arm.length}(${pow}k) c${Math.round(fs.coin)} f${Math.round(fs.food)} x${Math.round(fs.res)}`;
    }).join(' | ');
    console.log(`T${String(s.turn).padStart(3)} tilt ${s.tilt}(${Math.round(s.tiltProgress)}) free ${ownedRegions(s, 'free').length} battles ${battles} | ${row}`);
  }
}
console.log(`winner: ${JSON.stringify(s.winner)} after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const kinds: Record<string, number> = {};
for (const e of s.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
console.log(kinds);
for (const e of s.events.slice(-25)) console.log(`  T${e.turn} [${e.kind}] ${e.text}`);

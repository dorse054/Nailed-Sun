/**
 * Replay a saved battle headlessly and print what every unit did.
 *
 *   npx tsx tools/replay.ts <replay.json>
 *
 * Replay files come from "Save replay" on the results screen. The AI is
 * re-run wherever it played, exactly as the game's replay viewer does.
 */
import fs from 'node:fs';
import { Battle } from '../src/sim/battle';
import { BattleAI } from '../src/ai/battleAI';
import { dataFingerprint, parseReplay } from '../src/app/replayFile';

const path = process.argv[2];
if (!path) {
  console.error('usage: npx tsx tools/replay.ts <replay.json>');
  process.exit(1);
}
const parsed = parseReplay(fs.readFileSync(path, 'utf8'));
if ('error' in parsed) {
  console.error(parsed.error);
  process.exit(1);
}
const { file, sameBuild } = parsed;
if (!sameBuild) console.warn(`Recorded with data ${file.build}; this build is ${dataFingerprint()}. The battle may play out differently.\n`);

const b = new Battle(file.setup, { replay: file.log });
for (const side of [0, 1] as const) {
  if (side !== file.playerSide || file.setup.armies[side].controller === 'ai') b.setController(side, new BattleAI());
}
const r = b.run();
const reason = r.reason === 'rout' ? 'decided by rout' : r.reason === 'timeout' ? 'time ran out' : r.reason;
console.log(`${r.winner === -1 ? 'Stalemate' : `Side ${r.winner} wins`} at ${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')}, ${reason}. ${file.log.length} player orders.\n`);
for (const side of [0, 1] as const) {
  const s = r.sides[side];
  console.log(`Side ${side}${side === file.playerSide ? ' (player)' : ''}: ${s.faction}, lost ${s.soldiersLost} of ${s.soldiersStart}`);
  for (const u of s.units) {
    console.log(`  ${u.name.padEnd(28)} ${`${u.alive}/${u.start}`.padStart(8)}  kills ${String(u.kills).padStart(4)}  damage ${String(Math.round(u.damageDealt)).padStart(7)}  ${u.state}`);
  }
  console.log('');
}

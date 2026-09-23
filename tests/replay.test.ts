/**
 * Replay files: what "Save replay" writes must read back, and must replay
 * the same battle when the AI is re-run where it played.
 */
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/sim/battle';
import { BattleAI } from '../src/ai/battleAI';
import type { TimedCommand } from '../src/sim/types';
import { dataFingerprint, parseReplay, replayJson } from '../src/app/replayFile';
import { makeSetup, outcome } from './helpers';

const setup = () =>
  makeSetup({
    seed: 11,
    timeLimit: 240,
    armies: [
      { faction: 'vesperate', units: ['vesperate.maren', 'vesperate.lanternGuard', 'vesperate.vesperArbalests'] },
      { faction: 'hush', units: ['hush.queenYsh', 'hush.rimeguard', 'hush.hushbows'], controller: 'ai' },
    ],
  });

describe('replay files', () => {
  it('round-trips the setup, the orders and the player side', () => {
    const s = setup();
    const log: TimedCommand[] = [{ tick: 40, side: 0, cmd: { type: 'halt', unit: 1 } }];
    const r = parseReplay(replayJson(s, log, 0));
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.sameBuild).toBe(true);
    expect(r.file.build).toBe(dataFingerprint());
    expect(r.file.setup).toEqual(JSON.parse(JSON.stringify(s)));
    expect(r.file.log).toEqual(log);
    expect(r.file.playerSide).toBe(0);
  });

  it('rejects files that are not replays, damaged, or name unknown units', () => {
    expect(parseReplay('not json')).toHaveProperty('error');
    expect(parseReplay('{"kind":"other"}')).toHaveProperty('error');
    expect(parseReplay(JSON.stringify({ kind: 'nailed-sun-replay', version: 1, setup: { armies: [] }, log: [] }))).toHaveProperty('error');
    const s = setup();
    s.armies[1].units[1]!.def = 'hush.noSuchUnit';
    expect(parseReplay(replayJson(s, [], 0))).toHaveProperty('error');
  });

  it('flags a replay recorded with other game data', () => {
    const j = JSON.parse(replayJson(setup(), [], 0));
    j.build = '00000000';
    const r = parseReplay(JSON.stringify(j));
    expect('error' in r ? null : r.sameBuild).toBe(false);
  });

  it('replays the same battle from the file', () => {
    const play = (json: string) => {
      const r = parseReplay(json);
      if ('error' in r) throw new Error(r.error);
      const b = new Battle(r.file.setup, { replay: r.file.log });
      for (const side of [0, 1] as const) if (side !== r.file.playerSide || r.file.setup.armies[side].controller === 'ai') b.setController(side, new BattleAI());
      b.run();
      return outcome(b);
    };
    // The "player" orders its line forward at 5 s; the AI plays the other side.
    const s = setup();
    const log: TimedCommand[] = [{ tick: 100, side: 0, cmd: { type: 'move', unit: 1, x: 500, y: 400 } }];
    const json = replayJson(s, log, 0);
    expect(play(json)).toEqual(play(json));
  });
});

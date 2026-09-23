import type { BattleRequest } from '../store';
import { go } from '../store';
import type { BattleResult, BattleSetup, SideSummary, TimedCommand } from '../../sim/types';
import { factionDef, unitDef } from '../../data/index';
import { UnitIcon } from '../../ui/UnitIcon';

function fmt(t: number): string {
  return `${Math.floor(t / 60)}:${Math.floor(t % 60)
    .toString()
    .padStart(2, '0')}`;
}

const STATE_LABEL: Record<string, string> = {
  ready: 'Holding',
  routing: 'Routing',
  shattered: 'Shattered',
  dead: 'Destroyed',
  fled: 'Fled',
  embarked: 'Aboard',
};

export function Results({ req, result, log, setup }: { req: BattleRequest; result: BattleResult; log: TimedCommand[]; setup: BattleSetup }) {
  const me = req.playerSide;
  const won = result.winner === me;
  const draw = result.winner === -1;
  const mine = result.sides[me];
  const theirs = result.sides[(1 - me) as 0 | 1];
  const mvp = [...mine.units].sort((a, b) => b.kills - a.kills)[0];
  const replay = () =>
    go({
      name: 'battle',
      req: { setup, playerSide: me, mode: 'replay', skipDeploy: true, replay: log, title: 'Replay' },
    });
  const again = () => {
    const s: BattleSetup = JSON.parse(JSON.stringify(setup));
    for (const u of s.armies[me].units) {
      delete u.x;
      delete u.y;
      delete u.facing;
    }
    s.seed = Math.floor(Math.random() * 1e9);
    go({ name: 'battle', req: { setup: s, playerSide: me, mode: req.mode === 'demo' ? 'demo' : 'custom', skipDeploy: req.mode === 'demo' } });
  };
  return (
    <div class="screen setup-screen scroll">
      <div class="results">
        <div class="panel results-hero">
          <h1 style={{ color: won ? 'var(--gold)' : draw ? 'var(--text)' : 'var(--bad)' }}>{draw ? 'Stalemate' : won ? 'Victory' : 'Defeat'}</h1>
          <div class="muted">
            {factionDef(mine.faction).name} against {factionDef(theirs.faction).name} · {fmt(result.time)} · {result.reason === 'rout' ? 'decided by rout' : result.reason === 'timeout' ? 'time ran out' : result.reason === 'capture' ? 'the settlement fell' : 'the field was conceded'}
          </div>
          {mvp && mvp.kills > 0 && (
            <div>
              Most feared: <b style={{ color: 'var(--gold)' }}>{mvp.name}</b>, {mvp.kills} kills
            </div>
          )}
          <div class="row" style={{ justifyContent: 'center' }}>
            <button class="btn primary" onClick={replay}>
              Watch the replay
            </button>
            <button class="btn" onClick={again}>
              Fight again
            </button>
            <button class="btn" onClick={() => go({ name: 'custom' })}>
              New custom battle
            </button>
            <button class="btn ghost" onClick={() => go({ name: 'menu' })}>
              Main menu
            </button>
          </div>
        </div>
        <div class="results-sides">
          <SideTable title="Your army" s={mine} side={me} />
          <SideTable title="The enemy" s={theirs} side={(1 - me) as 0 | 1} />
        </div>
        <p class="muted" style={{ textAlign: 'center', fontSize: '12.5px' }}>
          Every battle is a fixed 20-tick simulation with seeded randomness: the replay re-runs your {log.length} orders against the same seed and plays out exactly the same.
        </p>
      </div>
    </div>
  );
}

function SideTable({ title, s, side }: { title: string; s: SideSummary; side: 0 | 1 }) {
  const lostPct = Math.round((s.soldiersLost / Math.max(1, s.soldiersStart)) * 100);
  return (
    <section class="panel" style={{ padding: '12px' }}>
      <div class="spread">
        <h2 style={{ fontSize: '24px' }}>{title}</h2>
        <span class="chip num">
          {s.soldiersLost} of {s.soldiersStart} lost ({lostPct}%)
        </span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Unit</th>
              <th class="r">Alive</th>
              <th class="r">Kills</th>
              <th class="r">Damage</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {s.units.map((u) => (
              <tr key={u.id}>
                <td>
                  <span class="row" style={{ gap: '6px', flexWrap: 'nowrap' }}>
                    <UnitIcon def={unitDef(u.def)} size={22} side={side} />
                    {u.name}
                  </span>
                </td>
                <td class="r">
                  {u.alive}/{u.start}
                </td>
                <td class="r">{u.kills}</td>
                <td class="r">{u.damageDealt.toLocaleString()}</td>
                <td class={`state-${u.state}`}>{STATE_LABEL[u.state] ?? u.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

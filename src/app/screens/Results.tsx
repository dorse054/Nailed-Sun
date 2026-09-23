import type { BattleRequest } from '../store';
import { go } from '../store';
import type { BattleResult, BattleSetup, SideSummary, TimedCommand } from '../../sim/types';
import { LANDMARKS } from '../../campaign/regions';
import { factionDef, unitDef } from '../../data/index';
import { UnitIcon } from '../../ui/UnitIcon';
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { saveFile } from '../claude';
import { replayJson, replayName } from '../replayFile';
import { clock, type Moment } from '../battle/moments';
import { Moments, TaleOf } from '../battle/Tale';
import { legendById, medalFor } from '../legends';
import { book } from '../book';
import { MEDAL_WORDS, MedalChip } from './Legends';

/** What happened to the last "Save replay". */
const saved = signal<string | null>(null);

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

/** Where a battle was fought, if at a landmark, as it reads mid-sentence. */
function placeName(map: BattleSetup['map']): string | null {
  const lm = map.landmark;
  if (!lm) return null;
  if (lm === 'candle') return map.glow ? 'a lit Candle' : 'a dead Candle';
  if (lm === 'umbralVale') return 'an Umbral Vale';
  return LANDMARKS[lm].name.replace(/^The /, 'the ');
}

export function Results({ req, result, log, setup, moments = [], strength = [] }: { req: BattleRequest; result: BattleResult; log: TimedCommand[]; setup: BattleSetup; moments?: Moment[]; strength?: [number, number, number][] }) {
  const me = req.playerSide;
  const legend = req.legend ? legendById(req.legend) : undefined;
  const won = result.winner === me;
  const draw = result.winner === -1;
  const mine = result.sides[me];
  const theirs = result.sides[(1 - me) as 0 | 1];
  const mvp = [...mine.units].sort((a, b) => b.kills - a.kills)[0];
  // A new battle starts with no save notice.
  useEffect(() => {
    saved.value = null;
  }, [result]);
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
    // A new battle: the enemy general thinks it over again.
    for (const a of s.armies) delete a.plan;
    go({ name: 'battle', req: { setup: s, playerSide: me, mode: req.mode === 'demo' ? 'demo' : 'custom', skipDeploy: req.mode === 'demo', ...(req.briefing ? { title: req.title, briefing: req.briefing } : {}), ...(req.legend ? { legend: req.legend } : {}) } });
  };
  return (
    <div class="screen setup-screen scroll">
      <div class="results">
        <div class="panel results-hero">
          <h1 style={{ color: won ? 'var(--gold)' : draw ? 'var(--text)' : 'var(--bad)' }}>{draw ? 'Stalemate' : won ? 'Victory' : 'Defeat'}</h1>
          <div class="muted">
            {factionDef(mine.faction).name} against {factionDef(theirs.faction).name}
            {placeName(setup.map) ? ` at ${placeName(setup.map)}` : ''} · {fmt(result.time)} · {result.reason === 'rout' ? 'decided by rout' : result.reason === 'timeout' ? 'time ran out' : result.reason === 'capture' ? 'the settlement fell' : 'the field was conceded'}
          </div>
          {legend && (
            <div class="legend-medal">
              <b>{legend.title}</b>: {medalFor(legend, result, me) ? <MedalChip medal={medalFor(legend, result, me)} /> : <span class="medal none">No medal this time</span>} <span class="muted">Best: {book.value.legends?.[legend.id] ? MEDAL_WORDS[book.value.legends[legend.id]!] : 'none yet'}.</span>
              <div class="muted">{legend.lesson}</div>
            </div>
          )}
          {mvp && mvp.kills > 0 && (
            <div>
              Most feared: <b style={{ color: 'var(--gold)' }}>{mvp.name}</b>, {mvp.kills} kills
            </div>
          )}
          <div class="row" style={{ justifyContent: 'center' }}>
            <button class="btn primary" onClick={replay}>
              Watch the replay
            </button>
            <button
              class="btn"
              onClick={async () => {
                const r = await saveFile(replayName(setup), replayJson(setup, log, me));
                saved.value = r === 'saved' ? 'Replay saved.' : r === 'declined' ? null : 'The replay could not be saved here.';
              }}
              title="A small file with the battle and your orders: share it in a bug report and it replays exactly."
            >
              Save replay
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
        {(moments.length > 0 || null) && (
          <div class="panel results-story">
            {/* A replay's tale was the battle's to tell, from its own report. */}
            {req.mode !== 'replay' && <TaleOf key={String(setup.seed)} setup={setup} result={result} moments={moments} player={me} title={req.title} />}
            <StrengthChart strength={strength} moments={moments} me={me} end={result.time} />
            <Moments moments={moments} />
          </div>
        )}
        <div class="results-sides">
          <SideTable title="Your army" s={mine} side={me} />
          <SideTable title="The enemy" s={theirs} side={(1 - me) as 0 | 1} />
        </div>
        {saved.value && (
          <p class="muted" role="status" style={{ textAlign: 'center' }}>
            {saved.value}
          </p>
        )}
        <p class="muted" style={{ textAlign: 'center', fontSize: '12.5px' }}>
          Every battle is a fixed 20-tick simulation with seeded randomness: the replay re-runs your {log.length} orders against the same seed and plays out exactly the same.
        </p>
      </div>
    </div>
  );
}

/**
 * Each army's strength through the battle, the player's in blue and the
 * enemy's in red, with a tick at every turning point (hover for what it was).
 */
function StrengthChart({ strength, moments, me, end }: { strength: [number, number, number][]; moments: Moment[]; me: 0 | 1; end: number }) {
  if (strength.length < 3 || end <= 0) return null;
  const W = 600;
  const H = 110;
  const pad = 4;
  const x = (t: number) => pad + (Math.min(end, t) / end) * (W - pad * 2);
  const y = (v: number) => pad + (1 - Math.max(0, Math.min(1, v))) * (H - pad * 2 - 12);
  const line = (side: 1 | 2) => strength.map((p) => `${x(p[0]).toFixed(1)},${y(p[side]).toFixed(1)}`).join(' ');
  const mineIdx = (me === 0 ? 1 : 2) as 1 | 2;
  const theirsIdx = (me === 0 ? 2 : 1) as 1 | 2;
  return (
    <figure class="strength-chart">
      <figcaption class="muted">
        Strength through the battle: <b class="mine">yours</b> and <b class="theirs">theirs</b>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Each army's remaining strength over the battle">
        <line x1={pad} x2={W - pad} y1={y(0.5)} y2={y(0.5)} class="grid" />
        <polyline points={line(theirsIdx)} class="theirs" />
        <polyline points={line(mineIdx)} class="mine" />
        {moments.map((m, i) => (
          <line key={i} x1={x(m.t)} x2={x(m.t)} y1={H - 10} y2={H - 2} class={`tick ${m.side === undefined ? '' : m.side === me ? 'mine' : 'theirs'}`}>
            <title>{`${clock(m.t)} ${m.text}`}</title>
          </line>
        ))}
      </svg>
    </figure>
  );
}

/** Enemy value a unit destroyed, as a multiple of its own cost. */
const worth = (u: SideSummary['units'][number]): number | null => (u.valueDealt === undefined || !u.cost ? null : u.valueDealt / u.cost);

function SideTable({ title, s, side }: { title: string; s: SideSummary; side: 0 | 1 }) {
  const lostPct = Math.round((s.soldiersLost / Math.max(1, s.soldiersStart)) * 100);
  // The side's best performer: most enemy value destroyed for its cost, if it earned its keep.
  const best = s.units.reduce<SideSummary['units'][number] | null>((b, u) => ((worth(u) ?? 0) > (b ? worth(b) ?? 0 : 1) ? u : b), null);
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
              <th class="r" title="Enemy value destroyed, as a multiple of the unit's own cost">Worth</th>
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
                    {u === best && (
                      <span class="mvp" title="Destroyed the most enemy value for its cost">
                        ★
                      </span>
                    )}
                  </span>
                </td>
                <td class="r">
                  {u.alive}/{u.start}
                </td>
                <td class="r">{u.kills}</td>
                <td class="r">{u.damageDealt.toLocaleString()}</td>
                <td class="r num">{worth(u) === null ? '—' : `${worth(u)!.toFixed(1)}×`}</td>
                <td class={`state-${u.state}`}>{STATE_LABEL[u.state] ?? u.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

import { useEffect, useState } from 'preact/hooks';
import type { CampaignSession, Prompt } from './session';
import { abandonCampaign, leaveCampaign } from './session';
import type { ArmyState, BattleReport, Owner, PendingBattle } from '../../campaign/types';
import { Moments, TaleOf, ToldTale } from '../battle/Tale';
import { noteCampaign } from '../book';
import { factionDef, unitDef } from '../../data/index';
import { BANDS } from '../../data/rules';
import { FACTION_IDS, WIND_NAMES, type FactionId } from '../../data/schema';
import { regionDef } from '../../campaign/regions';
import { armyById, fmtNum, ownedRegions } from '../../campaign/state';
import { attackerPower, defenderPower, garrisonFor, sunForAttacker } from '../../campaign/battles';
import { armyPower, regionBand, regionWind, wallLevel, battleLeadership } from '../../campaign/rules';
import { demandTribute, setStance } from '../../campaign/actions';
import { garrisonPower } from '../../campaign/battles';
import { victoryStatus } from '../../campaign/victory';
import { effectWords, pendingDilemma, resolveDilemma } from '../../campaign/dilemmas';
import { audio } from '../../audio/audio';
import { UnitIcon } from '../../ui/UnitIcon';
import { OWNER_COLOR } from './campaignMap';
import { go } from '../store';

export function Prompts({ session, focus }: { session: CampaignSession; focus: (r: string) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const p = session.prompt.value;
  if (!p) return session.s.dilemma && !session.busy.value ? <DilemmaPrompt session={session} focus={focus} /> : null;
  switch (p.kind) {
    case 'battle':
      return <BattlePrompt session={session} p={p} focus={focus} />;
    case 'settlement':
      return <SettlementPrompt session={session} army={p.army} region={p.region} />;
    case 'summary':
      return <Summary session={session} />;
    case 'reports':
      return <Reports session={session} p={p} />;
    case 'offer':
      return <OfferPrompt p={p} />;
    case 'end':
      return <End session={session} />;
  }
}

/** A choice the world puts to the player, with its price either way. */
function DilemmaPrompt({ session, focus }: { session: CampaignSession; focus: (r: string) => void }) {
  const d = pendingDilemma(session.s);
  if (!d) return null;
  const choose = (i: 0 | 1) => {
    resolveDilemma(session.s, i);
    audio.ui('click');
    session.bump();
  };
  return (
    <div class="modal-veil">
      <div class="panel modal dilemma" role="dialog" aria-labelledby="dilemma-title">
        <div class="spread">
          <span class="label">Toll {session.s.turn}</span>
          {d.region && (
            <button class="btn small ghost" onClick={() => focus(d.region!)}>
              Show on map
            </button>
          )}
        </div>
        <h2 id="dilemma-title">
          {d.title}
          {d.written && (
            <span class="jev-mark" title="Written by Claude for this moment of your campaign; the game sets what each choice gives and costs">
              ✦ Claude
            </span>
          )}
        </h2>
        <p class="dilemma-text">{d.text}</p>
        <div class="dilemma-choices">
          {d.choices.map((c, i) => (
            <button key={c.label} class={`btn ${i === 0 ? 'primary' : ''}`} onClick={() => choose(i as 0 | 1)}>
              <b>{c.label}</b>
              <span class="small">{effectWords(c.effect, session.s).join(' · ')}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ownerName(o: Owner, region: string): string {
  return o === 'free' ? `Free folk of ${regionDef(region).settlement || regionDef(region).name}` : factionDef(o).name;
}

function Side({ session, title, owner, armies, garrison, region, align }: { session: CampaignSession; title: string; owner: Owner; armies: ArmyState[]; garrison: boolean; region: string; align: 'l' | 'r' }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const g = garrison ? garrisonFor(session.s, region) : [];
  return (
    <div class={`bp-side ${align}`}>
      <span class="label">{title}</span>
      <h3 style={{ color: OWNER_COLOR[owner] }}>{ownerName(owner, region)}</h3>
      {armies.map((a) => (
        <div key={a.id} class="bp-army">
          <div class="muted small">
            {a.name} · {a.lord.name}
          </div>
          <div class="bp-icons">
            <UnitIcon def={unitDef(a.lord.def)} size={24} side={owner === session.player ? 0 : 1} />
            {a.units.map((u, i) => (
              <span key={i} class="bp-u" title={`${unitDef(u.def).name} · ${Math.round(u.strength * 100)}%`}>
                <UnitIcon def={unitDef(u.def)} size={24} side={owner === session.player ? 0 : 1} />
                <i style={{ width: `${u.strength * 100}%` }} />
              </span>
            ))}
          </div>
        </div>
      ))}
      {g.length > 0 && (
        <div class="bp-army">
          <div class="muted small">Garrison</div>
          <div class="bp-icons">
            {g.map((d, i) => (
              <UnitIcon key={i} def={unitDef(d)} size={24} side={owner === session.player ? 0 : 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** What an AI faction is putting to the player, in words. */
function offerText(d: Extract<Prompt, { kind: 'offer' }>['deal']): { title: string; body: string } {
  const A = factionDef(d.from).name;
  const coin = d.coin ?? 0;
  switch (d.kind) {
    case 'peace':
      return { title: `${A} offer peace`, body: coin ? `An end to the war, and ${coin} coin besides.` : 'An end to the war between you.' };
    case 'trade':
      return { title: `${A} propose trade`, body: 'Open markets between your lands: coin for both every Toll.' };
    case 'alliance':
      return { title: `${A} propose an alliance`, body: 'Allies share vision and join each other’s wars.' };
    case 'tribute':
      return d.demand
        ? { title: `${A} demand tribute`, body: `They want ${coin} coin a Toll for 10 Tolls. Refusing will anger them.` }
        : { title: `${A} offer tribute`, body: `They will pay you ${coin} coin a Toll for 10 Tolls.` };
    case 'gift':
      return { title: `${A} send a gift`, body: `${coin} coin, as a token of good will.` };
    case 'mooring':
      return { title: `${A} ask for a mooring`, body: `They would tie a wind-city to the walls of ${d.region ? regionDef(d.region).settlement || regionDef(d.region).name : 'one of your towns'}.` };
    case 'vassal':
      return { title: `${A} propose vassalage`, body: 'One of you would bow to the other.' };
    default:
      return { title: `${A} send envoys`, body: `A proposal: ${d.kind}.` };
  }
}

const DEAL_TONE: Record<string, string> = { insult: 'bad', poor: 'bad', fair: 'warn', good: 'good', generous: 'good' };

/** An AI faction puts a deal to the player: accept or refuse. */
function OfferPrompt({ p }: { p: Extract<Prompt, { kind: 'offer' }> }) {
  const d = p.deal;
  const t = offerText(d);
  return (
    <div class="modal-veil">
      <div class="panel modal offer" role="dialog" aria-label={t.title}>
        <span class="label">envoys</span>
        <h2 style={{ color: OWNER_COLOR[d.from] }}>{t.title}</h2>
        <p>{t.body}</p>
        <div class="row">
          <span class={`chip ${DEAL_TONE[p.value.label] ?? ''}`}>For you: {p.value.label}</span>
          {p.value.why.map((w) => (
            <span key={w} class="muted small">
              {w}
            </span>
          ))}
        </div>
        <div class="row" style={{ justifyContent: 'flex-end' }}>
          <button class="btn" onClick={() => p.resolve(false)}>
            Refuse
          </button>
          <button class="btn primary" onClick={() => p.resolve(true)}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

function verdict(ratio: number): { text: string; cls: string } {
  if (ratio > 1.8) return { text: 'Decisive advantage', cls: 'good' };
  if (ratio > 1.2) return { text: 'The advantage is yours', cls: 'good' };
  if (ratio > 0.83) return { text: 'A close fight', cls: 'warn' };
  if (ratio > 0.55) return { text: 'Outmatched', cls: 'bad' };
  return { text: 'Grim odds', cls: 'bad' };
}

function BattlePrompt({ session, p, focus }: { session: CampaignSession; p: Extract<Prompt, { kind: 'battle' }>; focus: (r: string) => void }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const pb: PendingBattle = p.pb;
  const [choice, setChoice] = useState<'sack' | 'moor'>(s.regions[pb.region]!.owner === 'free' ? 'moor' : 'sack');
  const me = session.player;
  const iAttack = pb.attacker.faction === me;
  const atkArmies = pb.attacker.armies.map((id) => armyById(s, id)).filter((a): a is ArmyState => !!a);
  const defArmies = pb.defender.armies.map((id) => armyById(s, id)).filter((a): a is ArmyState => !!a);
  const ap = attackerPower(s, pb);
  const dp = defenderPower(s, pb);
  const mine = iAttack ? ap : dp;
  const theirs = iAttack ? dp : ap;
  const v = verdict(mine / Math.max(1, theirs));
  const band = BANDS[regionBand(s, pb.region)];
  const wind = regionWind(s, pb.region);
  const walls = pb.assault ? wallLevel(s, pb.region) : 0;
  const sun = sunForAttacker(pb.from, pb.region);
  const mySun = iAttack ? sun : sun === 'eyes' ? 'back' : sun === 'back' ? 'eyes' : 'flank';
  const sunText = mySun === 'eyes' ? 'The sun will be in your eyes' : mySun === 'back' ? 'The sun will be at your back' : 'The sun will be on your flank';
  const lead = battleLeadership(s, iAttack ? atkArmies[0] ?? null : defArmies[0] ?? null, me, iAttack ? pb.defender.faction : pb.attacker.faction, pb.region);
  const place = regionDef(pb.region).settlement || regionDef(pb.region).name;
  const driftSettlement = iAttack && me === 'drift' && pb.defender.garrison;
  return (
    <div class="modal-veil">
      <div class="panel modal bp" role="dialog" aria-label={`Battle at ${place}`}>
        <div class="spread">
          <h2>{iAttack ? `Attack on ${place}` : `${place} is attacked!`}</h2>
          <button class="btn ghost small" onClick={() => focus(pb.region)}>
            Show on map
          </button>
        </div>
        <div class="bp-sides">
          <Side session={session} title="Attacker" owner={pb.attacker.faction} armies={atkArmies} garrison={false} region={pb.region} align="l" />
          <div class="bp-vs">vs</div>
          <Side session={session} title="Defender" owner={pb.defender.faction} armies={defArmies} garrison={pb.defender.garrison} region={pb.region} align="r" />
        </div>
        <div class="bp-odds">
          <div class="bp-bar" aria-hidden="true">
            <div class="me" style={{ width: `${(mine / Math.max(1, mine + theirs)) * 100}%` }} />
          </div>
          <b class={v.cls}>{v.text}</b>
          <span class="muted small num">
            {fmtNum(mine)} against {fmtNum(theirs)}
          </span>
        </div>
        <ul class="bp-field">
          <li>
            <b>{band.name}</b>: {['Dark', 'Dim', 'Dusk', 'Bright', 'Blaze'][band.light]} light
          </li>
          <li>
            <b>{WIND_NAMES[wind]}</b>
            {wind ? ', blowing sunward' : ''}
          </li>
          <li>
            <b>{sunText}</b>
            {mySun === 'eyes' && band.light >= 2 ? ': glare will cost your men accuracy' : ''}
          </li>
          {walls > 0 && (
            <li>
              <b>Walls level {walls}</b>: infantry climb slowly, cavalry wait for a gate
            </li>
          )}
          {lead.why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        {driftSettlement && (
          <div class="row">
            <span class="label">If we win</span>
            <button class={`btn small ${choice === 'moor' ? 'on' : ''}`} onClick={() => setChoice('moor')} title="Free the city and tie a mooring to it">
              Moor
            </button>
            <button class={`btn small ${choice === 'sack' ? 'on' : ''}`} onClick={() => setChoice('sack')} title="Take coin and Renown and sail on">
              Sack
            </button>
          </div>
        )}
        <div class="row bp-buttons">
          <button class="btn primary" onClick={() => session.fight(p, driftSettlement ? choice : undefined)}>
            Fight the battle
          </button>
          <button class="btn" onClick={() => void session.auto(p, driftSettlement ? choice : undefined)}>
            Auto-resolve
          </button>
          {p.attacking && (
            <button class="btn ghost" onClick={() => session.standDown(p)}>
              Stand down
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SettlementPrompt({ session, army, region }: { session: CampaignSession; army: string; region: string }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const s = session.s;
  const a = armyById(s, army);
  const def = regionDef(region);
  if (!a) {
    session.prompt.value = null;
    return null;
  }
  const gp = garrisonPower(s, region);
  const ap = armyPower(a);
  const v = verdict(ap / Math.max(1, gp));
  const walls = wallLevel(s, region);
  const close = () => (session.prompt.value = null);
  return (
    <div class="modal-veil">
      <div class="panel modal" role="dialog">
        <h2>{def.settlement}</h2>
        <p>
          {a.name} reaches {def.settlement}
          {walls ? `, behind walls of level ${walls}` : ''}. Its garrison is about {fmtNum(gp)} strong against your {fmtNum(ap)}: <b class={v.cls}>{v.text.toLowerCase()}</b>.
        </p>
        <div class="row">
          <button class="btn primary" onClick={() => void session.assaultHere(army)}>
            Assault
          </button>
          <button
            class="btn"
            onClick={() => {
              setStance(s, army, 'raid');
              close();
              session.bump();
            }}
            title="Loot the countryside each Toll; the owner earns nothing here"
          >
            Raid the countryside
          </button>
          {a.faction === 'drift' && s.regions[region]!.owner === 'free' && (
            <button
              class="btn"
              onClick={() => {
                const r = demandTribute(s, army, armyPower, (x) => garrisonPower(s, x));
                if (!r.ok) session.say(r.reason);
                close();
                session.bump();
              }}
            >
              Demand tribute
            </button>
          )}
          <button class="btn ghost" onClick={close}>
            Wait
          </button>
        </div>
      </div>
    </div>
  );
}

function Summary({ session }: { session: CampaignSession }) {
  const s = session.s;
  const prev = s.turn - 1;
  const seen = session.visibility().regions;
  // Your news, and the world's news where you can see it.
  const events = s.events.filter(
    (e) =>
      (e.turn === prev || e.turn === s.turn) &&
      !(e.kind === 'shudder' && e.turn === 1) &&
      (e.faction === session.player || (!e.faction && (!e.region || seen.has(e.region) || e.kind !== 'battle'))),
  );
  const fd = factionDef(session.player);
  const close = () => (session.prompt.value = null);
  const first = s.turn === 1;
  return (
    <div class="modal-veil" onClick={close}>
      <div class="panel modal summary" role="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{first ? 'The Shudder' : `Toll ${s.turn}`}</h2>
        {first && (
          <div class="summary-intro">
            <p>
              The sun has not moved in a thousand years. Today, it shuddered. You lead <b>{fd.name}</b>.
            </p>
            <p class="muted">{fd.pitch}</p>
            <p>
              <b>Your victory: {fd.victory.name}.</b> {fd.victory.desc}
            </p>
            <p class="muted small">
              {matchMedia('(pointer: coarse)').matches
                ? 'Tap an army, then tap a region to march. Drag to pan and pinch to zoom.'
                : 'Click an army, then click a region to march. Right-click also marches. Enter ends the Toll; Tab cycles your armies.'}
            </p>
          </div>
        )}
        {!first && (
          <ul class="summary-list">
            {events.length === 0 && <li class="muted">A quiet Toll.</li>}
            {events.map((e, i) => (
              <li key={i} class={`ev ev-${e.kind}`}>
                {e.text}
                {e.by === 'jev' && <JevMark />}
              </li>
            ))}
          </ul>
        )}
        <div class="row" style={{ justifyContent: 'flex-end' }}>
          <button class="btn primary" onClick={close} autoFocus>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function Reports({ session, p }: { session: CampaignSession; p: Extract<Prompt, { kind: 'reports' }> }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const close = () => session.closeReports();
  return (
    <div class="modal-veil" onClick={close}>
      <div class="panel modal" role="dialog" onClick={(e) => e.stopPropagation()}>
        {p.reports.map((r) => {
          const won = r.winner === session.player;
          const place = regionDef(r.region).settlement || regionDef(r.region).name;
          const iAtk = r.attacker === session.player;
          return (
            <div key={r.id} class="report">
              <h2 class={won ? 'good' : r.winner === null ? '' : 'bad'}>{r.winner === null ? `Stalemate at ${place}` : won ? `Victory at ${place}` : `Defeat at ${place}`}</h2>
              <p>
                {r.captured && won ? `${place} is ours. ` : ''}
                {r.captured && !won ? `${place} has fallen. ` : ''}
                You lost {iAtk ? r.lossesA : r.lossesD} of {iAtk ? r.startA : r.startD} soldiers; the enemy lost {iAtk ? r.lossesD : r.lossesA} of {iAtk ? r.startD : r.startA}.
                {!r.fought && ' (Auto-resolved.)'}
              </p>
              <ReportStory session={session} r={r} place={place} />
            </div>
          );
        })}
        <div class="row" style={{ justifyContent: 'flex-end' }}>
          <button class="btn primary" onClick={close} autoFocus>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

/** A fought battle's turning points, and its tale when the player asks for it. */
function ReportStory({ session, r, place }: { session: CampaignSession; r: BattleReport; place: string }) {
  const notes = session.notesOf(r);
  if (!notes) return r.tale ? <ToldTale tale={r.tale} /> : null;
  const player = notes.setup.armies.findIndex((a) => a.faction === session.player && a.controller === 'player');
  return (
    <div class="report-story">
      <TaleOf setup={notes.setup} result={notes.result} moments={notes.moments} player={(player === 1 ? 1 : 0) as 0 | 1} title={`The battle at ${place}`} tale={r.tale} onTale={(t) => session.keepTale(r, t)} toll={r.turn} />
      <Moments moments={notes.moments} open={false} />
    </div>
  );
}

/** How the world ends, told the same whether the player won or watched. */
const EPILOGUE: Record<string, string> = {
  choir: 'The Last Lens catches the sun and holds it. Noon spreads from the Nail Spire until no shadow is left anywhere in the world.',
  hush: 'The Candles gutter out one by one. The world turns its face from the sun, and the long night the Hush waited for begins.',
  vesperate: 'The bells ring the Hour, and the Hour holds. The world stays at dusk: balanced, counted and kept.',
  drift: 'The wind-cities gather at the Kite Fields for the Great Moot. The roads belong to whoever can ride the wind, and that is the Drift.',
};

function End({ session }: { session: CampaignSession }) {
  // Signal-aware components skip parent re-renders; subscribe to campaign changes.
  void session.version.value;
  const writing = session.sagaBusy.value;
  useEffect(() => {
    void session.saga();
    const s = session.s;
    noteCampaign(`${s.seed}:${s.player}:${s.difficulty}`, s.player, s.winner?.faction === s.player, s.winner?.turn ?? s.turn);
  }, [session]);
  const s = session.s;
  const w = s.winner;
  const alive = s.factions[session.player].alive;
  const won = w?.faction === session.player;
  const st = victoryStatus(s, session.player);
  const epilogue = w ? (w.kind === 'Domination' ? `${factionDef(w.faction).name} rule the world by force. Whatever the sun does next, it does over their banners.` : EPILOGUE[w.faction]) : null;
  // The winner first, then the living by how close they came, then the fallen.
  const order = [...FACTION_IDS].sort((a, b) => {
    const rank = (f: FactionId) => (w?.faction === f ? 2 : s.factions[f].alive ? 1 : 0);
    return rank(b) - rank(a) || victoryStatus(s, b).progress - victoryStatus(s, a).progress;
  });
  return (
    <div class="modal-veil">
      <div class="panel modal end" role="dialog">
        <h1 class={won ? 'gold' : 'bad'}>{won ? 'Victory' : !alive ? 'Your people are gone' : 'Defeat'}</h1>
        <p class="end-sub">
          {w ? `${factionDef(w.faction).name} win on Toll ${w.turn}: ${w.kind}.` : !alive ? 'Your last army and your last settlement are lost.' : ''}
        </p>
        {epilogue && <p class="end-epilogue">{epilogue}</p>}
        {s.saga ? (
          <section class="end-saga">
            <h2>{s.saga.title}</h2>
            <p>{s.saga.text}</p>
            <span class="jev-mark" title="Written by Claude from this campaign's annals">
              ✦ Claude
            </span>
          </section>
        ) : (
          writing && <p class="end-saga waiting">The chronicler writes the saga of your war…</p>
        )}
        {!won && !w && <p class="muted">{st.desc}</p>}
        <table class="end-standings">
          <thead>
            <tr>
              <th scope="col">Faction</th>
              <th scope="col">Holds</th>
              <th scope="col" title="Battles won and lost">
                Won · lost
              </th>
              <th scope="col">Victory</th>
            </tr>
          </thead>
          <tbody>
            {order.map((f) => {
              const fs = s.factions[f];
              const v = victoryStatus(s, f);
              const held = f === 'drift' ? `${Object.values(s.regions).filter((r) => r.mooring).length} moorings` : `${ownedRegions(s, f).length} regions`;
              return (
                <tr key={f} class={fs.alive ? '' : 'fallen'}>
                  <th scope="row" style={{ color: OWNER_COLOR[f] }}>
                    {factionDef(f).name}
                    {f === session.player && <span class="muted small"> (you)</span>}
                  </th>
                  <td>{fs.alive ? held : 'fallen'}</td>
                  <td class="num" title={`${fs.wins} battles won, ${fs.losses} lost`}>
                    {fs.wins} · {fs.losses}
                  </td>
                  <td>
                    <div class="bar" title={`${v.name}: ${v.lines.filter((l) => l.ok).length} of ${v.lines.length} conditions`}>
                      <div style={{ width: `${Math.round((w?.faction === f ? 1 : v.progress) * 100)}%`, background: w?.faction === f ? 'var(--gold)' : OWNER_COLOR[f] }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p class="muted small">
          {s.turn} Tolls · the Tilt stands {s.tilt === 0 ? 'at the Hour' : `${s.tilt > 0 ? 'sunward' : 'nightward'} (${s.tilt > 0 ? '+' : '−'}${Math.abs(s.tilt)})`}
        </p>
        <div class="row" style={{ justifyContent: 'center' }}>
          <button class="btn" onClick={() => (session.prompt.value = null)}>
            Look at the world
          </button>
          <button
            class="btn primary"
            onClick={() => {
              abandonCampaign();
              go({ name: 'campaign' });
            }}
          >
            New campaign
          </button>
          <button
            class="btn ghost"
            onClick={() => {
              leaveCampaign();
              go({ name: 'menu' });
            }}
          >
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}

/** Marks a choice the AI made on Claude's advice. */
export function JevMark() {
  return (
    <span class="jev-mark" title="This faction's council took Claude's advice">
      ✦ Claude
    </span>
  );
}

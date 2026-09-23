/**
 * After a battle: its turning points, and its tale when the player asks
 * Claude to tell it.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BattleResult, BattleSetup, Side } from '../../sim/types';
import { claudeStatus } from '../claude';
import { clock, type Moment } from './moments';
import { placeOf, tellTale, type Tale } from './claudeTale';
import { addTale } from '../book';

/**
 * Each army's strength through the battle, the player's in blue and the
 * enemy's in red, with a tick at every turning point (hover for what it was).
 */
export function StrengthChart({ strength, moments, me, end }: { strength: [number, number, number][]; moments: Moment[]; me: 0 | 1; end: number }) {
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

export function Moments({ moments, open = true }: { moments: Moment[]; open?: boolean }) {
  if (!moments.length) return null;
  return (
    <details class="moments" open={open}>
      <summary>Turning points</summary>
      <ol>
        {moments.map((m, i) => (
          <li key={i}>
            <span class="num">{clock(m.t)}</span>
            <span>{m.text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ToldTale({ tale }: { tale: Tale }) {
  return (
    <section class="tale">
      <h3>
        {tale.title}
        <span class="jev-mark" title="Told by Claude from the battle's turning points">
          ✦ Claude
        </span>
      </h3>
      <p>{tale.text}</p>
    </section>
  );
}

export function TaleOf({
  setup,
  result,
  moments,
  player,
  title,
  tale,
  onTale,
  toll,
}: {
  setup: BattleSetup;
  result: BattleResult;
  moments: Moment[];
  player: Side;
  title?: string;
  /** A tale already told (a campaign report keeps its tale). */
  tale?: Tale;
  onTale?: (t: Tale) => void;
  /** The campaign Toll, for the book. */
  toll?: number;
}) {
  const [told, setTold] = useState<Tale | null>(tale ?? null);
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  if (told) return <ToldTale tale={told} />;
  const status = claudeStatus.value;
  // Once asked, the answer (or the silence) stays on screen whatever Claude's state.
  if (status !== 'ready' && state === 'idle') return null;
  const ask = async () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 45000);
    setState('busy');
    const t = await tellTale(setup, result, moments, player, title, ctrl.signal);
    clearTimeout(timer);
    if (t) {
      setTold(t);
      onTale?.(t);
      const foe = (1 - player) as Side;
      addTale({
        kind: 'battle',
        title: t.title,
        text: t.text,
        faction: result.sides[player].faction,
        foe: result.sides[foe].faction,
        place: placeOf(setup, title),
        won: result.winner === -1 ? null : result.winner === player,
        ...(toll !== undefined ? { toll } : {}),
      });
    } else setState('failed');
  };
  return (
    <div class="tale-ask">
      <button class="btn" onClick={ask} disabled={state === 'busy' || status !== 'ready'} title="Claude tells this battle as your people's chronicler would">
        {state === 'busy' ? 'The chronicler is writing…' : '✦ Tell the tale'}
      </button>
      {state === 'failed' && <span class="muted">{status === 'refused' ? 'Claude isn’t allowed on this page right now.' : 'The chronicler is silent. Try again later.'}</span>}
    </div>
  );
}

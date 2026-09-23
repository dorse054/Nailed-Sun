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

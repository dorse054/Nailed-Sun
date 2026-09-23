/**
 * The player's chronicles: their record with each faction, and the book of
 * every tale and saga Claude has told them. Kept in this browser.
 */
import { useState } from 'preact/hooks';
import { FACTION_IDS } from '../../data/schema';
import { factionDef } from '../../data/index';
import { book, forgetBook, type BookTale } from '../book';
import { go } from '../store';
import { LEGENDS } from '../legends';

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

function meta(t: BookTale): string {
  const parts: string[] = [];
  const f = factionDef(t.faction).short;
  if (t.kind === 'saga') {
    parts.push(`The saga of ${factionDef(t.faction).name}`);
    parts.push(t.won ? `victory on Toll ${t.toll ?? '?'}` : `ended on Toll ${t.toll ?? '?'}`);
  } else {
    parts.push(t.foe ? `${f} against ${factionDef(t.foe).short}` : f);
    if (t.place) parts.push(t.place);
    parts.push(t.won === null ? 'undecided' : t.won ? 'won' : 'lost');
    if (t.toll !== undefined) parts.push(`Toll ${t.toll}`);
  }
  try {
    parts.push(new Date(t.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  } catch {
    // An odd locale is no reason to hide the tale.
  }
  return parts.join(' · ');
}

/** The Legends won, by medal, with the way to them. */
function LegendsLine() {
  const won = book.value.legends ?? {};
  const n = (m: string) => Object.values(won).filter((x) => x === m).length;
  const count = Object.keys(won).length;
  return (
    <p class="chron-legends">
      <b>Legends</b>{' '}
      {count ? (
        <span class="num">
          {count} of {LEGENDS.length} won · Gold {n('gold')} · Silver {n('silver')} · Bronze {n('bronze')}
        </span>
      ) : (
        <span class="muted">none won yet</span>
      )}{' '}
      <button class="btn small ghost" onClick={() => go({ name: 'legends' })}>
        Legends →
      </button>
    </p>
  );
}

export function Chronicles() {
  const b = book.value;
  const [kind, setKind] = useState<'all' | 'battle' | 'saga'>('all');
  const [confirm, setConfirm] = useState(false);
  const tales = b.tales.filter((t) => kind === 'all' || t.kind === kind);
  const any = FACTION_IDS.some((f) => b.records[f].fought || b.records[f].campaigns);
  return (
    <div class="screen setup-screen scroll">
      <header class="setup-head">
        <button class="btn ghost" onClick={() => go({ name: 'menu' })}>
          ← Menu
        </button>
        <h1>Chronicles</h1>
        <span class="head-spacer" />
      </header>
      <div class="chronicles">
        <section class="panel chron-record">
          <h2>Your record</h2>
          {any ? (
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Faction</th>
                    <th class="r">Battles won</th>
                    <th class="r">Campaigns won</th>
                    <th class="r">Fastest victory</th>
                  </tr>
                </thead>
                <tbody>
                  {FACTION_IDS.map((f) => {
                    const r = b.records[f];
                    return (
                      <tr key={f}>
                        <td>
                          <i class="chron-dot" style={{ background: `var(--${f})` }} />
                          {factionDef(f).name}
                        </td>
                        <td class="r num">
                          {r.won} of {r.fought} <span class="muted">{pct(r.won, r.fought)}</span>
                        </td>
                        <td class="r num">
                          {r.campaignsWon} of {r.campaigns}
                        </td>
                        <td class="r num">{r.fastest ? `Toll ${r.fastest}` : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p class="muted">No battles yet. Every battle you fight to its end, and every campaign you finish, is counted here.</p>
          )}
          <LegendsLine />
        </section>
        <section class="panel chron-book">
          <div class="spread">
            <h2>The book of tales</h2>
            <div class="seg" role="radiogroup" aria-label="Which tales">
              {(
                [
                  ['all', 'All'],
                  ['battle', 'Battles'],
                  ['saga', 'Sagas'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} role="radio" aria-checked={kind === id} class={`btn small ${kind === id ? 'on' : ''}`} onClick={() => setKind(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {tales.length === 0 ? (
            <p class="muted">
              {b.tales.length
                ? 'None of that kind yet.'
                : 'No tales yet. With Claude, after a battle ✦ Tell the tale has it told as your people’s chronicler would, and a campaign that ends with Claude on gets its saga. Both are kept here.'}
            </p>
          ) : (
            tales.map((t) => (
              <article key={`${t.at}${t.title}`} class={`book-tale ${t.kind}`} style={{ '--fc': `var(--${t.faction})` } as never}>
                <h3>{t.title}</h3>
                <div class="muted book-meta">{meta(t)}</div>
                <p>{t.text}</p>
              </article>
            ))
          )}
        </section>
        <p class="muted chron-foot">
          Kept in this browser only.{' '}
          {confirm ? (
            <>
              Forget every record and tale?{' '}
              <button
                class="btn small danger"
                onClick={() => {
                  forgetBook();
                  setConfirm(false);
                }}
              >
                Forget
              </button>{' '}
              <button class="btn small ghost" onClick={() => setConfirm(false)}>
                Keep
              </button>
            </>
          ) : (
            (any || b.tales.length > 0) && (
              <button class="btn small ghost" onClick={() => setConfirm(true)}>
                Forget everything
              </button>
            )
          )}
        </p>
      </div>
    </div>
  );
}

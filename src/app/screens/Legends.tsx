/**
 * Legends: set battles around the design's signature moments. Each shows its
 * story, both sides and the best medal won so far.
 */
import { factionDef } from '../../data/index';
import { LEGENDS, legendRequest, type Legend, type Medal } from '../legends';
import { book } from '../book';
import { dailyLegend, dailyStreak, dayKey, dayName, lowerThe } from '../daily';
import { go, settings } from '../store';
import { audio } from '../../audio/audio';

export const MEDAL_WORDS: Record<Medal, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

/** What each medal asks, in words. */
export function medalTerms(l: Legend): string {
  return `Win for bronze; lose under ${Math.round(l.silver * 100)}% of your soldiers for silver, under ${Math.round(l.gold * 100)}% for gold.`;
}

export function MedalChip({ medal }: { medal: Medal | null | undefined }) {
  if (!medal) return <span class="medal none">No medal yet</span>;
  return <span class={`medal ${medal}`}>{MEDAL_WORDS[medal]}</span>;
}

/** Today's battle: new each day, the same for everyone that day. */
function DailyCard() {
  const today = dayKey();
  const l = dailyLegend(today);
  const best = book.value.daily?.[today];
  const streak = dailyStreak(book.value.daily, today);
  return (
    <article class={`panel legend-card daily ${best ?? ''}`} style={{ '--fc': `var(--${l.me})` } as never}>
      <div class="spread">
        <h2>
          <span class="daily-label">Today’s battle · {dayName(today)}</span>
          {l.title}
        </h2>
        <MedalChip medal={best} />
      </div>
      <div class="muted legend-sides">
        {factionDef(l.me).name} against {lowerThe(factionDef(l.foe).name)}
      </div>
      <p class="legend-hook">{l.story}</p>
      <p class="muted legend-terms">
        {medalTerms(l)} {streak > 1 ? `You have won ${streak} days running.` : streak === 1 && best ? 'Come back tomorrow for another.' : ''}
      </p>
      <button
        class="btn primary"
        onClick={() => {
          audio.unlock();
          go({ name: 'battle', req: legendRequest(l, settings.value.unitScale) });
        }}
      >
        {best ? 'Fight it again' : 'Fight today’s battle'}
      </button>
    </article>
  );
}

export function Legends() {
  const won = book.value.legends ?? {};
  const count = (m: Medal) => Object.values(won).filter((x) => x === m).length;
  return (
    <div class="screen setup-screen scroll">
      <header class="setup-head">
        <button class="btn ghost" onClick={() => go({ name: 'menu' })}>
          ← Menu
        </button>
        <h1>Legends</h1>
        <span class="head-spacer" />
      </header>
      <div class="legends">
        <p class="muted legends-intro">
          Six battles the world still tells of, each built around one idea, and a new battle every day. Win them, then win them cheaply.{' '}
          {Object.keys(won).length > 0 && (
            <span class="num">
              Gold {count('gold')} · Silver {count('silver')} · Bronze {count('bronze')}
            </span>
          )}
        </p>
        <DailyCard />
        <div class="legend-grid">
          {LEGENDS.map((l) => (
            <article key={l.id} class={`panel legend-card ${won[l.id] ?? ''}`} style={{ '--fc': `var(--${l.me})` } as never}>
              <div class="spread">
                <h2>{l.title}</h2>
                <MedalChip medal={won[l.id]} />
              </div>
              <div class="muted legend-sides">
                {factionDef(l.me).name} against {lowerThe(factionDef(l.foe).name)}
              </div>
              <p class="legend-hook">{l.hook}</p>
              <p class="muted legend-terms">{medalTerms(l)}</p>
              <button
                class="btn primary"
                onClick={() => {
                  audio.unlock();
                  go({ name: 'battle', req: legendRequest(l, settings.value.unitScale) });
                }}
              >
                {won[l.id] ? 'Fight it again' : 'Fight'}
              </button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

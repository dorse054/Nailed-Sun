/**
 * The Tutorials screen: four short battles, one core idea per faction.
 */
import { factionDef } from '../../data/index';
import { go } from '../store';
import { audio } from '../../audio/audio';
import { Rose } from '../../ui/Rose';
import { completedTutorials } from './progress';
import { startTutorial, TUTORIALS } from './index';
import './tutorial.css';

export function TutorialsScreen() {
  const done = completedTutorials();
  const click = (f: () => void) => () => {
    audio.unlock();
    audio.ui('click');
    f();
  };
  return (
    <div class="screen setup-screen scroll tut-screen">
      <header class="setup-head">
        <button class="btn ghost" onClick={click(() => go({ name: 'menu' }))}>
          ← Menu
        </button>
        <h1>Tutorials</h1>
        <span class="chip gold num" title="Tutorials finished">
          {done.size} / {TUTORIALS.length} done
        </span>
      </header>
      <p class="tut-intro muted">
        Four short battles, one for each faction. Each teaches the one idea that faction fights by. Start with the Choir: it also teaches the controls.
      </p>
      <div class="tut-grid">
        {TUTORIALS.map((t, i) => {
          const f = factionDef(t.faction);
          const finished = done.has(t.id);
          return (
            <article key={t.id} class={`panel tut-card ${finished ? 'done' : ''}`} style={{ '--fc': `var(--${t.faction})` } as never}>
              <div class="tut-card-top">
                <div class="tut-card-rose">
                  <Rose sunBearing={t.field.sunBearing} light={t.field.light} wind={t.field.wind} facing={-Math.PI / 2} size={64} />
                </div>
                <div class="tut-card-head">
                  <div class="tut-tag">
                    {i + 1}. {f.name}
                  </div>
                  <h2>{t.title}</h2>
                  <div class="muted tut-card-field">{t.field.note}</div>
                </div>
                {finished && (
                  <span class="chip good tut-card-badge" title="You have finished this tutorial">
                    ✓ Done
                  </span>
                )}
              </div>
              <p class="tut-card-idea">{t.idea}</p>
              <p class="muted tut-card-blurb">{t.blurb}</p>
              <ul class="tut-card-learn">
                {t.learn.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <div class="spread tut-card-foot">
                <span class="muted num">About {t.minutes} minutes</span>
                <button class={`btn ${finished ? '' : 'primary'}`} onClick={click(() => startTutorial(t.id))}>
                  {finished ? 'Play again' : i === 0 && done.size === 0 ? 'Start here' : 'Start'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

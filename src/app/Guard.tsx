import type { ComponentChildren } from 'preact';
import { useErrorBoundary } from 'preact/hooks';
import { go, screen } from './store';

/**
 * Catches a failure anywhere in the interface and offers a way back instead
 * of a blank page. Campaigns are saved at the start of every Toll.
 */
export function Guard({ children }: { children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary((e) => console.error(e));
  if (!error) return <>{children}</>;
  const where = screen.value.name;
  return (
    <div class="screen" style={{ display: 'grid', placeItems: 'center', padding: '16px', background: 'var(--ink)' }}>
      <div class="panel modal" role="alert">
        <h2>Something went wrong</h2>
        <p>
          The {where === 'battle' ? 'battle' : where === 'campaign' ? 'campaign map' : 'screen'} hit an error it could not recover from. Your campaign is saved at the start of every Toll.
        </p>
        <p class="muted small" style={{ wordBreak: 'break-word' }}>
          {String((error as Error)?.message ?? error)}
        </p>
        <div class="row">
          <button
            class="btn primary"
            onClick={() => {
              go({ name: 'menu' });
              reset();
            }}
          >
            Back to the main menu
          </button>
          {where !== 'menu' && (
            <button class="btn" onClick={() => reset()}>
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

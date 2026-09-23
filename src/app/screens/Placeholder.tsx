import { go } from '../store';

export function Placeholder({ name }: { name: string }) {
  return (
    <div class="screen" style={{ display: 'grid', placeItems: 'center', padding: '16px' }}>
      <div class="panel modal">
        <h2>{name}</h2>
        <p class="muted">This screen is being built.</p>
        <button class="btn" onClick={() => go({ name: 'menu' })}>
          Back
        </button>
      </div>
    </div>
  );
}

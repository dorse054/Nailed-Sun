/**
 * Claude in the game. When Nailed Sun runs as a published artifact on
 * claude.ai, the page may ask Claude on the viewer's own account, once the
 * viewer allows it. The campaign uses it for the design's "Jev" role: the AI
 * factions' judgment calls and in-character treaty answers. Anywhere else,
 * or once the viewer declines, nothing is asked and the scripted AI plays
 * alone.
 */
import { signal } from '@preact/signals';

export interface SampleOptions {
  modelTier?: 'quick' | 'default' | 'complex';
  signal?: AbortSignal;
  cache?: boolean | { gcTime?: number; refresh?: boolean };
}

interface SampleFn {
  (input: string, options?: SampleOptions): Promise<{ text: string; truncated: boolean }>;
  json<T>(input: string, options?: SampleOptions): Promise<T>;
}

/**
 * 'unknown' until the runtime answers; 'ready' when Claude can be asked;
 * 'absent' outside claude.ai; 'refused' once the viewer or their account
 * says no (final for this page load).
 */
export const claudeStatus = signal<'unknown' | 'ready' | 'absent' | 'refused'>('unknown');

let found: Promise<SampleFn | null> | null = null;

/** Resolve the sample capability once. Never rejects. */
export function findClaude(): Promise<SampleFn | null> {
  if (found) return found;
  const c = (globalThis as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
  found =
    typeof c?.use === 'function'
      ? c.use('sample').then(
          (s) => (typeof s === 'function' ? (s as SampleFn) : null),
          () => null,
        )
      : Promise.resolve(null);
  void found.then((s) => {
    if (claudeStatus.value === 'unknown') claudeStatus.value = s ? 'ready' : 'absent';
  });
  return found;
}

/** Refusals that hold for the rest of the page load: stop asking. */
const FINAL = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'session_expired']);

/**
 * Ask Claude for a JSON answer. Rejects with an Error whose message is the
 * platform's error code; a final refusal switches Claude off for this load.
 */
export async function askClaudeJson<T>(prompt: string, options: SampleOptions = {}): Promise<T> {
  const s = await findClaude();
  if (!s || claudeStatus.value === 'refused') throw new Error('unavailable');
  try {
    return await s.json<T>(prompt, options);
  } catch (e) {
    const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : 'upstream_error';
    if (FINAL.has(code)) claudeStatus.value = 'refused';
    throw new Error(code);
  }
}

interface DownloadsNs {
  save(request: { filename: string; data: string }): Promise<{ status: string }>;
}

/**
 * Offer a file to the player. On claude.ai the viewer confirms the save;
 * elsewhere it is an ordinary browser download.
 */
export async function saveFile(filename: string, data: string): Promise<'saved' | 'declined' | 'failed'> {
  const c = (globalThis as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
  if (typeof c?.use === 'function') {
    const d = (await c.use('downloads').catch(() => null)) as DownloadsNs | null;
    if (d) {
      try {
        await d.save({ filename, data });
        return 'saved';
      } catch (e) {
        return (e as { code?: string })?.code === 'declined' ? 'declined' : 'failed';
      }
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

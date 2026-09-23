/**
 * The annals: the world's big news, kept for the whole campaign for its story.
 */
import { describe, expect, it } from 'vitest';
import { newCampaign } from '../src/campaign/setup';
import { log } from '../src/campaign/state';

describe('campaign annals', () => {
  it('keep public big news, not private notes or small talk', () => {
    const s = newCampaign({ faction: 'hush', seed: 2 });
    const before = s.annals?.length ?? 0;
    log(s, 'capture', 'The Choir of the Nail take Aumsgate.');
    log(s, 'diplomacy', 'The Hush declare war on The Vesperate.');
    log(s, 'info', 'A caravan passes.');
    log(s, 'capture', 'Your scouts see Aumsgate fall.', 'hush');
    const got = (s.annals ?? []).slice(before).map((e) => e.text);
    expect(got).toEqual(['The Choir of the Nail take Aumsgate.', 'The Hush declare war on The Vesperate.']);
  });

  it('outlast the chronicle, within a bound', () => {
    const s = newCampaign({ faction: 'hush', seed: 2 });
    for (let i = 0; i < 400; i++) log(s, 'capture', `Capture ${i}`);
    expect(s.events.length).toBe(300);
    expect(s.annals!.length).toBe(240);
    expect(s.annals!.at(-1)!.text).toBe('Capture 399');
  });
});

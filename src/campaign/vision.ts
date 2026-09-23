/**
 * Fog of war on the campaign map. A faction sees its own regions, its
 * armies and moorings, and one region beyond; the Choir heliograph sees
 * further. Hush armies on the Shadow Roads stay hidden until they strike or
 * an enemy army stands next to them.
 */
import type { FactionId } from '../data/schema';
import type { ArmyState, CampaignState } from './types';
import { REGIONS } from './regions';
import { neighbors } from './geometry';
import { allied } from './state';
import { heliographReach } from './rules';

export function visibleRegions(s: CampaignState, f: FactionId): Set<string> {
  const seen = new Set<string>();
  const add = (id: string) => {
    seen.add(id);
    for (const n of neighbors(id)) seen.add(n);
  };
  for (const r of REGIONS) {
    const st = s.regions[r.id]!;
    if (st.owner !== 'free' && allied(s, f, st.owner)) add(r.id);
    if (f === 'drift' && st.mooring) add(r.id);
  }
  for (const a of s.armies) if (allied(s, f, a.faction)) add(a.region);
  for (const id of heliographReach(s, f)) seen.add(id);
  return seen;
}

export function armyVisible(s: CampaignState, f: FactionId, a: ArmyState, seen = visibleRegions(s, f)): boolean {
  if (allied(s, f, a.faction)) return true;
  if (!seen.has(a.region)) return false;
  if (a.shadowed) {
    // Only an army standing beside it notices a host on the Shadow Roads.
    return s.armies.some((o) => o.faction === f && (o.region === a.region || neighbors(o.region).includes(a.region)));
  }
  return true;
}

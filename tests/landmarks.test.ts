/**
 * Landmark battlefields: the ground a campaign landmark gives a battle.
 */
import { describe, expect, it } from 'vitest';
import { COVER, Terrain, type MapSetup } from '../src/sim/terrain';
import { lightAt } from '../src/sim/zones';
import { makeBattle } from './helpers';

const map = (o: Partial<MapSetup>): MapSetup => ({ seed: 5, band: 'gloaming', wind: 0, sunBearing: 0, ...o });

describe('landmark battlefields', () => {
  it('leave every other battlefield exactly as it was', () => {
    const a = new Terrain(map({}));
    const b = new Terrain(map({ landmark: undefined }));
    expect(Array.from(b.cover)).toEqual(Array.from(a.cover));
  });

  it('an Umbral Vale is walled on both flanks and never brighter than Dim', () => {
    const t = new Terrain(map({ band: 'longAfternoon', landmark: 'umbralVale' }));
    expect(t.light).toBe(1);
    for (const y of [100, 500, 900]) {
      expect(t.coverAt(20, y)).toBe(COVER.Cliff);
      expect(t.coverAt(t.width - 20, y)).toBe(COVER.Cliff);
      expect(t.passable(20, y, 'infantry')).toBe(false);
    }
    expect(t.passable(t.width / 2, 500, 'infantry')).toBe(true);
  });

  it('the Nail Spire stands at the heart of a field battle, not inside town walls', () => {
    const field = new Terrain(map({ band: 'glare', landmark: 'nailSpire' }));
    expect(field.passable(field.width / 2, field.height / 2, 'infantry')).toBe(false);
    const town = new Terrain(map({ band: 'glare', landmark: 'nailSpire', fort: { defender: 1, radius: 170 } }));
    expect(town.rects.some((r) => r.kind === 'spire')).toBe(false);
  });

  it('a lit Candle holds the light at Dusk around its peak for everyone; a dead one does not', () => {
    const armies = [
      { faction: 'choir' as const, units: ['choir.kilnAcolytes'] },
      { faction: 'hush' as const, units: ['hush.rimeguard'] },
    ] as [{ faction: 'choir'; units: string[] }, { faction: 'hush'; units: string[] }];
    const lit = makeBattle({ map: { band: 'evernight', landmark: 'candle', glow: true }, armies });
    const cx = lit.terrain.width / 2;
    const cy = lit.terrain.height / 2;
    expect(lightAt(lit, cx + 60, cy)).toBe(2);
    expect(lightAt(lit, cx + 400, cy)).toBe(0);
    const glow = lit.zones.find((z) => z.def.id === 'candleGlow')!;
    expect(glow.side).not.toBe(0);
    expect(glow.side).not.toBe(1);
    const dead = makeBattle({ map: { band: 'evernight', landmark: 'candle', glow: false }, armies });
    expect(lightAt(dead, cx + 60, cy)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { allFactionUnits, allUnits, FACTIONS, factionDef, hasUnit, recruitable, unitDef } from '../src/data/index';
import { ZONES, zoneDef } from '../src/data/zones';
import { FACTION_IDS } from '../src/data/schema';
import type { AbilityDef, FactionDef, MissileWeapon, OnHit, UnitDef } from '../src/data/schema';

const factions: FactionDef[] = FACTION_IDS.map((id) => FACTIONS[id]);
const units: UnitDef[] = allUnits();
const abilities: { unit: UnitDef; ability: AbilityDef }[] = units.flatMap((unit) => (unit.abilities ?? []).map((ability) => ({ unit, ability })));

function missilesOf(u: UnitDef): { where: string; w: MissileWeapon }[] {
  const out: { where: string; w: MissileWeapon }[] = [];
  if (u.missile) out.push({ where: `${u.id}.missile`, w: u.missile });
  if (u.altMissile) out.push({ where: `${u.id}.altMissile`, w: u.altMissile });
  if (u.leader?.missile) out.push({ where: `${u.id}.leader.missile`, w: u.leader.missile });
  return out;
}

function onHitsOf(u: UnitDef): { where: string; list: OnHit[] }[] {
  const out: { where: string; list: OnHit[] }[] = [];
  if (u.weapon.onHit) out.push({ where: `${u.id}.weapon`, list: u.weapon.onHit });
  if (u.leader?.weapon.onHit) out.push({ where: `${u.id}.leader.weapon`, list: u.leader.weapon.onHit });
  for (const m of missilesOf(u)) if (m.w.onHit) out.push({ where: m.where, list: m.w.onHit });
  for (const a of u.abilities ?? []) {
    for (const e of a.effects) if (e.kind === 'damage' && e.onHit) out.push({ where: `${u.id}.${a.id}`, list: e.onHit });
  }
  return out;
}

/** Every zone id the data refers to, with where it is referenced. */
function zoneReferences(): { where: string; zone: string }[] {
  const refs: { where: string; zone: string }[] = [];
  for (const f of factions) for (const m of f.mechanics ?? []) if (m.kind === 'zone') refs.push({ where: `${f.id} mechanics`, zone: m.zone });
  for (const u of units) {
    for (const m of u.mechanics ?? []) if (m.kind === 'zone') refs.push({ where: `${u.id} mechanics`, zone: m.zone });
    for (const a of u.abilities ?? []) for (const e of a.effects) if (e.kind === 'zone') refs.push({ where: `${u.id}.${a.id}`, zone: e.zone });
    for (const h of onHitsOf(u)) for (const e of h.list) if (e.kind === 'lightZone') refs.push({ where: `${h.where} onHit`, zone: e.zone });
    for (const m of missilesOf(u)) if (m.w.impactZone) refs.push({ where: `${m.where} impactZone`, zone: m.w.impactZone.zone });
  }
  return refs;
}

describe('faction registry', () => {
  it('registers the four factions under their own ids', () => {
    expect(Object.keys(FACTIONS).sort()).toEqual([...FACTION_IDS].sort());
    for (const id of FACTION_IDS) {
      expect(factionDef(id).id).toBe(id);
      expect(FACTIONS[id].id).toBe(id);
    }
  });

  it.each(FACTION_IDS)('%s has exactly 11 regular units, 1 colossus costing 3200, 1 lord and 2 heroes', (id) => {
    const f = FACTIONS[id];
    expect(f.units).toHaveLength(11);
    for (const u of f.units) {
      expect(['colossus', 'lord', 'hero']).not.toContain(u.role);
      expect(u.character).toBeUndefined();
    }
    expect(f.colossus.role).toBe('colossus');
    expect(f.colossus.category).toBe('colossus');
    expect(f.colossus.size).toBe('colossal');
    expect(f.colossus.cost).toBe(3200);
    expect(f.colossus.soldiers).toBe(1);
    expect(f.lord.role).toBe('lord');
    expect(f.lord.character?.kind).toBe('lord');
    expect(f.heroes).toHaveLength(2);
    for (const h of f.heroes) {
      expect(h.role).toBe('hero');
      expect(h.character?.kind).toBe('hero');
      expect(h.soldiers).toBe(1);
    }
    expect(allFactionUnits(f)).toHaveLength(15);
  });

  it('lords lead a bodyguard: they have leader stats and more than one soldier', () => {
    for (const f of factions) {
      expect(f.lord.leader, f.id).toBeDefined();
      expect(f.lord.soldiers, f.id).toBeGreaterThan(1);
      expect(f.lord.leader!.hp).toBeGreaterThan(f.lord.hp);
    }
  });

  it('recruitable() offers regular units, the colossus and heroes, but never the lord', () => {
    for (const f of factions) {
      const ids = recruitable(f.id).map((u) => u.id);
      expect(ids).not.toContain(f.lord.id);
      expect(ids).toContain(f.colossus.id);
      for (const u of [...f.units, ...f.heroes]) if (!u.hidden) expect(ids).toContain(u.id);
      expect(ids.length).toBe(ids.filter((x) => hasUnit(x)).length);
    }
  });
});

describe('unit ids', () => {
  it('are unique across all factions', () => {
    const ids = units.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 11 units, a colossus, a lord, 2 heroes and the generic campaign captain.
    expect(ids).toHaveLength(4 * 16);
  });

  it('are prefixed by their faction, and each unit belongs to the faction that lists it', () => {
    for (const f of factions) {
      for (const u of allFactionUnits(f)) {
        expect(u.id.startsWith(`${f.id}.`), u.id).toBe(true);
        expect(u.faction, u.id).toBe(f.id);
      }
    }
  });

  it('resolve through unitDef() and hasUnit(), and unknown ids are rejected', () => {
    for (const u of units) {
      expect(unitDef(u.id)).toBe(u);
      expect(hasUnit(u.id)).toBe(true);
    }
    expect(hasUnit('choir.nobody')).toBe(false);
    expect(() => unitDef('choir.nobody')).toThrow();
  });
});

describe('zones', () => {
  it('every zone referenced by mechanics, ability effects, on-hit effects and impact zones exists', () => {
    const refs = zoneReferences();
    // Sanity: the collector actually sees the references (7 mechanic zones, 8 ability zones, 2 impact zones today).
    expect(refs.length).toBeGreaterThanOrEqual(15);
    const kinds = new Set(refs.map((r) => r.zone));
    for (const z of ['walkingNoon', 'eclipse', 'veil', 'lantern', 'sunpatch', 'spores', 'frostField', 'gust']) expect(kinds).toContain(z);
    const missing = refs.filter((r) => !(r.zone in ZONES)).map((r) => `${r.where} -> ${r.zone}`);
    expect(missing).toEqual([]);
  });

  it('zones the simulation creates by name exist too (burning ground, scorched lines, molten glass)', () => {
    for (const id of ['burning', 'burningLine', 'moltenGlass', 'signal']) expect(() => zoneDef(id)).not.toThrow();
    expect(() => zoneDef('noSuchZone')).toThrow();
  });

  it('each zone is keyed by its own id, has a positive radius and a valid light rule', () => {
    for (const [key, z] of Object.entries(ZONES)) {
      expect(z.id).toBe(key);
      expect(z.radius).toBeGreaterThan(0);
      if (z.light) {
        expect([1, 2, 3]).toContain(z.light.intensity);
        expect(z.light.level).toBeGreaterThanOrEqual(0);
        expect(z.light.level).toBeLessThanOrEqual(4);
        // Floors brighten, ceilings darken.
        if (z.light.mode === 'ceiling') expect(z.light.level).toBeLessThanOrEqual(1);
        else expect(z.light.level).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('matches the doc table: Lantern 1, Sunpatch 2, Walking Noon 3, Veil 2, Eclipse 3', () => {
    expect(ZONES.lantern!.light).toEqual({ mode: 'floor', level: 2, intensity: 1 });
    expect(ZONES.sunpatch!.light).toEqual({ mode: 'floor', level: 3, intensity: 2 });
    expect(ZONES.walkingNoon!.light).toEqual({ mode: 'floor', level: 3, intensity: 3 });
    expect(ZONES.veil!.light).toEqual({ mode: 'ceiling', level: 0, intensity: 2 });
    expect(ZONES.eclipse!.light).toEqual({ mode: 'ceiling', level: 0, intensity: 3 });
    expect(ZONES.walkingNoon!.radius).toBe(70);
    expect(ZONES.eclipse!.radius).toBe(70);
    expect(ZONES.sunpatch!.radius).toBe(40);
  });
});

describe('costs, tiers and stats', () => {
  it('costs and tiers are in sane ranges for each kind of unit', () => {
    for (const f of factions) {
      for (const u of f.units) {
        expect(u.tier, u.id).toBeGreaterThanOrEqual(1);
        expect(u.tier, u.id).toBeLessThanOrEqual(4);
        expect(u.cost, u.id).toBeGreaterThanOrEqual(300);
        expect(u.cost, u.id).toBeLessThanOrEqual(2000);
      }
      expect(f.colossus.tier).toBe(5);
      expect(f.lord.tier).toBe(4);
      expect(f.lord.cost).toBeGreaterThanOrEqual(800);
      expect(f.lord.cost).toBeLessThanOrEqual(1500);
      for (const h of f.heroes) {
        expect(h.tier, h.id).toBe(3);
        expect(h.cost, h.id).toBeGreaterThanOrEqual(500);
        expect(h.cost, h.id).toBeLessThanOrEqual(1200);
      }
    }
    for (const u of units) expect(u.cost % 50, u.id).toBe(0);
  });

  it('within each faction, higher tiers cost more on average', () => {
    for (const f of factions) {
      const byTier = new Map<number, number[]>();
      for (const u of f.units) byTier.set(u.tier, [...(byTier.get(u.tier) ?? []), u.cost]);
      const tiers = [...byTier.keys()].sort((a, b) => a - b);
      const avg = tiers.map((t) => byTier.get(t)!.reduce((a, c) => a + c, 0) / byTier.get(t)!.length);
      for (let i = 1; i < avg.length; i++) expect(avg[i], `${f.id} tier ${tiers[i]}`).toBeGreaterThan(avg[i - 1]!);
    }
  });

  it('core stats are positive and armor is a percentage', () => {
    for (const u of units) {
      const tag = u.id;
      expect(Number.isInteger(u.soldiers) && u.soldiers >= 1, tag).toBe(true);
      expect(u.hp, tag).toBeGreaterThan(0);
      expect(u.armor, tag).toBeGreaterThanOrEqual(0);
      expect(u.armor, tag).toBeLessThanOrEqual(100);
      expect(u.ma, tag).toBeGreaterThan(0);
      expect(u.md, tag).toBeGreaterThan(0);
      expect(u.speed, tag).toBeGreaterThan(0);
      expect(u.mass, tag).toBeGreaterThan(0);
      expect(u.leadership, tag).toBeGreaterThan(0);
      expect(u.leadership, tag).toBeLessThanOrEqual(100);
      expect(u.charge, tag).toBeGreaterThanOrEqual(0);
      expect(u.weapon.interval, tag).toBeGreaterThan(0);
      expect(u.weapon.base, tag).toBeGreaterThan(0);
      expect(u.weapon.ap, tag).toBeGreaterThanOrEqual(0);
      if (u.shield !== undefined) {
        expect(u.shield, tag).toBeGreaterThan(0);
        expect(u.shield, tag).toBeLessThan(1);
      }
      if (u.leader) {
        expect(u.leader.armor, tag).toBeLessThanOrEqual(100);
        expect(u.leader.weapon.interval, tag).toBeGreaterThan(0);
      }
    }
  });

  it('missile weapons are well-formed', () => {
    for (const u of units) {
      for (const { where, w } of missilesOf(u)) {
        expect(w.range, where).toBeGreaterThan(0);
        expect(w.minRange ?? 0, where).toBeLessThan(w.range);
        expect(w.ammo, where).toBeGreaterThan(0);
        expect(w.reload, where).toBeGreaterThan(0);
        expect(w.accuracy, where).toBeGreaterThan(0);
        expect(w.accuracy, where).toBeLessThanOrEqual(1);
        expect(w.damage, where).toBeGreaterThan(0);
        if (w.trajectory === 'beam' || w.trajectory === 'lineBeam') expect(w.windless, `${where} beams ignore wind`).toBe(true);
        if (w.windRange) {
          expect(w.windRange.up, where).toBeLessThanOrEqual(w.windRange.calm);
          expect(w.windRange.calm, where).toBeLessThanOrEqual(w.windRange.down);
        }
      }
    }
    // The doc's Firekite numbers.
    expect(unitDef('drift.firekiteBattery').missile!.windRange).toEqual({ down: 350, up: 150, calm: 200 });
  });
});

describe('abilities', () => {
  it('every ability has a positive cooldown or a limited number of uses', () => {
    expect(abilities.length).toBeGreaterThan(20);
    for (const { unit, ability } of abilities) {
      const ok = ability.cooldown > 0 || (ability.uses !== undefined && ability.uses > 0);
      expect(ok, `${unit.id}.${ability.id}`).toBe(true);
      if (ability.uses !== undefined) expect(ability.uses, `${unit.id}.${ability.id}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('every big ability (one with a windup) has a visible windup of at least 2 s', () => {
    const big = abilities.filter(({ ability }) => ability.windup !== undefined);
    // The colossi's signature moves: Censer Sweep, Noon Lance, Unveil, Dive, Blinding Dust, Thousand Eyes, The Hour That Never Comes.
    expect(big.length).toBeGreaterThanOrEqual(7);
    for (const { unit, ability } of big) expect(ability.windup!, `${unit.id}.${ability.id}`).toBeGreaterThanOrEqual(2);
  });

  it('repair abilities target existing units of their own faction, and their casters are repairers', () => {
    const repairs = abilities.filter(({ ability }) => ability.effects.some((e) => e.kind === 'repair'));
    expect(repairs.length).toBe(2);
    for (const { unit, ability } of repairs) {
      expect(ability.target).toBe('ally');
      expect(unit.mechanics?.some((m) => m.kind === 'repairer'), unit.id).toBe(true);
      for (const e of ability.effects) {
        if (e.kind !== 'repair') continue;
        expect(e.pct).toBeGreaterThan(0);
        expect(e.targets.length).toBeGreaterThan(0);
        for (const t of e.targets) {
          expect(hasUnit(t), `${unit.id}.${ability.id} -> ${t}`).toBe(true);
          expect(unitDef(t).faction).toBe(unit.faction);
        }
      }
    }
  });

  it('ability ids are unique per unit, and targeted abilities declare a positive range', () => {
    for (const u of units) {
      const ids = (u.abilities ?? []).map((a) => a.id);
      expect(new Set(ids).size, u.id).toBe(ids.length);
    }
    for (const { unit, ability } of abilities) {
      if (ability.target === 'point' || ability.target === 'enemy' || ability.target === 'ally') {
        expect(ability.range ?? 0, `${unit.id}.${ability.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('toggles carry a stance whose switches the unit can actually use', () => {
    for (const { unit, ability } of abilities) {
      if (ability.kind !== 'toggle') {
        expect(ability.stance, `${unit.id}.${ability.id}`).toBeUndefined();
        continue;
      }
      const st = ability.stance;
      expect(st, `${unit.id}.${ability.id}`).toBeDefined();
      if (st?.lightOff) expect(unit.mechanics?.some((m) => m.kind === 'zone' && m.toggleable), unit.id).toBe(true);
      if (st?.altMissile) expect(unit.altMissile, unit.id).toBeDefined();
      if (st?.exitTime !== undefined) expect(st.exitTime).toBeGreaterThan(0);
    }
  });

  it("AI hints are ones the scripted AI knows how to plan for that kind of ability", () => {
    const activeHints = ['selfWhenEngaged', 'always', 'onEnemyCluster', 'onEnemyInFront', 'onAllyCluster', 'onHiddenEnemies', 'onEnemyCharacter', 'onEnemyArtillery', 'whenEnemyBeams', 'onToll', 'whenLosing', 'never'];
    const toggleHints = ['selfWhenCavalryNear', 'whenLosing', 'never'];
    for (const { unit, ability } of abilities) {
      const hint = ability.ai ?? 'never';
      const allowed = ability.kind === 'toggle' ? toggleHints : activeHints;
      expect(allowed, `${unit.id}.${ability.id}: ${hint}`).toContain(hint);
      if (hint === 'onAllyCluster') expect(ability.effects.some((e) => e.kind === 'repair'), `${unit.id}.${ability.id}`).toBe(true);
      if (hint === 'onEnemyCharacter' || hint === 'onEnemyArtillery') expect(ability.target).toBe('enemy');
    }
  });
});

describe('faction traits', () => {
  it('trait light and wind conditions are consistent ranges', () => {
    for (const f of factions) {
      for (const t of f.traits) {
        const w = t.when;
        if (!w) continue;
        if (w.lightMin !== undefined && w.lightMax !== undefined) expect(w.lightMin, `${f.id}.${t.id}`).toBeLessThanOrEqual(w.lightMax);
        if (w.windMin !== undefined && w.windMax !== undefined) expect(w.windMin, `${f.id}.${t.id}`).toBeLessThanOrEqual(w.windMax);
      }
    }
  });

  it('only the Vesperate keep Hours, and they offer the Charge, Iron and Rest', () => {
    for (const f of factions) {
      if (f.id === 'vesperate') expect(f.hours?.map((h) => h.id).sort()).toEqual(['charge', 'iron', 'rest']);
      else expect(f.hours).toBeUndefined();
    }
  });
});

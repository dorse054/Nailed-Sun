/**
 * Exports every unit's stats to a spreadsheet-friendly CSV, one row per
 * unit, for balance reviews: `npm run stats:csv [out.csv]`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { allUnits } from '../src/data/index';

const out = process.argv[2] ?? 'reports/unit-stats.csv';
const cols = [
  'id',
  'name',
  'faction',
  'role',
  'category',
  'tier',
  'cost',
  'soldiers',
  'hp',
  'armor',
  'ma',
  'md',
  'weaponBase',
  'weaponAp',
  'weaponInterval',
  'weaponType',
  'charge',
  'mass',
  'speed',
  'leadership',
  'size',
  'missileKind',
  'missileRange',
  'missileDamage',
  'missileAp',
  'missileReload',
  'missileAmmo',
  'missileAccuracy',
  'abilities',
  'mechanics',
] as const;

const esc = (v: unknown): string => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = allUnits().map((u) => {
  const m = u.missile;
  const r: Record<(typeof cols)[number], unknown> = {
    id: u.id,
    name: u.name,
    faction: u.faction,
    role: u.role,
    category: u.category,
    tier: u.tier,
    cost: u.cost,
    soldiers: u.soldiers,
    hp: u.hp,
    armor: u.armor,
    ma: u.ma,
    md: u.md,
    weaponBase: u.weapon.base,
    weaponAp: u.weapon.ap,
    weaponInterval: u.weapon.interval,
    weaponType: u.weapon.type ?? 'normal',
    charge: u.charge,
    mass: u.mass,
    speed: u.speed,
    leadership: u.leadership,
    size: u.size,
    missileKind: m?.kind,
    missileRange: m?.range,
    missileDamage: m?.damage,
    missileAp: m?.ap,
    missileReload: m?.reload,
    missileAmmo: m?.ammo,
    missileAccuracy: m?.accuracy,
    abilities: (u.abilities ?? []).map((a) => a.name).join('; '),
    mechanics: (u.mechanics ?? []).map((x) => x.kind).join('; '),
  };
  return cols.map((c) => esc(r[c])).join(',');
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, [cols.join(','), ...rows].join('\n') + '\n');
console.log(`${out}: ${rows.length} units`);

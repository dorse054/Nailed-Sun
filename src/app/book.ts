/**
 * The player's chronicles, kept in this browser: every battle and campaign
 * fought, per faction, and every tale and saga Claude has told. Nothing here
 * is needed to play; if storage is unavailable the book simply stays empty.
 */
import { signal } from '@preact/signals';
import { FACTION_IDS, type FactionId } from '../data/schema';
import { loadRaw, save } from './store';
import { MEDAL_RANK, type Medal } from './legends';

export interface BookTale {
  /** When it was told (ms since 1970). */
  at: number;
  kind: 'battle' | 'saga';
  title: string;
  text: string;
  faction: FactionId;
  foe?: FactionId;
  /** Where it was fought, in words. */
  place?: string;
  /** Won, lost or neither (null). */
  won: boolean | null;
  /** The campaign Toll, for campaign battles and sagas. */
  toll?: number;
}

export interface FactionRecord {
  fought: number;
  won: number;
  campaigns: number;
  campaignsWon: number;
  /** The earliest Toll a campaign was won on. */
  fastest?: number;
}

export interface Book {
  version: 1;
  tales: BookTale[];
  records: Record<FactionId, FactionRecord>;
  /** Campaigns already counted, so a reloaded ending isn't counted twice. */
  counted: string[];
  /** The best medal won in each Legend. */
  legends?: Record<string, Medal>;
}

const KEY = 'nailedsun.book';
const MAX_TALES = 120;

function empty(): Book {
  const records = {} as Record<FactionId, FactionRecord>;
  for (const f of FACTION_IDS) records[f] = { fought: 0, won: 0, campaigns: 0, campaignsWon: 0 };
  return { version: 1, tales: [], records, counted: [] };
}

function read(): Book {
  const b = loadRaw<Book>(KEY);
  if (!b || b.version !== 1 || !Array.isArray(b.tales) || !b.records) return empty();
  const e = empty();
  for (const f of FACTION_IDS) e.records[f] = { ...e.records[f], ...b.records[f] };
  return { version: 1, tales: b.tales.slice(0, MAX_TALES), records: e.records, counted: Array.isArray(b.counted) ? b.counted.slice(-200) : [], legends: b.legends && typeof b.legends === 'object' ? b.legends : {} };
}

/** The book as it stands; screens re-render when it changes. */
export const book = signal<Book>(read());

function write(b: Book): void {
  book.value = b;
  save(KEY, b);
}

export function addTale(t: Omit<BookTale, 'at'>): void {
  const b = book.value;
  // The same tale told twice (a reloaded report) is kept once.
  if (b.tales.some((x) => x.title === t.title && x.text === t.text)) return;
  write({ ...b, tales: [{ ...t, at: Date.now() }, ...b.tales].slice(0, MAX_TALES) });
}

/** A battle the player fought to its end. */
export function noteBattle(faction: FactionId, won: boolean): void {
  const b = book.value;
  const r = b.records[faction];
  write({ ...b, records: { ...b.records, [faction]: { ...r, fought: r.fought + 1, won: r.won + (won ? 1 : 0) } } });
}

/** A campaign that ended, counted once however often its ending is shown. */
export function noteCampaign(key: string, faction: FactionId, won: boolean, toll: number): void {
  const b = book.value;
  if (b.counted.includes(key)) return;
  const r = b.records[faction];
  const fastest = won ? Math.min(r.fastest ?? Infinity, toll) : r.fastest;
  const next: FactionRecord = { ...r, campaigns: r.campaigns + 1, campaignsWon: r.campaignsWon + (won ? 1 : 0) };
  if (fastest !== undefined && Number.isFinite(fastest)) next.fastest = fastest;
  write({ ...b, records: { ...b.records, [faction]: next }, counted: [...b.counted, key].slice(-200) });
}

/** A Legend won: keep its medal if it beats the best so far. Returns whether it did. */
export function noteLegend(id: string, medal: Medal): boolean {
  const b = book.value;
  const best = b.legends?.[id];
  if (best && MEDAL_RANK[best] >= MEDAL_RANK[medal]) return false;
  write({ ...b, legends: { ...b.legends, [id]: medal } });
  return true;
}

export function forgetBook(): void {
  write(empty());
}

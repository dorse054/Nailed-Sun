/**
 * Feats: things worth having done once, kept in the Chronicles. Most are
 * read off a battle's result as it ends; the rest come from Legends medals,
 * campaigns and tales.
 */
import { FACTION_IDS, type FactionId } from '../data/schema';
import { unitDef } from '../data/index';
import type { BattleResult, BattleSetup, Side } from '../sim/types';
import { book, earnFeat } from './book';
import { LEGENDS } from './legends';
import { dailyStreak } from './daily';

export interface FeatDef {
  id: string;
  name: string;
  /** How it is earned, for the Chronicles. */
  how: string;
}

export const FEATS: FeatDef[] = [
  { id: 'firstBlood', name: 'First Blood', how: 'Win a battle.' },
  { id: 'flawless', name: 'Not One Lost', how: 'Win a battle with every one of your units still on the field.' },
  { id: 'heroic', name: 'Heroic Victory', how: 'Destroy most of the enemy while losing little of your own.' },
  { id: 'odds', name: 'Against the Odds', how: 'Win against an army worth half again as much as yours.' },
  { id: 'giantSlayer', name: 'Giant-Slayer', how: 'Win a battle in which an enemy colossus is brought down.' },
  { id: 'storm', name: 'Over the Walls', how: 'Take a walled town by assault.' },
  { id: 'hold', name: 'The Walls Held', how: 'Hold a walled town against an assault.' },
  { id: 'allFactions', name: 'Four Banners', how: 'Win a battle with each of the four factions.' },
  { id: 'legendary', name: 'Legendary', how: 'Win all six Legends.' },
  { id: 'golden', name: 'The Golden Age', how: 'Win gold in all six Legends.' },
  { id: 'sevenDays', name: 'Seven Days Running', how: 'Win the Daily Battle seven days in a row.' },
  { id: 'victor', name: 'The Shudder Ends', how: 'Win a campaign.' },
  { id: 'fourRoads', name: 'Every Road', how: 'Win a campaign with each of the four factions.' },
  { id: 'toldInSong', name: 'Told in Song', how: 'Have Claude tell the tale of one of your battles.' },
  { id: 'saga', name: 'The Saga', how: 'Finish a campaign with Claude as counsel and read its saga.' },
];

export function featDef(id: string): FeatDef | undefined {
  return FEATS.find((f) => f.id === id);
}

/** Feats earned by a battle the player fought to its end; returns the new ones. */
export function battleFeats(setup: BattleSetup, r: BattleResult, side: Side): FeatDef[] {
  const out: FeatDef[] = [];
  const earn = (id: string) => {
    if (earnFeat(id)) out.push(featDef(id)!);
  };
  if (r.winner !== side) return out;
  const mine = r.sides[side];
  const theirs = r.sides[(1 - side) as Side];
  earn('firstBlood');
  if (mine.units.every((u) => u.state === 'ready' || u.state === 'embarked')) earn('flawless');
  if (theirs.costLost / Math.max(1, theirs.costStart) > 0.7 && mine.costLost / Math.max(1, mine.costStart) < 0.3) earn('heroic');
  if (theirs.costStart >= mine.costStart * 1.5) earn('odds');
  if (theirs.units.some((u) => unitDef(u.def).category === 'colossus' && u.state === 'dead')) earn('giantSlayer');
  const fort = setup.map.fort;
  if (fort) earn(fort.defender === side ? 'hold' : 'storm');
  if (FACTION_IDS.every((f) => book.value.records[f].won > 0)) earn('allFactions');
  return out;
}

/** Feats from the Legends and Daily Battle medals won so far. */
export function legendFeats(): FeatDef[] {
  const won = book.value.legends ?? {};
  const out: FeatDef[] = [];
  if (LEGENDS.every((l) => won[l.id]) && earnFeat('legendary')) out.push(featDef('legendary')!);
  if (LEGENDS.every((l) => won[l.id] === 'gold') && earnFeat('golden')) out.push(featDef('golden')!);
  if (dailyStreak(book.value.daily) >= 7 && earnFeat('sevenDays')) out.push(featDef('sevenDays')!);
  return out;
}

/** Feats from a campaign won with a faction. */
export function campaignFeats(): FeatDef[] {
  const out: FeatDef[] = [];
  const rec = book.value.records;
  if (FACTION_IDS.some((f: FactionId) => rec[f].campaignsWon > 0) && earnFeat('victor')) out.push(featDef('victor')!);
  if (FACTION_IDS.every((f: FactionId) => rec[f].campaignsWon > 0) && earnFeat('fourRoads')) out.push(featDef('fourRoads')!);
  return out;
}

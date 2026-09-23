/**
 * Names for generic lords, by faction.
 */
import type { FactionId } from '../data/schema';
import { CAPTAIN_TITLES } from '../data/index';

const NAMES: Record<FactionId, string[]> = {
  choir: ['Aurel', 'Seraphine', 'Cantor Vey', 'Lumen', 'Orla of the Kiln', 'Tessaly', 'Brannoch', 'Idris', 'Helion', 'Mirel', 'Solenne', 'Castor'],
  hush: ['Vesh', 'Nyr', 'Othra', 'Siliss', 'the Pale Kerr', 'Ulmae', 'Drevik', 'Asha-Without-Light', 'Morrow', 'Ysolde', 'Grieve', 'Tamsk'],
  vesperate: ['Hollis Weir', 'Anselm Carillon', 'Ida Lantern', 'Corwen Weir', 'Maud Carillon', 'Tobiah Lantern', 'Esme Weir', 'Rufus Carillon', 'Petra Lantern', 'Oswin Weir', 'Clemence Carillon', 'Jory Lantern'],
  drift: ['Kesh Farwind', 'Ilo Redsail', 'Marra Dustborn', 'Tamsin Highline', 'Oru Stormkin', 'Pell Longreed', 'Sabe Kitecaller', 'Vento', 'Harrow Saltwind', 'Nim Galeborn', 'Juno Ropeward', 'Ash Sailmender'],
};

export function lordName(f: FactionId, n: number): string {
  const list = NAMES[f];
  const i = ((Math.floor(n) % list.length) + list.length) % list.length;
  return `${CAPTAIN_TITLES[f]} ${list[i]}`;
}

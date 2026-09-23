/**
 * The world of Nailed Sun, from the design doc.
 */
import type { FactionId } from './schema';

export const PITCH =
  'Nailed Sun is a Total War-style strategy game: a turn-based campaign map plus real-time battles with thousands of soldiers. It goes deep instead of wide, with four fully realized factions.';

export const WORLD =
  'The world is tidally locked. The sun hangs fixed in the sky: one half of the world burns in endless noon, the other freezes in endless night. Civilization clings to the ring of eternal sunset between them.';

export const LEGEND =
  'Legend says the sun was nailed in place to end an age of darkness. When the campaign opens, it moves for the first time in a thousand years.';

export const TAGLINE = 'The sun has not moved in a thousand years. Today, it shuddered.';

export const PILLARS: { name: string; desc: string }[] = [
  { name: 'The world is a weapon', desc: 'Sun direction, wind, shadow and light level are fixed on every battlefield and shape every deployment.' },
  { name: 'Four factions, four ways to play', desc: 'Each has its own economy, battle rhythm and answer to the light. None is a reskin of another.' },
  { name: 'Colossal moments', desc: 'Each faction fields one signature colossus that changes a battle when it arrives, with a clear and fair way to kill it.' },
  { name: 'Readable at a glance', desc: "Every unit's role reads from its silhouette at full zoom-out, and every big ability is telegraphed before it lands." },
  { name: 'Fair asymmetry', desc: 'Factions play wildly differently but win about equally often at equal cost, proven by automated simulation.' },
];

export const PHYSICS =
  'Three physical rules make the world feel real: shadows never move, every plant leans toward the sun, and every river flows from the night\'s ice toward the day, where it boils away.';

export const MYTH: string[] = [
  'A thousand years ago the world turned, and every land had day and night. The Choir teach that their prophet-smith Aum drove a Nail of light through the sun to end the Long Night, an age when things from the dark hunted freely. Since then the sun has not moved.',
  'Each people remembers it differently. The Choir call it the Holding; the Hush call it the Theft, half the world robbed of day and half of night. The Vesperate call it history, and built an empire where the two halves meet.',
  "The campaign opens with the Shudder: the sun slips a hair's breadth, every permanent shadow twitches, and the wind dies for an hour. Everyone now believes the Nail is failing. The war is over what comes next.",
];

export const TILT_TEXT =
  'The Tilt is the world-state everyone fights over: a campaign-wide value from -5 (nightward) to +5 (sunward), starting at 0. Each region has a sun-height value, and every Tilt point moves it a fifth of a band. Border regions flip first; at +/-5 the whole map has shifted one full band.';

export const TILT_SIDES: { faction: FactionId; desc: string }[] = [
  { faction: 'choir', desc: 'The Choir push the Tilt sunward, spreading day over the Hush homeland.' },
  { faction: 'hush', desc: 'The Hush push it nightward, cooling the Choir heartland.' },
  { faction: 'vesperate', desc: 'The Vesperate lose farmland either way and fight to hold it at 0.' },
  { faction: 'drift', desc: 'The Drift gain wind as the Tilt moves in either direction, because an unbalanced world blows harder.' },
];

export const LANDMARKS: { name: string; where: string; why: string }[] = [
  { name: 'The Nail Spire', where: 'Center of the Glare', why: "Said to pin the sun. Site of the Choir's Last Lens and the Hush's final ritual." },
  { name: 'The Pole of Night', where: 'Deepest Evernight', why: 'The darkest place in the world. Seat of the Hush queen and their greatest ritual site.' },
  { name: 'The Candles', where: 'Three peaks in the Evernight', why: 'Mountains tall enough to catch the sun: gold spires burning in the dark. Choir holy sites deep in Hush land.' },
  { name: 'The Umbral Vales', where: 'Canyons in the Gloaming and Long Afternoon', why: 'Valleys in permanent shadow, cold and dark inside the day. The Hush use them as hidden roads.' },
  { name: 'The Mistfalls', where: 'Where Gloaming rivers reach the heat', why: 'Rivers pour off cliffs and boil into walls of mist with permanent rainbows. Natural chokepoints.' },
  { name: 'The Leaning Wood', where: 'Western Gloaming', why: 'Colossal trees bowed sunward like a frozen wave. Deep cover on the nightward side only.' },
  { name: 'The Stopped Dial', where: 'Vesper, the Vesperate capital', why: 'A giant sundial whose shadow never moved, until the Shudder moved it one notch.' },
  { name: 'The Rime Sea', where: 'Northern Evernight', why: 'A frozen ocean under the aurora. Its ice-whales give the Hush bone for weapons and armor.' },
  { name: 'The Kite Fields', where: 'The Gale Roads', why: 'Where Drift clans gather for their great moots, under a sky crowded with kites.' },
];

export const MATCHUPS: { a: FactionId; b: FactionId; note: string }[] = [
  { a: 'choir', b: 'hush', note: "The central rivalry: light against dark. The Choir want open, bright fields; the Hush want night maps, shadows and forests. Sunpatch and Veil fight over the ground, and the two colossi cancel each other's light." },
  { a: 'choir', b: 'vesperate', note: 'Armor against discipline. Knellguard and Knell Cannons shatter Brittle Choir units, while Choir beams outrange everything in bright light. Attack the Choir from the side, never with the sun at your back.' },
  { a: 'choir', b: 'drift', note: 'Slow against fast. Strider Archers bleed the slow Choir lines, but beams ignore wind and burn sails and gliders. The Choir answer with Gnomon rings and Heliographer marks.' },
  { a: 'hush', b: 'vesperate', note: 'Ambush against formation. Lanterns and Lamplighters strip Hush stealth; the Hush use Veils and Shadow Roads to strike before the Vesperate form up. Whoever controls the timing wins.' },
  { a: 'hush', b: 'drift', note: 'Two fast factions fighting over the sky. Moths meet gliders, and tethers and bolas decide who gets pinned. Calm night maps favor the Hush; open, windy steppes favor the Drift.' },
  { a: 'vesperate', b: 'drift', note: "Walls against wind. The Drift can't win a straight fight against Vesperate lines, so they raid, harass and ram. Halberds punish charges, and the Counterweight Engine outranges everything the Drift field." },
];

export function matchupNote(a: FactionId, b: FactionId): string | null {
  const m = MATCHUPS.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  return m ? m.note : null;
}

export const SIGNATURE_MOMENTS: { name: string; desc: string }[] = [
  { name: 'Deployment as a puzzle', desc: 'Every map asks whether you want the sun or the wind at your back, and against the Choir the answer flips.' },
  { name: 'Light wars', desc: 'A Veil rolls over the Choir line and their beams die; a Sunpatch flares and the Unlit are exposed.' },
  { name: 'The bell charge', desc: 'The Vesperate player watches the Toll timer and launches the lancers on the bell.' },
  { name: 'The downwind run', desc: 'The Dreadsail gathers speed across the map and breaks the line, then the wall behind it.' },
  { name: 'Colossus duels', desc: 'When the Nailbearer meets the Umbral Mother, light and dark cancel and the fight returns to steel.' },
  { name: 'The silent charge', desc: 'In a dark forest, a Vesperate line hears nothing, then everything.' },
];

export const ANTI_FRUSTRATION: string[] = [
  'Everything big is telegraphed with a windup animation, a sound cue and a ground marker at least 2 s before impact.',
  'Every faction has a stealth counter: light zones, scouts, hearing or area damage.',
  'No loss of control: fear lowers leadership but never takes control of your units.',
  'Routs, not wipeouts: most units flee before dying, so a lost fight rarely means a lost army.',
  'The Sun-and-Wind Rose and unit tooltips show glare, wind, light and Toll effects with exact numbers.',
  'Each faction gets a short scripted tutorial battle that teaches its one core idea.',
];

export const COUNTERS: { role: string; beats: string; losesTo: string }[] = [
  { role: 'Line infantry', beats: 'Anti-large infantry, cavalry head-on', losesTo: 'Shock infantry, artillery, flanking' },
  { role: 'Anti-large infantry', beats: 'Cavalry, monsters, colossi', losesTo: 'Line infantry, missiles' },
  { role: 'Shock infantry', beats: 'Line infantry', losesTo: 'Missiles, cavalry' },
  { role: 'Missile infantry', beats: 'Slow infantry, monsters', losesTo: 'Cavalry, flyers' },
  { role: 'Shock cavalry', beats: 'Missiles, artillery, flanks', losesTo: 'Anti-large, braced lines' },
  { role: 'Missile cavalry', beats: 'Slow infantry, monsters', losesTo: 'Missile infantry, shock cavalry' },
  { role: 'Monsters', beats: 'Infantry', losesTo: 'Anti-large, artillery' },
  { role: 'Artillery', beats: 'Dense blocks, monsters, colossi', losesTo: 'Cavalry, flyers' },
  { role: 'Flyers', beats: 'Artillery, missiles', losesTo: 'Massed missiles, harpoons' },
  { role: 'Colossus', beats: 'Most things alone', losesTo: 'Focused combined arms and its faction-specific weakness' },
];

export const BALANCE_TARGETS: { test: string; target: string }[] = [
  { test: 'Faction vs faction at equal cost, averaged over every light and wind condition', target: '45-55% wins' },
  { test: 'Faction vs faction in its best or worst conditions', target: 'Never above 60% or below 40%' },
  { test: "A unit's cost efficiency against others in its role", target: 'Within +/-10% of the role median' },
  { test: 'Counters', target: 'Every unit has at least 2 counters in each enemy faction that cost no more than it does' },
  { test: 'Colossus vs equal-cost combined arms', target: 'Colossus wins 40-50%' },
  { test: 'Light, wind and glare modifiers on one unit', target: '+/-20% each, +/-30% stacked; beam weapons are the one deliberate exception' },
];

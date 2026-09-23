# Nailed Sun

*The sun has not moved in a thousand years. Today, it shuddered.*

A Total War–style strategy game prototype: real-time battles with thousands of soldiers, and a turn-based campaign across a tidally locked world where one half burns in endless noon and the other freezes in endless night. Built in the browser (TypeScript, Canvas 2D, Preact) from the design doc *Nailed Sun — Game Design & Build Plan*.

## What's in it

- **Battles.** Every soldier is simulated: formations, duels, charges with bracing, physical missiles with scatter and friendly fire, beams that burn brighter in full light, morale (Steady, Wavering, Broken, Shattered), fatigue, stealth and shadow. The sun, the wind, glare and fixed shadows shape every deployment.
- **Four factions.** The Choir of the Nail (sun-fed zealots with beams and mirrors), the Hush (night hunters who fight from the dark), the Vesperate (disciplined bell-empire whose Tolls grant an Hour), and the Drift (steppe nomads riding the wind). 11 units, a legendary lord, 2 heroes and a signature colossus each.
- **Colossi.** The Nailbearer, the Umbral Mother, Old Midnight and the Dreadsail, each with telegraphed abilities and a clear way to kill it.
- **Fortified battles.** Walls, gates, towers and a capture point: infantry climb walls slowly with ladders, horses and engines wait at the gates, towers shoot attackers in range, attackers batter gates, engines break walls, Choir beams burn gates, the Dreadsail rams walls down and Old Midnight docks as a siege tower.
- **The campaign.** 31 regions across the five light bands and the Gale Roads, each with a settlement, wind and resource. Coin, food, public order and each faction's own resource (Radiance, Dread, Hours, Renown); building chains; recruitment tiers; the Tilt that shifts every region's light; faction mechanics (Hymns and pilgrimages, the Long Hunt and the Listening, the Calendar and the Houses, wind-cities, moorings and raids); diplomacy; heroes who fight in armies or act alone on the map (rally, sabotage, scout); a scripted campaign AI; victory races, coalitions against the leader, and the Great Shudder after Toll 70. Battles are fought on the field or auto-resolved with the same simulation. The direction you attack from sets where the sun stands.
- **Landmark battlefields.** A battle at a landmark is fought on its ground: the Nail Spire, a Candle, the Stopped Dial and the Pole of Night at the heart of the field, a lit Candle's glow holding the light at Dusk for both armies, an Umbral Vale's canyon walls and permanent shade, the Mistfalls' river. Custom Battle can pick any of them.
- **Tutorials.** One short scripted battle per faction, each teaching its core idea: the Choir fight with the sun at their backs, the Hush strike from the dark, the Vesperate charge on the bell, the Drift ride the wind.
- **Custom and quick battles**, **replays** (every battle is a deterministic 20-tick simulation replayed exactly from its orders; save one as a small file from the results screen and open it again from Custom Battle), a **Codex** of the world and every unit, and a **Balance Lab**.
- **Sound.** Procedural audio with no samples: the Choir sing their charges over glass harmonica, the Hush are near-silent until one shriek, the Vesperate ring bells and sound brass, the Drift throat-sing under whistling arrows and howling kites. Units you can't see make no sound.
- **Phones and tablets.** Battles and the campaign work by touch: tap to select and order, pinch to zoom, and a Pan / Select / Line switch for box selection and drawing formation lines. Panels fold away to show more of the field.
- **Save files.** Download a campaign from Settings to keep a copy or carry it to another device, and load it back.
- **Claude as counsel (the design's "Jev").** Played as an artifact on claude.ai, Settings can let the campaign's AI factions take Claude's advice: every other Toll each faction asks Claude, in character and all at once, whether to change its wars, treaties or plans, and envoys decide your closer proposals in character (the game values every deal first; a clear insult or a generous offer needs no envoy) and answer in their own words. The scripted AI always decides the details and takes over whenever Claude is slow, unavailable or declined, and the same limits apply (no wars of choice before Toll 14). In battles, while you deploy, the enemy general reads the field in words and picks a plan (attack, hold or ambush) and says a few words; the plan becomes part of the battle's setup, so the battle and its replay follow it exactly, and a late answer is dropped. (The design's every-2-seconds Jev general would need answers far faster than a chat model gives.) At the end of a campaign, Claude's chronicler writes the saga of your war from its annals. `src/campaign/jev.ts` also takes any other advisor, such as an HTTP endpoint on a server you run.

## Running it

```sh
npm install
npm run dev          # play at http://localhost:5173
npm test             # vitest: core, rules, data, simulation, balance
npm run typecheck
```

Shortcuts for development: `#campaign`, `#custom`, `#codex`, `#lab`, `#quick`, `#camp:hush` (a fresh campaign as the Hush), `#demo:a=choir,b=hush,band=gloaming,seed=3,wind=1` (add `steppe=1` for the Gale Roads).

### Controls

Battle: left-click selects, drag a box to select many, right-click moves or attacks, right-drag lays out a line and its facing. Wheel zooms, WASD or arrows pan, and the minimap (larger screens) moves the view. Space pauses, R run, F fire at will, H halt, M melee, 1–3 abilities, +/− speed.

Battle by touch: tap a unit to select it, tap the ground or an enemy to order it, drag to pan, pinch to zoom. The bar above the unit cards switches what one finger does: Pan, Select (taps add units, a drag draws a box) or Line (a drag lays the selection out along a line). All selects every unit.

Campaign: click an army, then click a region to march (right-click also marches). Enter ends the Toll, Tab cycles your armies, Escape clears the selection. By touch: tap an army, then tap a region.

## Tools

| Command | What it does |
| --- | --- |
| `npm run balance -- --help` | The headless balance simulator: faction vs faction over all 15 light and wind conditions, colossi vs combined arms, unit duels. Writes `reports/balance-report.md` and `.json`. `--quick` runs in about a minute. |
| `npx tsx tools/campaign-sim.ts <seed> <tolls> <scale>` | A headless all-AI campaign, printing the state every 5 Tolls. |
| `npx tsx tools/replay.ts <replay.json>` | Replays a saved battle headlessly (the AI re-run where it played) and prints every unit's losses, kills and damage. For bug reports. |
| `npm run stats:csv` | Every unit's stats as a spreadsheet (`reports/unit-stats.csv`). |
| `npm run artifact` | Builds the single-file page (`dist-single/`) and the hosted page fragment (`dist-artifact/`). |
| `node tools/shot.mjs <url> <out.png>` | Screenshots a page with Playwright. |
| `node tools/reach.mjs [url]` | Opens every screen and campaign panel at phone, landscape-phone and desktop sizes (against a running `npm run dev`) and lists any button that is off screen with no way to scroll to it, or covered. |

## How it's built

- `src/core`: deterministic math (sfc32 randomness, engine-independent trig) and a spatial hash. The simulation never calls `Math.random`, `Math.sin` or `**`.
- `src/data`: every faction, unit, ability, zone and world rule as data. Abilities are built from shared effect blocks (damage, zone, buff, knockback, leadership, reveal, repair); the rest are named mechanics.
- `src/sim`: the battle simulation at a fixed 20 ticks per second, knowing nothing about graphics. The same code runs on-screen battles, auto-resolve (in web workers) and the balance simulator.
- `src/ai`: the scripted battle AI that plays either side.
- `src/campaign`: the campaign model, rules, turn engine, battles, AI, diplomacy and victory.
- `src/render`, `src/audio`, `src/app`: the Canvas renderer, procedural audio and the Preact interface.
- `src/balance`: the balance suites, runner and report.

Battles are reproducible from their setup and command log alone, so a replay, an auto-resolved campaign battle and a balance run all see the same fight.

# Nailed Sun

*The sun has not moved in a thousand years. Today, it shuddered.*

A Total War–style strategy game prototype: real-time battles with thousands of soldiers, and a turn-based campaign across a tidally locked world where one half burns in endless noon and the other freezes in endless night. Built in the browser (TypeScript, Canvas 2D, Preact) from the design doc *Nailed Sun — Game Design & Build Plan*.

## What's in it

- **Battles.** Every soldier is simulated: formations, duels, charges with bracing, physical missiles with scatter and friendly fire, beams that burn brighter in full light, morale (Steady, Wavering, Broken, Shattered), fatigue, stealth and shadow. The sun, the wind, glare and fixed shadows shape every deployment.
- **Four factions.** The Choir of the Nail (sun-fed zealots with beams and mirrors), the Hush (night hunters who fight from the dark), the Vesperate (disciplined bell-empire whose Tolls grant an Hour), and the Drift (steppe nomads riding the wind). 11 units, a legendary lord, 2 heroes and a signature colossus each.
- **Colossi.** The Nailbearer, the Umbral Mother, Old Midnight and the Dreadsail, each with telegraphed abilities and a clear way to kill it.
- **Fortified battles.** Walls, gates and a capture point: infantry climb walls slowly with ladders, horses and engines wait at the gates, attackers batter gates, engines break walls and Choir beams burn gates.
- **The campaign.** 31 regions across the five light bands and the Gale Roads, each with a settlement, wind and resource. Coin, food, public order and each faction's own resource (Radiance, Dread, Hours, Renown); building chains; recruitment tiers; the Tilt that shifts every region's light; faction mechanics (Hymns and pilgrimages, the Long Hunt and the Listening, the Calendar and the Houses, wind-cities, moorings and raids); diplomacy; a scripted campaign AI; victory races, coalitions against the leader, and the Great Shudder after Toll 70. Battles are fought on the field or auto-resolved with the same simulation. The direction you attack from sets where the sun stands.
- **Custom and quick battles**, **replays** (every battle is a deterministic 20-tick simulation replayed exactly from its orders), a **Codex** of the world and every unit, a **Balance Lab**, **tutorials** and procedural audio.

## Running it

```sh
npm install
npm run dev          # play at http://localhost:5173
npm test             # vitest: core, rules, data, simulation, balance
npm run typecheck
```

Shortcuts for development: `#campaign`, `#custom`, `#codex`, `#lab`, `#quick`, `#camp:hush` (a fresh campaign as the Hush), `#demo:a=choir,b=hush,band=gloaming,seed=3,wind=1`.

### Controls

Battle: left-click selects, drag a box to select many, right-click moves or attacks, right-drag lays out a line and its facing. Wheel zooms, WASD or arrows pan. Space pauses, R run, F fire at will, H halt, M melee, 1–3 abilities, +/− speed.

Campaign: click an army, then click a region to march (right-click also marches). Enter ends the Toll, Tab cycles your armies, Escape clears the selection.

## Tools

| Command | What it does |
| --- | --- |
| `npm run balance -- --help` | The headless balance simulator: faction vs faction over all 15 light and wind conditions, colossi vs combined arms, unit duels. Writes `reports/balance-report.md` and `.json`. `--quick` runs in about a minute. |
| `npx tsx tools/campaign-sim.ts <seed> <tolls> <scale>` | A headless all-AI campaign, printing the state every 5 Tolls. |
| `npm run stats:csv` | Every unit's stats as a spreadsheet (`reports/unit-stats.csv`). |
| `npm run artifact` | Builds the single-file page (`dist-single/`) and the hosted page fragment (`dist-artifact/`). |
| `node tools/shot.mjs <url> <out.png>` | Screenshots a page with Playwright. |

## How it's built

- `src/core`: deterministic math (sfc32 randomness, engine-independent trig) and a spatial hash. The simulation never calls `Math.random`, `Math.sin` or `**`.
- `src/data`: every faction, unit, ability, zone and world rule as data. Abilities are built from shared effect blocks (damage, zone, buff, knockback, leadership, reveal, repair); the rest are named mechanics.
- `src/sim`: the battle simulation at a fixed 20 ticks per second, knowing nothing about graphics. The same code runs on-screen battles, auto-resolve (in web workers) and the balance simulator.
- `src/ai`: the scripted battle AI that plays either side.
- `src/campaign`: the campaign model, rules, turn engine, battles, AI, diplomacy and victory.
- `src/render`, `src/audio`, `src/app`: the Canvas renderer, procedural audio and the Preact interface.
- `src/balance`: the balance suites, runner and report.

Battles are reproducible from their setup and command log alone, so a replay, an auto-resolved campaign battle and a balance run all see the same fight.

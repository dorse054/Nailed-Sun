# Balance changes

What changed in the battle balance pass, why, and what it did. "Before" is the report
committed at `9b2bd03` (one seed everywhere); "after" is `reports/balance-report.md` on this
branch (`npx tsx tools/balance.ts --seeds 1 --faction-seeds 2`: two seeds for faction
battles, one for colossi and duels).

## Headline numbers

| | Before | After | Target |
|---|---|---|---|
| Choir vs the field | 72% | 58% | 45–55% |
| Hush vs the field | 19% | 44% | 45–55% |
| Vesperate vs the field | 54% | 56% | 45–55% |
| Drift vs the field | 56% | 41% | 45–55% |
| Target 1 flags (clear / within noise) | 4 / 4 | 1 / 7 | none |
| Faction battles ending on the timer | 34% | 27% | fewer |
| Mean faction battle length | 442 s | 398 s | decisive, not trivial |
| The Nailbearer vs 3,200 points of arms | 88% | 51% | 40–50% |
| The Umbral Mother | 7% | 56% | 40–50% |
| Old Midnight | 10% | 36% | 40–50% |
| The Dreadsail | 66% | 44% | 40–50% |
| Target 5 flags (clear / within noise) | 4 / 0 | 0 / 3 | none |
| Cost efficiency in role flags (clear / within noise) | 7 / 21 | 6 / 23 | none |
| Counter flags (clear) | 19 | 22 | none |
| The doc's counters table, relations that hold | 12 of 19 | 12 of 19 | all |

Faction identity holds: the Choir win 26% in the Dark and 88% in Blaze (sun-fed); the
Hush are at their best in the Dark (65%) and Dim (58%) and at their worst in Bright (29%).

## What still misses

- **Target 1.** One clear miss: the Vesperate beat the Hush 69% of the time (n=60). Their
  lanterns and burning ground light up the Hush's darkness, so Nightborn and stealth fail
  where the two armies meet; Lamplighters are still the Vesperate's best killer of light
  infantry. Choir 58%, Vesperate 56%, Hush 44% and Drift 41% are inside the noise of one
  more seed but not yet inside 45–55%.
- **Target 2** (every faction 40–60% in every condition) is far off and partly by design:
  sun-fed Choir and dark-loving Hush swing 26–88% and 29–65% across light levels. 6 clear
  misses; with 12 battles per cell the other 63 flags are within noise.
- **Target 3.** Six clear misses, all where duels and army battles disagree. Windbows
  (+283%) kite everything in a one-on-one duel (fastest missile infantry, longest range,
  and they now hold when their missiles are better), yet are an average missile unit in
  army battles, where the Drift still need them. Lamplighters (−48%) are the reverse:
  80 m grenadiers that lose duels and dominate armies. Anchor Guard, Glowkin Lurers and
  Reedspears (+43–46%) are cheap lines of the two weakest factions; the Counterweight
  Engine (−41%) is excellent behind a line and helpless when charged in the open.
- **Target 4.** 22 unit–faction pairs lack two cheaper counters; 20 more cannot have them
  (too few enemy units cost less). Contradicted relations of the doc's counters table:
  shock over line, monster over line/shock/missile, missile cavalry and artillery over
  monsters, flyers over massed missiles.
- **Colossi** are all within noise of 40–50% (Old Midnight 36%, the Umbral Mother 56%).

## Simulation fixes

- **Trapped soldiers.** A soldier standing on impassable ground (placed in a building, deep
  water or a wall that was re-stamped) may always move, so it walks out instead of being
  stuck for good; units are settled onto open ground at the start and after disembarking.
- **Frozen formations.** When a unit's soldiers drift more than 30 m from their slots, the
  anchor re-forms where the soldiers are (at most every 4 s) instead of stopping for good.
  Formation cohesion never slows a unit below 20%, stale melee approaches are cleared, and
  soldiers only pursue routers of the unit they were sent against (the melee deadlock).
- **Valuing hurt units.** Remaining value is cost times hit points left, for units still
  fighting: a colossus at 30% counts 30%, not 100% until it dies.
- **Decisive endings.** An army under 25% of its value while the enemy still has at least
  twice as much plus 10 percentage points is broken and loses (field battles); within 3
  points at the time limit is a draw. In a siege, an assault that has spent itself is
  called off (units that are only routing still count there: they rally and come again).
- **Morale counts wounds.** Casualty shock is taken from hit points lost, not only from
  deaths, and a unit with less than a quarter of its hit points shatters when it routs.
  This is what stopped units fighting to the last man under colossus and beam fire.
- **Melee.** Only the front two ranks of a block press into melee, and no more soldiers
  attack a big body than fit in one ring around it.
- **Burning ground.** Armor turns part of the heat; soldiers who aren't fighting step out
  of it; fire damage is set per weapon (3/s); overlapping fires don't stack (a soldier
  burns in the hottest fire only, and a firebomb landing in its own side's fire keeps that
  fire going instead of lighting another). Stacked firebomb fires had made Lamplighters
  worth three times their cost.
- **Sieges.** Artillery batters the gate; routers get out of the walls (defenders through
  their own gates, climbers over a wall, anyone through a breach) and run around the fort
  instead of into it.
- **Signature attacks** are numbers in `SIGNATURE` (rules.ts): the Noon Lance burns the
  first six bodies in its path (each once per cast) instead of everything along 300 m.
- **Value tally.** Every unit counts the enemy value it destroys (`valueDealt`), which the
  army-battle analysis below is built on.

## Battle AI

- **Colossi** with no line to wait for march on the enemy instead of standing still, and
  prefer targets they can catch; the Dreadsail no longer turns back when it sees no one.
- **Units with nothing to do** (archers, artillery, skirmishers, flyers with no line left)
  advance toward the last place an enemy was seen instead of standing still; archers out
  of arrows with no line left fight as a line.
- **The line** closes at a run while it is under missile or artillery fire; cavalry holds a
  wing only while the line is still waiting to advance; skirmishers run from any melee
  threat within 55 m.
- **The Drift** strike when a Gale is at their backs and otherwise pick their stance like
  everyone else (hold when their missiles are better). Always attacking cost them about 7
  points of win rate.
- **Sieges.** The attacker gathers its line beyond tower range outside one gate (the one
  nearest its army), then crosses together; artillery moves up and batters that gate;
  cavalry and monsters wait until it falls, then everything that fights hand to hand
  pushes on to the capture point. The defender guards the threatened gate from inside and,
  once the enemy is in the town, falls back onto the capture point.

## Army generator

- Near the 16-unit limit the generator leans toward units that use the remaining budget:
  armies of cheap units (mostly the Drift) used to hit the limit several hundred points
  under budget, so "equal cost" battles weren't.

## Rules and modifiers

- Light and wind modifiers brought within ±20% each: Blaze makes non-Choir units tire 20%
  faster (was 50%); a Gale speeds flyers 20% downwind (was 25%); Glassblind (Choir) costs
  20% spotting in Dim and Dark (was 30%); Cold-blooded (Kilnback Lancers) −20% speed in the
  Dark (was −25%). Beams keep their light multipliers, the stated exception.
- Nightborn (Hush): +15% melee attack and defense in Dim and Dark (was +10%). Before it the
  Hush were no stronger in the dark than at dusk, against their identity.
- Burning ground 3 damage a second for every fire (was 6–8), with armor and non-stacking as
  above. Lantern light (Lantern Guard) 26 m (was 32 m): the Vesperate countered the Hush in
  every light, dark included.
- Shatter: a routing unit with less than 25% of its hit points left shatters (was 12% of its
  soldiers, wounds not counted).
- Signature attacks (`SIGNATURE`): Noon Lance 22 damage, 28 AP, first 6 bodies in its path
  (was 38/52 to everything along 300 m); Ramming Run 70/50 (unchanged in the end). The
  Dreadsail's broadside bolts reload in 3.2 s (was 2.4) and its kites burn at 3/s.
- Sieges: one tower bolt a second (was three when the towers arrived from main).

## Fortified battles

Not part of the balance report; measured with batches of 24 fort battles (every attacker and
defender faction pair, two seeds, 12,000 points a side, no colossi, 1,500 s limit):

| Setup | Attacker wins |
|---|---|
| Before (coordinator's repro, Vesperate on Choir walls) | lost on the timer after losing 709 of 842 soldiers |
| Siege AI, no towers | 38–42% |
| With the towers from main at 3 bolts a second | 0 of 24 |
| Towers at 1 bolt a second (now) | 13–25% across batches (3–6 of 24) |

Routers now get out of the walls (in the stuck case three shattered Choir units sat against
a shut gate for twenty minutes), assaults that have spent themselves are called off, and a
siege in which nothing happens for 120 s ends with the attacker withdrawing instead of
idling to the time limit. Old Midnight's docking works with the siege AI (in a trace it
docked at 115 s and put its garrison inside the walls).

## Why costs moved the way they did

The duel suite prices a unit against one enemy type in the open; the faction battles price
it in an army. The two disagreed badly, and the headline target is the faction battles, so
the costs follow what units do there: every unit now tallies the enemy value it destroys,
and an instrumented copy of the faction suite (value destroyed and lost per point fielded,
by unit, role and light) showed where the points went.

- **Missile infantry** destroyed one to two times its cost per battle, behind a line; line
  infantry about half. The Vesperate and Choir field twice the missile share of the Hush
  and Drift. Vesperate Arbalests (pavise 35% missile block, 0.70 accuracy, armor 36) and
  Lamplighters (splash plus stacked fires) were outliers even among missiles.
- **Missile cavalry, flyers, monsters and support** destroyed 0.05–0.4 of their cost and
  died: the factions that field them (Hush, Drift) paid for units that did little. They
  are cheaper.
- **Unit limit.** Cheap Drift armies used to hit the 16-unit limit hundreds of points under
  budget; the generator now leans toward units that use the remaining budget.
- **Colossi** were tuned against 3,200 points of the new, cheaper arms: Old Midnight into a
  real colossus (it won 19%), the Dreadsail sturdier, the Umbral Mother frailer, the
  Nailbearer back near its old hit points after the Noon Lance change.

## Unit data (before → after)

| Unit | Faction | Role | Change |
|---|---|---|---|
| Kiln Acolytes | Choir | line | cost 450→500 |
| Mirror Wardens | Choir | line | cost 750→800 |
| Cinder Penitents | Choir | shock | cost 800→700; melee vsInfantry –→8 |
| Shardbows | Choir | missile | cost 500→600 |
| Lenswrights | Choir | missile | cost 1100→1200 |
| Heliographer Riders | Choir | missileCav | cost 750→650 |
| Kilnback Lancers | Choir | shockCav | cost 1300→1350; Cold-blooded −25%→−20% speed in the Dark |
| Molten Saints | Choir | monster | cost 1800→1350; hp 1500→2000 |
| Heliostat Battery | Choir | artillery | cost 1250→1450; missile damage 30→22; missile ap 44→32; fire r7 12s 6/s→r7 12s 3/s |
| Cinderglass Mangonel | Choir | artillery | cost 900→1150; fire r11 12s 8/s→r11 12s 3/s |
| The Nailbearer | Choir | colossus | hp 13000→13500; armor 70→62 |
| Glowkin Lurers | Hush | line | cost 400→350 |
| The Unlit | Hush | shock | cost 1200→750; melee vsInfantry –→8 |
| Hushbows | Hush | missile | cost 550→500 |
| Veilweavers | Hush | support | cost 800→650 |
| Rime Hounds | Hush | shockCav | cost 450→400 |
| Grue Hunters | Hush | shockCav | cost 950→850 |
| Dusk Moth Riders | Hush | flyer | cost 1150→1000 |
| Lanternmaws | Hush | monster | cost 1700→950; hp 1850→2500 |
| Whalebreaker Ballista | Hush | artillery | cost 1100→900 |
| The Umbral Mother | Hush | colossus | hp 9000→10500; armor 26→34 |
| Hour Levy | Vesperate | antiLarge | cost 400→550 |
| Lantern Guard | Vesperate | line | cost 750→800 |
| Oathsworn Halberdiers | Vesperate | antiLarge | cost 750→800 |
| Knellguard | Vesperate | shock | cost 1250→1150; melee vsInfantry –→8 |
| Vesper Arbalests | Vesperate | missile | cost 800→900; missile reload 8→9; missile accuracy 0.7→0.64; Plant Pavise missile block 0.35→0.2 |
| Lamplighters | Vesperate | missile | cost 700→800; missile damage 16→14; missile ammo 8→5; fire r8 14s 6/s→r6 10s 3/s |
| Knell Cannon | Vesperate | artillery | cost 1200→1000 |
| Counterweight Engine | Vesperate | artillery | cost 950→750 |
| Old Midnight | Vesperate | colossus | hp 14000→22000; melee base 70→100; melee ap 36→50; melee interval 3.4→2; melee splash {"targets":6,"radius":6}→{"targets":10,"radius":8}; missile damage 14→20; missile ap 14→20; missile reload 1.1→0.8; missile ammo 400→600 |
| Reedspears | Drift | antiLarge | cost 400→450 |
| Gale Dancers | Drift | shock | cost 850→700; melee vsInfantry –→8 |
| Anchor Guard | Drift | line | cost 850→650 |
| Dustrunners | Drift | missileCav | cost 550→350 |
| Strider Archers | Drift | missileCav | cost 900→500 |
| Strider Lancers | Drift | shockCav | cost 1250→1150 |
| Galewings | Drift | flyer | cost 1100→650; fire r8 12s 6/s→r8 12s 3/s |
| Howling Kites | Drift | support | cost 750→600 |
| Firekite Battery | Drift | artillery | cost 1150→900; fire r10 14s 7/s→r10 14s 3/s |
| The Dreadsail | Drift | colossus | hp 12500→17500 |

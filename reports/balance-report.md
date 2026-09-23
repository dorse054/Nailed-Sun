# Nailed Sun balance report

Generated 2026-09-23T15:23:28.870Z at commit `f52cea9`. Command: `npx tsx tools/balance.ts --seeds 1 --faction-seeds 2 --out reports --raw`.

Settings: suites ["factions","colossus","duels"]; seeds {"factions":2,"duels":1,"colossus":1}; factionScale 1; budget 12000; armsBudget 3200; factions ["choir","hush","vesperate","drift"]; conditions all 15; timeLimits {"factions":600,"duels":300,"colossus":600}; quick false.

Runtime: factions: 360 battles in 18 min 11 s (mean 12.1 s CPU each); colossus: 360 battles in 3 min 50 s (mean 2.5 s CPU each); duels: 1452 battles in 3 min 30 s (mean 0.6 s CPU each) on 4 worker threads, 4 cores, Node v22.22.2.

## Targets

| # | Target | Goal | Status | Summary |
|---|---|---|---|---|
| 1 | Faction vs faction, all conditions | 45–55% wins at equal cost, averaged over every light and wind condition | **FAIL** | 1 clear miss, 7 possible (within noise). Vs field: Choir 58%, Hush 44%, Vesperate 56%, Drift 41%. |
| 2 | Best and worst conditions | never above 60% or below 40% in a faction’s best or worst condition | **FAIL** | 6 clear misses, 63 possible (within noise). |
| 3 | Cost efficiency in role | within ±10% of the role median | **FAIL** | 6 clear misses, 23 possible (within noise). 2 notes. |
| 4 | Counters | at least 2 counters in each enemy faction that cost no more | **FAIL** | 22 clear misses, 0 possible (within noise). 20 notes. |
| 5 | Colossus vs combined arms | the colossus wins 40–50% against equal cost | **WARN** | 0 clear misses, 3 possible (within noise). The Nailbearer 51%, The Umbral Mother 56%, Old Midnight 36%, The Dreadsail 44%. |

FAIL means the whole 95% interval misses the target; WARN means the estimate misses but the interval still overlaps it (more seeds would tell).

## Flags

Worst first within each target; clear misses (FAIL) before possible ones (WARN). Every flag is in the JSON report.

**Simulation** (0 fail, 1 warn)

- **WARN** 27% of faction battles hit the time limit and were decided on remaining value.

**Target 1: Faction vs faction, all conditions** (1 fail, 7 warn)

- **FAIL** Vesperate win 69% (95%: 57%–79%, n=60) against Hush over all conditions (target 45–55%).
- **WARN** Choir win 66% (95%: 53%–77%, n=60) against Drift over all conditions (target 45–55%).
- **WARN** Choir win 59% (95%: 47%–71%, n=60) against Vesperate over all conditions (target 45–55%).
- **WARN** Vesperate win 59% (95%: 47%–71%, n=60) against Drift over all conditions (target 45–55%).
- **WARN** Drift win 41% (95%: 34%–49%, n=180) against all other factions (target 45–55%).
- **WARN** Choir win 58% (95%: 51%–65%, n=180) against all other factions (target 45–55%).
- **WARN** Vesperate win 56% (95%: 49%–63%, n=180) against all other factions (target 45–55%).
- **WARN** Hush win 44% (95%: 37%–51%, n=180) against all other factions (target 45–55%).

**Target 2: Best and worst conditions** (6 fail, 63 warn)

- **FAIL** Choir win 0% (95%: 0%–24%, n=12) against the field in Dark / Gale (target 40–60%).
- **FAIL** Choir win 100% (95%: 76%–100%, n=12) against the field in Blaze / Breeze (target 40–60%).
- **FAIL** Choir win 96% (95%: 70%–100%, n=12) against Vesperate in Blaze light (target 40–60%).
- **FAIL** Choir win 8% (95%: 1%–35%, n=12) against the field in Dim / Gale (target 40–60%).
- **FAIL** Vesperate win 92% (95%: 65%–99%, n=12) against the field in Dark / Gale (target 40–60%).
- **FAIL** Choir win 92% (95%: 65%–99%, n=12) against Drift in Blaze light (target 40–60%).
- **WARN** Hush win 13% (95%: 3%–40%, n=12) against the field in Bright / Gale (target 40–60%).
- **WARN** Hush win 88% (95%: 60%–97%, n=12) against Choir in Dark light (target 40–60%).
- **WARN** Vesperate win 88% (95%: 60%–97%, n=12) against Choir in Dim light (target 40–60%).
- **WARN** Vesperate win 88% (95%: 60%–97%, n=12) against Drift in Dusk light (target 40–60%).
- …and 59 more.

**Target 3: Cost efficiency in role** (6 fail, 23 warn)

- **FAIL** Windbows (missile) trades 5.03 enemy points per point lost, +283% from the missile median 1.31 (95%: +161% to +539%; target ±10%).
- **FAIL** Lamplighters (missile) trades 0.69 enemy points per point lost, −48% from the missile median 1.31 (95%: −64% to −30%; target ±10%).
- **FAIL** Anchor Guard (line) trades 1.90 enemy points per point lost, +46% from the line median 1.30 (95%: +18% to +85%; target ±10%).
- **FAIL** Glowkin Lurers (line) trades 1.87 enemy points per point lost, +44% from the line median 1.30 (95%: +17% to +73%; target ±10%).
- **FAIL** Reedspears (antiLarge) trades 1.80 enemy points per point lost, +43% from the antiLarge median 1.26 (95%: +12% to +88%; target ±10%).
- **FAIL** Counterweight Engine (artillery) trades 0.44 enemy points per point lost, −41% from the artillery median 0.75 (95%: −55% to −22%; target ±10%).
- **WARN** Rimeguard (antiLarge) trades 1.83 enemy points per point lost, +45% from the antiLarge median 1.26 (95%: −1% to +128%; target ±10%).
- **WARN** Hushbows (missile) trades 1.87 enemy points per point lost, +42% from the missile median 1.31 (95%: +9% to +96%; target ±10%).
- **WARN** Antlered Lancers (shockCav) trades 0.73 enemy points per point lost, −38% from the shockCav median 1.17 (95%: −58% to −8%; target ±10%).
- **WARN** Hour Levy (antiLarge) trades 0.85 enemy points per point lost, −33% from the antiLarge median 1.26 (95%: −49% to −8%; target ±10%).
- …and 19 more.

**Target 4: Counters** (22 fail, 0 warn)

- **FAIL** Rimeguard (700) has 0 counters in Vesperate (none); 2 Vesperate units cost no more.
- **FAIL** Gnomon Guard (700) has 0 counters in Vesperate (none); 2 Vesperate units cost no more.
- **FAIL** Galewings (650) has 0 counters in Choir (none); 3 Choir units cost no more.
- **FAIL** Anchor Guard (650) has 0 counters in Choir (none); 3 Choir units cost no more.
- **FAIL** Anchor Guard (650) has 0 counters in Vesperate (none); 2 Vesperate units cost no more.
- **FAIL** Shardbows (600) has 0 counters in Vesperate (none); 2 Vesperate units cost no more.
- **FAIL** Gale Dancers (700) has 0 counters in Vesperate (none); 2 Vesperate units cost no more.
- **FAIL** Cinder Penitents (700) has 0 counters in Vesperate (none); 2 Vesperate units cost no more.
- **FAIL** Rimeguard (700) has 1 counter in Choir (Shardbows 100%); 5 Choir units cost no more.
- **FAIL** Reedspears (450) has 1 counter in Hush (Glowkin Lurers 100%); 2 Hush units cost no more.
- …and 12 more.

**Target 5: Colossus vs combined arms** (0 fail, 3 warn)

- **WARN** The Umbral Mother wins 56% (95%: 45%–65%, n=90) alone against 3186 points of combined arms (target 40–50%).
- **WARN** Old Midnight wins 36% (95%: 27%–46%, n=90) alone against 3197 points of combined arms (target 40–50%).
- **WARN** The Nailbearer wins 51% (95%: 41%–61%, n=90) alone against 3171 points of combined arms (target 40–50%).

**Notes** (29)

- [target 3] Belfry Wagon (support) trades 0.02 enemy points per point lost, −90% from the support median 0.24 (95%: −93% to −86%; target ±10%); support units are valued for their auras, which duels do not measure.
- [target 3] Veilweavers (support) trades 0.28 enemy points per point lost, +16% from the support median 0.24 (95%: −41% to +85%; target ±10%); support units are valued for their auras, which duels do not measure.
- [target 4] Reedspears (450) can't have 2 counters in Choir: only 0 Choir units cost 450 or less.
- [target 4] Reedspears (450) can't have 2 counters in Vesperate: only 0 Vesperate units cost 450 or less.
- [target 4] Hour Levy (550) can't have 2 counters in Choir: only 1 Choir unit costs 550 or less.
- [target 4] Glowkin Lurers (350) can't have 2 counters in Choir: only 0 Choir units cost 350 or less.
- [target 4] Glowkin Lurers (350) can't have 2 counters in Vesperate: only 0 Vesperate units cost 350 or less.
- [target 4] Glowkin Lurers (350) can't have 2 counters in Drift: only 1 Drift unit costs 350 or less.
- [target 4] Kiln Acolytes (500) can't have 2 counters in Vesperate: only 0 Vesperate units cost 500 or less.
- [target 4] Windbows (500) can't have 2 counters in Choir: only 1 Choir unit costs 500 or less.
- [target 4] Windbows (500) can't have 2 counters in Vesperate: only 0 Vesperate units cost 500 or less.
- [target 4] Hushbows (500) can't have 2 counters in Choir: only 1 Choir unit costs 500 or less.
- [target 4] Hushbows (500) can't have 2 counters in Vesperate: only 0 Vesperate units cost 500 or less.
- [target 4] Dustrunners (350) can't have 2 counters in Choir: only 0 Choir units cost 350 or less.
- [target 4] Dustrunners (350) can't have 2 counters in Vesperate: only 0 Vesperate units cost 350 or less.
- [target 4] Strider Archers (500) can't have 2 counters in Vesperate: only 0 Vesperate units cost 500 or less.
- [target 4] Rime Hounds (400) can't have 2 counters in Choir: only 0 Choir units cost 400 or less.
- [target 4] Rime Hounds (400) can't have 2 counters in Vesperate: only 0 Vesperate units cost 400 or less.
- [target 4] Rime Hounds (400) can't have 2 counters in Drift: only 1 Drift unit costs 400 or less.
- [target 4] Dustrunners (350) can't have 2 counters in Hush: only 1 Hush unit costs 350 or less.
- [target 4] Bell Outriders (550) can't have 2 counters in Choir: only 1 Choir unit costs 550 or less.
- [target 4] Strider Archers (500) can't have 2 counters in Choir: only 1 Choir unit costs 500 or less.
- [counters table] The doc's counters table has shock beating line, but shock units won 43% (95%: 27%–61%, n=30) of equal-cost duels against line units.
- [counters table] The doc's counters table has monster beating line, but monster units won 43% (95%: 21%–67%, n=14) of equal-cost duels against line units.
- [counters table] The doc's counters table has monster beating missile, but monster units won 39% (95%: 20%–61%, n=18) of equal-cost duels against missile units.
- [counters table] The doc's counters table has flyer beating missile, but flyer units won 25% (95%: 11%–47%, n=20) of equal-cost duels against missile units.
- [counters table] The doc's counters table has missileCav beating monster, but missileCav units won 0% (95%: 0%–22%, n=14) of equal-cost duels against monster units.
- [counters table] The doc's counters table has monster beating shock, but monster units won 0% (95%: 0%–24%, n=12) of equal-cost duels against shock units.
- [counters table] The doc's counters table has artillery beating monster, but artillery units won 0% (95%: 0%–14%, n=24) of equal-cost duels against monster units.

## 1. Faction vs faction (equal cost)

360 battles over 15 conditions; 96 ended on the timer, 18 drawn; mean length 398 s.

Win rate of the row faction against the column faction (% wins, 95% interval, battles):

| | Choir | Hush | Vesperate | Drift | vs field |
|---|---|---|---|---|---|
| **Choir** | — | 49% (37%–61%, 60) | 59% (47%–71%, 60) | 66% (53%–77%, 60) | 58% (51%–65%, 180) |
| **Hush** | 51% (39%–63%, 60) | — | 31% (21%–43%, 60) | 51% (39%–63%, 60) | 44% (37%–51%, 180) |
| **Vesperate** | 41% (29%–53%, 60) | 69% (57%–79%, 60) | — | 59% (47%–71%, 60) | 56% (49%–63%, 180) |
| **Drift** | 34% (23%–47%, 60) | 49% (37%–61%, 60) | 41% (29%–53%, 60) | — | 41% (34%–49%, 180) |

Side 0 (bottom edge) wins 49% (95%: 44%–54%, n=360); by sun bearing: N 41% (n=88), E 53% (n=90), S 55% (n=92), W 47% (n=90). With the sun in the north, side 0 faces it.

Armies that rolled their colossus against one that didn't won 51% (95%: 43%–58%, n=156).

### 2. Conditions

Best and worst condition against the field:

| Faction | Worst | Best |
|---|---|---|
| Choir | Dark / Gale: 0% (0%–24%, 12) | Blaze / Breeze: 100% (76%–100%, 12) |
| Hush | Bright / Gale: 13% (3%–40%, 12) | Dark / Calm: 79% (51%–93%, 12) |
| Vesperate | Dark / Calm: 25% (9%–53%, 12) | Dark / Gale: 92% (65%–99%, 12) |
| Drift | Bright / Breeze: 17% (5%–45%, 12) | Bright / Gale: 75% (47%–91%, 12) |

Win rate against the field in each condition (% wins, battles):

| Faction | Light | Calm | Breeze | Gale |
|---|---|---|---|---|
| **Choir** | Dark | 42% (12) | 38% (12) | 0% (12) |
|  | Dim | 54% (12) | 29% (12) | 8% (12) |
|  | Dusk | 54% (12) | 75% (12) | 79% (12) |
|  | Bright | 71% (12) | 79% (12) | 79% (12) |
|  | Blaze | 79% (12) | 100% (12) | 83% (12) |
| **Hush** | Dark | 79% (12) | 50% (12) | 67% (12) |
|  | Dim | 33% (12) | 63% (12) | 79% (12) |
|  | Dusk | 50% (12) | 33% (12) | 17% (12) |
|  | Bright | 17% (12) | 58% (12) | 13% (12) |
|  | Blaze | 46% (12) | 25% (12) | 33% (12) |
| **Vesperate** | Dark | 25% (12) | 50% (12) | 92% (12) |
|  | Dim | 54% (12) | 67% (12) | 63% (12) |
|  | Dusk | 67% (12) | 58% (12) | 67% (12) |
|  | Bright | 75% (12) | 46% (12) | 33% (12) |
|  | Blaze | 46% (12) | 46% (12) | 58% (12) |
| **Drift** | Dark | 54% (12) | 63% (12) | 42% (12) |
|  | Dim | 58% (12) | 42% (12) | 50% (12) |
|  | Dusk | 29% (12) | 33% (12) | 38% (12) |
|  | Bright | 38% (12) | 17% (12) | 75% (12) |
|  | Blaze | 29% (12) | 29% (12) | 25% (12) |

Each pairing by light level and by wind (win rate of the first faction, battles):

| Pairing | Dark | Dim | Dusk | Bright | Blaze | Calm | Breeze | Gale |
|---|---|---|---|---|---|---|---|---|
| Choir vs Hush | 13% (12) | 29% (12) | 50% (12) | 79% (12) | 75% (12) | 53% (20) | 53% (20) | 43% (20) |
| Choir vs Vesperate | 38% (12) | 13% (12) | 79% (12) | 71% (12) | 96% (12) | 57% (20) | 63% (20) | 57% (20) |
| Choir vs Drift | 29% (12) | 50% (12) | 79% (12) | 79% (12) | 92% (12) | 70% (20) | 78% (20) | 50% (20) |
| Hush vs Vesperate | 25% (12) | 54% (12) | 17% (12) | 25% (12) | 33% (12) | 40% (20) | 30% (20) | 23% (20) |
| Hush vs Drift | 83% (12) | 50% (12) | 33% (12) | 42% (12) | 46% (12) | 48% (20) | 60% (20) | 45% (20) |
| Vesperate vs Drift | 29% (12) | 50% (12) | 88% (12) | 50% (12) | 79% (12) | 57% (20) | 53% (20) | 68% (20) |

## 5. Colossus vs equal-cost combined arms

360 battles: each colossus alone against about 3,200 points of an enemy faction's line, missiles and cavalry (no lord, heroes or colossus).

| Colossus | Wins | Choir | Hush | Vesperate | Drift | Dark | Dim | Dusk | Bright | Blaze | Arms cost | Mean length | Timeouts | Colossus HP lost | Arms value lost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| The Nailbearer | 51% (41%–61%, 90) | — | 20% | 67% | 67% | 56% | 33% | 56% | 50% | 61% | 3171 | 190 s | 2 | 66% | 69% |
| The Umbral Mother | 56% (45%–65%, 90) | 73% | — | 77% | 17% | 56% | 67% | 39% | 56% | 61% | 3186 | 141 s | 0 | 57% | 67% |
| Old Midnight | 36% (27%–46%, 90) | 30% | 27% | — | 52% | 56% | 39% | 53% | 31% | 3% | 3197 | 351 s | 27 | 60% | 47% |
| The Dreadsail | 44% (35%–55%, 90) | 43% | 33% | 57% | — | 39% | 53% | 58% | 33% | 39% | 3191 | 309 s | 14 | 63% | 61% |

Battles on the timer are scored by the simulation’s remaining-value rule: every unit still fighting counts its cost times the share of its hit points left, so a badly hurt colossus counts for what is left of it.

## 3. Cost efficiency in role (unit duels)

1452 duels at equal cost (the cheaper unit fielded in copies to within 10%), Dusk light and a Breeze on open ground; 32 ended on the timer (0 without a real fight), and in 6% the duel harness had to send an idle unit in. Efficiency is enemy points destroyed per own point lost (wounds count), summed over every duel against every enemy-faction unit; the interval is a bootstrap over duels.

| Unit | Faction | Role | Cost | Duel wins | Efficiency | Role median | vs median (95%) | Flag |
|---|---|---|---|---|---|---|---|---|
| Rimeguard | Hush | antiLarge | 700 | 72% (66) | 1.83 | 1.26 | +45% (−1% to +128%) | **WARN** |
| Reedspears | Drift | antiLarge | 450 | 77% (66) | 1.80 | 1.26 | +43% (+12% to +88%) | **FAIL** |
| Gnomon Guard | Choir | antiLarge | 700 | 67% (66) | 1.26 | 1.26 | ±0% (−28% to +36%) |  |
| Oathsworn Halberdiers | Vesperate | antiLarge | 800 | 55% (66) | 1.04 | 1.26 | −17% (−36% to +5%) | **WARN** |
| Hour Levy | Vesperate | antiLarge | 550 | 45% (66) | 0.85 | 1.26 | −33% (−49% to −8%) | **WARN** |
| Heliostat Battery | Choir | artillery | 1450 | 53% (66) | 0.98 | 0.75 | +31% (−9% to +96%) | **WARN** |
| Rime Spitters | Hush | artillery | 900 | 41% (66) | 0.92 | 0.75 | +24% (−6% to +70%) | **WARN** |
| Sailcart Ballistae | Drift | artillery | 900 | 30% (66) | 0.85 | 0.75 | +14% (−16% to +52%) | **WARN** |
| Whalebreaker Ballista | Hush | artillery | 900 | 35% (66) | 0.81 | 0.75 | +9% (−19% to +49%) |  |
| Knell Cannon | Vesperate | artillery | 1000 | 34% (66) | 0.68 | 0.75 | −9% (−33% to +26%) |  |
| Firekite Battery | Drift | artillery | 900 | 23% (66) | 0.64 | 0.75 | −14% (−34% to +8%) | **WARN** |
| Cinderglass Mangonel | Choir | artillery | 1150 | 33% (66) | 0.59 | 0.75 | −20% (−43% to +11%) | **WARN** |
| Counterweight Engine | Vesperate | artillery | 750 | 15% (66) | 0.44 | 0.75 | −41% (−55% to −22%) | **FAIL** |
| Dusk Moth Riders | Hush | flyer | 1000 | 73% (66) | 1.89 | 1.71 | +10% (−17% to +47%) | **WARN** |
| Galewings | Drift | flyer | 650 | 71% (66) | 1.54 | 1.71 | −10% (−30% to +11%) | **WARN** |
| Anchor Guard | Drift | line | 650 | 82% (66) | 1.90 | 1.30 | +46% (+18% to +85%) | **FAIL** |
| Glowkin Lurers | Hush | line | 350 | 83% (66) | 1.87 | 1.30 | +44% (+17% to +73%) | **FAIL** |
| Kiln Acolytes | Choir | line | 500 | 59% (66) | 1.30 | 1.30 | ±0% (−19% to +26%) |  |
| Mirror Wardens | Choir | line | 800 | 56% (66) | 1.18 | 1.30 | −9% (−30% to +19%) |  |
| Lantern Guard | Vesperate | line | 800 | 52% (66) | 0.97 | 1.30 | −26% (−44% to +2%) | **WARN** |
| Windbows | Drift | missile | 500 | 91% (66) | 5.03 | 1.31 | +283% (+161% to +539%) | **FAIL** |
| Hushbows | Hush | missile | 500 | 70% (66) | 1.87 | 1.31 | +42% (+9% to +96%) | **WARN** |
| Lenswrights | Choir | missile | 1200 | 57% (66) | 1.47 | 1.31 | +12% (−24% to +57%) | **WARN** |
| Vesper Arbalests | Vesperate | missile | 900 | 53% (66) | 1.16 | 1.31 | −12% (−35% to +24%) | **WARN** |
| Shardbows | Choir | missile | 600 | 48% (66) | 1.07 | 1.31 | −19% (−39% to +4%) | **WARN** |
| Lamplighters | Vesperate | missile | 800 | 38% (66) | 0.69 | 1.31 | −48% (−64% to −30%) | **FAIL** |
| Dustrunners | Drift | missileCav | 350 | 40% (66) | 1.04 | 0.98 | +6% (−20% to +38%) |  |
| Bell Outriders | Vesperate | missileCav | 550 | 44% (66) | 1.00 | 0.98 | +2% (−22% to +39%) |  |
| Strider Archers | Drift | missileCav | 500 | 32% (66) | 0.95 | 0.98 | −2% (−22% to +24%) |  |
| Heliographer Riders | Choir | missileCav | 650 | 38% (66) | 0.89 | 0.98 | −9% (−31% to +20%) |  |
| Lanternmaws | Hush | monster | 950 | 65% (66) | 1.44 | 1.28 | +13% (−13% to +47%) | **WARN** |
| Molten Saints | Choir | monster | 1350 | 58% (66) | 1.12 | 1.28 | −13% (−33% to +17%) | **WARN** |
| Gale Dancers | Drift | shock | 700 | 64% (66) | 1.19 | 1.02 | +17% (−10% to +55%) | **WARN** |
| Cinder Penitents | Choir | shock | 700 | 58% (66) | 1.11 | 1.02 | +9% (−15% to +39%) |  |
| The Unlit | Hush | shock | 750 | 56% (66) | 0.93 | 1.02 | −9% (−34% to +23%) |  |
| Knellguard | Vesperate | shock | 1150 | 44% (66) | 0.91 | 1.02 | −11% (−34% to +17%) | **WARN** |
| Rime Hounds | Hush | shockCav | 400 | 64% (66) | 1.40 | 1.17 | +20% (−11% to +58%) | **WARN** |
| Grue Hunters | Hush | shockCav | 850 | 61% (66) | 1.36 | 1.17 | +16% (−16% to +64%) | **WARN** |
| Strider Lancers | Drift | shockCav | 1150 | 53% (66) | 1.17 | 1.17 | ±0% (−24% to +33%) |  |
| Kilnback Lancers | Choir | shockCav | 1350 | 43% (66) | 0.84 | 1.17 | −28% (−46% to −4%) | **WARN** |
| Antlered Lancers | Vesperate | shockCav | 1300 | 40% (66) | 0.73 | 1.17 | −38% (−58% to −8%) | **WARN** |
| Veilweavers | Hush | support | 650 | 15% (66) | 0.28 | 0.24 | +16% (−41% to +85%) | **INFO** |
| Howling Kites | Drift | support | 600 | 12% (66) | 0.24 | 0.24 | ±0% (−58% to +69%) |  |
| Belfry Wagon | Vesperate | support | 800 | 0% (66) | 0.02 | 0.24 | −90% (−93% to −86%) | **INFO** |

### Role against role

Win rate of row-role units against column-role units at equal cost (% wins, duels):

| | antiLarge | artillery | flyer | line | missile | missileCav | monster | shock | shockCav | support |
|---|---|---|---|---|---|---|---|---|---|---|
| **antiLarge** | 50% (36) | 68% (60) | 19% (16) | 42% (38) | 25% (44) | 100% (30) | 75% (16) | 60% (30) | 100% (38) | 95% (22) |
| **artillery** | 32% (60) | 50% (96) | 8% (24) | 20% (60) | 56% (72) | 0% (48) | 0% (24) | 40% (48) | 5% (60) | 86% (36) |
| **flyer** | 81% (16) | 92% (24) | 50% (4) | 100% (16) | 25% (20) | 58% (12) | 33% (6) | 92% (12) | 64% (14) | 100% (8) |
| **line** | 58% (38) | 80% (60) | 0% (16) | 50% (36) | 50% (44) | 100% (30) | 57% (14) | 57% (30) | 84% (38) | 92% (24) |
| **missile** | 75% (44) | 44% (72) | 75% (20) | 50% (44) | 50% (52) | 61% (36) | 61% (18) | 89% (36) | 39% (46) | 89% (28) |
| **missileCav** | 0% (30) | 100% (48) | 42% (12) | 0% (30) | 39% (36) | 50% (20) | 0% (14) | 25% (24) | 2% (32) | 100% (18) |
| **monster** | 25% (16) | 100% (24) | 67% (6) | 43% (14) | 39% (18) | 100% (14) | 50% (4) | 0% (12) | 79% (14) | 90% (10) |
| **shock** | 40% (30) | 60% (48) | 8% (12) | 43% (30) | 11% (36) | 75% (24) | 100% (12) | 50% (24) | 93% (30) | 100% (18) |
| **shockCav** | 0% (38) | 95% (60) | 36% (14) | 16% (38) | 61% (46) | 98% (32) | 21% (14) | 7% (30) | 50% (36) | 100% (22) |
| **support** | 5% (22) | 14% (36) | 0% (8) | 8% (24) | 11% (28) | 0% (18) | 10% (10) | 0% (18) | 0% (22) | 50% (12) |

The doc's counters table, checked against these duels: 12 of 19 relations hold (the counter wins more than half). Contradicted: shock over line (43%, n=30); missileCav over monster (0%, n=14); monster over line (43%, n=14); monster over shock (0%, n=12); monster over missile (39%, n=18); artillery over monster (0%, n=24); flyer over missile (25%, n=20).

## 4. Counters

A counter is an enemy unit that costs no more and wins at least 60% of the duels. Each cell lists the counters found (win %), or why the target cannot be met.

| Unit | Cost | Choir | Hush | Vesperate | Drift |
|---|---|---|---|---|---|
| Rimeguard | 700 | ✗ Shardbows 100% | — | ✗ | ✓ Windbows 100%, Galewings 100% |
| Reedspears | 450 | n/a (0 cheaper) | ✗ Glowkin Lurers 100% | n/a (0 cheaper) | — |
| Gnomon Guard | 700 | — | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100% | ✗ | ✗ Windbows 100% |
| Oathsworn Halberdiers | 800 | ✓ Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100% | — | ✓ Anchor Guard 100%, Windbows 100%, Galewings 100% |
| Hour Levy | 550 | n/a (1 cheaper) | ✓ Glowkin Lurers 100%, Hushbows 100% | — | ✓ Reedspears 100%, Windbows 100% |
| Heliostat Battery | 1450 | — | ✓ Veilweavers 100%, Rime Hounds 100%, Grue Hunters 100%, Dusk Moth Riders 100%, Lanternmaws 100%, Whalebreaker Ballista 100% | ✓ Bell Outriders 100%, Antlered Lancers 100% | ✓ Reedspears 100%, Anchor Guard 100%, Dustrunners 100%, Strider Archers 100%, Strider Lancers 100%, Galewings 100%, Sailcart Ballistae 100% |
| Rime Spitters | 900 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Heliographer Riders 100% | — | ✓ Lantern Guard 100%, Bell Outriders 100% | ✓ Reedspears 100%, Anchor Guard 100%, Dustrunners 100%, Strider Archers 100%, Galewings 100%, Sailcart Ballistae 100% |
| Sailcart Ballistae | 900 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Shardbows 100%, Heliographer Riders 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100%, Hushbows 100%, Rime Hounds 100%, Grue Hunters 100%, Whalebreaker Ballista 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Vesper Arbalests 100%, Bell Outriders 100% | — |
| Whalebreaker Ballista | 900 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Shardbows 100%, Heliographer Riders 100% | — | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Vesper Arbalests 100%, Bell Outriders 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Dustrunners 100%, Strider Archers 100%, Galewings 100% |
| Knell Cannon | 1000 | ✓ Shardbows 100%, Heliographer Riders 100% | ✓ Hushbows 100%, Rime Hounds 100%, Grue Hunters 100%, Dusk Moth Riders 100%, Lanternmaws 100%, Rime Spitters 100%, Whalebreaker Ballista 100% | — | ✓ Reedspears 100%, Gale Dancers 100%, Windbows 100%, Dustrunners 100%, Strider Archers 100%, Galewings 100%, Sailcart Ballistae 100% |
| Firekite Battery | 900 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Cinder Penitents 100%, Heliographer Riders 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, Rime Hounds 100%, Grue Hunters 100%, Rime Spitters 100%, Whalebreaker Ballista 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Bell Outriders 100%, Counterweight Engine 100% | — |
| Cinderglass Mangonel | 1150 | — | ✓ Rime Hounds 100%, Grue Hunters 100%, Dusk Moth Riders 100%, Lanternmaws 100%, Rime Spitters 100%, Whalebreaker Ballista 100% | ✓ Lantern Guard 100%, Bell Outriders 100%, Counterweight Engine 100%, Knell Cannon 75% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Dustrunners 100%, Strider Archers 100%, Strider Lancers 100%, Galewings 100%, Sailcart Ballistae 100% |
| Counterweight Engine | 750 | ✓ Kiln Acolytes 100%, Gnomon Guard 100%, Cinder Penitents 100%, Heliographer Riders 100% | ✓ Glowkin Lurers 100%, Hushbows 100%, Rime Hounds 100% | — | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Dustrunners 100%, Strider Archers 100%, Galewings 100% |
| Dusk Moth Riders | 1000 | ✗ Shardbows 100% | — | ✗ Vesper Arbalests 100% | ✓ Reedspears 100%, Windbows 100%, Galewings 100%, Sailcart Ballistae 100% |
| Galewings | 650 | ✗ | ✗ Hushbows 100% | ✗ Bell Outriders 100% | — |
| Anchor Guard | 650 | ✗ | ✗ Glowkin Lurers 100% | ✗ | — |
| Glowkin Lurers | 350 | n/a (0 cheaper) | — | n/a (0 cheaper) | n/a (1 cheaper) |
| Kiln Acolytes | 500 | — | ✓ Glowkin Lurers 100%, Hushbows 100% | n/a (0 cheaper) | ✓ Reedspears 100%, Windbows 100% |
| Mirror Wardens | 800 | — | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100% | ✓ Lantern Guard 100%, Lamplighters 100% | ✓ Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Galewings 100% |
| Lantern Guard | 800 | ✓ Gnomon Guard 100%, Cinder Penitents 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100% | — | ✓ Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Galewings 100% |
| Windbows | 500 | n/a (1 cheaper) | ✗ Rime Hounds 100% | n/a (0 cheaper) | — |
| Hushbows | 500 | n/a (1 cheaper) | — | n/a (0 cheaper) | ✓ Reedspears 100%, Windbows 100% |
| Lenswrights | 1200 | — | ✓ Glowkin Lurers 100%, Veilweavers 100%, Rime Hounds 100%, Grue Hunters 100%, Rime Spitters 100%, Whalebreaker Ballista 100% | ✗ Bell Outriders 75% | ✓ Reedspears 100%, Windbows 100%, Dustrunners 100%, Sailcart Ballistae 100% |
| Vesper Arbalests | 900 | ✗ Mirror Wardens 100% | ✓ Glowkin Lurers 100%, Rime Hounds 100%, Grue Hunters 100% | — | ✓ Reedspears 100%, Anchor Guard 100%, Windbows 100%, Firekite Battery 100% |
| Shardbows | 600 | — | ✓ Glowkin Lurers 100%, Hushbows 100% | ✗ | ✓ Reedspears 100%, Windbows 100% |
| Lamplighters | 800 | ✗ Shardbows 100% | ✓ Hushbows 100%, Rime Hounds 100% | — | ✓ Windbows 100%, Dustrunners 100%, Strider Archers 100% |
| Dustrunners | 350 | n/a (0 cheaper) | n/a (1 cheaper) Glowkin Lurers 100% | n/a (0 cheaper) | — |
| Bell Outriders | 550 | n/a (1 cheaper) Kiln Acolytes 100% | ✓ Glowkin Lurers 100%, Rime Hounds 100%, Hushbows 75% | — | ✓ Reedspears 100%, Windbows 100% |
| Strider Archers | 500 | n/a (1 cheaper) Kiln Acolytes 100% | ✓ Glowkin Lurers 100%, Hushbows 100%, Rime Hounds 100% | n/a (0 cheaper) | — |
| Heliographer Riders | 650 | — | ✓ Glowkin Lurers 100%, Hushbows 100%, Rime Hounds 100% | ✓ Hour Levy 100%, Bell Outriders 100% | ✓ Reedspears 100%, Anchor Guard 100%, Windbows 100%, Dustrunners 100%, Galewings 100% |
| Lanternmaws | 950 | ✓ Kiln Acolytes 100%, Gnomon Guard 100%, Cinder Penitents 100% | — | ✗ Oathsworn Halberdiers 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100% |
| Molten Saints | 1350 | — | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100%, Hushbows 100%, Rime Hounds 100%, Dusk Moth Riders 100% | ✓ Oathsworn Halberdiers 100%, Knellguard 100%, Vesper Arbalests 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100% |
| Gale Dancers | 700 | ✓ Kiln Acolytes 100%, Gnomon Guard 100%, Shardbows 100% | ✓ Glowkin Lurers 100%, Hushbows 100%, Rimeguard 75% | ✗ | — |
| Cinder Penitents | 700 | — | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100% | ✗ | ✓ Reedspears 100%, Anchor Guard 100%, Windbows 100%, Galewings 100%, Gale Dancers 75% |
| The Unlit | 750 | ✗ Heliographer Riders 100% | — | ✓ Hour Levy 100%, Bell Outriders 100% | ✓ Anchor Guard 100%, Windbows 100%, Galewings 100% |
| Knellguard | 1150 | ✓ Kiln Acolytes 100%, Gnomon Guard 100%, Cinder Penitents 100%, Cinderglass Mangonel 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100%, Hushbows 100%, Rime Hounds 100%, Dusk Moth Riders 100% | — | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Galewings 100% |
| Rime Hounds | 400 | n/a (0 cheaper) | — | n/a (0 cheaper) | n/a (1 cheaper) |
| Grue Hunters | 850 | ✓ Kiln Acolytes 100%, Gnomon Guard 100%, Cinder Penitents 100% | — | ✓ Hour Levy 100%, Oathsworn Halberdiers 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100% |
| Strider Lancers | 1150 | ✓ Kiln Acolytes 100%, Gnomon Guard 100%, Cinder Penitents 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100%, Hushbows 100%, Dusk Moth Riders 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Knellguard 100% | — |
| Kilnback Lancers | 1350 | — | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100%, Hushbows 100%, Rime Hounds 100%, Dusk Moth Riders 100%, Lanternmaws 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Knellguard 100%, Vesper Arbalests 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Strider Lancers 100% |
| Antlered Lancers | 1300 | ✓ Kiln Acolytes 100%, Gnomon Guard 100%, Cinder Penitents 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100%, Hushbows 100%, Rime Hounds 100%, Grue Hunters 100%, Dusk Moth Riders 100%, Lanternmaws 100%, Whalebreaker Ballista 100% | — | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Strider Lancers 100% |
| Veilweavers | 650 | ✓ Kiln Acolytes 100%, Shardbows 100%, Heliographer Riders 100% | — | ✓ Hour Levy 100%, Bell Outriders 100% | ✓ Reedspears 100%, Anchor Guard 100%, Windbows 100%, Dustrunners 100%, Strider Archers 100%, Galewings 100% |
| Howling Kites | 600 | ✓ Kiln Acolytes 100%, Shardbows 100% | ✓ Hushbows 100%, Rime Hounds 100% | ✓ Hour Levy 100%, Bell Outriders 100% | — |
| Belfry Wagon | 800 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Shardbows 100%, Heliographer Riders 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100%, Hushbows 100%, Veilweavers 100%, Rime Hounds 100% | — | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Dustrunners 100%, Strider Archers 100%, Galewings 100%, Howling Kites 100% |

## 6. Cost formula

Cost = k · sqrt(EHP · EDPS) · s + a, from stats alone. EHP is total HP over exposure to a reference line soldier (75%) and arrow (25%) after MD, armor and shields; EDPS is expected damage per second of the whole unit against a reference line/cavalry mix (front two ranks in contact, one charge per 20 s, missiles over a 150 s fight with a range factor); s = (speed / 5)^0.3; a = heuristic points for mechanics, abilities and passives. k is fitted per role family (median), so the deviation compares a unit with others of its kind. Definitions are in `src/balance/formula.ts`.

k by family: infantry 0.57, missile 1.36, cavalry 0.76, monster 0.89, artillery 8.00, colossus 2.13, character 2.33, support 2.03.

| Unit | Family | Cost | Formula | Actual vs formula | EHP | EDPS | s | a |
|---|---|---|---|---|---|---|---|---|
| Heliostat Battery | artillery | 1450 | 1222 | +19% | 820 | 42.2 | 0.82 | 0 |
| Whalebreaker Ballista | artillery | 900 | 829 | +9% | 725 | 20.1 | 0.86 | 0 |
| Knell Cannon | artillery | 1000 | 954 | +5% | 925 | 23.9 | 0.80 | 0 |
| Firekite Battery | artillery | 900 | 894 | +1% | 638 | 24.7 | 0.89 | 0 |
| Cinderglass Mangonel | artillery | 1150 | 1158 | −1% | 716 | 41.5 | 0.84 | 0 |
| Sailcart Ballistae | artillery | 900 | 1187 | −24% | 876 | 20.5 | 1.11 | 0 |
| Counterweight Engine | artillery | 750 | 1401 | −46% | 757 | 62.6 | 0.78 | 40 |
| Rime Spitters | artillery | 900 | 2200 | −59% | 1653 | 52.4 | 0.94 | 0 |
| Strider Archers | cavalry | 500 | 462 | +8% | 4600 | 47.6 | 1.30 | 0 |
| Kilnback Lancers | cavalry | 1350 | 1250 | +8% | 11414 | 151.6 | 1.19 | 60 |
| Antlered Lancers | cavalry | 1300 | 1236 | +5% | 10890 | 140.8 | 1.23 | 80 |
| Strider Lancers | cavalry | 1150 | 1142 | +1% | 8375 | 147.5 | 1.28 | 60 |
| Bell Outriders | cavalry | 550 | 550 | ±0% | 4637 | 54.6 | 1.28 | 60 |
| Grue Hunters | cavalry | 850 | 905 | −6% | 6961 | 125.3 | 1.25 | 20 |
| Heliographer Riders | cavalry | 650 | 701 | −7% | 5072 | 65.5 | 1.28 | 140 |
| Rime Hounds | cavalry | 400 | 505 | −21% | 2845 | 68.4 | 1.30 | 70 |
| Dustrunners | cavalry | 350 | 472 | −26% | 4447 | 50.3 | 1.32 | 0 |
| Wind-Reader | character | 750 | 207 | +262% | 1337 | 2.8 | 1.03 | 60 |
| Lamplighter-Captain | character | 750 | 289 | +160% | 2149 | 4.5 | 1.00 | 60 |
| Listener | character | 800 | 374 | +114% | 1296 | 2.5 | 1.01 | 240 |
| Glasswright | character | 800 | 398 | +101% | 1564 | 2.9 | 1.00 | 240 |
| Bellwright | character | 700 | 415 | +69% | 1964 | 3.6 | 0.99 | 220 |
| Pale Huntress | character | 850 | 792 | +7% | 2757 | 16.9 | 1.06 | 260 |
| Anvil-Walker | character | 850 | 934 | −9% | 5408 | 24.2 | 1.01 | 80 |
| Skywarden | character | 850 | 950 | −11% | 2835 | 15.7 | 1.36 | 280 |
| Tavi Longwind, the Helm | character | 1100 | 1479 | −26% | 5021 | 43.6 | 1.30 | 60 |
| High Cantor Oriel | character | 1100 | 2106 | −48% | 10586 | 77.5 | 0.97 | 60 |
| Queen Ysh, the Unlit | character | 1100 | 2259 | −51% | 6159 | 105.9 | 1.03 | 320 |
| Keeper Maren Carillon | character | 1100 | 2408 | −54% | 9181 | 75.1 | 1.21 | 60 |
| The Dreadsail | colossus | 3200 | 2363 | +35% | 20847 | 28.3 | 1.27 | 290 |
| The Umbral Mother | colossus | 3200 | 2981 | +7% | 12354 | 55.4 | 1.23 | 810 |
| The Nailbearer | colossus | 3200 | 3476 | −8% | 22800 | 96.9 | 0.95 | 470 |
| Old Midnight | colossus | 3200 | 4324 | −26% | 40158 | 126.5 | 0.78 | 570 |
| Rimeguard | infantry | 700 | 539 | +30% | 9742 | 82.8 | 0.99 | 30 |
| Hour Levy | infantry | 550 | 464 | +19% | 9373 | 52.7 | 0.98 | 70 |
| Knellguard | infantry | 1150 | 996 | +15% | 14347 | 226.5 | 0.96 | 0 |
| Gnomon Guard | infantry | 700 | 618 | +13% | 12591 | 79.1 | 0.96 | 70 |
| Oathsworn Halberdiers | infantry | 800 | 721 | +11% | 12793 | 101.9 | 0.96 | 90 |
| Kiln Acolytes | infantry | 500 | 478 | +5% | 10417 | 61.4 | 0.98 | 30 |
| Cinder Penitents | infantry | 700 | 698 | ±0% | 7684 | 158.6 | 1.01 | 60 |
| Lantern Guard | infantry | 800 | 803 | ±0% | 20012 | 80.8 | 0.96 | 100 |
| Mirror Wardens | infantry | 800 | 857 | −7% | 22143 | 76.0 | 0.95 | 150 |
| Gale Dancers | infantry | 700 | 756 | −7% | 7154 | 188.0 | 1.05 | 60 |
| Reedspears | infantry | 450 | 500 | −10% | 8631 | 56.4 | 1.02 | 90 |
| Anchor Guard | infantry | 650 | 744 | −13% | 17257 | 88.7 | 0.96 | 60 |
| Glowkin Lurers | infantry | 350 | 405 | −14% | 8217 | 57.6 | 1.00 | 10 |
| The Unlit | infantry | 750 | 1001 | −25% | 8547 | 217.5 | 1.02 | 200 |
| Lamplighters | missile | 800 | 634 | +26% | 3627 | 61.2 | 0.99 | 0 |
| Lenswrights | missile | 1200 | 956 | +26% | 3375 | 157.7 | 0.96 | 0 |
| Shardbows | missile | 600 | 529 | +13% | 4007 | 39.2 | 0.98 | 0 |
| Vesper Arbalests | missile | 900 | 1016 | −11% | 5942 | 95.4 | 0.96 | 30 |
| Windbows | missile | 500 | 569 | −12% | 3832 | 44.5 | 1.01 | 0 |
| Hushbows | missile | 500 | 694 | −28% | 3958 | 44.9 | 1.00 | 120 |
| Dusk Moth Riders | monster | 1000 | 637 | +57% | 2758 | 44.8 | 1.33 | 220 |
| Galewings | monster | 650 | 610 | +7% | 2357 | 53.3 | 1.36 | 180 |
| Molten Saints | monster | 1350 | 1460 | −8% | 11996 | 169.5 | 1.02 | 160 |
| Lanternmaws | monster | 950 | 1143 | −17% | 9820 | 106.8 | 1.08 | 160 |
| Belfry Wagon | support | 800 | 326 | +146% | 1655 | 0.8 | 0.89 | 260 |
| Howling Kites | support | 600 | 600 | ±0% | 2417 | 16.9 | 0.98 | 200 |
| Veilweavers | support | 650 | 817 | −20% | 3282 | 21.0 | 0.99 | 290 |

## Simulation health

2172 battles run; 0 threw, 0 produced NaNs, 0 hit the wall-clock limit.

| Suite | Battles | Timeouts | Mean simulated length | Mean CPU per battle |
|---|---|---|---|---|
| factions | 360 | 96 | 398 s | 12.10 s |
| duels | 1452 | 32 | 81 s | 0.56 s |
| colossus | 360 | 43 | 248 s | 2.52 s |

Faction battles that hit the time limit (96 of 360): units most often still fighting on the side that was behind — Tavi Longwind, the Helm 29, The Dreadsail 19, Howling Kites 19, Windbows 18, Vesper Arbalests 15, Sailcart Ballistae 15, Reedspears 14, High Cantor Oriel 12, Queen Ysh, the Unlit 11, Belfry Wagon 11, Rime Spitters 10, Hushbows 10.

## Method

- Both sides are played by the same scripted battle AI (`src/ai/battleAI.ts`). Every fixture is fought twice with the sides swapped, and the sun is rotated north, east, south and west across fixtures, so deployment edge and glare cancel out.
- Conditions: 5 light levels (Dark to Blaze) × 3 winds (Calm, Breeze, Gale), each fought on the terrain of the band that has that light naturally (Evernight, Dimmark, Gloaming, Long Afternoon, Glare).
- Faction battles: two armies of the same budget from the army generator (`generateArmy`, colossus “maybe”), one random draw per fixture, auto-deployed; decided by rout (every unit routed, or an army broken: under 25% of its value still fighting while the enemy has at least twice as much plus 10 percentage points), or on remaining value (cost times hit points left, for units still fighting) at the time limit.
- Unit duels: cost-matched copies placed 300 m apart on open, flat ground checked free of water, woods and rocks. A lone unit gives the battle AI no battle line, so the duel harness (`src/balance/duelAI.ts`) sends idle units at the nearest enemy after 20 s without damage or closing in; both sides use it. Duels leave out army context: no general, no Toll, no auras from other units.
- Unit size: with `unitScale` below 1 only infantry, cavalry, beasts and flyers shrink; monsters, artillery, heroes and colossi keep full strength, so reduced-scale runs favour armies that field more of them.
- Win rates count a draw as half a win. Intervals are 95% Wilson intervals for win rates and bootstrap intervals for efficiency.

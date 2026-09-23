# Nailed Sun balance report

Generated 2026-09-23T10:36:13.537Z at commit `f1ec05a+changes`. Command: `npx tsx tools/balance.ts --raw (report rebuilt from reports/balance-raw.tmp.json)`.

Settings: suites ["factions","colossus","duels"]; seeds {"factions":1,"duels":1,"colossus":1}; factionScale 1; budget 12000; armsBudget 3200; factions ["choir","hush","vesperate","drift"]; conditions all 15; timeLimits {"factions":600,"duels":300,"colossus":600}; quick false.

Runtime: factions: 180 battles in 6 min 20 s (mean 8.4 s CPU each); colossus: 360 battles in 3 min 13 s (mean 2.1 s CPU each); duels: 1452 battles in 3 min 58 s (mean 0.6 s CPU each) on 4 worker threads, 4 cores, Node v22.22.2.

## Targets

| # | Target | Goal | Status | Summary |
|---|---|---|---|---|
| 1 | Faction vs faction, all conditions | 45–55% wins at equal cost, averaged over every light and wind condition | **FAIL** | 4 clear misses, 4 possible (within noise). Vs field: Choir 72%, Hush 19%, Vesperate 54%, Drift 56%. |
| 2 | Best and worst conditions | never above 60% or below 40% in a faction’s best or worst condition | **FAIL** | 26 clear misses, 62 possible (within noise). |
| 3 | Cost efficiency in role | within ±10% of the role median | **FAIL** | 7 clear misses, 21 possible (within noise). 2 notes. |
| 4 | Counters | at least 2 counters in each enemy faction that cost no more | **FAIL** | 19 clear misses, 0 possible (within noise). 16 notes. |
| 5 | Colossus vs combined arms | the colossus wins 40–50% against equal cost | **FAIL** | 4 clear misses, 0 possible (within noise). The Nailbearer 88%, The Umbral Mother 7%, Old Midnight 10%, The Dreadsail 66%. |

FAIL means the whole 95% interval misses the target; WARN means the estimate misses but the interval still overlaps it (more seeds would tell).

## Flags

Worst first within each target; clear misses (FAIL) before possible ones (WARN). Every flag is in the JSON report.

**Simulation** (0 fail, 1 warn)

- **WARN** 34% of faction battles hit the time limit and were decided on remaining value.

**Target 1: Faction vs faction, all conditions** (4 fail, 4 warn)

- **FAIL** Choir win 87% (95%: 70%–95%, n=30) against Hush over all conditions (target 45–55%).
- **FAIL** Drift win 87% (95%: 70%–95%, n=30) against Hush over all conditions (target 45–55%).
- **FAIL** Hush win 19% (95%: 12%–28%, n=90) against all other factions (target 45–55%).
- **FAIL** Choir win 72% (95%: 62%–80%, n=90) against all other factions (target 45–55%).
- **WARN** Vesperate win 70% (95%: 52%–83%, n=30) against Hush over all conditions (target 45–55%).
- **WARN** Choir win 65% (95%: 47%–79%, n=30) against Drift over all conditions (target 45–55%).
- **WARN** Choir win 63% (95%: 46%–78%, n=30) against Vesperate over all conditions (target 45–55%).
- **WARN** Drift win 56% (95%: 45%–65%, n=90) against all other factions (target 45–55%).

**Target 2: Best and worst conditions** (26 fail, 62 warn)

- **FAIL** Choir win 100% (95%: 61%–100%, n=6) against the field in Dusk / Breeze (target 40–60%).
- **FAIL** Choir win 100% (95%: 61%–100%, n=6) against the field in Dusk / Gale (target 40–60%).
- **FAIL** Choir win 100% (95%: 61%–100%, n=6) against the field in Blaze / Calm (target 40–60%).
- **FAIL** Choir win 100% (95%: 61%–100%, n=6) against the field in Blaze / Breeze (target 40–60%).
- **FAIL** Choir win 100% (95%: 61%–100%, n=6) against the field in Blaze / Gale (target 40–60%).
- **FAIL** Hush win 0% (95%: 0%–39%, n=6) against the field in Dim / Gale (target 40–60%).
- **FAIL** Hush win 0% (95%: 0%–39%, n=6) against the field in Dusk / Calm (target 40–60%).
- **FAIL** Hush win 0% (95%: 0%–39%, n=6) against the field in Dusk / Breeze (target 40–60%).
- **FAIL** Hush win 0% (95%: 0%–39%, n=6) against the field in Bright / Calm (target 40–60%).
- **FAIL** Hush win 0% (95%: 0%–39%, n=6) against the field in Bright / Breeze (target 40–60%).
- …and 78 more.

**Target 3: Cost efficiency in role** (7 fail, 21 warn)

- **FAIL** Cinderglass Mangonel (artillery) trades 2.67 enemy points per point lost, +238% from the artillery median 0.79 (95%: +119% to +452%; target ±10%).
- **FAIL** Heliostat Battery (artillery) trades 2.38 enemy points per point lost, +201% from the artillery median 0.79 (95%: +95% to +374%; target ±10%).
- **FAIL** Reedspears (antiLarge) trades 2.94 enemy points per point lost, +97% from the antiLarge median 1.50 (95%: +50% to +177%; target ±10%).
- **FAIL** Knell Cannon (artillery) trades 0.45 enemy points per point lost, −43% from the artillery median 0.79 (95%: −56% to −26%; target ±10%).
- **FAIL** Counterweight Engine (artillery) trades 0.47 enemy points per point lost, −40% from the artillery median 0.79 (95%: −54% to −21%; target ±10%).
- **FAIL** The Unlit (shock) trades 0.63 enemy points per point lost, −38% from the shock median 1.01 (95%: −53% to −17%; target ±10%).
- **FAIL** Strider Archers (missileCav) trades 0.52 enemy points per point lost, −35% from the missileCav median 0.79 (95%: −52% to −15%; target ±10%).
- **WARN** Bell Outriders (missileCav) trades 1.03 enemy points per point lost, +29% from the missileCav median 0.79 (95%: −3% to +79%; target ±10%).
- **WARN** Hour Levy (antiLarge) trades 1.93 enemy points per point lost, +29% from the antiLarge median 1.50 (95%: −3% to +60%; target ±10%).
- **WARN** Anchor Guard (line) trades 1.25 enemy points per point lost, −29% from the line median 1.75 (95%: −46% to −6%; target ±10%).
- …and 18 more.

**Target 4: Counters** (19 fail, 0 warn)

- **FAIL** Kiln Acolytes (450) has 0 counters in Hush (none); 2 Hush units cost no more.
- **FAIL** Dustrunners (550) has 0 counters in Vesperate (none); 2 Vesperate units cost no more.
- **FAIL** Cinderglass Mangonel (900) has 1 counter in Hush (Rime Hounds 100%); 6 Hush units cost no more.
- **FAIL** Cinderglass Mangonel (900) has 1 counter in Vesperate (Bell Outriders 100%); 7 Vesperate units cost no more.
- **FAIL** Heliostat Battery (1250) has 1 counter in Vesperate (Bell Outriders 100%); 10 Vesperate units cost no more.
- **FAIL** Galewings (1100) has 1 counter in Hush (Hushbows 100%); 8 Hush units cost no more.
- **FAIL** Mirror Wardens (750) has 1 counter in Hush (Glowkin Lurers 100%); 4 Hush units cost no more.
- **FAIL** Mirror Wardens (750) has 1 counter in Vesperate (Lamplighters 100%); 5 Vesperate units cost no more.
- **FAIL** Mirror Wardens (750) has 1 counter in Drift (Reedspears 100%); 4 Drift units cost no more.
- **FAIL** Lantern Guard (750) has 1 counter in Hush (Glowkin Lurers 100%); 4 Hush units cost no more.
- …and 9 more.

**Target 5: Colossus vs combined arms** (4 fail, 0 warn)

- **FAIL** The Nailbearer wins 88% (95%: 80%–93%, n=90) alone against 3186 points of combined arms (target 40–50%).
- **FAIL** The Umbral Mother wins 7% (95%: 3%–14%, n=90) alone against 3183 points of combined arms (target 40–50%).
- **FAIL** Old Midnight wins 10% (95%: 5%–18%, n=90) alone against 3189 points of combined arms (target 40–50%).
- **FAIL** The Dreadsail wins 66% (95%: 55%–75%, n=90) alone against 3191 points of combined arms (target 40–50%).

**Notes** (26)

- [sim] 4 duels ended on the timer with neither side 5% down; their result is a coin flip on remaining value.
- [target 3] Belfry Wagon (support) trades 0.02 enemy points per point lost, −91% from the support median 0.25 (95%: −94% to −85%; target ±10%); support units are valued for their auras, which duels do not measure.
- [target 3] Veilweavers (support) trades 0.33 enemy points per point lost, +32% from the support median 0.25 (95%: −14% to +89%; target ±10%); support units are valued for their auras, which duels do not measure.
- [target 4] Reedspears (400) can't have 2 counters in Choir: only 0 Choir units cost 400 or less.
- [target 4] Reedspears (400) can't have 2 counters in Hush: only 1 Hush unit costs 400 or less.
- [target 4] Reedspears (400) can't have 2 counters in Vesperate: only 1 Vesperate unit costs 400 or less.
- [target 4] Hour Levy (400) can't have 2 counters in Choir: only 0 Choir units cost 400 or less.
- [target 4] Hour Levy (400) can't have 2 counters in Hush: only 1 Hush unit costs 400 or less.
- [target 4] Hour Levy (400) can't have 2 counters in Drift: only 1 Drift unit costs 400 or less.
- [target 4] Kiln Acolytes (450) can't have 2 counters in Vesperate: only 1 Vesperate unit costs 450 or less.
- [target 4] Glowkin Lurers (400) can't have 2 counters in Choir: only 0 Choir units cost 400 or less.
- [target 4] Glowkin Lurers (400) can't have 2 counters in Vesperate: only 1 Vesperate unit costs 400 or less.
- [target 4] Kiln Acolytes (450) can't have 2 counters in Drift: only 1 Drift unit costs 450 or less.
- [target 4] Glowkin Lurers (400) can't have 2 counters in Drift: only 1 Drift unit costs 400 or less.
- [target 4] Windbows (500) can't have 2 counters in Vesperate: only 1 Vesperate unit costs 500 or less.
- [target 4] Shardbows (500) can't have 2 counters in Vesperate: only 1 Vesperate unit costs 500 or less.
- [target 4] Rime Hounds (450) can't have 2 counters in Choir: only 1 Choir unit costs 450 or less.
- [target 4] Rime Hounds (450) can't have 2 counters in Vesperate: only 1 Vesperate unit costs 450 or less.
- [target 4] Rime Hounds (450) can't have 2 counters in Drift: only 1 Drift unit costs 450 or less.
- [counters table] The doc's counters table has line beating antiLarge, but line units won 50% (95%: 35%–65%, n=38) of equal-cost duels against antiLarge units.
- [counters table] The doc's counters table has flyer beating missile, but flyer units won 13% (95%: 4%–33%, n=20) of equal-cost duels against missile units.
- [counters table] The doc's counters table has shock beating line, but shock units won 5% (95%: 1%–19%, n=30) of equal-cost duels against line units.
- [counters table] The doc's counters table has monster beating line, but monster units won 0% (95%: 0%–22%, n=14) of equal-cost duels against line units.
- [counters table] The doc's counters table has monster beating shock, but monster units won 0% (95%: 0%–24%, n=12) of equal-cost duels against shock units.
- [counters table] The doc's counters table has monster beating missile, but monster units won 0% (95%: 0%–18%, n=18) of equal-cost duels against missile units.
- [counters table] The doc's counters table has artillery beating monster, but artillery units won 0% (95%: 0%–14%, n=24) of equal-cost duels against monster units.

## 1. Faction vs faction (equal cost)

180 battles over 15 conditions; 61 ended on the timer, 4 drawn; mean length 442 s.

Win rate of the row faction against the column faction (% wins, 95% interval, battles):

| | Choir | Hush | Vesperate | Drift | vs field |
|---|---|---|---|---|---|
| **Choir** | — | 87% (70%–95%, 30) | 63% (46%–78%, 30) | 65% (47%–79%, 30) | 72% (62%–80%, 90) |
| **Hush** | 13% (5%–30%, 30) | — | 30% (17%–48%, 30) | 13% (5%–30%, 30) | 19% (12%–28%, 90) |
| **Vesperate** | 37% (22%–54%, 30) | 70% (52%–83%, 30) | — | 55% (38%–71%, 30) | 54% (44%–64%, 90) |
| **Drift** | 35% (21%–53%, 30) | 87% (70%–95%, 30) | 45% (29%–62%, 30) | — | 56% (45%–65%, 90) |

Side 0 (bottom edge) wins 52% (95%: 44%–59%, n=180); by sun bearing: N 55% (n=44), E 50% (n=46), S 53% (n=46), W 49% (n=44). With the sun in the north, side 0 faces it.

Armies that rolled their colossus against one that didn't won 51% (95%: 40%–61%, n=80).

### 2. Conditions

Best and worst condition against the field:

| Faction | Worst | Best |
|---|---|---|
| Choir | Dim / Calm: 17% (3%–56%, 6) | Dusk / Breeze: 100% (61%–100%, 6) |
| Hush | Dim / Gale: 0% (0%–39%, 6) | Dim / Calm: 83% (44%–97%, 6) |
| Vesperate | Dark / Calm: 0% (0%–39%, 6) | Bright / Calm: 92% (52%–99%, 6) |
| Drift | Dark / Gale: 33% (10%–70%, 6) | Dark / Breeze: 83% (44%–97%, 6) |

Win rate against the field in each condition (% wins, battles):

| Faction | Light | Calm | Breeze | Gale |
|---|---|---|---|---|
| **Choir** | Dark | 75% (6) | 33% (6) | 67% (6) |
|  | Dim | 17% (6) | 17% (6) | 50% (6) |
|  | Dusk | 83% (6) | 100% (6) | 100% (6) |
|  | Bright | 75% (6) | 92% (6) | 67% (6) |
|  | Blaze | 100% (6) | 100% (6) | 100% (6) |
| **Hush** | Dark | 50% (6) | 17% (6) | 17% (6) |
|  | Dim | 83% (6) | 33% (6) | 0% (6) |
|  | Dusk | 0% (6) | 0% (6) | 17% (6) |
|  | Bright | 0% (6) | 0% (6) | 17% (6) |
|  | Blaze | 0% (6) | 17% (6) | 33% (6) |
| **Vesperate** | Dark | 0% (6) | 67% (6) | 83% (6) |
|  | Dim | 67% (6) | 83% (6) | 83% (6) |
|  | Dusk | 50% (6) | 33% (6) | 50% (6) |
|  | Bright | 92% (6) | 75% (6) | 50% (6) |
|  | Blaze | 50% (6) | 25% (6) | 0% (6) |
| **Drift** | Dark | 75% (6) | 83% (6) | 33% (6) |
|  | Dim | 33% (6) | 67% (6) | 67% (6) |
|  | Dusk | 67% (6) | 67% (6) | 33% (6) |
|  | Bright | 33% (6) | 33% (6) | 67% (6) |
|  | Blaze | 50% (6) | 58% (6) | 67% (6) |

Each pairing by light level and by wind (win rate of the first faction, battles):

| Pairing | Dark | Dim | Dusk | Bright | Blaze | Calm | Breeze | Gale |
|---|---|---|---|---|---|---|---|---|
| Choir vs Hush | 83% (6) | 50% (6) | 100% (6) | 100% (6) | 100% (6) | 80% (10) | 80% (10) | 100% (10) |
| Choir vs Vesperate | 50% (6) | 17% (6) | 83% (6) | 67% (6) | 100% (6) | 55% (10) | 65% (10) | 70% (10) |
| Choir vs Drift | 42% (6) | 17% (6) | 100% (6) | 67% (6) | 100% (6) | 75% (10) | 60% (10) | 60% (10) |
| Hush vs Vesperate | 33% (6) | 50% (6) | 0% (6) | 17% (6) | 50% (6) | 40% (10) | 20% (10) | 30% (10) |
| Hush vs Drift | 33% (6) | 17% (6) | 17% (6) | 0% (6) | 0% (6) | 20% (10) | 0% (10) | 20% (10) |
| Vesperate vs Drift | 33% (6) | 100% (6) | 17% (6) | 100% (6) | 25% (6) | 50% (10) | 55% (10) | 60% (10) |

## 5. Colossus vs equal-cost combined arms

360 battles: each colossus alone against about 3,200 points of an enemy faction's line, missiles and cavalry (no lord, heroes or colossus).

| Colossus | Wins | Choir | Hush | Vesperate | Drift | Dark | Dim | Dusk | Bright | Blaze | Arms cost | Mean length | Timeouts | Colossus HP lost | Arms value lost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| The Nailbearer | 88% (80%–93%, 90) | — | 98% | 98% | 68% | 78% | 81% | 92% | 97% | 94% | 3186 | 269 s | 15 | 35% | 89% |
| The Umbral Mother | 7% (3%–14%, 90) | 13% | — | 8% | 0% | 0% | 11% | 14% | 11% | 0% | 3183 | 210 s | 3 | 97% | 27% |
| Old Midnight | 10% (5%–18%, 90) | 8% | 13% | — | 8% | 11% | 0% | 25% | 8% | 6% | 3189 | 301 s | 13 | 91% | 15% |
| The Dreadsail | 66% (55%–75%, 90) | 60% | 67% | 70% | — | 67% | 58% | 75% | 61% | 67% | 3191 | 349 s | 18 | 54% | 79% |

Battles on the timer are scored by the simulation’s remaining-value rule, which counts a colossus at full value until it falls.

## 3. Cost efficiency in role (unit duels)

1452 duels at equal cost (the cheaper unit fielded in copies to within 10%), Dusk light and a Breeze on open ground; 126 ended on the timer (4 without a real fight), and in 42% the duel harness had to send an idle unit in. Efficiency is enemy points destroyed per own point lost (wounds count), summed over every duel against every enemy-faction unit; the interval is a bootstrap over duels.

| Unit | Faction | Role | Cost | Duel wins | Efficiency | Role median | vs median (95%) | Flag |
|---|---|---|---|---|---|---|---|---|
| Reedspears | Drift | antiLarge | 400 | 95% (66) | 2.94 | 1.50 | +97% (+50% to +177%) | **FAIL** |
| Hour Levy | Vesperate | antiLarge | 400 | 85% (66) | 1.93 | 1.50 | +29% (−3% to +60%) | **WARN** |
| Oathsworn Halberdiers | Vesperate | antiLarge | 750 | 65% (66) | 1.50 | 1.50 | ±0% (−30% to +36%) |  |
| Rimeguard | Hush | antiLarge | 700 | 57% (66) | 1.33 | 1.50 | −11% (−36% to +25%) | **WARN** |
| Gnomon Guard | Choir | antiLarge | 700 | 58% (66) | 1.31 | 1.50 | −12% (−31% to +16%) | **WARN** |
| Cinderglass Mangonel | Choir | artillery | 900 | 70% (66) | 2.67 | 0.79 | +238% (+119% to +452%) | **FAIL** |
| Heliostat Battery | Choir | artillery | 1250 | 69% (66) | 2.38 | 0.79 | +201% (+95% to +374%) | **FAIL** |
| Firekite Battery | Drift | artillery | 1150 | 44% (66) | 0.88 | 0.79 | +12% (−13% to +56%) | **WARN** |
| Rime Spitters | Hush | artillery | 900 | 27% (66) | 0.86 | 0.79 | +9% (−22% to +50%) |  |
| Sailcart Ballistae | Drift | artillery | 900 | 23% (66) | 0.72 | 0.79 | −9% (−29% to +16%) |  |
| Whalebreaker Ballista | Hush | artillery | 1100 | 34% (66) | 0.71 | 0.79 | −10% (−30% to +17%) |  |
| Counterweight Engine | Vesperate | artillery | 950 | 10% (66) | 0.47 | 0.79 | −40% (−54% to −21%) | **FAIL** |
| Knell Cannon | Vesperate | artillery | 1200 | 11% (66) | 0.45 | 0.79 | −43% (−56% to −26%) | **FAIL** |
| Dusk Moth Riders | Hush | flyer | 1150 | 67% (66) | 1.91 | 1.81 | +6% (−22% to +45%) |  |
| Galewings | Drift | flyer | 1100 | 68% (66) | 1.71 | 1.81 | −6% (−19% to +9%) |  |
| Mirror Wardens | Choir | line | 750 | 75% (66) | 2.02 | 1.75 | +15% (−11% to +46%) | **WARN** |
| Kiln Acolytes | Choir | line | 450 | 86% (66) | 1.93 | 1.75 | +10% (−12% to +34%) | **WARN** |
| Glowkin Lurers | Hush | line | 400 | 83% (66) | 1.75 | 1.75 | ±0% (−23% to +36%) |  |
| Lantern Guard | Vesperate | line | 750 | 68% (66) | 1.51 | 1.75 | −14% (−37% to +15%) | **WARN** |
| Anchor Guard | Drift | line | 850 | 62% (66) | 1.25 | 1.75 | −29% (−46% to −6%) | **WARN** |
| Windbows | Drift | missile | 500 | 55% (66) | 1.47 | 1.27 | +16% (−18% to +64%) | **WARN** |
| Lamplighters | Vesperate | missile | 700 | 70% (66) | 1.46 | 1.27 | +15% (−22% to +56%) | **WARN** |
| Lenswrights | Choir | missile | 1100 | 55% (66) | 1.30 | 1.27 | +2% (−22% to +43%) |  |
| Shardbows | Choir | missile | 500 | 53% (66) | 1.25 | 1.27 | −2% (−24% to +25%) |  |
| Vesper Arbalests | Vesperate | missile | 800 | 56% (66) | 1.22 | 1.27 | −4% (−29% to +43%) |  |
| Hushbows | Hush | missile | 550 | 48% (66) | 1.12 | 1.27 | −12% (−35% to +21%) | **WARN** |
| Bell Outriders | Vesperate | missileCav | 550 | 58% (66) | 1.03 | 0.79 | +29% (−3% to +79%) | **WARN** |
| Heliographer Riders | Choir | missileCav | 750 | 38% (66) | 0.88 | 0.79 | +10% (−24% to +54%) | **WARN** |
| Dustrunners | Drift | missileCav | 550 | 38% (66) | 0.71 | 0.79 | −10% (−35% to +24%) | **WARN** |
| Strider Archers | Drift | missileCav | 900 | 18% (66) | 0.52 | 0.79 | −35% (−52% to −15%) | **FAIL** |
| Molten Saints | Choir | monster | 1800 | 47% (66) | 0.80 | 0.68 | +17% (−18% to +65%) | **WARN** |
| Lanternmaws | Hush | monster | 1700 | 29% (66) | 0.56 | 0.68 | −17% (−40% to +14%) | **WARN** |
| Gale Dancers | Drift | shock | 850 | 60% (66) | 1.23 | 1.01 | +22% (−1% to +61%) | **WARN** |
| Cinder Penitents | Choir | shock | 800 | 64% (66) | 1.20 | 1.01 | +19% (−7% to +54%) | **WARN** |
| Knellguard | Vesperate | shock | 1250 | 40% (66) | 0.81 | 1.01 | −19% (−42% to +9%) | **WARN** |
| The Unlit | Hush | shock | 1200 | 32% (66) | 0.63 | 1.01 | −38% (−53% to −17%) | **FAIL** |
| Rime Hounds | Hush | shockCav | 450 | 61% (66) | 1.11 | 0.90 | +23% (−10% to +61%) | **WARN** |
| Antlered Lancers | Vesperate | shockCav | 1300 | 48% (66) | 0.93 | 0.90 | +3% (−22% to +34%) |  |
| Strider Lancers | Drift | shockCav | 1250 | 45% (66) | 0.90 | 0.90 | ±0% (−28% to +32%) |  |
| Kilnback Lancers | Choir | shockCav | 1300 | 51% (66) | 0.88 | 0.90 | −3% (−32% to +31%) |  |
| Grue Hunters | Hush | shockCav | 950 | 39% (66) | 0.81 | 0.90 | −11% (−34% to +23%) | **WARN** |
| Veilweavers | Hush | support | 800 | 21% (66) | 0.33 | 0.25 | +32% (−14% to +89%) | **INFO** |
| Howling Kites | Drift | support | 750 | 11% (66) | 0.25 | 0.25 | ±0% (−48% to +74%) |  |
| Belfry Wagon | Vesperate | support | 800 | 7% (66) | 0.02 | 0.25 | −91% (−94% to −85%) | **INFO** |

### Role against role

Win rate of row-role units against column-role units at equal cost (% wins, duels):

| | antiLarge | artillery | flyer | line | missile | missileCav | monster | shock | shockCav | support |
|---|---|---|---|---|---|---|---|---|---|---|
| **antiLarge** | 50% (36) | 70% (60) | 31% (16) | 50% (38) | 50% (44) | 97% (30) | 94% (16) | 93% (30) | 100% (38) | 95% (22) |
| **artillery** | 30% (60) | 50% (96) | 8% (24) | 27% (60) | 64% (72) | 6% (48) | 0% (24) | 48% (48) | 10% (60) | 76% (36) |
| **flyer** | 69% (16) | 92% (24) | 50% (4) | 81% (16) | 13% (20) | 50% (12) | 67% (6) | 67% (12) | 93% (14) | 100% (8) |
| **line** | 50% (38) | 73% (60) | 19% (16) | 50% (36) | 68% (44) | 100% (30) | 100% (14) | 95% (30) | 100% (38) | 96% (24) |
| **missile** | 50% (44) | 36% (72) | 88% (20) | 32% (44) | 50% (52) | 72% (36) | 100% (18) | 86% (36) | 35% (46) | 93% (28) |
| **missileCav** | 3% (30) | 94% (48) | 50% (12) | 0% (30) | 28% (36) | 50% (20) | 64% (14) | 13% (24) | 0% (32) | 89% (18) |
| **monster** | 6% (16) | 100% (24) | 33% (6) | 0% (14) | 0% (18) | 36% (14) | 50% (4) | 0% (12) | 57% (14) | 80% (10) |
| **shock** | 7% (30) | 52% (48) | 33% (12) | 5% (30) | 14% (36) | 88% (24) | 100% (12) | 50% (24) | 98% (30) | 94% (18) |
| **shockCav** | 0% (38) | 90% (60) | 7% (14) | 0% (38) | 65% (46) | 100% (32) | 43% (14) | 2% (30) | 50% (36) | 91% (22) |
| **support** | 5% (22) | 24% (36) | 0% (8) | 4% (24) | 7% (28) | 11% (18) | 20% (10) | 6% (18) | 9% (22) | 50% (12) |

The doc's counters table, checked against these duels: 12 of 19 relations hold (the counter wins more than half). Contradicted: line over antiLarge (50%, n=38); shock over line (5%, n=30); monster over line (0%, n=14); monster over shock (0%, n=12); monster over missile (0%, n=18); artillery over monster (0%, n=24); flyer over missile (13%, n=20).

## 4. Counters

A counter is an enemy unit that costs no more and wins at least 60% of the duels. Each cell lists the counters found (win %), or why the target cannot be met.

| Unit | Cost | Choir | Hush | Vesperate | Drift |
|---|---|---|---|---|---|
| Reedspears | 400 | n/a (0 cheaper) | n/a (1 cheaper) | n/a (1 cheaper) | — |
| Hour Levy | 400 | n/a (0 cheaper) | n/a (1 cheaper) | — | n/a (1 cheaper) |
| Oathsworn Halberdiers | 750 | ✓ Kiln Acolytes 100%, Mirror Wardens 100% | ✓ Glowkin Lurers 100%, Hushbows 100% | — | ✓ Reedspears 100%, Windbows 100% |
| Rimeguard | 700 | ✓ Kiln Acolytes 100%, Shardbows 100% | — | ✓ Hour Levy 100%, Lamplighters 100% | ✓ Windbows 100%, Reedspears 75% |
| Gnomon Guard | 700 | — | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100% | ✓ Hour Levy 100%, Lamplighters 100% | ✓ Reedspears 100%, Windbows 100% |
| Cinderglass Mangonel | 900 | — | ✗ Rime Hounds 100% | ✗ Bell Outriders 100% | ✓ Reedspears 100%, Dustrunners 100% |
| Heliostat Battery | 1250 | — | ✓ Veilweavers 100%, Rime Hounds 100%, Dusk Moth Riders 100% | ✗ Bell Outriders 100% | ✓ Reedspears 100%, Dustrunners 100%, Galewings 100% |
| Firekite Battery | 1150 | ✓ Kiln Acolytes 100%, Cinder Penitents 100%, Heliographer Riders 100%, Cinderglass Mangonel 100% | ✓ Glowkin Lurers 100%, Rime Hounds 100%, Grue Hunters 100%, Dusk Moth Riders 100% | ✓ Hour Levy 100%, Bell Outriders 100% | — |
| Rime Spitters | 900 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Heliographer Riders 100%, Cinderglass Mangonel 100% | — | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Bell Outriders 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Dustrunners 100%, Strider Archers 100%, Sailcart Ballistae 100% |
| Sailcart Ballistae | 900 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Heliographer Riders 100%, Cinderglass Mangonel 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, Rime Hounds 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Vesper Arbalests 100%, Lamplighters 100%, Bell Outriders 100% | — |
| Whalebreaker Ballista | 1100 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Heliographer Riders 100%, Cinderglass Mangonel 100% | — | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Bell Outriders 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Dustrunners 100%, Strider Archers 100% |
| Counterweight Engine | 950 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Shardbows 100%, Heliographer Riders 100%, Cinderglass Mangonel 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, Rime Hounds 100%, Grue Hunters 100% | — | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Dustrunners 100%, Strider Archers 100%, Sailcart Ballistae 100% |
| Knell Cannon | 1200 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Cinder Penitents 100%, Shardbows 100%, Lenswrights 100%, Heliographer Riders 100%, Cinderglass Mangonel 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100%, Rime Hounds 100%, Grue Hunters 100%, Dusk Moth Riders 100%, Whalebreaker Ballista 100%, Rime Spitters 75% | — | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Dustrunners 100%, Strider Archers 100%, Galewings 100%, Sailcart Ballistae 100%, Firekite Battery 100% |
| Dusk Moth Riders | 1150 | ✓ Kiln Acolytes 100%, Shardbows 100%, Lenswrights 100% | — | ✓ Hour Levy 100%, Vesper Arbalests 100%, Lamplighters 75% | ✓ Reedspears 100%, Gale Dancers 100%, Windbows 100% |
| Galewings | 1100 | ✓ Cinder Penitents 100%, Shardbows 100%, Lenswrights 100%, Heliographer Riders 100% | ✗ Hushbows 100% | ✓ Vesper Arbalests 100%, Bell Outriders 100% | — |
| Mirror Wardens | 750 | — | ✗ Glowkin Lurers 100% | ✗ Lamplighters 100% | ✗ Reedspears 100% |
| Kiln Acolytes | 450 | — | ✗ | n/a (1 cheaper) | n/a (1 cheaper) Reedspears 100% |
| Glowkin Lurers | 400 | n/a (0 cheaper) | — | n/a (1 cheaper) | n/a (1 cheaper) Reedspears 100% |
| Lantern Guard | 750 | ✓ Kiln Acolytes 100%, Mirror Wardens 100% | ✗ Glowkin Lurers 100% | — | ✗ Reedspears 100% |
| Anchor Guard | 850 | ✓ Kiln Acolytes 100%, Gnomon Guard 100% | ✓ Glowkin Lurers 100%, Rimeguard 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Lamplighters 100% | — |
| Windbows | 500 | ✗ Kiln Acolytes 100% | ✓ Glowkin Lurers 100%, Rime Hounds 100% | n/a (1 cheaper) Hour Levy 100% | — |
| Lamplighters | 700 | ✗ Shardbows 100% | ✗ Hushbows 100% | — | ✗ Windbows 100% |
| Lenswrights | 1100 | — | ✓ Glowkin Lurers 100%, Veilweavers 100%, Rime Hounds 100%, Grue Hunters 100%, Whalebreaker Ballista 100% | ✓ Hour Levy 100%, Oathsworn Halberdiers 100%, Bell Outriders 100%, Counterweight Engine 100% | ✓ Reedspears 100%, Gale Dancers 100%, Dustrunners 100% |
| Shardbows | 500 | — | ✓ Glowkin Lurers 100%, Rime Hounds 100% | n/a (1 cheaper) Hour Levy 100% | ✗ Reedspears 100% |
| Vesper Arbalests | 800 | ✓ Kiln Acolytes 100%, Gnomon Guard 100% | ✓ Glowkin Lurers 100%, Rime Hounds 100% | — | ✗ Reedspears 100% |
| Hushbows | 550 | ✓ Kiln Acolytes 100%, Shardbows 100% | — | ✓ Hour Levy 100%, Bell Outriders 100% | ✓ Reedspears 100%, Windbows 100% |
| Bell Outriders | 550 | ✗ Kiln Acolytes 100% | ✓ Glowkin Lurers 100%, Rime Hounds 100% | — | ✗ Reedspears 100% |
| Heliographer Riders | 750 | — | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100%, Rime Hounds 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Lamplighters 100%, Bell Outriders 100% | ✓ Reedspears 100%, Windbows 100%, Dustrunners 100% |
| Dustrunners | 550 | ✓ Kiln Acolytes 100%, Shardbows 100% | ✓ Glowkin Lurers 100%, Hushbows 100%, Rime Hounds 100% | ✗ | — |
| Strider Archers | 900 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Shardbows 100%, Heliographer Riders 100%, Cinderglass Mangonel 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100%, Veilweavers 100%, Rime Hounds 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Vesper Arbalests 100%, Lamplighters 100%, Bell Outriders 100% | — |
| Molten Saints | 1800 | — | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100%, Hushbows 100%, Rime Hounds 100%, Dusk Moth Riders 100% | ✓ Lantern Guard 100%, Oathsworn Halberdiers 100%, Knellguard 100%, Vesper Arbalests 100%, Lamplighters 100%, Bell Outriders 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100% |
| Lanternmaws | 1700 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Shardbows 100%, Lenswrights 100%, Heliographer Riders 100% | — | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Knellguard 100%, Vesper Arbalests 100%, Lamplighters 100%, Bell Outriders 100%, Antlered Lancers 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Dustrunners 100%, Galewings 100% |
| Gale Dancers | 850 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Shardbows 100%, Cinder Penitents 75% | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Lamplighters 100% | — |
| Cinder Penitents | 800 | — | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100% | ✓ Hour Levy 100%, Oathsworn Halberdiers 100%, Vesper Arbalests 100%, Lamplighters 100% | ✓ Reedspears 100%, Windbows 100% |
| Knellguard | 1250 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Lenswrights 100%, Heliostat Battery 100%, Cinderglass Mangonel 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100%, Dusk Moth Riders 100%, Rime Spitters 100% | — | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Galewings 100%, Sailcart Ballistae 100%, Firekite Battery 100% |
| The Unlit | 1200 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Shardbows 100%, Lenswrights 100%, Cinderglass Mangonel 100% | — | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Vesper Arbalests 100%, Lamplighters 100%, Bell Outriders 100%, Knell Cannon 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100%, Galewings 100%, Firekite Battery 100% |
| Rime Hounds | 450 | n/a (1 cheaper) Kiln Acolytes 100% | — | n/a (1 cheaper) Hour Levy 100% | n/a (1 cheaper) Reedspears 100% |
| Antlered Lancers | 1300 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Kilnback Lancers 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100%, Rime Hounds 100%, Dusk Moth Riders 100% | — | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Galewings 100% |
| Strider Lancers | 1250 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100%, Rime Hounds 100%, Grue Hunters 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Knellguard 100%, Lamplighters 100% | — |
| Kilnback Lancers | 1300 | — | ✓ Glowkin Lurers 100%, Rimeguard 100%, The Unlit 100%, Rime Hounds 100%, Dusk Moth Riders 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Knellguard 100%, Lamplighters 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Galewings 100% |
| Grue Hunters | 950 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Shardbows 100% | — | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Vesper Arbalests 100%, Lamplighters 100% | ✓ Reedspears 100%, Gale Dancers 100%, Anchor Guard 100%, Windbows 100% |
| Veilweavers | 800 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Gnomon Guard 100%, Cinder Penitents 100%, Shardbows 100%, Heliographer Riders 100% | — | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Vesper Arbalests 100%, Lamplighters 100%, Bell Outriders 100% | ✓ Reedspears 100%, Windbows 100%, Dustrunners 100% |
| Howling Kites | 750 | ✓ Mirror Wardens 100%, Gnomon Guard 100%, Shardbows 100%, Heliographer Riders 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100%, Rime Hounds 100% | ✓ Hour Levy 100%, Lantern Guard 100%, Oathsworn Halberdiers 100%, Lamplighters 100%, Bell Outriders 100% | — |
| Belfry Wagon | 800 | ✓ Kiln Acolytes 100%, Mirror Wardens 100%, Cinder Penitents 100%, Shardbows 100%, Heliographer Riders 100% | ✓ Glowkin Lurers 100%, Rimeguard 100%, Hushbows 100%, Veilweavers 100%, Rime Hounds 100% | — | ✓ Reedspears 100%, Windbows 100%, Dustrunners 100%, Howling Kites 100% |

## 6. Cost formula

Cost = k · sqrt(EHP · EDPS) · s + a, from stats alone. EHP is total HP over exposure to a reference line soldier (75%) and arrow (25%) after MD, armor and shields; EDPS is expected damage per second of the whole unit against a reference line/cavalry mix (front two ranks in contact, one charge per 20 s, missiles over a 150 s fight with a range factor); s = (speed / 5)^0.3; a = heuristic points for mechanics, abilities and passives. k is fitted per role family (median), so the deviation compares a unit with others of its kind. Definitions are in `src/balance/formula.ts`.

k by family: infantry 0.63, missile 1.23, cavalry 0.80, monster 1.76, artillery 6.60, colossus 2.98, character 2.33, support 2.79.

| Unit | Family | Cost | Formula | Actual vs formula | EHP | EDPS | s | a |
|---|---|---|---|---|---|---|---|---|
| Whalebreaker Ballista | artillery | 1100 | 683 | +61% | 725 | 20.1 | 0.86 | 0 |
| Firekite Battery | artillery | 1150 | 737 | +56% | 638 | 24.7 | 0.89 | 0 |
| Knell Cannon | artillery | 1200 | 787 | +52% | 925 | 23.9 | 0.80 | 0 |
| Heliostat Battery | artillery | 1250 | 1178 | +6% | 820 | 57.6 | 0.82 | 0 |
| Cinderglass Mangonel | artillery | 900 | 955 | −6% | 716 | 41.5 | 0.84 | 0 |
| Sailcart Ballistae | artillery | 900 | 979 | −8% | 876 | 20.5 | 1.11 | 0 |
| Counterweight Engine | artillery | 950 | 1162 | −18% | 757 | 62.6 | 0.78 | 40 |
| Rime Spitters | artillery | 900 | 1814 | −50% | 1653 | 52.4 | 0.94 | 0 |
| Strider Archers | cavalry | 900 | 487 | +85% | 4600 | 47.6 | 1.30 | 0 |
| Dustrunners | cavalry | 550 | 498 | +10% | 4447 | 50.3 | 1.32 | 0 |
| Strider Lancers | cavalry | 1250 | 1202 | +4% | 8375 | 147.5 | 1.28 | 60 |
| Heliographer Riders | cavalry | 750 | 732 | +2% | 5072 | 65.5 | 1.28 | 140 |
| Antlered Lancers | cavalry | 1300 | 1300 | ±0% | 10890 | 140.8 | 1.23 | 80 |
| Grue Hunters | cavalry | 950 | 954 | ±0% | 6961 | 125.3 | 1.25 | 20 |
| Kilnback Lancers | cavalry | 1300 | 1316 | −1% | 11414 | 151.6 | 1.19 | 60 |
| Bell Outriders | cavalry | 550 | 577 | −5% | 4637 | 54.6 | 1.28 | 60 |
| Rime Hounds | cavalry | 450 | 529 | −15% | 2845 | 68.4 | 1.30 | 70 |
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
| The Dreadsail | colossus | 3200 | 2739 | +17% | 14891 | 28.3 | 1.27 | 290 |
| Old Midnight | colossus | 3200 | 2869 | +12% | 25555 | 38.1 | 0.78 | 570 |
| The Umbral Mother | colossus | 3200 | 3544 | −10% | 10030 | 55.4 | 1.23 | 810 |
| The Nailbearer | colossus | 3200 | 4745 | −33% | 23598 | 96.9 | 0.95 | 470 |
| Knellguard | infantry | 1250 | 1037 | +21% | 14347 | 203.9 | 0.96 | 0 |
| Rimeguard | infantry | 700 | 589 | +19% | 9742 | 82.8 | 0.99 | 30 |
| The Unlit | infantry | 1200 | 1032 | +16% | 8547 | 195.0 | 1.02 | 200 |
| Cinder Penitents | infantry | 800 | 717 | +12% | 7684 | 139.9 | 1.01 | 60 |
| Gale Dancers | infantry | 850 | 775 | +10% | 7154 | 165.0 | 1.05 | 60 |
| Anchor Guard | infantry | 850 | 810 | +5% | 17257 | 88.7 | 0.96 | 60 |
| Gnomon Guard | infantry | 700 | 671 | +4% | 12591 | 79.1 | 0.96 | 70 |
| Oathsworn Halberdiers | infantry | 750 | 782 | −4% | 12793 | 101.9 | 0.96 | 90 |
| Glowkin Lurers | infantry | 400 | 443 | −10% | 8217 | 57.6 | 1.00 | 10 |
| Kiln Acolytes | infantry | 450 | 521 | −14% | 10417 | 61.4 | 0.98 | 30 |
| Lantern Guard | infantry | 750 | 871 | −14% | 20012 | 80.8 | 0.96 | 100 |
| Mirror Wardens | infantry | 750 | 925 | −19% | 22143 | 76.0 | 0.95 | 150 |
| Hour Levy | infantry | 400 | 502 | −20% | 9373 | 52.7 | 0.98 | 70 |
| Reedspears | infantry | 400 | 540 | −26% | 8631 | 56.4 | 1.02 | 90 |
| Lenswrights | missile | 1100 | 864 | +27% | 3375 | 157.7 | 0.96 | 0 |
| Shardbows | missile | 500 | 478 | +5% | 4007 | 39.2 | 0.98 | 0 |
| Lamplighters | missile | 700 | 681 | +3% | 3627 | 86.5 | 0.99 | 0 |
| Windbows | missile | 500 | 514 | −3% | 3832 | 44.5 | 1.01 | 0 |
| Hushbows | missile | 550 | 639 | −14% | 3958 | 44.9 | 1.00 | 120 |
| Vesper Arbalests | missile | 800 | 950 | −16% | 5942 | 101.5 | 0.96 | 30 |
| Dusk Moth Riders | monster | 1150 | 1043 | +10% | 2758 | 44.8 | 1.33 | 220 |
| Galewings | monster | 1100 | 1029 | +7% | 2357 | 53.3 | 1.36 | 180 |
| Lanternmaws | monster | 1700 | 1829 | −7% | 7267 | 106.8 | 1.08 | 160 |
| Molten Saints | monster | 1800 | 2382 | −24% | 8997 | 169.5 | 1.02 | 160 |
| Belfry Wagon | support | 800 | 350 | +128% | 1655 | 0.8 | 0.89 | 260 |
| Howling Kites | support | 750 | 750 | ±0% | 2417 | 16.9 | 0.98 | 200 |
| Veilweavers | support | 800 | 1015 | −21% | 3282 | 21.0 | 0.99 | 290 |

## Simulation health

1992 battles run; 0 threw, 0 produced NaNs, 0 hit the wall-clock limit.

| Suite | Battles | Timeouts | Mean simulated length | Mean CPU per battle |
|---|---|---|---|---|
| factions | 180 | 61 | 442 s | 8.39 s |
| duels | 1452 | 126 | 131 s | 0.64 s |
| colossus | 360 | 49 | 282 s | 2.13 s |

Faction battles that hit the time limit (61 of 180): units most often still fighting on the side that was behind — Queen Ysh, the Unlit 16, Lenswrights 13, Hushbows 11, Tavi Longwind, the Helm 11, Rime Spitters 10, High Cantor Oriel 9, Shardbows 9, Vesper Arbalests 9, Heliostat Battery 7, Rime Hounds 7, Rimeguard 6, Glowkin Lurers 6.

## Method

- Both sides are played by the same scripted battle AI (`src/ai/battleAI.ts`). Every fixture is fought twice with the sides swapped, and the sun is rotated north, east, south and west across fixtures, so deployment edge and glare cancel out.
- Conditions: 5 light levels (Dark to Blaze) × 3 winds (Calm, Breeze, Gale), each fought on the terrain of the band that has that light naturally (Evernight, Dimmark, Gloaming, Long Afternoon, Glare).
- Faction battles: two armies of the same budget from the army generator (`generateArmy`, colossus “maybe”), one random draw per fixture, auto-deployed; decided by rout, or on remaining value at the time limit.
- Unit duels: cost-matched copies placed 300 m apart on open, flat ground checked free of water, woods and rocks. A lone unit gives the battle AI no battle line, so the duel harness (`src/balance/duelAI.ts`) sends idle units at the nearest enemy after 20 s without damage or closing in; both sides use it. Duels leave out army context: no general, no Toll, no auras from other units.
- Unit size: with `unitScale` below 1 only infantry, cavalry, beasts and flyers shrink; monsters, artillery, heroes and colossi keep full strength, so reduced-scale runs favour armies that field more of them.
- Win rates count a draw as half a win. Intervals are 95% Wilson intervals for win rates and bootstrap intervals for efficiency.

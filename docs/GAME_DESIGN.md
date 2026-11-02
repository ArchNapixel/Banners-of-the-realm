# Banners of Valdrys — Game Design Document

> Version 1.0 (planning). Single-player, turn-based fantasy strategy game for the web browser, deployed on Vercel.
> **All numbers in this document are starting values.** They are meant to be tuned with the balance simulator built in Milestone M1. Keep every number in data files, never hard-coded in logic.

---

## Table of Contents

1. Game Overview
2. Core Loop and Turn Sequence
3. The World of Valdrys (lore and setting)
4. The Map
5. Kingdoms and Villages
6. Units
7. Companies, Armies and Commanders
8. Movement, Supply and Sieges
9. Battle System
10. Champions
11. Magic
12. Playable Races
13. Native Factions
14. The Awakening
15. Diplomacy, War Weariness, Victory and Defeat
16. Random Events
17. AI
18. Screens and UI
19. Naming Data
20. Technical Architecture
21. Development Roadmap
22. Appendix A: Example Battle (Battle of the Hills)
23. Appendix B: Open Decisions

---

## 1. Game Overview

### Concept
You rule a small kingdom of villages in the wild lands of Valdrys. You grow their population, build industries from the land around them, and turn your people into armies. Around you are long-established native realms and tribes, and rival founders (AI kingdoms) who started as small as you did.

War is decided by **army composition, leadership, morale and champions**, not raw numbers.

### Design pillars
1. **People are the resource.** Every soldier comes from a village's population. War always costs your economy.
2. **Composition beats numbers.** The right mix of units, terrain and leadership lets a smaller army win.
3. **Battles are stories.** Multi-day auto-resolved battles produce readable reports: who broke, why, and who rose as a hero.
4. **Heroes are earned.** Champions emerge from companies that survive hard fights. They are never bought.
5. **The world was here first.** Native factions are stronger than you at the start. You must decide whether to trade with them, ally with them, absorb them, or conquer them, before they awaken.

### Basic facts

| | |
|---|---|
| Platform | Web browser (desktop), hosted on Vercel |
| Mode | Single-player vs AI kingdoms and native factions |
| Reference screen | 1920×1080 |
| Setting | Original high-fantasy continent of Valdrys, with magic |
| Session length | 1–3 hours (Small map) to 6+ hours (Large map) |

---

## 2. Core Loop and Turn Sequence

```
Manage villages → Recruit & build → Move armies → Battles resolve (end of turn)
      ↑                                                              ↓
  Population grows ← Economy & upkeep ← Champions rise, villages captured
```

### Turn sequence
1. **Player phase**
   - Village orders: build, recruit, set taxes, train settlers.
   - Move companies and armies (movement happens immediately on the map).
   - Merge and split armies; assign commanders and champions; set stances and hidden-card triggers.
   - Cast strategic spells; take diplomatic actions (including with natives).
2. **AI phase**: each AI kingdom acts, then each native faction acts, through the same order system.
3. **Resolution phase**, in this order:
   1. Battles: each active battle resolves **one battle day** (3 rounds).
   2. Sieges advance: blockade stores drop, engineers breach walls.
   3. Training and building queues advance; finished units and settlers appear.
   4. Production: food, gold, wood, stone, iron, horses and mana are added.
   5. Upkeep is paid; shortages cause desertion and morale loss.
   6. Supply and attrition are applied to armies.
   7. Population changes (per race); stability updates; revolts are checked.
   8. Champion rising rolls and XP for battles that ended.
   9. Native checks: provocation responses, Omens, Awakening triggers.
   10. Random events.
   11. Victory and defeat checks, then autosave.

---

## 3. The World of Valdrys

### Lore
Valdrys was once ruled by the **Tharen Dominion**, an empire of mage-lords who bent the ley lines to their will. Three centuries ago their final ritual failed in a catastrophe remembered as **the Sundering**. The Dominion collapsed overnight. Its cities became the **Ancient Ruins** and its broken ley lines became the **Ley Nodes** scattered across the land.

The old peoples who weathered the Sundering in their strongholds endured. These are the **native realms and tribes**: proud, established, and suspicious of newcomers. Now, in the **Age of Banners**, new founders lead small bands into the wild lands to carve out kingdoms of their own. These are the player and AI kingdoms.

Beneath the barrows, the last Tharen emperor's court has not stayed dead. It is known as **the Hollow Crown**.

### Peoples of Valdrys

| Race | In-world name | Playable | Culture |
|---|---|---|---|
| Humans | **the Valdren** | Yes | Feudal crowns, knightly orders, sea trade |
| Elves | **the Sylvaen** | Yes | Ancient forest courts ruled by noble houses |
| Dwarves | **the Durrakin** | Yes | Mountain holds organized into clans |
| Orcs | **the Ghor** | Yes | Hordes and war clans of the highlands |
| Marshfolk | **the Vashkari** | Yes | Reptilian mire-clans organized by clutch |
| Giants | **the Ormun** | Native only | Jarldoms of the high peaks |
| Centaurs | **the Tarvani** | Native only | Nomadic herds of the open plains |
| Treefolk | **the Eldergrove** | Native only | Oakwardens and dryads of the Ancient Forests |
| Harpies | **the Kerrak** | Native only | Raiding flocks of the cliffs |
| Restless Dead | **the Hollow Crown** | Native only | The undead court of the last Tharen emperor |

In the UI, use the in-world name with the plain race name in a tooltip, e.g. "Durrakin (Dwarves)".

---

## 4. The Map

### Map generation
- **Procedurally generated hex map** (axial coordinates, pointy-top hexes), generated from a seed.
- **Placement order**:
  1. Generate terrain (noise-based elevation and moisture → terrain types).
  2. Name regions: cluster adjacent hexes of the same terrain and name each cluster (Section 19).
  3. Place **Ancient Forests**, **Ley Nodes** and **Ancient Ruins**.
  4. Place **native Realms** in their homeland terrain.
  5. Place **native Tribes**.
  6. Place the **Hollow Crown** (if enabled) at a ruin far from other factions.
  7. Place **player and AI capitals**, biased toward their race's homeland terrain, at least **6 hexes from any native border** and **10 hexes from each other**.
  8. Place a few **neutral villages** (independent, no faction).

| Map size | Hexes | Player + AI | Native Realms | Native Tribes | Hollow Crown | Neutral villages |
|---|---|---|---|---|---|---|
| Small | 30×20 | 1 + 2 | 1 | 2 | Optional | 3 |
| Medium | 40×30 | 1 + 3 | 2 | 3 | Optional | 5 |
| Large | 60×40 | 1 + 5 | 3 | 5 | On by default | 8 |

Native factions are picked from the faction pool in Section 13, matching available homeland terrain.

### Terrain

| Terrain | Move cost | Defense bonus | Battle frontage | Unlocks | Battle effects |
|---|---|---|---|---|---|
| Plains | 1 | 0% | 6 | Farm, Stables, Pasture | Cavalry +20% |
| Forest | 2 | +10% | 3 | Lumber Camp, Hunting Lodge | Cavalry −30%, archers −20%, ambush possible |
| Hills | 2 | +15% | 4 | Quarry, Pasture | Archers on the defending side +10% |
| Mountains | 3 | +30% | 2 | Mine, Gold Mine, Quarry | Cavalry −50% |
| Marsh | 3 | 0% | 3 | Peat Works | Everyone +5 Fatigue per round, attrition |
| Coast | 1 | 0% | 6 | Fishing Dock, Harbor | — |

### Overlays

| Overlay | Effect |
|---|---|
| **River** (hex edge) | Crossing costs +1 move; attacking across a river gives −20% damage |
| **Road** | Movement cost 0.5. Built by a kingdom between its own hexes (20 gold + 10 stone per hex) |
| **Ley Node** | Unlocks Mage Tower and Mana Well |
| **Ancient Ruins** | Explorable once by any company: gold, mana, champion XP, or a fight with ruin guardians. Can be claimed by the Hollow Crown as a Barrow |
| **Ancient Forest** | Sacred to the Eldergrove; counts as their territory |

### Fog of war

| Source | Vision radius |
|---|---|
| Village | 2 |
| Army / company | 2 |
| Scouts | 4 |
| Watchtower | 3 |

**What you can see of enemy armies**
- In vision: approximate size (±20%).
- Adjacent or scouted: exact companies and commander.
- Hidden champions: only revealed by the *Scrying* spell or when they reveal themselves in battle.

---

## 5. Kingdoms and Villages

### Starting kingdom (player and AI)
- **Capital**: Village tier, 1,500 population of the kingdom's race, with a Farm and a Barracks
- **Units**: 1 Militia company of the kingdom's race
- **Ruler**: a Level 5 commander
- **Resources**: 300 gold, 50 wood, 20 stone, plus a race bonus:

| Race | Starting bonus |
|---|---|
| Valdren | +100 gold |
| Sylvaen | +50 wood |
| Durrakin | +40 iron |
| Ghor | +100 food |
| Vashkari | +100 food |

### Village tiers

| Tier | Population cap | Building slots | Work radius | Upgrade cost |
|---|---|---|---|---|
| Hamlet | 1,000 | 3 | 1 | — |
| Village | 3,000 | 5 | 1 | 300 gold, 50 stone |
| Town | 8,000 | 8 | 2 | 800 gold, 150 stone |
| City | 20,000 | 12 | 2 | 2,000 gold, 400 stone |

Upgrading requires at least 80% of the current population cap.

### Population
- Each village tracks **population per race** (`populationByRace`). Most villages have one race; conquest, integration and refugees create mixed villages.
- **Civilians** are the population. A subset are **workers** assigned to buildings.
- **Soldiers** are removed from population when recruited.

**Growth per turn (per race in the village)**
```
growth % = race growth rate (Section 12/13)
           +1%   if kingdom food surplus is above 10% of consumption
           +0.5% with Granary
           ×0.5  if Stability < 30
starvation (food deficit): −2% per turn and −5 Stability
```
Total population cannot exceed the tier cap. Housing District raises the cap by 25%.

### Resources (kingdom-wide pools)

| Resource | Main source | Main use |
|---|---|---|
| Food | Farms, fishing, village center | Feeds civilians and soldiers |
| Gold | Taxes, Market, Gold Mine, Harbor | Buildings, units, upkeep |
| Wood | Lumber Camp | Buildings, archers, siege |
| Stone | Quarry | Walls, village upgrades, roads |
| Iron | Mine | Armored units |
| Horses | Stables, Pasture | Cavalry (1 horse per rider) |
| Mana | Mage Tower, Shrine, Mana Well, Temple | Magic units, spells |

### Food
- **Consumption**: 1 food per 100 civilians; 2 food per 100 soldiers.
- **Production**: each village center gives 10 food, plus buildings.

### Taxes

| Tax level | Gold per 100 civilians | Stability per turn |
|---|---|---|
| Low | 1 | +2 |
| Normal | 2 | 0 |
| High | 3 | −3 |

### Workers
```
building output = full output × min(1, assigned workers ÷ required workers)
```
Workers are assigned automatically from idle civilians in a priority order the player can change. Heavy recruitment leaves buildings understaffed.

### Buildings

| Building | Requires | Cost | Turns | Workers | Effect |
|---|---|---|---|---|---|
| Farm | Plains in radius | 60g, 20 wood | 2 | 200 | +10 food |
| Fishing Dock | Coast | 60g, 30 wood | 2 | 150 | +8 food, +2 gold |
| Hunting Lodge | Forest | 50g, 10 wood | 2 | 100 | +5 food |
| Lumber Camp | Forest | 50g | 2 | 150 | +8 wood |
| Peat Works | Marsh | 40g | 2 | 100 | +3 food, +3 wood |
| Quarry | Hills/Mountains | 80g, 20 wood | 3 | 200 | +6 stone |
| Mine | Mountains | 120g, 30 wood | 3 | 250 | +5 iron |
| Gold Mine | Mountains (rare deposit) | 200g, 40 wood | 4 | 250 | +15 gold |
| Stables | Plains | 150g, 40 wood | 3 | 100 | +20 horses; unlocks cavalry |
| Pasture | Plains or Hills | 80g | 2 | 100 | +10 horses |
| Market | — | 120g, 30 wood | 3 | 100 | +10 gold, +10% village tax |
| Harbor | Coast, Town tier | 300g, 80 wood | 4 | 200 | +25 gold |
| Granary | — | 100g, 40 wood | 2 | 50 | +0.5% growth, +3 turns siege stores |
| Housing District | Village tier | 150g, 50 wood | 3 | 0 | +25% population cap |
| Barracks | — | 100g, 30 wood | 2 | 50 | Unlocks Militia, Spearmen, Scouts, Settlers |
| Archery Range | — | 120g, 60 wood | 3 | 50 | Unlocks Archers, Crossbowmen |
| Blacksmith | Iron income | 200g, 40 stone | 3 | 100 | Unlocks Swordsmen, Heavy Cavalry |
| Siege Workshop | Town tier | 250g, 80 wood, 40 stone | 4 | 100 | Unlocks Siege Engineers |
| Temple | — | 150g, 50 stone | 3 | 50 | +10 Stability, +2 mana, unlocks Clerics; halves mixed-race penalty |
| Mage Tower | Ley Node in radius | 400g, 80 stone | 5 | 50 | +10 mana; unlocks Battle Mages, Wardens, Spellblades |
| Mana Well | On a Ley Node hex | 150g, 40 stone | 3 | 30 | +5 mana |
| Shrine | — | 80g, 20 stone | 2 | 20 | +3 mana |
| Watchtower | — | 60g, 20 wood | 1 | 10 | Vision 3 |
| Palisade | — | 100g, 80 wood | 2 | 0 | Defense +20%; can be assaulted |
| Stone Walls | Village tier, Palisade | 400g, 200 stone | 5 | 0 | Defense +40%; must be breached or starved |
| Court | Capital only | 200g | 3 | 50 | Hire Nobles as commanders |

Racial unique buildings are listed in Section 12.

### Settlers
- **Cost**: 300 population, 150 gold, 30 wood. **Training**: 2 turns. **Speed**: 2.
- Found a Hamlet with 300 population (of the settlers' race) on any empty hex at least 3 hexes from another village and not inside another faction's border.

### Neutral villages
Independent villages with a militia garrison. **Conquer** them, or **annex** them for 0.3 gold per resident if your nearest village is within 4 hexes.

### Stability (0–100, per village)

| Stability | Effect |
|---|---|
| 80+ | +10% production |
| 40–79 | Normal |
| 20–39 | −20% production |
| Below 20 | 10% revolt chance per turn (spawns rebel Militia) |

**Modifiers**
- Taxes (above)
- Temple: +10
- Garrison present: +5
- Recently conquered: −30 (same race) or −40 (different race), decaying by 3 per turn
- Heavy conscription (more than 10% of the population recruited within 5 turns): −10
- Starvation: −5 per turn
- Mixed population: see Section 12
- War weariness: see Section 15
- Racial traits (e.g. Ghor −10 base)

---

## 6. Units

### Recruitment rules
- Recruiting removes the company's men from the chosen race's population **immediately**.
- Gold and resources are paid up front.
- One training queue slot per village per military building type.
- When training finishes, the company appears in the village as **Green**.
- Company size and stat modifiers come from the **race** the men were drawn from (Section 12).

### Shared unit roster (base values, before racial modifiers)

| Unit | Base men | Cost | Turns | Upkeep (gold) | Atk | Def | Armor | Disc | Speed | Size | Tags |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Militia | 500 | 120g | 2 | 8 | 3 | 3 | 0 | 35 | 2 | 1 | infantry, light |
| Spearmen | 500 | 220g, 20 wood | 3 | 14 | 4 | 6 | 2 | 55 | 2 | 1 | infantry, polearm |
| Swordsmen | 500 | 350g, 40 iron | 4 | 20 | 7 | 6 | 5 | 65 | 2 | 1 | infantry, heavy |
| Archers | 500 | 240g, 30 wood | 3 | 14 | 5 ranged / 2 melee | 2 | 1 | 45 | 2 | 1 | ranged |
| Crossbowmen | 500 | 320g, 20 wood, 20 iron | 4 | 18 | 6 ranged (armor-piercing) / 2 | 3 | 2 | 50 | 2 | 1 | ranged |
| Light Cavalry | 300 | 350g, 300 horses | 4 | 24 | 5 | 3 | 1 | 55 | 4 | 1 | cavalry, light |
| Heavy Cavalry | 300 | 600g, 300 horses, 60 iron | 6 | 40 | 9 | 6 | 6 | 70 | 3 | 1 | cavalry, heavy |
| Scouts | 100 | 80g | 1 | 4 | 1 | 1 | 0 | 30 | 5 | 1 | recon |
| Siege Engineers | 200 | 300g, 60 wood, 40 stone | 4 | 15 | 1 | 1 | 0 | 40 | 1 | 1 | siege |
| Battle Mages | 50 | 500g, 100 mana | 5 | 20 + 5 mana | spells | 1 | 0 | 60 | 2 | 1 | magic |
| Clerics | 100 | 350g, 50 mana | 4 | 15 + 2 mana | heal | 2 | 0 | 60 | 2 | 1 | magic, support |
| Wardens | 300 | 450g, 60 mana, 20 iron | 4 | 22 | 5 | 6 | 4 | 65 | 2 | 1 | infantry, anti-magic |
| Spellblades | 200 | 700g, 120 mana, 40 iron | 6 | 35 + 5 mana | 10 | 7 | 5 | 75 | 2 | 1 | infantry, elite, magic |
| Settlers | 300 pop | 150g, 30 wood | 2 | 0 | — | 1 | 0 | 10 | 2 | 1 | civilian |

**Company size by race**: infantry and ranged companies use the race's company size (Section 12) instead of 500. Cavalry, magic and special units keep their listed size.

**Food upkeep** for all soldiers: 2 food per 100 men (Size counts: a Size 15 creature eats like 15 men).

### Size
Each unit type has a **Size** (default 1).
- **Damage dealt** uses `men × Size` as effective men.
- **Damage received** is divided by Size before it becomes deaths.

A company of 30 Size-15 beasts fights like 450 soldiers but dies one beast at a time.

### Experience

| Rank | Requirement (battles survived) | Combat multiplier | Discipline bonus |
|---|---|---|---|
| Green | 0 | ×0.9 | +0 |
| Trained | 1 | ×1.0 | +5 |
| Veteran | 3 | ×1.15 | +10 |
| Elite | 7 | ×1.3 | +15 |

**Replenishing**: a company in a friendly village can refill lost men by drawing population of its race and paying (lost men ÷ company size) × original gold cost. If more than 50% of the company is new, it drops one rank.

### Counter table (damage multipliers)

| Attacker → Target | Multiplier |
|---|---|
| Polearm vs cavalry | ×2.0 |
| Cavalry vs ranged | ×2.0 |
| Cavalry vs magic | ×2.0 |
| Cavalry vs light infantry (flank charge) | ×1.5 |
| Ranged vs light (Armor 0–1) | ×1.5 |
| Ranged vs heavy (Armor 5+) | ×0.5 (armor-piercing ignores this) |
| Ranged vs flying | ×2.0 |
| Heavy infantry vs polearm | ×1.5 |
| Anti-magic vs magic | ×2.0 and drains 20 enemy battle mana per round |
| Fire spells vs Treefolk | ×2.0 |
| Any vs routing company | ×2.0 |

Multipliers stack multiplicatively; only the highest applicable counter per pair applies.

---

## 7. Companies, Armies and Commanders

### Company
- One trained batch of a single unit type and race. The basic unit on the map and in battle.
- Can move alone, garrison a village, scout, explore ruins, or join an army.

### Army
- Formed by **merging companies on the same hex**. **No size limit.**
- Speed = slowest company.
- Can be split into companies at any time outside battle.
- The composition panel shows men per type, races, upkeep, speed, commander and champions.

### Commanders
An army may have one commander. Sources:

| Source | How | Notes |
|---|---|---|
| **Ruler** | Starts as a Level 5 commander | If killed: −20 Stability in all villages; an heir appears at Level 1 |
| **Nobles** | Hired at the Court for 300 gold | Level 1–3, random traits, 15 gold upkeep |
| **Champions** | Rise from battle (Section 10) | The strongest commanders |
| **Recruited native champions** | Captured and recruited with high relations | See Section 13 |

### What an army misses without a commander

| | With commander | Without |
|---|---|---|
| Formation | Best units placed in best slots | Companies fill slots in merge order |
| Targeting (ranged, spells) | Focus on weakest or most dangerous enemy | Random |
| Stance | Player chooses | Locked to Hold |
| Cohesion | Base + Leadership | −5 per company beyond the second |
| Morale recovery | +2 per round, +10 + Leadership overnight | None |
| Reserve rotation | Swaps tired companies for fresh ones | Reserves enter only when a front company routs |
| Retreat | Orderly: half the wounded carried away | Disorderly: all wounded captured, +50% pursuit losses |
| Abilities | Commander skills | None |

---

## 8. Movement, Supply and Sieges

### Movement
- Movement points = speed. Terrain costs in Section 4. Racial terrain rules in Section 12.
- Movement executes immediately on the map.
- **Zone of control**: entering a hex adjacent to an enemy army ends movement.
- **Battles start** when an army enters an enemy army's hex or an enemy village. They resolve at end of turn. All armies of both sides on that hex join.
- **Reinforcing**: moving into an ongoing battle hex adds that army on the next battle day.
- **Forced march**: +1 movement, +30 starting Fatigue in any battle that turn.

### Supply and attrition
- **In supply**: within 3 hexes of a friendly village, or on a road connected to one.
- **Out of supply**: 3% of men lost per turn; +10 starting Fatigue and −10 starting Morale in battles.
- **Foraging** (in enemy land): attrition halved; the nearest enemy village loses 10 Stability and some food.

### Sieges

| Defense | How the attacker gets in |
|---|---|
| None | Normal battle against the garrison |
| Palisade | Can be assaulted; defender +20% defense |
| Stone Walls | Must be **breached** (each Siege Engineer company: +25% breach progress per day; 100% = breached) or **starved** |

**Blockade**
- Village **Stores** = 3 turns (+3 with Granary).
- Each surrounded turn: stores −1.
- At 0: garrison −20 Morale per turn; population starves.
- The garrison surrenders at 0 Morale.

### Capturing a village

| Choice | Effect |
|---|---|
| Occupy | Keep population and buildings; conquest Stability penalty |
| Sack | Gold equal to 1 per resident (Ghor +50%); −30% population; −20 Stability in all the former owner's villages |
| Raze | Destroy the village entirely |

---

## 9. Battle System

### Structure
- **1 battle day = 1 game turn = 3 rounds** (Morning, Midday, Dusk).
- A battle continues across turns until one side is fully routed, destroyed or withdraws.
- **Attacker time limit**: after 5 days without victory, the attacker must withdraw, unless the battle is a siege.

### Battle lines

| Slot | Who | Count |
|---|---|---|
| Front | Infantry | Terrain frontage (2–6) |
| Flanks | Cavalry | 2 per side |
| Rear | Ranged and magic | Unlimited |
| Reserve | Everything that doesn't fit | Unlimited |

- **Lanes**: front company #1 fights enemy front company #1, and so on.
- **Overlap**: if one side has more front companies than the other, its extra companies overlap the enemy's end companies. Overlapped companies are **flanked**: ×1.25 damage taken, −10 Morale per round.
- **Flying** units (Kerrak harpies) ignore lines, frontage and Formation Integrity and attack the rear line directly.

### Round phases
1. **Spells**: each magic company casts 1 spell (commander/AI choice; leaderless picks a random valid spell).
2. **Ranged**: ranged companies fire at the enemy front line (rear line if Formation Integrity is below 30).
3. **Charge** (first round of each day only): cavalry charges enemy flanks; if the flank is empty, the charge hits the end front company, or the rear line if Integrity is below 30.
4. **Melee**: front lanes fight; cavalry fights on the flanks.
5. **Champions**: revealed champions deal damage; hidden-card triggers are checked; duels resolve.
6. **Morale**: changes applied; companies at 20 Morale or below **rout**.
7. **Reserves**: commanded armies swap companies below 40 Morale or 40% strength for reserves; leaderless armies only fill empty slots.

### Damage formula
```
effective men = attacker men × attacker Size
raw = effective men × Atk ÷ (Atk + target Def + target Armor)
casualties (in target men) = raw
      × K                          (melee 0.12, ranged 0.10, charge 0.15)
      × counter multiplier
      × terrain multiplier
      × experience multiplier
      × cohesion multiplier        (0.5 + Cohesion ÷ 200)
      × fatigue multiplier         (1 − attacker Fatigue ÷ 200)
      × stance multiplier
      × flanked multiplier         (×1.25 if target is flanked)
      × racial / trait / spell multipliers
      × random(0.85 – 1.15)
      ÷ target Size
```
Sanity check: 500 Militia vs Militia ≈ 30 casualties per round.

### The six measured criteria

| Criterion | Level | Range | Starts at |
|---|---|---|---|
| **Strength** | Company | Men | Current men |
| **Morale** | Company | 0–100 | 100; −10 if out of supply; −10 if starting Fatigue above 50 |
| **Cohesion** | Army | 0–100 | Average rank value (Green 70, Trained 80, Veteran 90, Elite 95) + commander Leadership; leaderless −5 per company beyond 2 |
| **Fatigue** | Company | 0–100 | +15 if it moved its full speed this turn; +30 on forced march |
| **Formation Integrity** | Army | 0–100 | 100; +10 if Spearmen/Pikemen are at least 25% of the front |
| **Mana** | Army | Pool | 100 per Battle Mage / Runecaster company present |

### Morale changes (per company, per round)

| Event | Change |
|---|---|
| Losses this round | −(% of men lost × 0.8) × (50 ÷ Discipline) |
| Flanked or overlapped | −10 |
| Hit by a charge | −10 |
| Neighboring company routs | −8 (−12 if leaderless) |
| Won the lane (dealt more than 1.5× what it took) | +3 |
| Commander present | +2 |
| Champion captain present | +Resolve ÷ 2 |
| Fatigue above 80 | −5 |
| Overnight with commander | +10 + Leadership |

**Rout** at 20 Morale or below. A routed company leaves the battle for good.
**No-Morale** units (Hollow Crown) never rout. If their Necromancer champion dies, every undead company in the battle **crumbles**, losing 50% of its men per round.

### Cohesion changes (army)
- A company routs: −5
- *Chaos* spell: −15
- Flanked by cavalry: −5 per round

### Fatigue changes (company)

| Event | Change |
|---|---|
| Fighting a round (Hold) | +8 |
| Fighting a round (Aggressive) | +18 |
| Fighting a round (Fighting Retreat) | +10 |
| Heavy armor (Armor 5+) | +4 extra per round |
| Marsh | +5 extra per round (not Vashkari) |
| Overnight rest | −40 |

Fatigue multiplies damage dealt (see formula). Above 80, extra −5 Morale per round.

### Formation Integrity changes (army)
- Cavalry charge not met by Spearmen/Pikemen: −15
- Overlapped: −10 per round
- Front company routs: −20
- *Stone Wall* spell: +20; *Quake*: −25 to the enemy

Below 30: enemy melee and cavalry can reach the rear line.

### Stances (commanded armies only)

| Stance | Damage dealt | Damage taken | Fatigue | Notes |
|---|---|---|---|---|
| Aggressive | ×1.2 | ×1.15 | High | — |
| Hold | ×0.85 | ×0.8 | Low | Default and the only option for leaderless armies |
| Fighting Retreat | ×0.6 | ×0.6 | Medium | Withdraws at the end of the day with low pursuit losses |

### Night between battle days
- Fatigue −40.
- Morale recovery only with a commander or champion.
- Clerics, Battle Priests and Shamans return 30% of the day's wounded.
- Battle mana regenerates 50%.
- The player (or AI) can change stance, withdraw, reinforce, or change hidden-card triggers.

### Ending a battle

| Result | Condition |
|---|---|
| Decisive Victory | All enemy companies routed or destroyed |
| Victory | Enemy withdraws |
| Stalemate | Both sides still standing at Dusk; continues next turn |
| Pyrrhic Victory | Won, but lost more than 50% of starting strength (−10 Stability in home villages) |

### Casualties
- **70% dead, 30% wounded.**
- The winner keeps its wounded; they return over 3 turns in friendly territory.
- The loser's wounded are captured, unless it retreated with a commander (half carried away) or had healers (another half carried away).

### Pursuit (routed men)

| Pursuers | Killed | Captured |
|---|---|---|
| Infantry only | 4% | 6% |
| Each Light Cavalry company (or equivalent) | +10% | +8% |
| Each Heavy Cavalry company (or equivalent) | +6% | +4% |

Pursuit losses are capped at 40%. Escaped routers return to their nearest village as **Broken** companies (Morale 30, recovering 10 per turn), or desert into the population if no friendly village is within 6 hexes.

### Prisoners
- **Ransom**: 1 gold per prisoner (the owner decides whether to pay)
- **Conscript**: as Green Militia of their race, Morale −30 for 5 turns
- **Release**: +5 Stability in nearby conquered villages; +5 relations with natives of that race

### Battle report
Each battle produces a report containing:
- Day-by-day, round-by-round log
- Losses per company per round (dead, wounded, routed, captured)
- Charts of Strength, Morale, Cohesion, Fatigue and Integrity over time
- Key moments: routs, rout cascades, champion reveals, duels, spells
- Final summary table and rewards (XP, Glory, champion rising)

See Appendix A for a full example.

---

## 10. Champions

### How champions rise
After each battle, every surviving company rolls a **rising chance**:

| Factor | Bonus |
|---|---|
| Base | 1% |
| Veteran | +3% |
| Elite | +8% |
| Survived while outnumbered 2:1 or more | +10% |
| Caused an enemy company to rout | +5% |
| Held the line while a neighbor routed | +10% |
| Killed an enemy champion | +25% |
| Glory (battles survived) | +1% per battle |
| Valdren *Age of Heroes* | +2% |
| Ghor *Fighting Pits* in home village | +3% |
| Their previous champion was killed | +15% |

A company can have only one champion at a time.

### Class by origin unit

| Origin | Class | Strength |
|---|---|---|
| Militia, Warband | Folk Hero | Resolve, morale aura |
| Spearmen, Pikemen, Ironshields, Thornguard | Warden of the Line | Vitality, Integrity bonuses |
| Swordsmen, Venomblades | Blademaster | Might |
| Archers, Crossbowmen, Longbows, Arbalests, Stalkers | Marksman | Ranged damage, targets champions |
| Any cavalry | Lancer Lord | Charge damage, pursuit |
| Battle Mages, Runecasters, Spellblades | Archmage | Arcana |
| Clerics, Battle Priests, Shamans | Saint | Healing, Resolve |
| Wardens | Spellbreaker | Anti-magic |

**Rare Awakening (5%)**: a non-magic champion also gains Arcana and one spell from their race's affinity schools.

### Starting trait and epithet

| Rising moment | Trait | Effect | Epithet |
|---|---|---|---|
| Held the line | Unbreakable | Their company cannot rout while they live | "the Unbroken" |
| Killed an enemy champion | Giantslayer | +50% damage vs champions and Size 10+ units | "Giantslayer" |
| Survived an ambush | Watchful | Immune to ambush | "the Watchful" |
| Survived while outnumbered | Stalwart | +20% Defense for their company | "the Stalwart" |
| Caused a rout | Bloodthirsty | +20% damage vs routing enemies | "the Red" |
| Rose during a siege | Iron Will | Immune to fear effects | "Ironheart" |
| Rose under heavy magic | Arcane-touched | −30% damage from spells | "Spellscarred" |

The display name becomes `{name} {epithet}`, e.g. **Tomas the Unbroken**.

### Stats

| Stat | Effect |
|---|---|
| Might | Personal damage |
| Vitality | Hit points before being wounded |
| Leadership | Cohesion and morale recovery as commander |
| Tactics | Initiative, formation bonuses, commander skills |
| Arcana | Spell power |
| Resolve | Morale aura for their company |

Starting stats: 5 in each, +4 in the class's main stat, +2 in its secondary stat.

### Leveling
- Levels 1–20. XP to next level = 100 × current level.
- Level up: +3 stat points.
- Skills at levels 3, 5, 8, 12, 16 and 20.
- Sylvaen champions gain +25% XP.

| XP source | XP |
|---|---|
| Survived a battle | 20 |
| Each battle day fought | 10 |
| Kills | 1 per 10 |
| Their company routs an enemy company | 15 |
| Duel won | 60 |
| Victory as commander | 50 |

### Skill paths

| Commander | Vanguard | Champion of the People | Arcane (magic champions) |
|---|---|---|---|
| **Iron Discipline**: no cohesion loss from army size | **Cleave**: hits two enemy companies | **Last Stand**: army can't rout for 1 round (once per battle) | **Overchannel**: spells ×1.5, cost +50% mana |
| **Pincer**: +25% flank damage | **Bloodlust**: +1% damage per 1% of their company's losses | **Banner of Legend**: +10 Morale to every company | **Counterspell**: cancel 1 enemy spell per day |
| **Night March**: army +1 movement after a battle | **Duelist**: +30% in duels | **Rally Cry**: rally 1 routed company per day | **Ley Walker**: +50% battle mana regeneration |
| **Shield Wall Drill**: +15 Formation Integrity | **Whirlwind**: damage to all adjacent lanes | **Folk Hero's Return**: wounded return 2× faster | **Archmage**: 2 spells per round |
| **Logistician**: no attrition out of supply | **Executioner**: ×2 vs routing enemies | **Martyr**: on death, army +20 Morale | — |
| **Grand Reserve**: rotate reserves mid-round | **Hard to Kill**: 50% chance to survive a killing blow | — | — |

### Three ways to use a champion
1. **Army commander**: all commander advantages, scaled by stats.
2. **Company captain**: stays with their company; gives Resolve aura and traits.
3. **Hidden Card**: embedded in a company and invisible to enemy scouting.

### Hidden Card
**Reveal triggers** (player chooses one):
- Company Morale drops below 40
- An enemy champion appears
- A specific battle day and round
- The enemy commits its reserve
- Manual (reveal at the next night phase)

**On reveal**: fear shock (−15 Morale to enemy front companies), surge (+10 Morale to friendly companies), and full champion damage from then on.

### Champion damage
```
champion damage per round = damage of (Might × 8) soldiers with Atk 8,
                            using the normal damage formula
```

### Duels
- When both sides have revealed champions, a commander (or the AI) may challenge.
- Best of 3 exchanges: Might + Vitality + skill bonuses + random(1–10) each exchange.
- Winner's army +15 Morale; loser's army −15 Morale. Loser is wounded (60%) or killed (40%).

### Injury, capture and death
When a champion's Vitality hits 0:
- **Wounded** (60%): out 3–6 turns
- **Captured** (15%, only if their side loses): ransom or rescue
- **Killed** (25%): permanent. Their company −20 Morale and +15% rising chance

### Limits
No hard cap. Upkeep: 20 gold + 5 per level (+5 mana for magic champions).

---

## 11. Magic

### Mana sources
| Source | Mana per turn |
|---|---|
| Mage Tower (needs a Ley Node) | +10 |
| Mana Well (on a Ley Node) | +5 |
| Shrine | +3 |
| Temple | +2 |
| Heart Tree (Sylvaen) | +5 |

Mana is a kingdom-wide stockpile. Battle spells use the army's battle mana pool.

### Racial magic affinity
Spells from a race's two affinity schools cost **25% less** (Section 12). Some races cannot use certain schools.

### Battle spells
Spell power scales with casting company size (relative to its base size) and the Arcana of any mage champion with it.

| School | Spell | Mana | Effect |
|---|---|---|---|
| Fire | Firestorm | 40 | Heavy damage to one enemy company, −10 Morale |
| Fire | Burning Ground | 30 | One enemy front slot unusable next round |
| Earth | Stone Wall | 30 | +20 Formation Integrity |
| Earth | Quake | 50 | −25 enemy Formation Integrity |
| Frost | Chilling Mist | 30 | +15 Fatigue to enemy front companies |
| Frost | Frozen River | 40 | Removes river-crossing penalty this battle |
| Wind | Arrow Gale | 30 | Friendly ranged ×1.5 this round |
| Wind | Deflection | 30 | Cancels enemy ranged phase this round |
| Light | Rally | 30 | +15 Morale to all friendly companies |
| Light | Mend | 40 | Return 20% of today's wounded |
| Shadow | Terror | 40 | −15 Morale to the enemy front line |
| Shadow | Chaos | 40 | −15 enemy Cohesion |

### Strategic spells

| Spell | Mana | Effect |
|---|---|---|
| Bountiful Rain | 60 | +50% food in one village for 5 turns |
| Blight | 80 | Enemy village produces no food for 3 turns |
| Scrying | 50 | Reveals one army's full composition, including hidden champions |
| Ward | 60 | Protects a village from enemy strategic spells for 10 turns |
| Veil | 50 | Army appears 50% smaller to enemy scouting for 3 turns |
| Swift Winds | 40 | Army +1 speed for 2 turns |

### Balance levers
- Mages are fragile (Def 1, Armor 0).
- Cavalry ×2 vs magic units.
- Wardens ×2 vs magic and drain enemy battle mana.

---

## 12. Playable Races

Every race uses the shared roster (Section 6) with **racial modifiers**, plus 3 unique units, 1 unique building, a racial trait, 2 affinity schools, restrictions and a weakness.

### Overview

| Race | Homeland | Growth | Company size | Playstyle |
|---|---|---|---|---|
| **Valdren** (Humans) | Plains, Coast | 2.0% | 500 | Balanced, trade, knights, heroes |
| **Sylvaen** (Elves) | Forest | 1.2% | 300 | Few but elite, archers, forest ambushes |
| **Durrakin** (Dwarves) | Mountains, Hills | 1.5% | 400 | Armor, walls, mining, no cavalry |
| **Ghor** (Orcs) | Hills, Plains | 3.0% | 500 | Numbers and aggression, brittle morale |
| **Vashkari** (Marshfolk) | Marsh, Coast | 2.5% | 500 | Swamp warfare, venom, beasts |

### Valdren (Humans)
- **Trait — Adaptable**: buildings −10% cost; Markets and Harbors +10% gold; Nobles −30% cost; *Age of Heroes* +2% champion rising.
- **Affinity**: Light, Wind. **Restrictions**: none. **Weakness**: no terrain bonus.
- **Unique building — Chapter House** (Town tier, 300g, 80 stone): unlocks Knights of the Order and Battle Priests.

| Unique unit | Men | Cost | Turns | Atk | Def | Armor | Disc | Speed | Special |
|---|---|---|---|---|---|---|---|---|---|
| Knights of the Order | 300 | 700g, 300 horses, 80 iron | 6 | 9 | 7 | 7 | 80 | 3 | Charge ×1.3; immune to Terror |
| Pikemen | 500 | 260g, 30 wood | 3 | 4 | 7 | 3 | 60 | 2 | ×2.5 vs cavalry |
| Battle Priests | 100 | 400g, 60 mana | 4 | 3 | 3 | 2 | 70 | 2 | Heals like Clerics; +5 Morale to adjacent lanes per round |

### Sylvaen (Elves)
- **Trait — Children of the Wood**: forest move cost 1; in forest battles no archer penalty and +20% defense; companies rank up twice as fast; champions +25% XP; all units +1 Atk, +1 Def, +10 Discipline.
- **Affinity**: Wind, Frost. **Restrictions**: no Heavy Cavalry, no Siege Engineers, no Fire spells.
- **Weakness**: slow growth and small companies; vulnerable to cavalry on plains.
- **Unique building — Heart Tree** (forest hex, 250g): +5 mana, +10 Stability, unlocks unique units.

| Unique unit | Men | Cost | Turns | Atk | Def | Armor | Disc | Speed | Special |
|---|---|---|---|---|---|---|---|---|---|
| Sylvan Longbows | 300 | 320g, 40 wood | 4 | 8 ranged / 3 | 3 | 1 | 60 | 3 | Fires in the ranged phase and again before melee |
| Thornguard | 300 | 300g, 30 wood | 3 | 5 | 7 | 3 | 70 | 2 | In forest: ambush (first round, enemy can't respond) |
| Elk Riders | 200 | 380g, 40 food | 4 | 6 | 4 | 2 | 65 | 4 | Light cavalry; no forest penalty; no horses needed |

### Durrakin (Dwarves)
- **Trait — Stoneborn**: mountain move cost 2; Mines and Quarries +50%; Stone Walls −40% cost; all infantry +1 Armor, +10 Discipline.
- **Affinity**: Earth, Fire. Battle Mages are replaced by Runecasters.
- **Restrictions**: no cavalry of any kind. **Weakness**: weak pursuit and mobility; slow expansion.
- **Unique building — Deep Forge** (needs a Mine, 300g, 100 stone): +5 iron, unlocks unique units.

| Unique unit | Men | Cost | Turns | Atk | Def | Armor | Disc | Speed | Special |
|---|---|---|---|---|---|---|---|---|---|
| Ironshields | 400 | 420g, 60 iron | 4 | 5 | 9 | 7 | 80 | 2 | Overlap penalty halved; +15 Formation Integrity |
| Thunder Arbalests | 400 | 380g, 30 wood, 40 iron | 4 | 9 ranged (armor-piercing) / 2 | 4 | 4 | 60 | 2 | Fires every other round |
| Runecasters | 50 | 450g, 80 mana | 5 | spells | 3 | 4 | 75 | 2 | Earth/Fire only; spells −20% mana |

### Ghor (Orcs)
- **Trait — Blood and Fury**: all units +1 Atk, −10 Discipline; sacking +50% gold; foraging causes no attrition; war weariness builds at half speed; −10 base Stability; *Restless*: after 20 turns of peace, −1 Stability per turn.
- **Affinity**: Fire, Shadow. Clerics are replaced by Shamans.
- **Restrictions**: no Clerics, no Crossbowmen; Stone Walls +50% cost. **Weakness**: rout cascades; weak at defending sieges.
- **Unique building — Fighting Pits** (200g, 40 wood): training −1 turn (minimum 1); +3% champion rising.

| Unique unit | Men | Cost | Turns | Atk | Def | Armor | Disc | Speed | Special |
|---|---|---|---|---|---|---|---|---|---|
| Warband | 500 | 150g | 2 | 6 | 3 | 1 | 30 | 2 | −1 Atk per round after the first round of each day |
| Boar Riders | 300 | 400g, 60 iron, 150 food | 4 | 8 | 5 | 4 | 50 | 3 | Heavy cavalry using food instead of horses |
| Shamans | 100 | 350g, 50 mana | 4 | spells | 2 | 1 | 55 | 2 | Heal 20% of wounded; can cast Terror |

### Vashkari (Marshfolk)
- **Trait — Mire-born**: marsh move cost 1 with no fatigue or attrition; Fishing Docks +50%; all units +1 Armor; *Cold-blooded*: −10% Atk and +50% Fatigue gain in Mountains and Hills.
- **Affinity**: Frost, Shadow. **Restrictions**: no Stables (no horse cavalry). **Weakness**: highlands.
- **Unique building — Spawning Pools** (marsh or coast, 200g): +1% growth; unlocks unique units.

| Unique unit | Men | Cost | Turns | Atk | Def | Armor | Disc | Speed | Size | Special |
|---|---|---|---|---|---|---|---|---|---|---|
| Venomblades | 500 | 300g, 20 iron | 3 | 6 | 4 | 2 | 55 | 2 | 1 | Poison: targets lose 10% extra Morale per round |
| Swamp Stalkers | 300 | 260g, 30 wood | 3 | 5 javelins / 4 | 3 | 1 | 50 | 3 | 1 | Ambush in marsh and forest |
| Mire Beasts | 30 | 500g, 200 food | 5 | 6 | 6 | 5 | 60 | 2 | 15 | Monster |

### Racial affinity

| | Valdren | Sylvaen | Durrakin | Ghor | Vashkari | Ormun | Tarvani | Eldergrove | Kerrak | Hollow Crown |
|---|---|---|---|---|---|---|---|---|---|---|
| **Valdren** | — | 0 | +1 | −1 | 0 | −1 | +1 | 0 | −2 | −2 |
| **Sylvaen** | 0 | — | −1 | −2 | 0 | 0 | +1 | +2 | −2 | −2 |
| **Durrakin** | +1 | −1 | — | −2 | 0 | −1 | 0 | −1 | −2 | −2 |
| **Ghor** | −1 | −2 | −2 | — | +1 | +1 | −1 | −2 | 0 | −2 |
| **Vashkari** | 0 | 0 | 0 | +1 | — | 0 | 0 | 0 | −1 | −2 |

Affinity sets starting relations (affinity × 15). The Hollow Crown is hostile to everyone regardless.

### Mixed populations
- When recruiting, the player picks which race's population to draw from. The company gets that race's company size and modifiers. Example: a Valdren kingdom drawing Spearmen from a Durrakin district gets 400-man Durrakin Spearmen with +1 Armor and +10 Discipline.
- Another race's **unique units** require that race's unique building in the village and Stability ≥ 60.
- **Stability**: −5 for each minority race (above 10% of the village) with negative affinity to the majority; +3 for each with positive affinity. Temples halve the penalty.

---

## 13. Native Factions

### What makes natives different

| | Player and AI kingdoms | Native factions |
|---|---|---|
| Start | 1 village, 1 company | Several villages, walls, veteran armies, high-level leaders |
| Growth | Race rate | Race rate |
| Expansion | Whenever they choose | Yes, but homeland-focused and paced (see below) |
| Goal | Win the game | Hold and grow their homeland; reclaim their region when Awakened |
| Can win? | Yes | No, but an Awakening can cause everyone's defeat (Section 14) |
| Diplomacy | Full | Plus mercenaries, vassalage and integration |

The arc: **early game**, natives are the strongest powers on the map and you avoid provoking them. **Mid game**, their expansion pushes against yours; you trade, hire mercenaries, ally or fight. **Late game**, you absorb them, or they awaken.

### Native types

| Type | Start | Army | Leaders |
|---|---|---|---|
| **Tribe** | 2–4 Hamlets | 3–5 companies (Trained) | Chieftain Lv 5 |
| **Realm** | 1 Town or City + 3–6 Villages; Stone Walls in capital | 6–12 companies (mostly Veteran) | Ruler Lv 10 + 2–3 champions Lv 4–8 |
| **Barrow Kingdom** (Hollow Crown only) | 1 Barrow + 2 claimed ruins | 6 Skeleton Legions + 2 Wights | Necromancer Lv 8 |

### Native faction pool

| Race | Realms | Tribes |
|---|---|---|
| Valdren | The Free Cities of Caldmoor; The Aurel League | — |
| Sylvaen | The Elder Court of Aelindor; The Moonwood Enclave | — |
| Durrakin | The Old Hold of Khar Durum; The Ironvault Clans | — |
| Ghor | The Great Horde of Ghazrak | The Bloodtusk Clans; The Ashfang Warband |
| Vashkari | — | The Mire Clans of Ssethra; The Coil of Ixtal |
| Ormun | The Stormpeak Jarldom | The Hall of Ormskar |
| Tarvani | — | The Herds of the Sunplain; The Windrunner Tribe |
| Eldergrove | The Eldergrove of Mossdeep (max 1 per map) | — |
| Kerrak | — | The Shrieking Eyries; The Kerrak of Galecrag |
| Hollow Crown | The Hollow Crown of Kingsgrave (max 1 per map) | — |

Native factions of playable races use that race's full roster and traits.

### Native-only races

| Race | Homeland | Attitude | Signature units | Gain from alliance / integration |
|---|---|---|---|---|
| **Ormun** (Giants) | Mountains | Isolationist, very territorial | Hill Giants (20, Size 25, Atk 8, Def 6, Armor 4, Disc 70, Speed 2); Boulder Throwers (20, Size 15, ranged Atk 7, also counts as siege) | Recruit Giant companies |
| **Tarvani** (Centaurs) | Plains | Proud; respect strength | Centaur Lancers (300, Size 2, Atk 7, Def 4, Armor 2, Disc 65, Speed 4); Horse Archers (300, ranged Atk 5, Speed 5, skip enemy charge phase) | +20 horses per turn via trade; Centaur mercenaries |
| **Eldergrove** (Treefolk) | Ancient Forest | Hostile to anyone cutting their forest | Treants (30, Size 20, Atk 7, Def 8, Armor 6, Disc 90, Speed 1, ×2 damage taken from Fire); Dryads (100, magic: Earth/Frost) | Elderwood Blessing: +20% food and +5 mana in nearby villages; Treant allies |
| **Kerrak** (Harpies) | Cliffs, coastal mountains | Chaotic raiders; no lasting deals | Harpy Flock (200, flying, Atk 5, Def 2, Armor 0, Disc 40, Speed 5) | None: only bribed (temporary peace) or destroyed |
| **Hollow Crown** (Restless Dead) | Ancient Ruins | Hostile to all; no diplomacy | Skeleton Legion (500, Atk 3, Def 4, Armor 2, no morale); Wights (200, Atk 6, Def 5, Armor 3, fear aura −5 Morale to adjacent enemies per round, no morale); Necromancer champion | +20 relations with every faction that fought them |

**Native-only rules**
- **Flying** (Kerrak): ignores lines, frontage, zone of control and Integrity; attacks the rear line; archers deal ×2.
- **Nomadic camps** (Tarvani): Tribe camps relocate every 10 turns within their home plains.
- **No morale / crumble** (Hollow Crown): see Section 9.
- **Raise Dead** (Hollow Crown): after any battle within 4 hexes of a Barrow, 10% of all dead become new Skeleton companies for them (rounded down to whole companies of 500; remainder carried over).

### Native expansion
Natives grow and expand like every other faction, with homeland preferences and pacing:

- **Growth**: at their race's normal rate.
- **Settling**: when a village reaches 70% of its cap, they train settlers and found a village on a free hex of their **homeland terrain** within 6 hexes of their border.
- **Pace**: Realms found at most 1 settlement per 8 turns; Tribes 1 per 10 turns.
- **Confederation**: a Tribe with 5 villages including a Town becomes a Realm.
- **Capturing**: before Awakening, natives **keep villages they capture inside their own borders**. Outside their borders, punitive expeditions raid or sack and then return home.
- **Hollow Crown expansion**: claims Ancient Ruins as Barrows (1 per 10 turns) and turns captured villages into Barrows (the population is lost; 10% becomes Skeleton companies).
- **Standing army target**: Realms 8 companies, Tribes 4, scaled up by +1 per 2 villages beyond their starting count.

### Territory
- Each native village claims a border of radius 2.
- Ancient Forests (Eldergrove) and Barrows/claimed ruins (Hollow Crown) are always territory.
- Player and AI settlers cannot found villages inside native borders.

### Attitude (per kingdom)
Starting relations = racial affinity × 15. Then:

| Action | Relations change |
|---|---|
| Army inside their territory | −5 per army per turn |
| Settling within 3 hexes of their border | −20 |
| Lumber Camp within 3 hexes of an Ancient Forest | −10 per turn (Eldergrove) |
| Attacking a native faction of the same race | −20 |
| Trade agreement active | +2 per turn |
| Gift | +1 per 20 gold |
| Fighting their enemies (including the Hollow Crown) | +10 per battle |
| Defeating them in battle | −30 (Tarvani: +10 instead) |
| Releasing prisoners of their race | +5 |

### Responses to provocation

| Relations | Response |
|---|---|
| Below 0 | Warning popup: "Leave our lands" |
| Below −30 | Border skirmishes against armies inside their territory |
| Below −50 | Punitive expedition: an army raids or sacks your nearest offending village, then returns home |
| Below −70 | Full war: they fight to remove your presence near their land |

### Coalitions
Conquering two or more native villages gives that kingdom −15 relations with every other native faction.

### Interactions

| Option | Requirement | Effect |
|---|---|---|
| Trade Agreement | Relations ≥ 0 | Swap resources each turn |
| Hire Mercenaries | Relations ≥ 20 | Rent one native company for 5–10 turns with gold; uses none of your population; returns home after |
| Gifts / Tribute | Any | Gold or resources for relations |
| Alliance | Relations ≥ 50 | They defend you and fight your enemies near their land |
| Vassalage | Relations ≥ 60 and military power ≥ 2× theirs, or defeated them in war | They keep autonomy, pay 20% of income, send troops on request; may rebel if your power drops below theirs |
| Integration | Vassal for 20 turns with relations ≥ 80 | Their villages and population join your kingdom; you can recruit their race's units |
| Conquest | War | Capture villages; different-race population −40 Stability (decaying); unique units need Stability ≥ 60 |

**Mercenary prices** (per turn): 15% of the unit's normal cost, minimum 30 gold. Giant and Treant companies cost double.

### Native leaders
- Native rulers and champions are normal characters.
- **Killing a Realm's ruler** fractures the Realm into 2–3 Tribes that may fight each other.
- **Captured native champions** can be recruited if relations with their faction are ≥ 40 (they keep their race's bonuses).

### Native AI
- Maintain the standing army target.
- Guard borders; keep armies near the most threatened village.
- Expand by the rules above.
- Respond to provocation by the table above.
- Accept or refuse offers based on relations, relative strength and race attitude.
- Switch to the **Reclaim** goal while Awakened (Section 14).

---

## 14. The Awakening

A late-game threat in which an established native Realm stops defending and goes on the offensive.

### Omens
Three turns before awakening, the player receives **Omen** popups, e.g. *"The deep halls of Khar Durum ring with war-drums."* The Realm is marked on the map with an Omen icon.

### Triggers (any one)
1. **Threat**: the Realm has lost 30% or more of its villages since game start, or its capital is besieged.
2. **Encroachment**: 3 or more foreign villages within 4 hexes of its border.
3. **Age**: from turn 120, 1% chance per turn, +0.5% for every 10 turns after.
4. **Kin's Call**: a Realm of the same race awakens within 15 hexes (25% chance).

Only Realms awaken. Tribes of the same race within 15 hexes become the awakened Realm's vassals.

### Effects (30 turns)
- Growth ×1.5; training −1 turn; upkeep −25%; standing army target ×2.
- A **Legendary Champion** (Level 15) rises with a unique legendary skill.
- Goal becomes **Reclaim**: conquer and keep every village within 8 hexes of their capital, then push outward.
- −30 relations with every player and AI kingdom, **except** allies and overlords. For those, the Realm becomes an **Awakened Ally** and fights their enemies.

### Legendary Champions

| Faction | Legendary Champion | Legendary skill |
|---|---|---|
| The Old Hold of Khar Durum | Durrakhan the Stone King | **Mountain's Endurance**: his army's front line cannot have Integrity below 50 |
| The Ironvault Clans | Hilda Anvilborn, the Forge-Mother | **Unbroken Steel**: all companies +2 Armor |
| The Elder Court of Aelindor | Aelith the Undying Queen | **Eternal Spring**: 30% of the army's dead return each night |
| The Moonwood Enclave | Vaeron the Moon-Archer | **Silver Rain**: all ranged ×1.5 every round |
| The Free Cities of Caldmoor | The Iron Regent | **Sell-swords' Gold**: hires 2 mercenary companies per turn for free |
| The Aurel League | Grand Marshal Edmund Aurel | **Grand Charge**: all cavalry charges every round |
| The Great Horde of Ghazrak | Ghazrak the World-Breaker | **Endless Fury**: enemy routs spread twice as far |
| The Stormpeak Jarldom | Ormgar the Mountain | **Avalanche**: once per battle, −30% men to one enemy company |
| The Eldergrove of Mossdeep | The Rootmother | **Living Forest**: any battle in or next to her forest counts as forest for her side |

### Ending
- **Shattered**: the Legendary Champion is slain. −30 Stability in all the Realm's villages; the Realm returns to normal and cannot awaken for 50 turns.
- **Slumber**: 30 turns pass. The Realm keeps its conquests, returns to normal behavior and can awaken again later.

### The Long Night (Hollow Crown)
- **Trigger**: the Hollow Crown holds 3 Barrows or 10 companies.
- **Effect**: the **Hollow Emperor** rises (Level 18 Necromancer champion; skill **Grave Tide**: Raise Dead radius 8 and 20%). The Hollow Crown attacks the nearest living faction each turn.
- Every faction gets +20 relations with anyone fighting the Hollow Crown.
- **Ends** only when the Hollow Emperor is destroyed.

### Awakened defeat
If awakened natives (including the Hollow Crown during the Long Night) control **50% or more of all villages**, every player and AI kingdom loses: *"The Old Powers Reclaim Valdrys."*

---

## 15. Diplomacy, War Weariness, Victory and Defeat

### Relations
Each pair of factions has relations from −100 to +100.

| Action | Effect |
|---|---|
| Declare War | Relations −50; breaking a treaty also gives −20 Reputation with everyone |
| Propose Peace | Accepted based on war score, war weariness and personality |
| Truce | Automatic for 10 turns after peace |
| Non-Aggression Pact | No war for 20 turns |
| Alliance | Shared vision; allies are asked to join wars |
| Tribute | Gold for relations or to end a war |

Native-specific options are in Section 13.

### War weariness
- +1 per turn at war (Ghor +0.5), +1 per 1,000 men lost
- −2 per turn at peace
- All villages lose Stability equal to war weariness ÷ 10

### Victory (chosen at game setup)
- **Conquest**: capture every player and AI capital. Natives can be ignored.
- **Domination**: control 60% of all villages, including native ones. Vassal villages count as half.
- **Score**: highest score at turn 200 (population, territory, armies, champions, integrated natives).

### Defeat
- You lose all your villages, or
- **The Old Powers Reclaim Valdrys** (Section 14).

---

## 16. Random Events

| Event | Effect |
|---|---|
| Bountiful Harvest | +50% food in one village for 3 turns |
| Drought | −30% food in a region for 4 turns |
| Plague | −10% population in one village; may spread to neighbors |
| Bandits | A bandit Militia company appears near a village |
| Wandering Hero | A Level 3 champion offers to join for gold |
| Ley Surge | +50 mana |
| Noble's Ambition | A noble demands gold or loses loyalty (−Leadership) |
| Refugees | +300 population of a random race in a border village, −5 Stability |
| Ruin Discovered | A new Ancient Ruins overlay appears |
| Deserters | A low-paid company loses 20% of its men |
| Festival | Pay 100 gold for +10 Stability everywhere |
| Monster Sighting | A powerful neutral monster appears near ruins (reward for killing it) |
| Omens | Awakening warning (Section 14) |
| Native Envoy | A native faction offers trade or demands tribute |

---

## 17. AI

### Structure
The AI submits orders through the same system as the player. It is **utility-based**: it scores possible actions and picks the highest.

| Layer | Runs | Decides |
|---|---|---|
| Strategic | Each turn | Goal: Grow, Expand, Prepare War, Attack, Defend, Seek Peace |
| Economic | Each turn | Building, recruiting, taxes, settler targets |
| Operational | Each turn | Merging armies, commanders, targets, reinforcing, retreating |
| Tactical | Each battle night | Stance, withdraw or continue, hidden-card triggers, duels |
| Native Policy | Each turn | Trade, mercenaries, alliances, vassalage, integration or conquest of natives; Awakening risk |

### Battle prediction
1. Estimate the enemy army from what it can see (fog applies).
2. Run the battle resolver 20 times with different seeds.
3. Attack only if the win rate and expected losses meet the personality's thresholds.

### Personalities

| Personality | Attack threshold (win rate) | Priorities | Native policy |
|---|---|---|---|
| Warlord | 50% | Heavy infantry, cavalry, early wars | Conquer natives |
| Builder | 75% | Economy, walls, late wars | Trade and integrate |
| Mage-King | 65% | Mage Towers, magic units, Wardens | Ally with magical natives |
| Opportunist | 60% | Attacks whoever is already at war | Attacks natives already at war or Shattered |
| Turtle | 85% | Defense, walls, counterattacks | Avoid provocation |

**Race leanings**: Ghor → Warlord/Opportunist; Durrakin → Turtle/Builder; Sylvaen → Mage-King/Turtle; Valdren → any; Vashkari → Opportunist/Builder.

**Awakening awareness**: the AI tracks Encroachment and Threat triggers and avoids pushing a Realm into awakening unless it is allied with it or strong enough to win.

### Difficulty

| Level | AI bonuses (AI kingdoms only, not natives) |
|---|---|
| Easy | −20% income; 20% of attacks skip simulation |
| Normal | None |
| Hard | +20% income; training −1 turn (minimum 1) |
| Brutal | +40% income; +1% growth; lower attack thresholds |

The AI never sees through fog on any difficulty.

### Performance
AI and turn resolution run in a Web Worker. Target: under 2 seconds per full turn on a Medium map.

---

## 18. Screens and UI

Designed for a **1920×1080** reference screen.

### Main layout
```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Top bar 56px: Kingdom | Gold Food Wood Stone Iron Horses Mana | Pop | Turn | End Turn │
├──────────────┬────────────────────────────────────────────────┬───────────────┤
│ Left 320px   │                                                │ Right 380px   │
│ Tabs:        │                Hex Map (PixiJS)                │ Context panel │
│ Villages     │      pan, zoom, select, move, borders, fog     │ (village,     │
│ Armies       │                                                │  army, hex,   │
│ Champions    │                                                │  faction)     │
│ Natives      │                                                │               │
│ Kingdom      │                                                │               │
├──────────────┴────────────────────────────────────────────────┴───────────────┤
│ Bottom 180px: Event log | Ongoing battles | Training & build queues | Omens        │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Screens

| Screen | Contents |
|---|---|
| Main Menu | New Game, Continue, Load, Settings |
| New Game Setup | Race, kingdom name and color, map size, seed, number of AI, AI races and personalities, difficulty, victory condition, Hollow Crown toggle, Ironman |
| Map | Main layout; native borders in faction colors; sacred hexes; Omen icons |
| Village Panel | Population by race, workers, stability, tax, buildings and slots, terrain in radius, recruit queue with source-race picker, garrison |
| Army Panel | Companies (race, strength, rank, morale, fatigue), commander, champions (own hidden ones marked), stance, merge/split, upkeep, speed |
| Champion Screen | Stats, level, XP, traits, epithet, skill tree, battle history, assignment |
| Battle Report | Day/round log, losses tables, criteria charts, key moments, rewards |
| Battle Night Dialog | Stance, withdraw, reinforcements arriving, hidden-card triggers |
| Kingdom Overview | Income/expense breakdown, resources over time, war weariness |
| Diplomacy | AI kingdoms: relations, treaties, actions |
| Natives Panel | Native factions, relations, borders, Awakening status, interactions, mercenaries for hire |
| Event Popup | Event text and choices |
| Save/Load | Slots, autosaves, export/import |
| Settings | Animation speed, audio, hotkeys |

### Hotkeys

| Key | Action |
|---|---|
| Enter | End Turn |
| Tab | Next idle army |
| V | Next village |
| M | Merge selected companies |
| B | Latest battle report |
| N | Natives panel |
| Esc | Close panel / menu |

### Art direction
- **v1**: flat colored hexes, simple icons, banner markers in faction colors.
- **Later**: illustrated terrain tiles and unit banners. Art is kept separate from the engine.

---

## 19. Naming Data

Store each race's names in `/src/engine/data/names/{race}.json`. Names are generated with the seeded RNG. Prefer full-name lists; fall back to the syllable generator when a list runs out. Never reuse a name already in the game.

### Region names
Pattern: `{part} {terrain word}` (optionally `the {part} {terrain word}`).

| Terrain | Terrain words |
|---|---|
| Plains | Fields, Plains, Downs, Steppe, Meadows, Vale |
| Forest | Wood, Weald, Deep, Thicket, Greenwood |
| Hills | Hills, Fells, Rises, Heights |
| Mountains | Peaks, Spine, Teeth, Crags, Range |
| Marsh | Mire, Fen, Bog, Sloughs, Marshes |
| Coast | Coast, Shore, Strand, Reach |

Parts: Ashen, Grey, Thorn, Silver, Iron, Raven, Wolf, Hollow, Amber, Frost, Ember, Sorrow, Vael, Kesh, Dun, Mor, Old King's, Sundered, Tharen, Gold, Black, Whisper, Storm, Bright.

### Valdren (Humans)
- **Kingdom patterns**: Kingdom of {Place}, Crown of {Place}, {Place} Marches, Principality of {Place}
- **Villages**: Ashford, Brennick, Caldmoor, Dunmere, Elmsworth, Fairhollow, Greywater, Harrowgate, Kestrel's Rest, Lindhurst, Marrowby, Northwick, Oakhaven, Redfield, Stonebridge, Thornbury, Westmarch, Wyndham, Bramstead, Aldergate
- **Syllables**: prefixes Ash, Bren, Cald, Dun, Elm, Fair, Grey, Har, Lind, Mar, North, Oak, Red, Stone, Thorn, West, Wynd, Bram, Alder; suffixes -ford, -wick, -moor, -mere, -by, -hurst, -haven, -field, -gate, -bridge, -ton, -stead
- **Male names**: Aldric, Bertram, Cedric, Edmund, Gareth, Halden, Osric, Roland, Tomas, Wystan, Aldous, Merek, Alaric, Corwin, Hugh
- **Female names**: Adela, Beatrix, Cecily, Elinor, Isolde, Maud, Rowena, Sybil, Joanna, Agnes, Edith, Matilda, Alys, Gwen, Rosamund
- **Surnames**: Ashby, Blackwood, Corwen, Dunmore, Halloway, Marlowe, Penrose, Thorne, Vance, Whitlock, Fairfax, Greaves
- **Format**: `{first} {surname}`; titles Sir/Dame for champions, Lord/Lady for nobles

### Sylvaen (Elves)
- **Kingdom patterns**: The {Place} Court, House {House}, Grove of {Place}, The {Place} Enclave
- **Villages**: Aelindor, Caelith, Ithriel, Lorthaen, Myrravel, Nythara, Silvaine, Thalorin, Vaelith, Elarion, Faelwyn, Seraneth, Ilvaris, Talanor, Yselde
- **Syllables**: prefixes Ael, Cael, Ith, Lor, Myr, Nyth, Sil, Thal, Vael, Fael, Elar, Ser, Ilv, Tal; suffixes -indor, -ith, -iel, -thaen, -avel, -ara, -vaine, -orin, -wyn, -eth, -ion, -aris
- **Male names**: Aerion, Caelan, Eryndel, Faelar, Myrdin, Sareth, Taelis, Vaeron, Ilythen, Thandor, Lethril, Orrith
- **Female names**: Aelwen, Calithe, Elowen, Faelith, Ilyra, Lyssara, Nimeth, Saelith, Vaelora, Yrelle, Thessaiel, Miravel
- **Houses**: Aelvaris, Caelmyr, Ithandril, Silvarane, Thaloris, Vaenith, Myrrowen
- **Format**: `{first} of House {house}`

### Durrakin (Dwarves)
- **Kingdom patterns**: The Hold of {Place}, Clan {Clan}, {Place} Deep, The {Place} Holds
- **Villages**: Khar Durum, Dun Gorrim, Ironvault, Grimhold, Thorgrund, Kal Morra, Stonedeep, Brannoc Gate, Hammerfall, Orrin's Delve, Duskanvil, Gol Barren, Haldrak, Morgrund
- **Syllables**: prefixes Khar, Dun, Gor, Thor, Kal, Brann, Grim, Durr, Hald, Mor; suffixes -durum, -grund, -hold, -delve, -gate, -forge, -deep, -mor, -rak
- **Male names**: Balgrim, Durgan, Harrok, Korvin, Morgrim, Orrin, Thorvak, Brokk, Gundar, Varrik, Dolgren, Haldor
- **Female names**: Brynja, Dagna, Helga, Kara, Ragna, Sigrun, Thora, Hilde, Vigdis, Embla, Gerda, Astrid
- **Clans**: Stonefist, Deepdelver, Hammerhand, Coalbrow, Anvilborn, Granitejaw, Goldvein, Ironmantle, Emberbeard
- **Format**: `{first} {clan}`

### Ghor (Orcs)
- **Kingdom patterns**: The {Place} Horde, Clan {Place}, The {Place} Warband
- **Villages**: Ghazrak, Morkul, Skarnag, Urzog, Krull's Pit, Durzag, Vorgash, Rakmor, Thuzgul, Bruka, Grashnak, Ulkar, Zagmor, Ruktar
- **Syllables**: prefixes Ghaz, Mor, Skar, Urz, Dur, Vor, Rak, Thuz, Grash, Ulk, Bruk, Zag; suffixes -rak, -kul, -nag, -zog, -gash, -mor, -gul, -ar, -tar
- **Male names**: Azgar, Brakka, Durgash, Grommak, Hruk, Krazz, Morgath, Rukh, Throgg, Urzak, Vorga, Zugrak
- **Female names**: Agra, Bashka, Durga, Ghazra, Kurna, Morra, Shagra, Urka, Yazga, Zhora
- **Epithets**: Ironjaw, Skullsplitter, the Red, Bonecrusher, Blacktooth, Stormtusk, Ashfang, the Unbowed
- **Format**: `{first} {epithet}`

### Vashkari (Marshfolk)
- **Kingdom patterns**: The {Place} Brood, The {Place} Mire-Clans, Coil of {Place}
- **Villages**: Ssethra, Ixtal, Vash'kor, Thessik, Shaaz, Kesh'ra, Ixmoor, Zhalith, Ossek, Vruul, Sskarra, Tlazik
- **Syllables**: prefixes Sseth, Ix, Vash, Thess, Shaa, Kesh, Zhal, Oss, Vru, Tla; suffixes -ra, -tal, -kor, -ik, -az, -ith, -ek, -ul
- **Names** (unisex): Isska, Kethrax, Ssarul, Tzeshi, Vashik, Xalith, Zhaaro, Ossith, Kraal, Thessa, Ixil, Sslith
- **Clutches**: Green Coil, Still Water, Deep Reed, Black Fen, Silt-Mother, Old Scale
- **Format**: `{name} of the {clutch} Clutch`

### Ormun (Giants)
- **Settlements**: Ormskar, Hrimvald, Stormpeak Hall, Grimfell, Thunderhearth, Vallgrim
- **Names**: Ormgar, Skaldra, Hrimbold, Torvald, Gunnolf, Brakki, Ymra, Haldis
- **Epithets**: the Mountain, Stonehand, Cloudbreaker, Frostbrow
- **Format**: `{name} {epithet}`

### Tarvani (Centaurs)
- **Camps**: Sunwake Camp, Thunderhoof Ring, Goldgrass Circle, Windmane Camp, Dustrider Ring
- **Names**: Tarvos, Kaelen, Orinth, Sabrak, Velan, Ishra, Mareth, Nerya, Corvanth, Lessa
- **Epithets**: Swiftstrider, Stormhoof, Far-Eye, Sunmane
- **Format**: `{name} {epithet}`

### Eldergrove (Treefolk)
- **Groves**: Heartwood, Mossdeep, Rootmother's Hollow, Thornveil, Greenhall
- **Treant names**: Elder Thornbough, Ashvel, Greyleaf, Wyrmroot, Hollowmere, Bramblekin
- **Dryad names**: Wenna, Sorrel, Hazel, Willa, Rowan, Linden

### Kerrak (Harpies)
- **Eyries**: Shrikecliff, Razorroost, Galecrag, the Screaming Eyrie
- **Names**: Skree, Kraeya, Vessk, Thirra, Kiraak, Zeetha

### Hollow Crown (Restless Dead)
- **Barrows**: Kingsgrave, Barrow of Tharos, the Sunken Crypts, the Ashen Tomb, Halls of Silence
- **Necromancers**: Vael Morthane, Lord Ossric the Pale, Sereth the Unburied, the Grave-Queen Ilvara
- **Emperor**: the Hollow Emperor (true name unknown)

---

## 20. Technical Architecture

### Stack

| Layer | Choice |
|---|---|
| Build | Vite + React + TypeScript |
| Map rendering | PixiJS via `@pixi/react` |
| UI | React + Tailwind |
| State | Zustand |
| Saves | IndexedDB via Dexie, plus JSON export/import |
| Heavy computation | Web Worker (engine + AI) |
| Tests | Vitest |
| Hosting | Vercel (static) |

No backend, database or accounts. Everything runs in the browser.

### Folder structure
```
/src
  /engine                 ← pure TypeScript, no React, no DOM
    /data
      units.json
      buildings.json
      terrain.json
      races.json
      natives.json        ← faction pool, native-only units
      spells.json
      traits.json
      skills.json
      events.json
      legendary.json
      /names/{race}.json
    /core
      types.ts
      rng.ts
      state.ts
      orders.ts
      resolveTurn.ts
      economy.ts
      population.ts
      movement.ts
      siege.ts
      stability.ts
      diplomacy.ts
      natives.ts          ← expansion, provocation, awakening
      events.ts
      victory.ts
    /battle
      setupBattle.ts
      resolveBattleDay.ts
      damage.ts
      morale.ts
      criteria.ts
      spells.ts
      champions.ts
      pursuit.ts
      report.ts
    /ai
      strategic.ts
      economic.ts
      operational.ts
      tactical.ts
      nativePolicy.ts
      nativeAI.ts
      predict.ts
      personalities.ts
    /mapgen
      generateMap.ts
      placeFactions.ts
      names.ts
  /worker
  /ui
    /map
    /panels
    /screens
    /components
  /store
  /save
/scripts
  sim.ts                  ← run battle scenarios from the command line
  balance.ts              ← thousands of battles → win rates and losses
/tests
```

### Engineering rules (copy into `CLAUDE.md`)
1. **The engine is pure.** No React, DOM, `Math.random()` or `Date` anywhere in `/src/engine`.
2. **Deterministic.** All randomness goes through the seeded RNG. Turn seed = hash(game seed, turn number). Same state + orders + seed = same result.
3. **Data-driven.** All balance numbers live in `/src/engine/data`. No magic numbers in logic.
4. **Orders only.** UI and AI change the game only by submitting orders.
5. **Immutable turns.** `resolveTurn(state, orders, seed)` returns a new state plus an event log.
6. **Tested.** Every battle mechanic has unit tests. Run the balance script before closing a milestone.
7. **Reloading a save and replaying the same orders gives the same results** (prevents save-scumming).

### Core types
```ts
type HexCoord = { q: number; r: number };

type RaceId = 'valdren' | 'sylvaen' | 'durrakin' | 'ghor' | 'vashkari'
            | 'ormun' | 'tarvani' | 'eldergrove' | 'kerrak' | 'hollowCrown';

interface GameState {
  seed: string;
  turn: number;
  settings: GameSettings;
  map: MapData;
  kingdoms: Record<KingdomId, Kingdom>;
  villages: Record<VillageId, Village>;
  companies: Record<CompanyId, Company>;
  armies: Record<ArmyId, Army>;
  characters: Record<CharacterId, Character>;
  battles: Record<BattleId, Battle>;
  diplomacy: DiplomacyState;
  usedNames: string[];
  log: GameEvent[];
}

interface Kingdom {
  id: KingdomId;
  name: string;
  color: string;
  kind: 'player' | 'ai' | 'native';
  race: RaceId;
  nativeType?: 'tribe' | 'realm' | 'barrow';
  aiPersonality?: AIPersonality;
  resources: Resources;
  capitalId: VillageId;
  rulerId: CharacterId;
  warWeariness: number;
  explored: string[];
  standingArmyTarget?: number;
  lastSettledTurn?: number;
  vassalOf?: KingdomId;
  vassalSince?: number;
  awakening?: {
    state: 'dormant' | 'omens' | 'awakened' | 'slumber' | 'shattered';
    sinceTurn: number;
    legendaryChampionId?: CharacterId;
    cooldownUntil?: number;
  };
  startingVillageCount: number;
}

interface Village {
  id: VillageId;
  name: string;
  ownerId: KingdomId | null;
  hex: HexCoord;
  tier: 'hamlet' | 'village' | 'town' | 'city';
  populationByRace: Partial<Record<RaceId, number>>;
  stability: number;
  taxLevel: 'low' | 'normal' | 'high';
  buildings: BuildingInstance[];
  buildQueue: QueueItem[];
  trainQueue: QueueItem[];
  stores: number;
  recentConscription: number;
  conqueredTurn?: number;
  borderRadius: number;
  isBarrow?: boolean;
}

interface Company {
  id: CompanyId;
  ownerId: KingdomId;
  unitType: UnitTypeId;
  race: RaceId;
  men: number;
  rank: 'green' | 'trained' | 'veteran' | 'elite';
  battlesSurvived: number;
  armyId: ArmyId | null;
  hex: HexCoord;
  movementLeft: number;
  status: 'ready' | 'broken' | 'garrison';
  captainId?: CharacterId;
  hiddenChampion?: { characterId: CharacterId; trigger: RevealTrigger };
  mercenary?: { fromKingdom: KingdomId; turnsLeft: number };
}

interface Army {
  id: ArmyId;
  ownerId: KingdomId;
  name: string;
  companyIds: CompanyId[];
  commanderId?: CharacterId;
  hex: HexCoord;
  stance: 'aggressive' | 'hold' | 'fightingRetreat';
}

interface Character {
  id: CharacterId;
  name: string;
  epithet?: string;
  ownerId: KingdomId;
  race: RaceId;
  kind: 'ruler' | 'noble' | 'champion' | 'legendary';
  class?: ChampionClass;
  level: number;
  xp: number;
  stats: { might: number; vitality: number; leadership: number; tactics: number; arcana: number; resolve: number };
  traits: TraitId[];
  skills: SkillId[];
  status: 'active' | 'wounded' | 'captured' | 'dead';
  woundedTurns?: number;
  originCompanyId?: CompanyId;
}

interface UnitType {
  id: UnitTypeId;
  baseMen: number;
  usesRaceCompanySize: boolean;
  cost: Partial<Resources>;
  trainTurns: number;
  upkeepGold: number;
  upkeepMana?: number;
  atk: number;
  rangedAtk?: number;
  def: number;
  armor: number;
  discipline: number;
  speed: number;
  size: number;
  tags: UnitTag[];
  flying?: boolean;
  noMorale?: boolean;
  allowedRaces?: RaceId[];
  requiresBuilding?: BuildingId[];
  special?: SpecialRuleId[];
}

interface RaceData {
  id: RaceId;
  playable: boolean;
  homeland: TerrainId[];
  growthRate: number;
  companySize: number;
  modifiers: StatModifiers;
  terrainRules: TerrainRule[];
  magicAffinity: SchoolId[];
  forbiddenUnits: UnitTypeId[];
  forbiddenSchools: SchoolId[];
  uniqueBuilding?: BuildingId;
  uniqueUnits: UnitTypeId[];
  affinity: Partial<Record<RaceId, number>>;
  startingBonus?: Partial<Resources>;
}

interface Battle {
  id: BattleId;
  hex: HexCoord;
  day: number;
  attacker: BattleSide;
  defender: BattleSide;
  siege?: SiegeState;
  report: BattleReport;
}

interface BattleSide {
  kingdomId: KingdomId;
  armyIds: ArmyId[];
  front: CompanyId[];
  flanks: CompanyId[];
  rear: CompanyId[];
  reserve: CompanyId[];
  routed: CompanyId[];
  cohesion: number;
  integrity: number;
  mana: number;
  companyState: Record<CompanyId, { morale: number; fatigue: number; startMen: number }>;
  revealedChampions: CharacterId[];
}
```

---

## 21. Development Roadmap

Hand one milestone at a time to Claude Code.

| # | Milestone | Done when |
|---|---|---|
| **M1** | **Battle engine** | `npm run sim -- hills` prints a full multi-day report like Appendix A; balance script runs 1,000 battles; tests cover damage, Size, morale, routs, overlap, stances, pursuit, flying, no-morale |
| **M2** | **Champions & magic in battle** | Hidden cards trigger; duels work; spells change criteria; rising rolls create champions with class, trait and epithet |
| **M3** | **Map & villages** | Seeded hex map renders in PixiJS with terrain, regions, fog; villages with population by race, buildings, workers, taxes, stability; race-biased starts; name generation |
| **M4** | **Units & armies on the map** | Recruitment with training queues and source-race choice; racial modifiers and unique units/buildings for all 5 playable races; movement, ZOC, merge/split, upkeep, supply |
| **M5** | **Battles in the game** | Battles start from movement; multi-turn battles with night dialog; battle report screen with charts; prisoners |
| **M6** | **Sieges & conquest** | Walls, breaching, blockades, occupy/sack/raze, neutral villages, mixed-population stability |
| **M7** | **AI v1** | One personality builds, recruits, expands and attacks with battle prediction; AI vs AI wars |
| **M7.5** | **Natives** | Native Realms and Tribes of playable races placed at map generation; borders; native AI with expansion, standing army, provocation responses and punitive expeditions; Confederation |
| **M8** | **Champions outside battle** | Champion screen, leveling, skill trees, rulers, nobles, captured champion recruitment, strategic spells |
| **M9** | **AI v2 & diplomacy** | All personalities and difficulties; peace, war, alliances, war weariness; native trade, mercenaries, alliances, vassalage, integration, coalitions; AI Native Policy |
| **M9.5** | **Native-only races & the Awakening** | Ormun, Tarvani, Eldergrove, Kerrak, Hollow Crown with their rules; Omens, Awakening, Legendary Champions, Long Night, awakened defeat |
| **M10** | **Events, saves & victory** | Random events, save slots, autosave, Ironman, export/import, all victory and defeat conditions |
| **M11** | **Polish & release** | Tutorial hints, settings, hotkeys, performance pass, deploy to Vercel |

### Suggested prompt per milestone
> Read `docs/GAME_DESIGN.md` and `CLAUDE.md`. Implement Milestone M1 only. Write tests first, then the implementation. Finish by running the sim script for the hills scenario and showing its output.

---

## 22. Appendix A: Example Battle (Battle of the Hills)

Illustrative numbers. M1's sim output should look like this in structure; exact numbers will differ.

### Setup
You attack into hills; the enemy gets +15% defense from terrain.

**Your army: 2,550 men, commanded by Sir Halden Ashby (Lv 8)**

| Company | Men | Position |
|---|---|---|
| S1 Spearmen | 500 | Front |
| S2 Spearmen | 500 | Front |
| M1 Militia (hidden: Tomas) | 500 | Front |
| M2 Militia | 500 | Front |
| A1 Archers | 500 | Rear |
| BM Battle Mages | 50 | Rear |

**Enemy: 4,000 men, 8 Militia companies (E1–E8), no commander.** Cohesion −30%. Hill frontage is 4, so E1–E4 fight and E5–E8 wait in reserve.

### Day 1

| Round | Events | Your losses | Enemy losses |
|---|---|---|---|
| Morning | Archers + *Arrow Gale* on E1/E2, *Firestorm* on E3; melee | 140 (S1 25, S2 20, M1 45, M2 50) | 380 (ranged 230, melee 150) |
| Midday | No mana for *Arrow Gale*; enemy numbers press the militia | 200 (S1 20, S2 20, M1 75, M2 85) | 200 (ranged 70, melee 130) |
| Dusk | Archers fatigued; no side breaks → Ongoing Battle | 180 (S1 15, S2 15, M1 70, M2 80) | 170 (ranged 50, melee 120) |
| **Day total** | | **520** (2,030 standing) | **750** (3,250 standing) |

End of Day 1 criteria — You: Morale 62, Cohesion 85, Fatigue 68. Enemy: Morale 48, Cohesion 50, Fatigue 74.

### Night 1
Fatigue −40 both sides. Your Morale +10 (commander). Enemy gets no recovery and cannot rotate reserves. You switch to Hold. No Clerics, so no wounded return.

### Day 2

| Round | Events | Your losses | Enemy losses |
|---|---|---|---|
| Morning | Archers on E2, *Firestorm* on E3; melee. M1 Morale drops below 40 → **Tomas, Folk Hero Lv 6** revealed: fear shock, surge, *Unbreakable*. E3 routs; E5 fills the gap | 180 (S1 15, S2 15, M1 80, M2 70) | 255 |
| Midday | Archers on E5; Tomas kills 90 in E2; melee. E1 and E2 rout; the rout spreads to E4, E5 and the untouched E6–E8 | 110 (S1 10, S2 10, M1 50, M2 40) | 290 |
| Pursuit | Infantry only | — | 120 killed, 160 captured, 2,425 escaped |

### Final report — Decisive Victory (2 days)

| | Start | Dead | Wounded | Captured | Escaped | Standing |
|---|---|---|---|---|---|---|
| You | 2,550 | 567 | 243 | 0 | 0 | 1,740 |
| Enemy | 4,000 | 990 | — | 585 | 2,425 | 0 |

- Your 810 casualties = 567 dead + 243 wounded (return over the next turns).
- Enemy prisoners 585 = 425 wounded left on the field + 160 stragglers.
- The enemy's 2,425 escapees regroup as Broken companies.

| Your company | Start | Day 1 | Day 2 | End | Lost |
|---|---|---|---|---|---|
| S1 Spearmen | 500 | −60 | −25 | 415 | 17% |
| S2 Spearmen | 500 | −55 | −25 | 420 | 16% |
| M1 Militia (Tomas) | 500 | −190 | −130 | 180 | 64% |
| M2 Militia | 500 | −215 | −110 | 175 | 65% |
| A1 Archers | 500 | 0 | 0 | 500 | 0% |
| BM Battle Mages | 50 | 0 | 0 | 50 | 0% |

**Rewards**: Tomas the Unbroken gains XP (near Lv 7). M1 gains Glory and +10% rising chance. M2 rolls "Held the line" (no champion this time). Sir Halden gains commander XP. M1 and M2 need replenishing or merging.

**Lesson**: the enemy lost 1,415 men in combat but 2,425 simply ran. The leaderless army couldn't rotate reserves or recover morale, and the hidden champion turned the breaking point into the battle's end.

---

## 23. Appendix B: Open Decisions

| Decision | Current default |
|---|---|
| Final game title | *Banners of Valdrys* |
| Naval combat | Not in v1 |
| Artifacts (champion equipment) | Not in v1; ruins give gold, mana and XP |
| Roaming monsters | Only from events and ruins |
| Calendar / seasons | Not modeled in v1 |
| Score victory turn limit | 200 |

/**
 * Reconstruction of the GDD §9/§17 "83 known stall-pattern cases".
 *
 * The GDD reports an 83-case deterministic audit but does not list the cases.
 * These 83 are built from the categories it names: defensive mirrors and
 * cross-pairs, reflect loops, charge-greedy, aggressive cash-out, anti-charge,
 * cross-strategy patterns, ranged/melee/Tier-4 neutralization, and Blackhole
 * mirrors. They are our reconstruction, not the original suite.
 */
import { ATTACK_IDS, type AttackId } from '../../src/engine';
import { alternating, always, bait, cashOut, chargeGreedy, reflectLoop, type Strategy } from './harness';

export type Category =
  | 'defensive-mirror-cross'
  | 'reflect-loop'
  | 'charge-greedy'
  | 'aggressive-cash-out'
  | 'anti-charge'
  | 'cross-strategy'
  | 'tier-class-collision'
  | 'blackhole-mirror';

export interface StallScenario {
  readonly id: string;
  readonly category: Category;
  readonly strategies: readonly [Strategy, Strategy];
  /** Neither side ever attacks before Sudden Death, so nothing can eliminate until then. */
  readonly passiveUntilSuddenDeath: boolean;
}

const scenarios: StallScenario[] = [];
const add = (
  category: Category,
  id: string,
  a: Strategy,
  b: Strategy,
  passiveUntilSuddenDeath = false,
): void => {
  scenarios.push({ id: `${category}/${id}`, category, strategies: [a, b], passiveUntilSuddenDeath });
};

// A. Defensive mirrors and cross-pairs (10) -------------------------------------
const defensive: [string, Strategy][] = [
  ['dodge', always('DODGE')],
  ['shield', always('SHIELD')],
  ['dodge/shield', alternating('DODGE', 'SHIELD')],
  ['shield/dodge', alternating('SHIELD', 'DODGE')],
];
defensive.forEach(([nameA, a], i) => {
  defensive.slice(i).forEach(([nameB, b]) => add('defensive-mirror-cross', `${nameA} vs ${nameB}`, a, b, true));
});

// B. Reflect loops (18) ----------------------------------------------------------
const reflects = ([1, 2, 3, 4] as const).map((n) => [`reflect-${n}`, reflectLoop(n)] as [string, Strategy]);
for (const [name, strategy] of reflects) add('reflect-loop', `${name} mirror`, strategy, strategy, true);
for (const [name, strategy] of reflects) {
  add('reflect-loop', `${name} vs dodge`, strategy, always('DODGE'), true);
  add('reflect-loop', `${name} vs shield`, strategy, always('SHIELD'), true);
}
reflects.forEach(([nameA, a], i) => {
  reflects.slice(i + 1).forEach(([nameB, b]) => add('reflect-loop', `${nameA} vs ${nameB}`, a, b, true));
});

// C. Charge-greedy (8) -----------------------------------------------------------
add('charge-greedy', 'greedy mirror', chargeGreedy, chargeGreedy, true);
add('charge-greedy', 'greedy vs dodge', chargeGreedy, always('DODGE'), true);
add('charge-greedy', 'greedy vs shield', chargeGreedy, always('SHIELD'), true);
add('charge-greedy', 'greedy vs dodge/shield', chargeGreedy, alternating('DODGE', 'SHIELD'), true);
for (const [name, strategy] of reflects) add('charge-greedy', `greedy vs ${name}`, chargeGreedy, strategy, true);

// D. Aggressive cash-out against passive defenders (24) -------------------------
for (const weapon of ATTACK_IDS) {
  add('aggressive-cash-out', `${weapon} vs dodge`, cashOut(weapon), always('DODGE'));
  add('aggressive-cash-out', `${weapon} vs shield`, cashOut(weapon), always('SHIELD'));
}

// E. Anti-charge (7): attackers punishing Charge, and bait that mixes Charge with Dodge
for (const weapon of ['GUN', 'KNIFE', 'GATLING_GUN', 'AXE'] as const) {
  add('anti-charge', `${weapon} vs greedy`, cashOut(weapon), chargeGreedy);
}
for (const weapon of ['GUN', 'GATLING_GUN', 'KATANA'] as const) {
  add('anti-charge', `${weapon} vs bait`, cashOut(weapon), bait);
}

// F. Cross-strategy (8): attackers into Reflect loops -----------------------------
const crossPairs: [AttackId, 1 | 2 | 3 | 4][] = [
  ['KNIFE', 1],
  ['GUN', 2],
  ['AXE', 3],
  ['AXE', 4],
  ['GRENADE', 3],
  ['KATANA', 4],
  ['BOMB', 4],
  ['NUKE', 4],
];
for (const [weapon, n] of crossPairs) add('cross-strategy', `${weapon} vs reflect-${n}`, cashOut(weapon), reflectLoop(n));

// G. Tier / class collisions between two attackers (5) ----------------------------
add('tier-class-collision', 'GUN (ranged) vs KNIFE (melee), Tier 1', cashOut('GUN'), cashOut('KNIFE'));
add('tier-class-collision', 'GATLING_GUN (ranged) vs AXE (melee), Tier 2', cashOut('GATLING_GUN'), cashOut('AXE'));
add('tier-class-collision', 'THREE_HIT_COMBO (ranged) vs KATANA (melee), Tier 3', cashOut('THREE_HIT_COMBO'), cashOut('KATANA'));
add('tier-class-collision', 'BOMB (ranged) vs MJOLNIR (melee), Tier 4', cashOut('BOMB'), cashOut('MJOLNIR'));
add('tier-class-collision', 'KNIFE (Tier 1) vs GATLING_GUN (Tier 2)', cashOut('KNIFE'), cashOut('GATLING_GUN'));

// H. Blackhole mirrors (3) --------------------------------------------------------
add('blackhole-mirror', 'BLACKHOLE mirror', cashOut('BLACKHOLE'), cashOut('BLACKHOLE'));
add('blackhole-mirror', 'BLACKHOLE vs BOMB', cashOut('BLACKHOLE'), cashOut('BOMB'));
add('blackhole-mirror', 'BLACKHOLE vs reflect-4', cashOut('BLACKHOLE'), reflectLoop(4));

export const STALL_SCENARIOS: readonly StallScenario[] = scenarios;

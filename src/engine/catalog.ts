/** §3 attack catalog and §4 defensive actions. Costs and classes are exact. */

export const ATTACK_IDS = [
  'GUN',
  'KNIFE',
  'GATLING_GUN',
  'FLAMETHROWER',
  'AXE',
  'THREE_HIT_COMBO',
  'GRENADE',
  'KATANA',
  'BOMB',
  'NUKE',
  'MJOLNIR',
  'BLACKHOLE',
] as const;
export type AttackId = (typeof ATTACK_IDS)[number];

export const DEFENSE_IDS = [
  'DODGE',
  'SHIELD',
  'REFLECT',
  'DOUBLE_REFLECT',
  'TRIPLE_REFLECT',
  'QUAD_REFLECT',
] as const;
export type DefenseId = (typeof DEFENSE_IDS)[number];

/** `SPECIAL` is Blackhole only; it never takes part in ranged-vs-melee logic (§8). */
export type AttackClass = 'RANGED' | 'MELEE' | 'SPECIAL';

/**
 * How an attack picks its effect target set (§7).
 * - SINGLE: exactly one opponent. The GDD never lists a target count for the
 *   Tier 1-2 weapons; their matrix cells say "Eliminate" (singular), so they
 *   hit one chosen opponent.
 * - UP_TO_THREE: 1 to 3 distinct opponents (3-hit Combo, Grenade, Katana).
 * - ALL_OPPONENTS: every other living player (Bomb, Nuke, Mjolnir, Blackhole).
 */
export type TargetMode = 'SINGLE' | 'UP_TO_THREE' | 'ALL_OPPONENTS';

export interface AttackDef {
  readonly id: AttackId;
  readonly name: string;
  /** Charge cost. Also the attack's tier (§3). */
  readonly cost: number;
  readonly tier: number;
  readonly attackClass: AttackClass;
  readonly targetMode: TargetMode;
}

const attack = (
  id: AttackId,
  name: string,
  cost: number,
  attackClass: AttackClass,
  targetMode: TargetMode,
): AttackDef => ({ id, name, cost, tier: cost, attackClass, targetMode });

export const ATTACKS: Readonly<Record<AttackId, AttackDef>> = {
  GUN: attack('GUN', 'Gun', 1, 'RANGED', 'SINGLE'),
  KNIFE: attack('KNIFE', 'Knife', 1, 'MELEE', 'SINGLE'),
  GATLING_GUN: attack('GATLING_GUN', 'Gatling Gun', 2, 'RANGED', 'SINGLE'),
  FLAMETHROWER: attack('FLAMETHROWER', 'Flamethrower', 2, 'RANGED', 'SINGLE'),
  AXE: attack('AXE', 'Axe', 2, 'MELEE', 'SINGLE'),
  THREE_HIT_COMBO: attack('THREE_HIT_COMBO', '3-hit Combo', 3, 'RANGED', 'UP_TO_THREE'),
  GRENADE: attack('GRENADE', 'Grenade', 3, 'RANGED', 'UP_TO_THREE'),
  KATANA: attack('KATANA', 'Katana', 3, 'MELEE', 'UP_TO_THREE'),
  BOMB: attack('BOMB', 'Bomb', 4, 'RANGED', 'ALL_OPPONENTS'),
  NUKE: attack('NUKE', 'Nuke', 4, 'RANGED', 'ALL_OPPONENTS'),
  MJOLNIR: attack('MJOLNIR', 'Mjolnir', 4, 'MELEE', 'ALL_OPPONENTS'),
  BLACKHOLE: attack('BLACKHOLE', 'Blackhole', 5, 'SPECIAL', 'ALL_OPPONENTS'),
};

export interface DefenseDef {
  readonly id: DefenseId;
  readonly name: string;
  readonly cost: number;
}

export const DEFENSES: Readonly<Record<DefenseId, DefenseDef>> = {
  DODGE: { id: 'DODGE', name: 'Dodge', cost: 0 },
  SHIELD: { id: 'SHIELD', name: 'Shield', cost: 0 },
  REFLECT: { id: 'REFLECT', name: 'Reflect', cost: 1 },
  DOUBLE_REFLECT: { id: 'DOUBLE_REFLECT', name: 'Double Reflect', cost: 2 },
  TRIPLE_REFLECT: { id: 'TRIPLE_REFLECT', name: 'Triple Reflect', cost: 3 },
  QUAD_REFLECT: { id: 'QUAD_REFLECT', name: 'Quad Reflect', cost: 4 },
};

export const isAttackId = (value: unknown): value is AttackId =>
  typeof value === 'string' && Object.hasOwn(ATTACKS, value);

export const isDefenseId = (value: unknown): value is DefenseId =>
  typeof value === 'string' && Object.hasOwn(DEFENSES, value);

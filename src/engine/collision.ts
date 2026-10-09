/** §6 attack-versus-attack rules (with the §8 Blackhole overrides). */
import { ATTACKS, type AttackId } from './catalog';

export type CollisionRuleId =
  | 'BLACKHOLE_MIRROR'
  | 'BLACKHOLE_OVERRIDE'
  | 'HIGHER_TIER'
  | 'RANGED_BEATS_MELEE'
  | 'SAME_TIER_SAME_CLASS';

export interface CollisionResult {
  readonly ruleId: CollisionRuleId;
  /** Which side's attacker is eliminated by the collision; null = both survive. */
  readonly loser: 'A' | 'B' | null;
}

/**
 * Pairwise collision of attack `a` against attack `b`. Rules apply in order:
 *  1. Blackhole only neutralizes Blackhole; against anything else it wins.
 *  2. Higher tier eliminates the lower-tier attacker.
 *  3. Same tier, different class: ranged eliminates melee.
 *  4. Otherwise (same tier, same class) both survive.
 */
export function resolveAttackPair(a: AttackId, b: AttackId): CollisionResult {
  if (a === 'BLACKHOLE' && b === 'BLACKHOLE') return { ruleId: 'BLACKHOLE_MIRROR', loser: null };
  if (a === 'BLACKHOLE') return { ruleId: 'BLACKHOLE_OVERRIDE', loser: 'B' };
  if (b === 'BLACKHOLE') return { ruleId: 'BLACKHOLE_OVERRIDE', loser: 'A' };

  const defA = ATTACKS[a];
  const defB = ATTACKS[b];
  if (defA.tier > defB.tier) return { ruleId: 'HIGHER_TIER', loser: 'B' };
  if (defB.tier > defA.tier) return { ruleId: 'HIGHER_TIER', loser: 'A' };

  if (defA.attackClass !== defB.attackClass) {
    return { ruleId: 'RANGED_BEATS_MELEE', loser: defA.attackClass === 'MELEE' ? 'A' : 'B' };
  }
  return { ruleId: 'SAME_TIER_SAME_CLASS', loser: null };
}

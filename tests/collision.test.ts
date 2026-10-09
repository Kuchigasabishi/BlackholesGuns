import { describe, expect, it } from 'vitest';
import { ATTACK_IDS, resolveAttackPair, type AttackId } from '../src/engine';
import { duel } from './helpers';

/** Independent oracle data, typed by hand from GDD §3. */
const TIER: Record<AttackId, number> = {
  GUN: 1, KNIFE: 1,
  GATLING_GUN: 2, FLAMETHROWER: 2, AXE: 2,
  THREE_HIT_COMBO: 3, GRENADE: 3, KATANA: 3,
  BOMB: 4, NUKE: 4, MJOLNIR: 4,
  BLACKHOLE: 5,
};
const MELEE: readonly AttackId[] = ['KNIFE', 'AXE', 'KATANA', 'MJOLNIR'];

const NON_BLACKHOLE = ATTACK_IDS.filter((id) => id !== 'BLACKHOLE');
const pairs = <T>(items: readonly T[]): [T, T][] => items.flatMap((a) => items.map((b): [T, T] => [a, b]));

/** Expected loser for (a, b), straight from §6 prose. 'A' | 'B' | null (neutralize). */
function oracle(a: AttackId, b: AttackId): 'A' | 'B' | null {
  if (a === 'BLACKHOLE' && b === 'BLACKHOLE') return null;
  if (a === 'BLACKHOLE') return 'B';
  if (b === 'BLACKHOLE') return 'A';
  if (TIER[a] !== TIER[b]) return TIER[a] > TIER[b] ? 'B' : 'A';
  const aMelee = MELEE.includes(a);
  const bMelee = MELEE.includes(b);
  if (aMelee !== bMelee) return aMelee ? 'A' : 'B';
  return null;
}

describe('§6 attack-versus-attack: pure collision function', () => {
  it('matches the §6 oracle for all 144 ordered pairs', () => {
    for (const [a, b] of pairs(ATTACK_IDS)) {
      expect(resolveAttackPair(a, b).loser, `${a} vs ${b}`).toBe(oracle(a, b));
    }
  });

  it('is antisymmetric: swapping the sides swaps the loser', () => {
    for (const [a, b] of pairs(ATTACK_IDS)) {
      const ab = resolveAttackPair(a, b).loser;
      const ba = resolveAttackPair(b, a).loser;
      expect(ba, `${a} vs ${b}`).toBe(ab === 'A' ? 'B' : ab === 'B' ? 'A' : null);
    }
  });

  describe('higher tier eliminates lower tier', () => {
    const cases = pairs(NON_BLACKHOLE).filter(([a, b]) => TIER[a] > TIER[b]);
    it.each(cases)('%s beats %s', (higher, lower) => {
      expect(resolveAttackPair(higher, lower)).toEqual({ ruleId: 'HIGHER_TIER', loser: 'B' });
      expect(resolveAttackPair(lower, higher)).toEqual({ ruleId: 'HIGHER_TIER', loser: 'A' });
    });
  });

  describe('same tier, different class: ranged eliminates melee', () => {
    const cases: [AttackId, AttackId][] = [
      ['GUN', 'KNIFE'],
      ['GATLING_GUN', 'AXE'],
      ['FLAMETHROWER', 'AXE'],
      ['THREE_HIT_COMBO', 'KATANA'],
      ['GRENADE', 'KATANA'],
      ['BOMB', 'MJOLNIR'],
      ['NUKE', 'MJOLNIR'],
    ];
    it.each(cases)('%s (ranged) beats %s (melee)', (ranged, melee) => {
      expect(resolveAttackPair(ranged, melee)).toEqual({ ruleId: 'RANGED_BEATS_MELEE', loser: 'B' });
      expect(resolveAttackPair(melee, ranged)).toEqual({ ruleId: 'RANGED_BEATS_MELEE', loser: 'A' });
    });
  });

  describe('same tier, same class: both survive', () => {
    const cases: [AttackId, AttackId][] = [
      ['GUN', 'GUN'],
      ['KNIFE', 'KNIFE'],
      ['GATLING_GUN', 'FLAMETHROWER'],
      ['GATLING_GUN', 'GATLING_GUN'],
      ['AXE', 'AXE'],
      ['THREE_HIT_COMBO', 'GRENADE'],
      ['KATANA', 'KATANA'],
      ['BOMB', 'NUKE'],
      ['NUKE', 'NUKE'],
      ['MJOLNIR', 'MJOLNIR'],
    ];
    it.each(cases)('%s vs %s neutralize', (a, b) => {
      expect(resolveAttackPair(a, b)).toEqual({ ruleId: 'SAME_TIER_SAME_CLASS', loser: null });
      expect(resolveAttackPair(b, a)).toEqual({ ruleId: 'SAME_TIER_SAME_CLASS', loser: null });
    });
  });

  describe('Blackhole (§6.1, §8)', () => {
    it('only neutralizes another Blackhole', () => {
      expect(resolveAttackPair('BLACKHOLE', 'BLACKHOLE')).toEqual({ ruleId: 'BLACKHOLE_MIRROR', loser: null });
      const neutralizing = ATTACK_IDS.filter((id) => resolveAttackPair('BLACKHOLE', id).loser === null);
      expect(neutralizing).toEqual(['BLACKHOLE']);
    });

    it.each(NON_BLACKHOLE)('beats %s regardless of tier (no class logic applied)', (other) => {
      expect(resolveAttackPair('BLACKHOLE', other)).toEqual({ ruleId: 'BLACKHOLE_OVERRIDE', loser: 'B' });
      expect(resolveAttackPair(other, 'BLACKHOLE')).toEqual({ ruleId: 'BLACKHOLE_OVERRIDE', loser: 'A' });
    });
  });
});

describe('§6 attack-versus-attack: through resolveTurn (2 players, each aims at the other)', () => {
  it('agrees with the oracle for all 144 ordered pairs', () => {
    for (const [a, b] of pairs(ATTACK_IDS)) {
      const result = duel({ kind: 'ATTACK', weapon: a }, { kind: 'ATTACK', weapon: b });
      const loser = oracle(a, b);
      const expected = loser === 'A' ? ['p1'] : loser === 'B' ? ['p2'] : [];
      expect([...result.outcome.eliminatedPlayerIds], `${a} vs ${b}`).toEqual(expected);
    }
  });

  it('Gun vs Gun neutralizes, both survive, and the round continues', () => {
    const result = duel({ kind: 'ATTACK', weapon: 'GUN' }, { kind: 'ATTACK', weapon: 'GUN' });
    expect(result.outcome.eliminatedPlayerIds).toEqual([]);
    expect(result.outcome.transition).toBe('NEXT_TURN');
    expect(result.events.map((e) => e.outcome)).toEqual(['NEUTRALIZED', 'NEUTRALIZED']);
    expect(result.events.map((e) => e.ruleId)).toEqual(['COLLISION:SAME_TIER_SAME_CLASS', 'COLLISION:SAME_TIER_SAME_CLASS']);
  });

  it('Blackhole vs Blackhole neutralizes: both survive and Charge is spent', () => {
    const result = duel({ kind: 'ATTACK', weapon: 'BLACKHOLE' }, { kind: 'ATTACK', weapon: 'BLACKHOLE' });
    expect(result.outcome.eliminatedPlayerIds).toEqual([]);
    expect(result.nextState.players.p1!.charge).toBe(0);
    expect(result.nextState.players.p2!.charge).toBe(0);
    expect(result.events.every((e) => e.ruleId === 'COLLISION:BLACKHOLE_MIRROR')).toBe(true);
  });

  it('Blackhole eliminates a Nuke user (Tier 5 special beats Tier 4)', () => {
    const result = duel({ kind: 'ATTACK', weapon: 'BLACKHOLE' }, { kind: 'ATTACK', weapon: 'NUKE' });
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p2']);
  });
});

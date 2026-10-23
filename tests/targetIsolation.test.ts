import { describe, expect, it } from 'vitest';
import { attack, charge, defend, newGame, play, withCharges } from './helpers';

/**
 * Rules v1.1 (design change after playtesting): an attack-versus-attack tier collision only happens
 * between two players who are attacking EACH OTHER. An attacker who is hit by a third party it is not
 * attacking has no protection and is eliminated, whatever its tier. Blackhole still hits everyone it is aimed at.
 *
 * Scenario: A: FLAMETHROWER -> B    B: DODGE    C: KNIFE -> A
 */
const summary = (events: ReturnType<typeof play>['events']) => events.map((e) => `${e.sourcePlayerId}>${e.selectedTargetId}:${e.ruleId}:${e.outcome}`);

describe('target isolation (A Flamethrower -> B, B Dodge, C Knife -> A)', () => {
  const run = () => play(withCharges(newGame(3), { p1: 2, p3: 1 }), attack('p1', 'FLAMETHROWER', 'p2'), defend('p2', 'DODGE'), attack('p3', 'KNIFE', 'p1'));

  it("A's attack is evaluated against B only, and Dodge blocks it", () => {
    const events = run().events.filter((e) => e.sourcePlayerId === 'p1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ selectedTargetId: 'p2', effectTargetSet: ['p2'], outcome: 'BLOCKED', ruleId: 'MATRIX_V2:FLAMETHROWER:DODGE' });
  });

  it("C's Knife hits A: the weapons do not collide because A is not attacking C", () => {
    const events = run().events.filter((e) => e.sourcePlayerId === 'p3');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ selectedTargetId: 'p1', ruleType: 'UNGUARDED', ruleId: 'UNGUARDED_ATTACKER', outcome: 'TARGET_ELIMINATED', eliminationMarks: ['p1'] });
  });

  it('full result: A is eliminated by C, B survives (Dodge), C survives (nobody attacked C)', () => {
    const r = run();
    expect(summary(r.events)).toEqual(['p1>p2:MATRIX_V2:FLAMETHROWER:DODGE:BLOCKED', 'p3>p1:UNGUARDED_ATTACKER:TARGET_ELIMINATED']);
    expect(r.outcome.eliminatedPlayerIds).toEqual(['p1']);
    expect(r.outcome.survivorIds).toEqual(['p2', 'p3']);
    expect(r.events.find((e) => e.sourcePlayerId === 'p1')!.eliminationMarks).toEqual([]); // A's attack never reaches C
  });
});

describe('collisions only between players attacking each other', () => {
  it('mutual targeting still collides by tier: A Knife <-> B Gun, ranged beats melee, A is eliminated', () => {
    const r = play(withCharges(newGame(3), { p1: 1, p2: 1 }), attack('p1', 'KNIFE', 'p2'), attack('p2', 'GUN', 'p1'), charge('p3'));
    expect(r.events.map((e) => e.ruleType)).toEqual(['COLLISION', 'COLLISION']);
    expect(r.outcome.eliminatedPlayerIds).toEqual(['p1']);
  });

  it('mutual targeting, same tier and class: both attacks cancel and both survive', () => {
    const r = play(withCharges(newGame(3), { p1: 1, p2: 1 }), attack('p1', 'GUN', 'p2'), attack('p2', 'GUN', 'p1'), charge('p3'));
    expect(r.outcome.eliminatedPlayerIds).toEqual([]);
  });

  it('mutual targeting by a higher tier: the higher tier wins as before', () => {
    const r = play(withCharges(newGame(3), { p1: 2, p3: 1 }), attack('p1', 'FLAMETHROWER', 'p3'), defend('p2', 'DODGE'), attack('p3', 'KNIFE', 'p1'));
    expect(r.outcome.eliminatedPlayerIds).toEqual(['p3']);
  });

  it('a higher tier does not protect an attacker from a third party: tier-3 Katana -> B (Dodge) is still eliminated by a tier-1 Knife from C', () => {
    const r = play(withCharges(newGame(3), { p1: 3, p3: 1 }), attack('p1', 'KATANA', 'p2'), defend('p2', 'DODGE'), attack('p3', 'KNIFE', 'p1'));
    expect(r.outcome.eliminatedPlayerIds).toEqual(['p1']);
    expect(r.outcome.survivorIds).toEqual(['p2', 'p3']);
  });

  it('a 3-cycle (A->B, B->C, C->A) has no mutual pair, so every attacker is hit: all three are eliminated', () => {
    const r = play(withCharges(newGame(3), { p1: 1, p2: 1, p3: 1 }), attack('p1', 'GUN', 'p2'), attack('p2', 'GUN', 'p3'), attack('p3', 'GUN', 'p1'));
    expect(r.outcome.eliminatedPlayerIds).toEqual(['p1', 'p2', 'p3']);
    expect(r.events.every((e) => e.ruleId === 'UNGUARDED_ATTACKER')).toBe(true);
  });

  it('Blackhole still overrides: it is aimed at every opponent, so it collides with (and beats) any attack', () => {
    const r = play(withCharges(newGame(3), { p1: 2, p3: 5 }), attack('p1', 'FLAMETHROWER', 'p2'), defend('p2', 'DODGE'), attack('p3', 'BLACKHOLE'));
    expect(r.outcome.eliminatedPlayerIds).toContain('p1');
    expect(r.events.find((e) => e.sourcePlayerId === 'p3' && e.selectedTargetId === 'p1')).toMatchObject({ ruleType: 'UNGUARDED' });
  });

  it('a Charging player is hit only by attacks aimed at them', () => {
    const r = play(withCharges(newGame(3), { p1: 1 }), attack('p1', 'GUN', 'p2'), charge('p2'), charge('p3'));
    expect(r.outcome.eliminatedPlayerIds).toEqual(['p2']);
    expect(r.events).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { attack, charge, defend, newGame, play, withCharges } from './helpers';

/**
 * Regression tests for the reported "cross-talk" scenario:
 *   A: FLAMETHROWER -> B     B: DODGE     C: KNIFE -> A
 *
 * They pin down two things: (1) an attack is only ever evaluated against the target it
 * named, and (2) what happens when that attacker is itself attacked. Per §6 / §11, when the
 * target of an attack also chose an attack, the two ATTACKS are paired (higher tier wins, then
 * ranged beats melee), whoever each one is aimed at. That tier rule is the "override" that
 * decides A vs C here, so A's Flamethrower (tier 2) cancels C's Knife (tier 1) and eliminates C.
 */
const pairs = (events: ReturnType<typeof play>['events']) => events.map((e) => `${e.sourcePlayerId}>${e.selectedTargetId}:${e.ruleId}:${e.outcome}`);

describe('target isolation (A Flamethrower -> B, B Dodge, C Knife -> A)', () => {
  const run = () => play(withCharges(newGame(3), { p1: 2, p3: 1 }), attack('p1', 'FLAMETHROWER', 'p2'), defend('p2', 'DODGE'), attack('p3', 'KNIFE', 'p1'));

  it("A's attack produces exactly one interaction, against B only: nothing overflows onto C", () => {
    const events = run().events.filter((e) => e.sourcePlayerId === 'p1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ selectedTargetId: 'p2', effectTargetSet: ['p2'], outcome: 'BLOCKED', ruleId: 'MATRIX_V2:FLAMETHROWER:DODGE' });
    expect(events.some((e) => e.selectedTargetId === 'p3')).toBe(false);
  });

  it("C's Knife is evaluated against A (its own chosen target) and nothing else", () => {
    const events = run().events.filter((e) => e.sourcePlayerId === 'p3');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ selectedTargetId: 'p1', effectTargetSet: ['p1'] });
  });

  it('the full resolution: tier 2 beats tier 1, so A survives and C is the one eliminated by that pairing', () => {
    const r = run();
    expect(pairs(r.events)).toEqual(['p1>p2:MATRIX_V2:FLAMETHROWER:DODGE:BLOCKED', 'p3>p1:COLLISION:HIGHER_TIER:ATTACKER_ELIMINATED']);
    expect(r.outcome.eliminatedPlayerIds).toEqual(['p3']);
    expect(r.outcome.survivorIds).toEqual(['p1', 'p2']);
    // C's elimination comes from the collision with A's attack, never from A's attack on B.
    expect(r.events.find((e) => e.sourcePlayerId === 'p1')!.eliminationMarks).toEqual([]);
  });
});

describe('an attacker is fully vulnerable to incoming attacks unless a tier / Blackhole rule overrides it', () => {
  it('when the incoming attack is the higher tier, the attacker A IS eliminated and B and C survive (the expected result as reported)', () => {
    // A: Knife -> B (B dodges), C: Flamethrower -> A. Tier 2 beats A's tier 1 attack.
    const r = play(withCharges(newGame(3), { p1: 1, p3: 2 }), attack('p1', 'KNIFE', 'p2'), defend('p2', 'DODGE'), attack('p3', 'FLAMETHROWER', 'p1'));
    expect(r.outcome.eliminatedPlayerIds).toEqual(['p1']);
    expect(r.outcome.survivorIds).toEqual(['p2', 'p3']);
    expect(r.events.filter((e) => e.sourcePlayerId === 'p1')).toHaveLength(1); // still only A -> B
  });

  it('same tier, ranged beats melee: A (melee Axe) is eliminated by C (ranged Gatling Gun)', () => {
    const r = play(withCharges(newGame(3), { p1: 2, p3: 2 }), attack('p1', 'AXE', 'p2'), defend('p2', 'DODGE'), attack('p3', 'GATLING_GUN', 'p1'));
    expect(r.outcome.eliminatedPlayerIds).toEqual(['p1']);
  });

  it('same tier, same class: both attacks cancel and A survives C (and C survives A)', () => {
    const r = play(withCharges(newGame(3), { p1: 1, p3: 1 }), attack('p1', 'GUN', 'p2'), defend('p2', 'DODGE'), attack('p3', 'GUN', 'p1'));
    expect(r.outcome.eliminatedPlayerIds).toEqual([]);
  });

  it('Blackhole overrides everything: A is eliminated by an incoming Blackhole', () => {
    const r = play(withCharges(newGame(3), { p1: 2, p3: 5 }), attack('p1', 'FLAMETHROWER', 'p2'), defend('p2', 'DODGE'), attack('p3', 'BLACKHOLE'));
    expect(r.outcome.eliminatedPlayerIds).toContain('p1');
  });

  it('a player who is not attacking (Charging) is eliminated by any attack aimed at them; an attack not aimed at them never touches them', () => {
    const r = play(withCharges(newGame(3), { p1: 1 }), attack('p1', 'GUN', 'p2'), charge('p2'), charge('p3'));
    expect(r.outcome.eliminatedPlayerIds).toEqual(['p2']); // p3 is untouched
    expect(r.events).toHaveLength(1);
  });
});

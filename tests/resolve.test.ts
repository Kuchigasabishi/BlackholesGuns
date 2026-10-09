import { describe, expect, it } from 'vitest';
import { EngineError, deepFreeze, resolveTurn, type Action } from '../src/engine';
import { attack, charge, defend, ids, lockedFor, makeAction, newGame, play, withCharges } from './helpers';

describe('Charge economy (§3)', () => {
  it('Charge adds 1 and caps at 5', () => {
    let state = newGame(2);
    for (let expected = 1; expected <= 5; expected++) {
      state = play(state, charge('p1'), defend('p2', 'DODGE')).nextState;
      expect(state.players.p1!.charge).toBe(Math.min(expected, 5));
    }
    state = play(state, charge('p1'), defend('p2', 'DODGE')).nextState;
    expect(state.players.p1!.charge).toBe(5);
  });

  it('an attack spends exactly its cost; Reflect spends its cost; Dodge and Shield are free', () => {
    const state = withCharges(newGame(3), { p1: 4, p2: 3, p3: 2 });
    const next = play(state, attack('p1', 'GUN', 'p2'), defend('p2', 'TRIPLE_REFLECT'), defend('p3', 'SHIELD'));
    // p1's Gun is reflected, so the round ends; read Charge from the per-player results.
    const byId = Object.fromEntries(next.outcome.playerResults.map((r) => [r.playerId, r]));
    expect(byId.p1).toMatchObject({ chargeBefore: 4, chargeAfter: 3 });
    expect(byId.p2).toMatchObject({ chargeBefore: 3, chargeAfter: 0 });
    expect(byId.p3).toMatchObject({ chargeBefore: 2, chargeAfter: 2 });
  });

  it('carries Charge into the next turn when nobody is eliminated', () => {
    const state = withCharges(newGame(2), { p1: 2, p2: 1 });
    const blocked = play(state, attack('p1', 'AXE', 'p2'), defend('p2', 'DODGE')).nextState;
    expect(blocked.players.p1!.charge).toBe(0);
    expect(blocked.players.p2!.charge).toBe(1);
  });

  it('rejects an unaffordable attack without spending Charge', () => {
    const state = withCharges(newGame(2), { p1: 2 });
    expect(() => play(state, attack('p1', 'KATANA', 'p2'), charge('p2'))).toThrowError(EngineError);
    expect(state.players.p1!.charge).toBe(2);
  });
});

describe('a player hit while Charging is eliminated (§3, §17)', () => {
  it('Gun vs Charge eliminates the charger and ends the round', () => {
    const state = withCharges(newGame(2), { p1: 1 });
    const result = play(state, attack('p1', 'GUN', 'p2'), charge('p2'));
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p2']);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ ruleType: 'CHARGE_HIT', outcome: 'TARGET_ELIMINATED' });
  });

  it('is true for every attack, including the ones every defense would have blocked', () => {
    for (const [weapon, cost] of [['GUN', 1], ['KNIFE', 1], ['AXE', 2], ['KATANA', 3], ['MJOLNIR', 4]] as const) {
      const state = withCharges(newGame(2), { p1: cost });
      const result = play(state, attack('p1', weapon, 'p2'), charge('p2'));
      expect(result.outcome.eliminatedPlayerIds, weapon).toEqual(['p2']);
    }
  });

  it('a charging player who is NOT targeted survives and gains Charge', () => {
    const state = withCharges(newGame(3), { p1: 1 });
    const result = play(state, attack('p1', 'GUN', 'p2'), defend('p2', 'DODGE'), charge('p3'));
    expect(result.outcome.eliminatedPlayerIds).toEqual([]);
    expect(result.nextState.players.p3!.charge).toBe(1);
  });
});

describe('outgoing attacks still resolve when the attacker is eliminated (§6.4, §15)', () => {
  it('eliminated-by-collision attacker still eliminates its charging target', () => {
    // p1 Gun -> p3 (charging). p2 Gatling -> p1: Gatling out-tiers Gun, so p1 dies.
    const state = withCharges(newGame(3), { p1: 1, p2: 2 });
    const result = play(state, attack('p1', 'GUN', 'p3'), attack('p2', 'GATLING_GUN', 'p1'), charge('p3'));
    expect([...result.outcome.eliminatedPlayerIds].sort()).toEqual(['p1', 'p3']);
    expect(result.outcome.survivorIds).toEqual(['p2']);
    expect(result.outcome.transition).toBe('MATCH_ENDED');
    expect(result.outcome.matchWinnerId).toBe('p2');
  });

  it('eliminated-by-reflection attacker still completes its other target resolutions', () => {
    // p1 Grenade -> p2 (Triple Reflect: reflected, p1 dies) and p3 (charging: dies).
    const state = withCharges(newGame(3), { p1: 3, p2: 3 });
    const result = play(state, attack('p1', 'GRENADE', 'p2', 'p3'), defend('p2', 'TRIPLE_REFLECT'), charge('p3'));
    expect([...result.outcome.eliminatedPlayerIds].sort()).toEqual(['p1', 'p3']);
    expect(result.events.map((e) => [e.selectedTargetId, e.outcome])).toEqual([
      ['p2', 'ATTACKER_ELIMINATED'],
      ['p3', 'TARGET_ELIMINATED'],
    ]);
  });
});

describe('multi-target attacks resolve each target independently (§4, §7)', () => {
  it('Katana: only the target whose defense loses is eliminated', () => {
    const state = withCharges(newGame(4), { p1: 3, p3: 0, p4: 2 });
    const result = play(
      state,
      attack('p1', 'KATANA', 'p2', 'p3', 'p4'),
      defend('p2', 'DODGE'), // Block
      defend('p3', 'SHIELD'), // Block
      defend('p4', 'DOUBLE_REFLECT'), // Eliminate 3 Players -> eliminates p4 only
    );
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p4']);
    expect(result.events.map((e) => e.outcome)).toEqual(['BLOCKED', 'BLOCKED', 'TARGET_ELIMINATED']);
    expect(result.events.every((e) => e.effectTargetSet.join() === 'p2,p3,p4')).toBe(true);
  });

  it('Bomb: hits every opponent independently; a Quad Reflect still reflects it', () => {
    const state = withCharges(newGame(4), { p1: 4, p4: 4 });
    const result = play(
      state,
      attack('p1', 'BOMB'),
      defend('p2', 'DODGE'), // Eliminate All Players -> p2 eliminated
      defend('p3', 'SHIELD'), // Block
      defend('p4', 'QUAD_REFLECT'), // Reflect -> p1 eliminated
    );
    expect([...result.outcome.eliminatedPlayerIds].sort()).toEqual(['p1', 'p2']);
    expect(result.events).toHaveLength(3);
    expect(result.outcome.survivorIds).toEqual(['p3', 'p4']);
    expect(result.outcome.transition).toBe('NEXT_ROUND');
  });

  it('Blackhole eliminates every other living player regardless of defense, never its user', () => {
    const state = withCharges(newGame(4), { p1: 5, p4: 4 });
    const result = play(
      state,
      attack('p1', 'BLACKHOLE'),
      defend('p2', 'DODGE'),
      defend('p3', 'SHIELD'),
      defend('p4', 'QUAD_REFLECT'),
    );
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p2', 'p3', 'p4']);
    expect(result.outcome.survivorIds).toEqual(['p1']);
  });

  it('Blackhole with a rival Blackhole: the two neutralize and everyone else dies', () => {
    const state = withCharges(newGame(3), { p1: 5, p2: 5 });
    const result = play(state, attack('p1', 'BLACKHOLE'), attack('p2', 'BLACKHOLE'), defend('p3', 'DODGE'));
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p3']);
    expect(result.outcome.survivorIds).toEqual(['p1', 'p2']);
  });

  it('3-hit Combo may pick fewer than 3 targets, and the unselected player is untouched', () => {
    const state = withCharges(newGame(4), { p1: 3 });
    const result = play(
      state,
      attack('p1', 'THREE_HIT_COMBO', 'p2'),
      charge('p2'),
      charge('p3'),
      charge('p4'),
    );
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p2']);
  });

  it('with 5+ players a group attack with 3 targets leaves the others alone', () => {
    const state = withCharges(newGame(6), { p1: 3 });
    const result = play(
      state,
      attack('p1', 'GRENADE', 'p2', 'p3', 'p4'),
      charge('p2'),
      charge('p3'),
      charge('p4'),
      charge('p5'),
      charge('p6'),
    );
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p2', 'p3', 'p4']);
  });

  it('overlapping target choices by different attackers do not change either target set', () => {
    const state = withCharges(newGame(4), { p1: 3, p2: 3 });
    const result = play(
      state,
      attack('p1', 'KATANA', 'p3', 'p4'),
      attack('p2', 'GRENADE', 'p3', 'p4'),
      defend('p3', 'DODGE'),
      defend('p4', 'SHIELD'),
    );
    const eventsBy = (p: string) => result.events.filter((e) => e.sourcePlayerId === p).map((e) => e.selectedTargetId);
    expect(eventsBy('p1')).toEqual(['p3', 'p4']);
    expect(eventsBy('p2')).toEqual(['p3', 'p4']);
    // Katana: Dodge Block, Shield Block. Grenade: Dodge Block, Shield Eliminate -> p4 dies.
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p4']);
  });
});

describe('simultaneous resolution against one snapshot (§6.4, §7)', () => {
  it('elimination marks are unioned: any resolved incoming elimination is enough', () => {
    // p3 Dodges. p1's Gun is blocked, p2's Gatling Gun eliminates a dodger.
    const state = withCharges(newGame(3), { p1: 1, p2: 2 });
    const result = play(state, attack('p1', 'GUN', 'p3'), attack('p2', 'GATLING_GUN', 'p3'), defend('p3', 'DODGE'));
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p3']);
  });

  it('is independent of the order actions were supplied in', () => {
    const state = withCharges(newGame(3), { p1: 1, p2: 2 });
    const specs = [attack('p1', 'GUN', 'p3'), attack('p2', 'GATLING_GUN', 'p1'), charge('p3')];
    const forwards = resolveTurn(state, lockedFor(state, specs));
    const backwards = resolveTurn(state, lockedFor(state, [...specs].reverse()));
    expect(backwards).toEqual(forwards);
  });

  it('a collision with a target who is attacking someone else still pairs the two attacks (§11)', () => {
    // p1 Knife -> p2; p2 Gun -> p3 (not at p1). Ranged beats melee, so p1 is eliminated.
    const state = withCharges(newGame(3), { p1: 1, p2: 1 });
    const result = play(state, attack('p1', 'KNIFE', 'p2'), attack('p2', 'GUN', 'p3'), defend('p3', 'DODGE'));
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p1']);
  });

  it('emits events in a deterministic order: attackers by seat, then targets in effect-set order', () => {
    const state = withCharges(newGame(3), { p1: 3, p2: 1 });
    const result = play(state, attack('p1', 'GRENADE', 'p3', 'p2'), attack('p2', 'GUN', 'p3'), defend('p3', 'DODGE'));
    expect(result.events.map((e) => [e.orderKey, e.sourcePlayerId, e.selectedTargetId])).toEqual([
      [0, 'p1', 'p3'],
      [1, 'p1', 'p2'],
      [2, 'p2', 'p3'],
    ]);
  });
});

describe('everyone eliminated at once (undefined in the GDD)', () => {
  // p1 Bomb is reflected by p2's Quad Reflect; p2 dies to p3's Mjolnir; p3 loses its
  // collision with p1's Bomb (ranged beats melee). All three eliminated.
  const state = withCharges(newGame(3), { p1: 4, p2: 4, p3: 4 });
  const result = play(state, attack('p1', 'BOMB'), defend('p2', 'QUAD_REFLECT'), attack('p3', 'MJOLNIR'));

  it('marks every player eliminated', () => {
    expect([...result.outcome.eliminatedPlayerIds].sort()).toEqual(['p1', 'p2', 'p3']);
    expect(result.outcome.survivorIds).toEqual([]);
  });

  it('voids the round: no winner, no Match Win, same roster restarts at 0 Charge', () => {
    expect(result.outcome.transition).toBe('ROUND_RESTARTED_NO_SURVIVORS');
    expect(result.outcome.matchWinnerId).toBeNull();
    expect(result.nextState.series.matchWins).toEqual({ p1: 0, p2: 0, p3: 0 });
    expect(Object.values(result.nextState.players).map((p) => [p.alive, p.charge])).toEqual([
      [true, 0],
      [true, 0],
      [true, 0],
    ]);
    expect(result.nextState.match.roundIndex).toBe(2);
    expect(result.nextState.round.turnIndex).toBe(1);
    expect(result.nextState.round.noEliminationStreak).toBe(0);
  });
});

describe('purity and determinism', () => {
  it('never mutates its inputs (deep-frozen state and actions resolve fine)', () => {
    const state = deepFreeze(withCharges(newGame(3), { p1: 3, p2: 3 }));
    const locked = deepFreeze(
      lockedFor(state, [attack('p1', 'GRENADE', 'p2', 'p3'), defend('p2', 'TRIPLE_REFLECT'), charge('p3')]),
    );
    const before = JSON.stringify({ state, locked });
    expect(() => resolveTurn(state, locked)).not.toThrow();
    expect(JSON.stringify({ state, locked })).toBe(before);
  });

  it('returns frozen output', () => {
    const result = play(newGame(2), charge('p1'), charge('p2'));
    expect(Object.isFrozen(result.nextState)).toBe(true);
    expect(Object.isFrozen(result.nextState.players.p1)).toBe(true);
    expect(Object.isFrozen(result.events)).toBe(true);
  });

  it('is deterministic: identical inputs give byte-identical outputs', () => {
    const state = withCharges(newGame(4), { p1: 4, p4: 4 });
    const specs = [attack('p1', 'BOMB'), defend('p2', 'DODGE'), defend('p3', 'SHIELD'), defend('p4', 'QUAD_REFLECT')];
    const first = JSON.stringify(resolveTurn(state, lockedFor(state, specs)));
    const second = JSON.stringify(resolveTurn(state, lockedFor(state, specs)));
    expect(second).toBe(first);
  });
});

describe('input contract', () => {
  const state = newGame(3);
  const full = (): Record<string, Action> => lockedFor(state, ids(3).map((id) => charge(id)));

  it('throws MISSING_ACTION when a living player has no locked action', () => {
    const locked = full();
    delete locked.p2;
    expect(() => resolveTurn(state, locked)).toThrowError(expect.objectContaining({ code: 'MISSING_ACTION' }));
  });

  it('throws UNEXPECTED_ACTION for an action from a non-living player', () => {
    const locked = { ...full(), ghost: makeAction(state, 'ghost', { kind: 'CHARGE' }) };
    expect(() => resolveTurn(state, locked)).toThrowError(expect.objectContaining({ code: 'UNEXPECTED_ACTION' }));
  });

  it('throws INVALID_ACTION for a stale turn token', () => {
    const locked = { ...full(), p1: { ...makeAction(state, 'p1', { kind: 'CHARGE' }), turnId: 'old-turn' } };
    expect(() => resolveTurn(state, locked)).toThrowError(expect.objectContaining({ code: 'INVALID_ACTION' }));
  });

  it('throws INVALID_ACTION when an action is filed under the wrong player', () => {
    const locked = { ...full(), p1: makeAction(state, 'p2', { kind: 'CHARGE' }) };
    expect(() => resolveTurn(state, locked)).toThrowError(expect.objectContaining({ code: 'INVALID_ACTION' }));
  });

  it('refuses to resolve once the series is complete', () => {
    let s = newGame(2);
    for (let match = 0; match < 10; match++) {
      s = play(withCharges(s, { p1: 1 }), attack('p1', 'GUN', 'p2'), charge('p2')).nextState;
    }
    expect(s.series.status).toBe('COMPLETE');
    expect(() => resolveTurn(s, {})).toThrowError(expect.objectContaining({ code: 'SERIES_COMPLETE' }));
  });
});

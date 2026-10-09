import { describe, expect, it } from 'vitest';
import {
  ATTACK_IDS,
  OVERTIME_AFTER,
  SUDDEN_DEATH_AFTER,
  getActionAvailability,
  phaseFor,
  validateAction,
  type GameState,
} from '../src/engine';
import { attack, charge, defend, everyoneDodges, makeAction, newGame, play, withCharges, withStreak } from './helpers';

const dodgeTurns = (state: GameState, turns: number): GameState => {
  for (let i = 0; i < turns; i++) state = play(state, ...everyoneDodges(state)).nextState;
  return state;
};

describe('phaseFor (§9)', () => {
  it('uses 10 and 15 as the thresholds', () => {
    expect(SUDDEN_DEATH_AFTER).toBe(10);
    expect(OVERTIME_AFTER).toBe(15);
    expect(phaseFor(2, 0)).toBe('NORMAL');
    expect(phaseFor(2, 9)).toBe('NORMAL');
    expect(phaseFor(2, 10)).toBe('SUDDEN_DEATH');
    expect(phaseFor(2, 14)).toBe('SUDDEN_DEATH');
    expect(phaseFor(2, 15)).toBe('OVERTIME');
    expect(phaseFor(2, 99)).toBe('OVERTIME');
  });

  it('only applies with exactly two players alive', () => {
    for (const alive of [1, 3, 4, 8]) expect(phaseFor(alive, 50)).toBe('NORMAL');
  });
});

describe('Sudden Death entry', () => {
  it('begins after 10 consecutive no-elimination turns, not before', () => {
    let state = newGame(2);
    for (let turn = 1; turn <= 10; turn++) {
      expect(state.turn!.phase, `turn ${turn}`).toBe('NORMAL');
      expect(state.round.noEliminationStreak).toBe(turn - 1);
      state = play(state, ...everyoneDodges(state)).nextState;
    }
    expect(state.round.noEliminationStreak).toBe(10);
    expect(state.round.turnIndex).toBe(11);
    expect(state.turn!.phase).toBe('SUDDEN_DEATH');
    expect(state.round.phase).toBe('SUDDEN_DEATH');
  });

  it('reports the phase change in the turn outcome', () => {
    const state = dodgeTurns(newGame(2), 9);
    const result = play(state, ...everyoneDodges(state));
    expect(result.outcome.phaseChange).toEqual({ from: 'NORMAL', to: 'SUDDEN_DEATH' });
    const quiet = play(newGame(2), ...everyoneDodges(newGame(2)));
    expect(quiet.outcome.phaseChange).toBeNull();
  });

  it('counts neutralized attacks as no-elimination turns', () => {
    let state = newGame(2);
    for (let i = 0; i < 4; i++) {
      state = play(withCharges(state, { p1: 1, p2: 1 }), attack('p1', 'GUN', 'p2'), attack('p2', 'GUN', 'p1')).nextState;
    }
    expect(state.round.noEliminationStreak).toBe(4);
  });
});

describe('Sudden Death action rules', () => {
  const sd = (charges: Record<string, number> = {}) => withCharges(withStreak(newGame(2), 10), charges);

  it('disables all six defenses (even when affordable)', () => {
    const state = sd({ p1: 5 });
    const { defenses } = getActionAvailability(state, 'p1');
    for (const [id, a] of Object.entries(defenses)) {
      expect(a, id).toEqual({ available: false, reason: 'PHASE_RESTRICTED' });
    }
    expect(validateAction(state, makeAction(state, 'p1', { kind: 'DEFENSE', defense: 'DODGE' }))).toMatchObject({
      ok: false,
      code: 'PHASE_RESTRICTED',
    });
  });

  it('allows Charge only when no attack is affordable (0 Charge)', () => {
    const empty = sd({ p1: 0 });
    expect(getActionAvailability(empty, 'p1').charge.available).toBe(true);
    expect(validateAction(empty, makeAction(empty, 'p1', { kind: 'CHARGE' }))).toEqual({ ok: true });
  });

  it.each([1, 2, 3, 4, 5])('makes attacking mandatory at %i Charge', (balance) => {
    const state = sd({ p1: balance });
    expect(getActionAvailability(state, 'p1').charge).toEqual({ available: false, reason: 'ATTACK_MANDATORY' });
    expect(validateAction(state, makeAction(state, 'p1', { kind: 'CHARGE' }))).toMatchObject({
      ok: false,
      code: 'ATTACK_MANDATORY',
    });
    const affordable = ATTACK_IDS.filter((id) => getActionAvailability(state, 'p1').attacks[id].available);
    expect(affordable.length).toBeGreaterThan(0);
  });

  it('keeps Blackhole legal at 5 Charge', () => {
    const state = sd({ p1: 5 });
    expect(getActionAvailability(state, 'p1').attacks.BLACKHOLE.available).toBe(true);
    const result = play(state, attack('p1', 'BLACKHOLE'), charge('p2'));
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p2']);
  });

  it('leaves attack resolution unchanged (ranged still beats melee, ties neutralize)', () => {
    const gunVsKnife = play(sd({ p1: 1, p2: 1 }), attack('p1', 'GUN', 'p2'), attack('p2', 'KNIFE', 'p1'));
    expect(gunVsKnife.outcome.eliminatedPlayerIds).toEqual(['p2']);
    const mirror = play(sd({ p1: 1, p2: 1 }), attack('p1', 'GUN', 'p2'), attack('p2', 'GUN', 'p1'));
    expect(mirror.outcome.eliminatedPlayerIds).toEqual([]);
    expect(mirror.outcome.transition).toBe('NEXT_TURN');
  });

  it('a both-at-0 Sudden Death turn is Charge for both, then attacking is forced', () => {
    let state = sd();
    state = play(state, charge('p1'), charge('p2')).nextState;
    expect(state.players.p1!.charge).toBe(1);
    expect(state.round.phase).toBe('SUDDEN_DEATH');
    expect(() => play(state, charge('p1'), charge('p2'))).toThrowError(expect.objectContaining({ code: 'INVALID_ACTION' }));
  });
});

describe('Overtime', () => {
  it('begins after 5 more no-elimination turns in Sudden Death (15 total), end to end', () => {
    let state = dodgeTurns(newGame(2), 10); // turns 1-10 Normal
    const seen: string[] = [];
    // Sudden Death: both at 0 Charge must Charge; then both Gun each other; repeat.
    const script = [
      [charge('p1'), charge('p2')], // turn 11 (0 Charge)
      [attack('p1', 'GUN', 'p2'), attack('p2', 'GUN', 'p1')], // 12 (neutralize)
      [charge('p1'), charge('p2')], // 13
      [attack('p1', 'GUN', 'p2'), attack('p2', 'GUN', 'p1')], // 14
      [charge('p1'), charge('p2')], // 15
    ] as const;
    for (const turn of script) {
      seen.push(state.turn!.phase);
      const result = play(state, ...turn);
      expect(result.outcome.eliminatedPlayerIds).toEqual([]);
      state = result.nextState;
    }
    expect(seen).toEqual(Array(5).fill('SUDDEN_DEATH'));
    expect(state.round.noEliminationStreak).toBe(15);
    expect(state.round.turnIndex).toBe(16);
    expect(state.turn!.phase).toBe('OVERTIME');
  });

  it('preserves the streak across the Sudden Death -> Overtime transition (no reset)', () => {
    const state = withStreak(newGame(2), 14);
    const result = play(withCharges(state, { p1: 1, p2: 1 }), attack('p1', 'GUN', 'p2'), attack('p2', 'GUN', 'p1'));
    expect(result.nextState.round.noEliminationStreak).toBe(15);
    expect(result.outcome.phaseChange).toEqual({ from: 'SUDDEN_DEATH', to: 'OVERTIME' });
  });

  const overtime = (charges: Record<string, number> = {}) => withCharges(withStreak(newGame(2), 15), charges);

  it('restores normal action availability: Charge, Dodge, Shield and Reflects are legal again', () => {
    const state = overtime({ p1: 4 });
    const a = getActionAvailability(state, 'p1');
    expect(a.charge.available).toBe(true);
    for (const id of ['DODGE', 'SHIELD', 'REFLECT', 'DOUBLE_REFLECT', 'TRIPLE_REFLECT', 'QUAD_REFLECT'] as const) {
      expect(a.defenses[id].available, id).toBe(true);
    }
    expect(getActionAvailability(overtime({ p1: 0 }), 'p1').defenses.REFLECT).toEqual({
      available: false,
      reason: 'UNAFFORDABLE',
    });
  });

  it('uses normal combat resolution: matrix outcomes apply', () => {
    const state = overtime({ p1: 2, p2: 0 });
    expect(play(state, attack('p1', 'GATLING_GUN', 'p2'), defend('p2', 'DODGE')).outcome.eliminatedPlayerIds).toEqual(['p2']);
    expect(play(state, attack('p1', 'GATLING_GUN', 'p2'), defend('p2', 'SHIELD')).outcome.eliminatedPlayerIds).toEqual([]);
  });

  it('keeps neutralizing: same-tier same-class and Blackhole mirrors leave both alive; no draw, no forced kill', () => {
    const gunMirror = play(overtime({ p1: 1, p2: 1 }), attack('p1', 'GUN', 'p2'), attack('p2', 'GUN', 'p1'));
    expect(gunMirror.outcome).toMatchObject({ eliminatedPlayerIds: [], transition: 'NEXT_TURN' });
    expect(gunMirror.nextState.turn!.phase).toBe('OVERTIME');

    const holes = play(overtime({ p1: 5, p2: 5 }), attack('p1', 'BLACKHOLE'), attack('p2', 'BLACKHOLE'));
    expect(holes.outcome).toMatchObject({ eliminatedPlayerIds: [], transition: 'NEXT_TURN' });
    expect(holes.nextState.series.status).toBe('IN_PROGRESS');
  });

  it('still lets ranged beat melee and higher tier beat lower', () => {
    expect(
      play(overtime({ p1: 1, p2: 1 }), attack('p1', 'GUN', 'p2'), attack('p2', 'KNIFE', 'p1')).outcome.eliminatedPlayerIds,
    ).toEqual(['p2']);
    expect(
      play(overtime({ p1: 1, p2: 2 }), attack('p1', 'GUN', 'p2'), attack('p2', 'AXE', 'p1')).outcome.eliminatedPlayerIds,
    ).toEqual(['p1']);
  });
});

describe('streak and phase bookkeeping', () => {
  it('resets the streak on any elimination, and the new round starts in Normal Phase', () => {
    let state = dodgeTurns(newGame(3), 7);
    expect(state.round.noEliminationStreak).toBe(7);
    state = play(withCharges(state, { p1: 1 }), attack('p1', 'GUN', 'p2'), charge('p2'), defend('p3', 'DODGE')).nextState;
    expect(state.round.noEliminationStreak).toBe(0);
    expect(state.round.phase).toBe('NORMAL');
    expect(state.round.survivorIds).toEqual(['p1', 'p3']);
  });

  it('a round that drops from 3 players to 2 does not inherit the old streak', () => {
    let state = dodgeTurns(newGame(3), 12);
    expect(state.round.phase).toBe('NORMAL'); // Sudden Death needs exactly two players
    state = play(withCharges(state, { p1: 1 }), attack('p1', 'GUN', 'p2'), charge('p2'), defend('p3', 'DODGE')).nextState;
    expect(state.round.survivorIds).toHaveLength(2);
    expect(state.round.noEliminationStreak).toBe(0);
    expect(state.turn!.phase).toBe('NORMAL');
  });

  it('Sudden Death and Overtime never apply with 3+ players (GDD failsafe is two-player only)', () => {
    const state = dodgeTurns(newGame(3), 30);
    expect(state.round.noEliminationStreak).toBe(30);
    expect(state.turn!.phase).toBe('NORMAL');
    expect(state.round.survivorIds).toHaveLength(3);
  });

  it('records the phase a turn was played under', () => {
    const state = withStreak(newGame(2), 10);
    const result = play(withCharges(state, { p1: 1 }), attack('p1', 'GUN', 'p2'), charge('p2'));
    expect(result.outcome.phase).toBe('SUDDEN_DEATH');
  });
});

import { describe, expect, it } from 'vitest';
import {
  EngineError,
  MATRIX_VERSION,
  RULES_VERSION,
  SERIES_WIN_TARGET,
  createSeries,
  setConnectionStatus,
  setTurnDeadline,
  type GameState,
} from '../src/engine';
import { attack, charge, defend, ids, newGame, play, withCharges } from './helpers';

/** `winner` kills the other player of a 2-player series with Gun-vs-Charge. */
const winMatch = (state: GameState, winner: string, loser: string): GameState =>
  play(withCharges(state, { [winner]: 1 }), attack(winner, 'GUN', loser), charge(loser)).nextState;

describe('createSeries (§2)', () => {
  it('starts with the full lobby alive, 0 Charge, 0 wins, Normal Phase, turn 1', () => {
    const state = newGame(5);
    expect(state.series).toMatchObject({
      seriesId: 's1',
      rulesVersion: RULES_VERSION,
      matrixVersion: MATRIX_VERSION,
      lobby: ids(5),
      status: 'IN_PROGRESS',
      winnerId: null,
      matchIndex: 1,
      currentMatchId: 's1:m1',
    });
    expect(state.round).toMatchObject({
      roundId: 's1:m1:r1',
      turnIndex: 1,
      phase: 'NORMAL',
      noEliminationStreak: 0,
      status: 'IN_PROGRESS',
      survivorIds: ids(5),
    });
    expect(state.turn).toMatchObject({
      turnId: 's1:m1:r1:t1',
      phase: 'NORMAL',
      eligiblePlayerIds: ids(5),
      lockStatus: 'OPEN',
      deadlineAt: null,
    });
    for (const player of Object.values(state.players)) {
      expect(player).toMatchObject({ alive: true, charge: 0, matchWins: 0, connectionStatus: 'CONNECTED' });
    }
    expect(state.series.matchWins).toEqual(Object.fromEntries(ids(5).map((id) => [id, 0])));
  });

  it.each([0, 1, 9, 12])('rejects a lobby of %i players', (n) => {
    expect(() => createSeries({ seriesId: 's', playerIds: ids(n) })).toThrowError(EngineError);
  });

  it.each([2, 8])('accepts a lobby of %i players', (n) => {
    expect(newGame(n).round.survivorIds).toHaveLength(n);
  });

  it('rejects duplicate player ids', () => {
    expect(() => createSeries({ seriesId: 's', playerIds: ['a', 'a', 'b'] })).toThrowError(EngineError);
  });
});

describe('round lifecycle (§2, §15)', () => {
  // p1 Gun kills charging p3; p2 Dodges.
  const afterRound = () => {
    const state = withCharges(newGame(3), { p1: 1 });
    return play(state, attack('p1', 'GUN', 'p3'), defend('p2', 'DODGE'), charge('p3'));
  };

  it('any elimination ends the round; survivors start a new round at 0 Charge', () => {
    const { nextState, outcome } = afterRound();
    expect(outcome.transition).toBe('NEXT_ROUND');
    expect(nextState.round.roundId).toBe('s1:m1:r2');
    expect(nextState.round.survivorIds).toEqual(['p1', 'p2']);
    expect(nextState.players.p1).toMatchObject({ alive: true, charge: 0 });
    expect(nextState.players.p2).toMatchObject({ alive: true, charge: 0 });
    expect(nextState.players.p3).toMatchObject({ alive: false });
  });

  it('resets round-local counters (turn index, streak, phase) and keeps the match', () => {
    const { nextState } = afterRound();
    expect(nextState.round).toMatchObject({ turnIndex: 1, noEliminationStreak: 0, phase: 'NORMAL' });
    expect(nextState.turn).toMatchObject({ turnId: 's1:m1:r2:t1', eligiblePlayerIds: ['p1', 'p2'] });
    expect(nextState.match.matchId).toBe('s1:m1');
    expect(nextState.match.roundIndex).toBe(2);
  });

  it('eliminated players cannot act in later turns of that round', () => {
    const { nextState } = afterRound();
    expect(() => play(nextState, charge('p1'), charge('p2'), charge('p3'))).toThrowError(
      expect.objectContaining({ code: 'UNEXPECTED_ACTION' }),
    );
  });

  it('does not end the round when nobody is eliminated', () => {
    const { nextState, outcome } = play(newGame(3), charge('p1'), charge('p2'), charge('p3'));
    expect(outcome.transition).toBe('NEXT_TURN');
    expect(nextState.round.roundId).toBe('s1:m1:r1');
    expect(nextState.round.turnIndex).toBe(2);
    expect(nextState.round.noEliminationStreak).toBe(1);
    expect(nextState.turn!.turnId).toBe('s1:m1:r1:t2');
  });
});

describe('match lifecycle (§2)', () => {
  it('a sole survivor wins the match, earns 1 Match Win, and a new match starts with the full lobby', () => {
    const result = play(withCharges(newGame(2), { p1: 1 }), attack('p1', 'GUN', 'p2'), charge('p2'));
    const { nextState, outcome } = result;
    expect(outcome).toMatchObject({ transition: 'MATCH_ENDED', matchWinnerId: 'p1', seriesWinnerId: null });
    expect(nextState.series.matchWins).toEqual({ p1: 1, p2: 0 });
    expect(nextState.players.p1!.matchWins).toBe(1);
    expect(nextState.series.status).toBe('IN_PROGRESS');
    expect(nextState.match).toMatchObject({ matchId: 's1:m2', matchIndex: 2, roundIndex: 1, status: 'IN_PROGRESS' });
    expect(nextState.series.currentMatchId).toBe('s1:m2');
    expect(nextState.round).toMatchObject({ roundId: 's1:m2:r1', turnIndex: 1, noEliminationStreak: 0, phase: 'NORMAL' });
    for (const id of ['p1', 'p2']) expect(nextState.players[id]).toMatchObject({ alive: true, charge: 0 });
  });

  it('eliminated players return at the start of the next match, whatever the lobby size', () => {
    let state = withCharges(newGame(4), { p1: 1 });
    state = play(state, attack('p1', 'GUN', 'p2'), charge('p2'), charge('p3'), charge('p4')).nextState; // p2 out
    state = withCharges(state, { p1: 3 });
    const result = play(state, attack('p1', 'GRENADE', 'p3', 'p4'), charge('p3'), charge('p4'));
    expect(result.outcome.transition).toBe('MATCH_ENDED');
    expect(result.nextState.round.survivorIds).toEqual(ids(4));
    expect(Object.values(result.nextState.players).every((p) => p.alive && p.charge === 0)).toBe(true);
  });

  it('preserves every player\'s Match Wins across matches', () => {
    let state = newGame(2);
    state = winMatch(state, 'p1', 'p2');
    state = winMatch(state, 'p2', 'p1');
    state = winMatch(state, 'p1', 'p2');
    expect(state.series.matchWins).toEqual({ p1: 2, p2: 1 });
    expect(state.players.p1!.matchWins).toBe(2);
    expect(state.players.p2!.matchWins).toBe(1);
    expect(state.match.matchIndex).toBe(4);
  });

  it('resets round-local state at a new match even after a long stall', () => {
    let state = newGame(2);
    for (let i = 0; i < 10; i++) state = play(state, defend('p1', 'DODGE'), defend('p2', 'DODGE')).nextState;
    expect(state.round.phase).toBe('SUDDEN_DEATH');
    state = winMatch(state, 'p1', 'p2'); // p1 has 1 Charge injected, so it can legally attack in Sudden Death
    expect(state.round).toMatchObject({ turnIndex: 1, noEliminationStreak: 0, phase: 'NORMAL' });
  });
});

describe('series lifecycle (§2)', () => {
  it(`does not end the series at ${SERIES_WIN_TARGET - 1} Match Wins`, () => {
    let state = newGame(2);
    for (let i = 0; i < SERIES_WIN_TARGET - 1; i++) state = winMatch(state, 'p1', 'p2');
    expect(state.series.status).toBe('IN_PROGRESS');
    expect(state.series.matchWins.p1).toBe(SERIES_WIN_TARGET - 1);
    expect(state.turn).not.toBeNull();
  });

  it(`ends the series immediately when a player earns Match Win #${SERIES_WIN_TARGET}`, () => {
    let state = newGame(2);
    for (let i = 0; i < SERIES_WIN_TARGET - 1; i++) state = winMatch(state, 'p1', 'p2');
    const result = play(withCharges(state, { p1: 1 }), attack('p1', 'GUN', 'p2'), charge('p2'));
    expect(result.outcome).toMatchObject({ transition: 'SERIES_ENDED', matchWinnerId: 'p1', seriesWinnerId: 'p1' });
    expect(result.nextState.series).toMatchObject({ status: 'COMPLETE', winnerId: 'p1' });
    expect(result.nextState.series.matchWins.p1).toBe(SERIES_WIN_TARGET);
    expect(result.nextState.match).toMatchObject({ status: 'COMPLETE', winnerId: 'p1' });
    expect(result.nextState.turn).toBeNull();
  });

  it('is unbounded in matches: 9-9 keeps going, and the next win decides it', () => {
    let state = newGame(2);
    for (let i = 0; i < 9; i++) {
      state = winMatch(state, 'p1', 'p2');
      state = winMatch(state, 'p2', 'p1');
    }
    expect(state.series.matchWins).toEqual({ p1: 9, p2: 9 });
    expect(state.series.status).toBe('IN_PROGRESS');
    expect(state.match.matchIndex).toBe(19);
    state = winMatch(state, 'p2', 'p1');
    expect(state.series).toMatchObject({ status: 'COMPLETE', winnerId: 'p2' });
  });

  it('never produces a draw result', () => {
    // The only "everyone dies" case voids the round rather than ending the match.
    const state = withCharges(newGame(3), { p1: 4, p2: 4, p3: 4 });
    const { outcome, nextState } = play(state, attack('p1', 'BOMB'), defend('p2', 'QUAD_REFLECT'), attack('p3', 'MJOLNIR'));
    expect(outcome.matchWinnerId).toBeNull();
    expect(nextState.series.status).toBe('IN_PROGRESS');
  });
});

describe('server-facing state helpers', () => {
  it('stamps a turn deadline without touching anything else', () => {
    const state = newGame(2);
    const stamped = setTurnDeadline(state, 1_700_000_000_000);
    expect(stamped.turn!.deadlineAt).toBe(1_700_000_000_000);
    expect({ ...stamped, turn: null }).toEqual({ ...state, turn: null });
  });

  it('preserves connection status across rounds and matches', () => {
    let state = setConnectionStatus(newGame(3), 'p3', 'DISCONNECTED');
    state = play(withCharges(state, { p1: 1 }), attack('p1', 'GUN', 'p2'), charge('p2'), charge('p3')).nextState;
    expect(state.players.p3!.connectionStatus).toBe('DISCONNECTED');
  });

  it('Match Wins on Series and PlayerState always agree', () => {
    let state = newGame(3);
    for (let i = 0; i < 4; i++) {
      state = play(withCharges(state, { p1: 5 }), attack('p1', 'BLACKHOLE'), charge('p2'), charge('p3')).nextState;
      for (const id of ids(3)) expect(state.players[id]!.matchWins).toBe(state.series.matchWins[id]);
    }
    expect(state.series.matchWins.p1).toBe(4);
  });
});

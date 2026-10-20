import { describe, expect, it } from 'vitest';
import { forfeitPlayers } from '../src/engine';
import { attack, charge, newGame, play, withCharges } from './helpers';

describe('forfeitPlayers (a player quitting mid-series)', () => {
  it('3 players: the quitter is eliminated and a new round starts for the 2 survivors at 0 Charge', () => {
    const g = withCharges(newGame(3), { p1: 3, p2: 2, p3: 1 });
    const r = forfeitPlayers(g, ['p3']);
    expect(r.transition).toBe('NEXT_ROUND');
    expect(r.eliminatedIds).toEqual(['p3']);
    expect(r.state.round.survivorIds).toEqual(['p1', 'p2']);
    expect(r.state.players.p3!.alive).toBe(false);
    expect(r.state.players.p1!.charge).toBe(0);
    expect(r.state.series.departed).toEqual(['p3']);
    expect(r.state.turn!.eligiblePlayerIds).toEqual(['p1', 'p2']);
  });

  it('2 players: the series ends by forfeit and the one left wins it (no Match Win awarded)', () => {
    const r = forfeitPlayers(newGame(2), ['p2']);
    expect(r.transition).toBe('SERIES_ENDED');
    expect(r.seriesWinnerId).toBe('p1');
    expect(r.state.series).toMatchObject({ status: 'COMPLETE', winnerId: 'p1' });
    expect(r.state.series.matchWins.p1).toBe(0);
    expect(r.state.turn).toBeNull();
  });

  it('3 players, one survivor after the first quits and the second dies: the survivor wins the match and the quitter sits out the next', () => {
    let s = forfeitPlayers(withCharges(newGame(3), { p1: 1 }), ['p3']).state; // p1 + p2 left
    s = withCharges(s, { p1: 1 });
    const won = play(s, attack('p1', 'GUN', 'p2'), charge('p2'));
    expect(won.outcome.transition).toBe('MATCH_ENDED');
    const next = won.nextState;
    expect(next.series.matchWins.p1).toBe(1);
    expect(next.players.p3!.alive).toBe(false); // p3 left for good
    expect(next.round.survivorIds).toEqual(['p1', 'p2']);
  });

  it('a living player quitting leaves exactly one survivor: they win the match', () => {
    const three = forfeitPlayers(newGame(3), ['p3']).state;
    const r = forfeitPlayers(three, ['p2']); // only p1 is left
    expect(r.transition).toBe('SERIES_ENDED'); // p1 is the only participant in the series
    const four = forfeitPlayers(newGame(4), ['p4']).state; // 3 alive
    const r2 = forfeitPlayers(four, ['p2', 'p3']); // both leave at once; p1 alone
    expect(r2.state.series.status).toBe('COMPLETE');
  });

  it('ignores unknown or repeated quitters and finished series', () => {
    const g = newGame(3);
    expect(forfeitPlayers(g, ['zz']).transition).toBe('NONE');
    const after = forfeitPlayers(g, ['p3']).state;
    expect(forfeitPlayers(after, ['p3']).transition).toBe('NONE');
    expect(forfeitPlayers(forfeitPlayers(newGame(2), ['p2']).state, ['p1']).transition).toBe('NONE');
  });

  it('records the departure when the quitter was already eliminated, without restarting the round', () => {
    // p3 is eliminated this match, then leaves
    const g = withCharges(newGame(3), { p1: 1 });
    const turn = play(g, attack('p1', 'GUN', 'p3'), charge('p2'), charge('p3'));
    const afterKill = turn.nextState; // p3 dead, new round
    const r = forfeitPlayers(afterKill, ['p3']);
    expect(r.transition).toBe('NONE');
    expect(r.state.series.departed).toEqual(['p3']);
    expect(r.state.round.roundId).toBe(afterKill.round.roundId);
  });
});

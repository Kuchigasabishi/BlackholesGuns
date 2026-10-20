import { describe, expect, it } from 'vitest';
import { forfeitPlayers, type GameState, type PlayerId } from '../src/engine';
import { attack, charge, newGame, play, withCharges } from './helpers';

/** `winner` shoots the other charging player in a 2-player game: they win the match. */
function win(state: GameState, winner: PlayerId, loser: PlayerId): GameState {
  return play(withCharges(state, { [winner]: 1 }), attack(winner, 'GUN', loser), charge(loser)).nextState;
}
const streaks = (s: GameState) => Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, p.currentMatchStreak]));

describe('currentMatchStreak ("On Fire")', () => {
  it('starts at 0 for everyone', () => {
    expect(streaks(newGame(3))).toEqual({ p1: 0, p2: 0, p3: 0 });
  });

  it('increments the winner and instantly resets everyone else', () => {
    let s = newGame(2);
    s = win(s, 'p1', 'p2');
    expect(streaks(s)).toEqual({ p1: 1, p2: 0 });
    s = win(s, 'p1', 'p2');
    expect(streaks(s)).toEqual({ p1: 2, p2: 0 });
    s = win(s, 'p1', 'p2');
    expect(streaks(s)).toEqual({ p1: 3, p2: 0 });
    expect(s.series.matchStreaks).toEqual({ p1: 3, p2: 0 });
    // a different player wins: the old leader's streak is cleared in the very next state
    s = win(s, 'p2', 'p1');
    expect(streaks(s)).toEqual({ p1: 0, p2: 1 });
    expect(s.series.matchWins).toEqual({ p1: 3, p2: 1 });
  });

  it('is untouched by rounds inside a match (only a resolved match counts)', () => {
    const g = withCharges(newGame(3), { p1: 1 });
    const afterRound = play(g, attack('p1', 'GUN', 'p3'), charge('p2'), charge('p3')).nextState; // p3 out: new round, same match
    expect(streaks(afterRound)).toEqual({ p1: 0, p2: 0, p3: 0 });
  });

  it('is final on the state that ends the series', () => {
    let s = newGame(2);
    for (let i = 0; i < 9; i++) s = win(s, 'p1', 'p2');
    const done = win(s, 'p1', 'p2');
    expect(done.series.status).toBe('COMPLETE');
    expect(streaks(done)).toEqual({ p1: 10, p2: 0 });
  });

  it('a forfeit that leaves one survivor in a match credits them with the win and a streak', () => {
    // 4 players, p4 quits (3 alive), then p3 quits (2 alive), then p2 quits: p1 alone in the match but not the series
    let s = newGame(4);
    s = forfeitPlayers(s, ['p4']).state;
    s = forfeitPlayers(s, ['p3']).state;
    const r = forfeitPlayers(s, ['p2']);
    expect(r.transition).toBe('SERIES_ENDED'); // everyone else left: p1 wins the series by forfeit
    expect(streaks(r.state).p1).toBe(0); // no Match Win is awarded for a pure series forfeit

    // 3 players: p3 leaves, then p2 is shot: p1 wins the match
    let t = forfeitPlayers(withCharges(newGame(3), { p1: 1 }), ['p3']).state;
    t = withCharges(t, { p1: 1 });
    const won = play(t, attack('p1', 'GUN', 'p2'), charge('p2')).nextState;
    expect(streaks(won)).toEqual({ p1: 1, p2: 0, p3: 0 });
  });
});

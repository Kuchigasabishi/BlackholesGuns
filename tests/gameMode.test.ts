import { describe, expect, it } from 'vitest';
import { createSeries, forfeitPlayers } from '../src/engine';
import { attack, charge, ids, newGame, play, withCharges } from './helpers';

const charges = (s: ReturnType<typeof newGame>) => Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, p.charge]));

describe('game mode', () => {
  it('defaults to STANDARD and rejects unknown modes', () => {
    expect(createSeries({ seriesId: 's', playerIds: ids(2) }).series.gameMode).toBe('STANDARD');
    expect(newGame(2).series.gameMode).toBe('STANDARD');
    expect(() => createSeries({ seriesId: 's', playerIds: ids(2), gameMode: 'CHAOS' as never })).toThrow();
  });

  // p1 shoots p3 (Charging); p2 Charges. p3 is eliminated -> a new round starts with p1 and p2.
  const roundEnd = (mode: 'STANDARD' | 'SNOWBALL') =>
    play(withCharges(newGame(3, 's1', mode), { p1: 3, p2: 2 }), attack('p1', 'GUN', 'p3'), charge('p2'), charge('p3'));

  it('STANDARD: an elimination resets every survivor to 0 Charge (original rules)', () => {
    const r = roundEnd('STANDARD');
    expect(r.outcome.transition).toBe('NEXT_ROUND');
    expect(charges(r.nextState)).toEqual({ p1: 0, p2: 0, p3: 0 });
  });

  it('SNOWBALL: survivors keep their post-turn Charge (Gun cost paid, Charge +1 earned) into the next round', () => {
    const r = roundEnd('SNOWBALL');
    expect(r.outcome.transition).toBe('NEXT_ROUND');
    expect(r.nextState.round.survivorIds).toEqual(['p1', 'p2']);
    expect(charges(r.nextState)).toEqual({ p1: 2, p2: 3, p3: 0 }); // 3 - 1 for the Gun, 2 + 1 for Charging; the dead start at 0
    expect(r.nextState.round).toMatchObject({ turnIndex: 1, noEliminationStreak: 0, phase: 'NORMAL' }); // the round itself is fresh
  });

  it('SNOWBALL: the carried Charge is spendable and keeps growing in the next round', () => {
    const next = roundEnd('SNOWBALL').nextState;
    const spend = play(next, attack('p2', 'KATANA', 'p1'), charge('p1')); // p2 carried 3 Charge, so Katana (3) is legal
    expect(spend.nextState.players.p2!.charge).toBe(0);
    const grow = play(next, charge('p1'), charge('p2'));
    expect(charges(grow.nextState)).toMatchObject({ p1: 3, p2: 4 });
  });

  it('SNOWBALL: Charge is wiped only when a fresh match starts, and the mode persists for the series', () => {
    const s = withCharges(newGame(2, 's1', 'SNOWBALL'), { p1: 4, p2: 4 });
    const won = play(s, attack('p1', 'GUN', 'p2'), charge('p2'));
    expect(won.outcome.transition).toBe('MATCH_ENDED');
    expect(charges(won.nextState)).toEqual({ p1: 0, p2: 0 });
    expect(won.nextState.series.gameMode).toBe('SNOWBALL');
  });

  it('a round voided by a mutual wipe-out: SNOWBALL keeps the Charge that was left, STANDARD clears it', () => {
    const acts = [attack('p1', 'GUN', 'p2'), attack('p2', 'GUN', 'p3'), attack('p3', 'GUN', 'p1')] as const;
    const standard = play(withCharges(newGame(3), { p1: 3, p2: 3, p3: 3 }), ...acts);
    expect(standard.outcome.transition).toBe('ROUND_RESTARTED_NO_SURVIVORS');
    expect(charges(standard.nextState)).toEqual({ p1: 0, p2: 0, p3: 0 });
    const snow = play(withCharges(newGame(3, 's1', 'SNOWBALL'), { p1: 3, p2: 3, p3: 3 }), ...acts);
    expect(charges(snow.nextState)).toEqual({ p1: 2, p2: 2, p3: 2 }); // each paid 1 for the Gun
  });

  it('a quit or kick that restarts the round: SNOWBALL keeps survivors Charge, STANDARD clears it', () => {
    const mk = (mode: 'STANDARD' | 'SNOWBALL') => withCharges(newGame(3, 's1', mode), { p1: 4, p2: 2, p3: 1 });
    expect(charges(forfeitPlayers(mk('SNOWBALL'), ['p3']).state)).toEqual({ p1: 4, p2: 2, p3: 0 });
    expect(charges(forfeitPlayers(mk('STANDARD'), ['p3']).state)).toEqual({ p1: 0, p2: 0, p3: 0 });
  });

  it('with no elimination, Charge behaves identically in both modes', () => {
    for (const mode of ['STANDARD', 'SNOWBALL'] as const) {
      const r = play(newGame(3, 's1', mode), charge('p1'), charge('p2'), charge('p3'));
      expect(charges(r.nextState)).toEqual({ p1: 1, p2: 1, p3: 1 });
    }
  });
});

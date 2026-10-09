import { describe, expect, it } from 'vitest';
import { always, cashOut, runRound } from './harness';
import { STALL_SCENARIOS } from './scenarios';
import { defend, newGame, play, withStreak } from '../helpers';

/** Generous cap; the GDD's own audit reports a 17-turn worst case. */
const MAX_TURNS = 100;

/**
 * Scenarios that do NOT end by elimination under the rules as written (GDD v1.0.4).
 *
 * Cause: Sudden Death lasts only 5 turns (≈2 forced attack turns). If both of
 * those neutralize (random Gun/Gun or Knife/Knife), Overtime restores
 * Dodge/Shield/Reflect and §9 gives Overtime no failsafe of its own, so a passive
 * mirror then loops forever. This contradicts the GDD's "83/83 terminated, 0/83
 * stalled", whose case list is not published. Golden list: any rules or RNG change
 * that moves a scenario in or out of this set must be a conscious decision.
 */
const KNOWN_OVERTIME_STALLS: ReadonlySet<string> = new Set([
  'defensive-mirror-cross/dodge vs dodge',
  'defensive-mirror-cross/dodge vs shield',
  'reflect-loop/reflect-3 mirror',
  'aggressive-cash-out/BOMB vs shield',
  'aggressive-cash-out/NUKE vs dodge',
]);

const runs = STALL_SCENARIOS.map((scenario) => ({
  scenario,
  run: runRound(scenario.id, scenario.strategies, MAX_TURNS),
}));

describe('GDD §9 / §17 stall scenarios (reconstructed: the GDD does not list its 83 cases)', () => {
  it('has exactly 83 distinct scenarios across the eight named categories', () => {
    expect(STALL_SCENARIOS).toHaveLength(83);
    expect(new Set(STALL_SCENARIOS.map((s) => s.id)).size).toBe(83);
    const perCategory = Object.fromEntries(
      [...new Set(STALL_SCENARIOS.map((s) => s.category))].map((c) => [c, STALL_SCENARIOS.filter((s) => s.category === c).length]),
    );
    expect(perCategory).toEqual({
      'defensive-mirror-cross': 10,
      'reflect-loop': 18,
      'charge-greedy': 8,
      'aggressive-cash-out': 24,
      'anti-charge': 7,
      'cross-strategy': 8,
      'tier-class-collision': 5,
      'blackhole-mirror': 3,
    });
  });

  describe.each(runs)('$scenario.id', ({ scenario, run }) => {
    if (KNOWN_OVERTIME_STALLS.has(scenario.id)) {
      it(`KNOWN GAP: reaches Overtime with no eliminations and never ends (${MAX_TURNS} turns)`, () => {
        expect(run.terminated).toBe(false);
        expect(run.phasesSeen).toEqual(['NORMAL', 'SUDDEN_DEATH', 'OVERTIME']);
        expect(run.state.round.noEliminationStreak).toBe(MAX_TURNS);
        expect(run.state.round.survivorIds).toHaveLength(2);
      });
    } else {
      it('terminates: a player is eliminated and the round ends', () => {
        expect(run.terminated, `still running after ${MAX_TURNS} turns`).toBe(true);
        expect(run.finalTransition).toBe('MATCH_ENDED');
      });
    }

    if (scenario.passiveUntilSuddenDeath) {
      it('stalls through Normal Phase and is only ever broken by Sudden Death', () => {
        expect(run.phasesSeen).toContain('SUDDEN_DEATH');
        expect(run.turns).toBeGreaterThan(10);
      });
    }
  });

  it('summary: 78/83 terminate (longest 15 turns); 5/83 are Overtime stalls', () => {
    const stalled = runs.filter((r) => !r.run.terminated).map((r) => r.scenario.id);
    const terminated = runs.filter((r) => r.run.terminated);
    expect(new Set(stalled)).toEqual(KNOWN_OVERTIME_STALLS);
    expect(terminated).toHaveLength(78);
    expect(Math.max(...terminated.map((r) => r.run.turns))).toBe(15);
  });

  it('is reproducible: re-running every scenario gives identical turn counts and end states', () => {
    for (const { scenario, run } of runs) {
      const again = runRound(scenario.id, scenario.strategies, MAX_TURNS);
      expect(again.turns, scenario.id).toBe(run.turns);
      expect(JSON.stringify(again.state), scenario.id).toBe(JSON.stringify(run.state));
    }
  });
});

/**
 * NOT part of the 83. Characterisation of how the rules-as-written can fail to
 * terminate, so the gaps are visible, tracked, and cannot regress silently.
 */
describe('known gaps: patterns that never terminate under the rules as written', () => {
  it('Overtime has no failsafe: two Dodgers (even Shield/Dodge mix) never end the round', () => {
    let state = withStreak(newGame(2), 15);
    expect(state.turn!.phase).toBe('OVERTIME');
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const result = play(state, defend('p1', 'DODGE'), defend('p2', turn % 2 === 0 ? 'SHIELD' : 'DODGE'));
      expect(result.outcome.transition).toBe('NEXT_TURN');
      state = result.nextState;
    }
    expect(state.round.noEliminationStreak).toBe(15 + MAX_TURNS);
    expect(state.turn!.phase).toBe('OVERTIME');
  });

  it('the Sudden Death window only breaks a Dodge mirror about 3 times in 4', () => {
    const stalls = Array.from({ length: 400 }, (_, i) =>
      runRound(`seed-${i}`, [always('DODGE'), always('DODGE')], MAX_TURNS),
    ).filter((r) => !r.terminated).length;
    // Analytic expectation: two forced attack turns, each 50% to neutralize (Gun/Gun or Knife/Knife) => 25%.
    expect(stalls / 400).toBeGreaterThan(0.15);
    expect(stalls / 400).toBeLessThan(0.35);
  });

  // Cost-1 weapons are the only ones that cycle forever from Sudden Death on: Sudden Death keeps
  // Charge at 0 or 1, so the only legal attacks are Gun and Knife, and Gun/Gun or Knife/Knife neutralize.
  it.each([['GUN'], ['KNIFE']] as const)('two players who both cash out %s never end the round', (weapon) => {
    const run = runRound(`gap-${weapon}`, [cashOut(weapon), cashOut(weapon)], 200);
    expect(run.terminated).toBe(false);
    expect(run.phasesSeen).toEqual(['NORMAL', 'SUDDEN_DEATH', 'OVERTIME']);
    expect(run.neutralizations).toBeGreaterThan(0);
    // The timeout rule never has to step in: every action both players send is already legal.
    expect(run.timeouts).toBe(0);
  });

  it('Gun vs Knife mirrors do break: ranged beats melee', () => {
    expect(runRound('gun-vs-knife', [cashOut('GUN'), cashOut('KNIFE')], 200).terminated).toBe(true);
  });

  it('three players who all Dodge forever are never forced into anything (failsafe is two-player only)', () => {
    const dodge = always('DODGE');
    const run = runRound('gap-three-dodgers', [dodge, dodge, dodge], 200, 3);
    expect(run.terminated).toBe(false);
    expect(run.phasesSeen).toEqual(['NORMAL']);
    expect(run.state.round.noEliminationStreak).toBe(200);
  });
});

import { OVERTIME_AFTER, SUDDEN_DEATH_AFTER } from './constants';
import type { Phase } from './types';

/**
 * §9: the phase of the *next* turn, given how many players are alive and the
 * consecutive no-elimination streak so far.
 *
 * Sudden Death begins after 10 consecutive no-elimination turns, Overtime after
 * 5 more (15 total). Both exist only while exactly two players are alive; with
 * any other head-count the round stays in Normal Phase.
 */
export function phaseFor(aliveCount: number, noEliminationStreak: number): Phase {
  if (aliveCount !== 2) return 'NORMAL';
  if (noEliminationStreak >= OVERTIME_AFTER) return 'OVERTIME';
  if (noEliminationStreak >= SUDDEN_DEATH_AFTER) return 'SUDDEN_DEATH';
  return 'NORMAL';
}

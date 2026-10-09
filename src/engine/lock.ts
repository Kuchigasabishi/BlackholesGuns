/** §10 LOCK: timeout defaults for players without a valid committed action. */
import { ATTACKS } from './catalog';
import { affordableAttacks, getActionAvailability, validateAction } from './legality';
import { pickRandom, type Rng } from './rng';
import type { Action, GameState, PlayerId, RejectionCode } from './types';

export interface RejectedSubmission {
  readonly playerId: PlayerId;
  readonly code: RejectionCode;
  readonly message: string;
}

export interface LockTurnResult {
  /** Exactly one final action per living player, ready for `resolveTurn`. */
  readonly actions: Readonly<Record<PlayerId, Action>>;
  /** Players whose action was filled in by the timeout rule. */
  readonly timedOutPlayerIds: readonly PlayerId[];
  /** Submissions that were present but invalid (these players also time out). */
  readonly rejected: readonly RejectedSubmission[];
}

/**
 * The action applied when a player has not submitted a valid one by the
 * deadline: Charge (a no-op at 5 Charge), except in Sudden Death when an
 * attack is affordable. Charge is then illegal, so one affordable attack is
 * chosen uniformly at random using `rng`.
 */
export function buildTimeoutAction(state: GameState, playerId: PlayerId, rng: Rng, now: number): Action {
  const turn = state.turn;
  if (!turn) throw new Error('buildTimeoutAction: no open turn');
  const base = {
    seriesId: state.series.seriesId,
    matchId: state.match.matchId,
    roundId: state.round.roundId,
    turnId: turn.turnId,
    playerId,
    idempotencyKey: `timeout:${turn.turnId}:${playerId}`,
    acceptedAt: now,
    validation: { ok: true } as const,
  };

  if (getActionAvailability(state, playerId).charge.available) return { ...base, kind: 'CHARGE' };

  const player = state.players[playerId];
  const weaponId = pickRandom(rng, affordableAttacks(player?.charge ?? 0));
  const weapon = ATTACKS[weaponId];
  // Sudden Death only exists with exactly two players alive, so the single
  // opponent is the only possible target.
  const opponents = state.series.lobby.filter((id) => id !== playerId && state.players[id]?.alive);
  const targets = weapon.targetMode === 'ALL_OPPONENTS' ? [] : opponents.slice(0, 1);
  return { ...base, kind: 'ATTACK', weapon: weaponId, targets };
}

/**
 * Closes the commit window. Valid submissions are kept as-is; every other
 * living player gets the timeout action. Players are processed in lobby order
 * so a seeded `rng` yields reproducible results.
 */
export function lockTurn(
  state: GameState,
  submitted: Readonly<Record<PlayerId, Action>>,
  rng: Rng,
  now: number,
): LockTurnResult {
  const turn = state.turn;
  if (!turn) throw new Error('lockTurn: no open turn');

  const actions: Record<PlayerId, Action> = {};
  const timedOut: PlayerId[] = [];
  const rejected: RejectedSubmission[] = [];

  for (const playerId of turn.eligiblePlayerIds) {
    const candidate = Object.hasOwn(submitted, playerId) ? submitted[playerId] : undefined;
    if (candidate && candidate.playerId === playerId) {
      const verdict = validateAction(state, candidate);
      if (verdict.ok) {
        actions[playerId] = candidate;
        continue;
      }
      rejected.push({ playerId, code: verdict.code, message: verdict.message });
    }
    actions[playerId] = buildTimeoutAction(state, playerId, rng, now);
    timedOut.push(playerId);
  }
  return { actions, timedOutPlayerIds: timedOut, rejected };
}

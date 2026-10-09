/**
 * §16 test hooks: "seeded lobby/action injection and force phase/streak values
 * without altering production rules."
 *
 * These are PURE transformations of a GameState; they never touch the rules
 * code. Charges are bounded 0-5, the streak recomputes phase through the same
 * `phaseFor` the engine uses, and injected actions still go through the normal
 * legality check. The HTTP surface in gameServer.ts only exists in dev mode.
 */
import {
  MAX_CHARGE,
  deepFreeze,
  lockTurn,
  phaseFor,
  resolveTurn,
  type Action,
  type GameState,
  type PlayerId,
  type Rng,
  type TurnTransition,
} from '../engine';

export type DevHookCode = 'BAD_PAYLOAD' | 'ROOM_NOT_FOUND' | 'NOT_IN_GAME' | 'INVALID_PLAYER' | 'FORBIDDEN';

export class DevHookError extends Error {
  readonly code: DevHookCode;
  constructor(code: DevHookCode, message: string) {
    super(message);
    this.name = 'DevHookError';
    this.code = code;
  }
}

/** Sets Charge balances (0-5, integers) for living players. */
export function setCharges(state: GameState, charges: Readonly<Record<PlayerId, number>>): GameState {
  const players = { ...state.players };
  for (const [id, value] of Object.entries(charges)) {
    const player = players[id];
    if (!player) throw new DevHookError('INVALID_PLAYER', `Unknown player ${id}`);
    if (!player.alive) throw new DevHookError('INVALID_PLAYER', `${id} is eliminated`);
    if (!Number.isInteger(value) || value < 0 || value > MAX_CHARGE) {
      throw new DevHookError('BAD_PAYLOAD', `Charge for ${id} must be an integer 0-${MAX_CHARGE}`);
    }
    players[id] = { ...player, charge: value };
  }
  return deepFreeze({ ...state, players });
}

/**
 * Pretends `streak` consecutive no-elimination turns have already happened this
 * round. `9` makes the very next no-elimination turn open Sudden Death; `10`
 * opens Sudden Death immediately.
 */
export function setNoEliminationStreak(state: GameState, streak: number): GameState {
  if (!state.turn) throw new DevHookError('NOT_IN_GAME', 'No open turn');
  if (!Number.isInteger(streak) || streak < 0) throw new DevHookError('BAD_PAYLOAD', 'streak must be a non-negative integer');
  const phase = phaseFor(state.round.survivorIds.length, streak);
  return deepFreeze({
    ...state,
    round: { ...state.round, noEliminationStreak: streak, phase },
    turn: { ...state.turn, phase },
  });
}

export interface FastForwardResult {
  readonly state: GameState;
  readonly turnsPlayed: number;
  /** Why it stopped early, if it did (an elimination ended the round, etc.). */
  readonly stoppedBy: TurnTransition | null;
}

/**
 * Plays `turns` turns in which everyone prefers Dodge. Where Dodge is illegal
 * (Sudden Death) the normal timeout rule picks the action, so the rules are
 * exercised exactly as in a real game. Stops if anyone is eliminated.
 */
export function fastForward(state: GameState, turns: number, rng: Rng): FastForwardResult {
  if (!Number.isInteger(turns) || turns < 0 || turns > 500) throw new DevHookError('BAD_PAYLOAD', 'turns must be an integer 0-500');
  let current = state;
  for (let i = 0; i < turns; i++) {
    const turn = current.turn;
    if (!turn) throw new DevHookError('NOT_IN_GAME', 'No open turn');
    const submitted: Record<PlayerId, Action> = {};
    for (const id of turn.eligiblePlayerIds) {
      submitted[id] = {
        seriesId: current.series.seriesId,
        matchId: current.match.matchId,
        roundId: current.round.roundId,
        turnId: turn.turnId,
        playerId: id,
        kind: 'DEFENSE',
        defense: 'DODGE',
        idempotencyKey: `dev-ff:${turn.turnId}:${id}`,
        acceptedAt: 0,
        validation: { ok: true },
      };
    }
    const locked = lockTurn(current, submitted, rng, 0);
    const result = resolveTurn(current, locked.actions);
    current = result.nextState;
    if (result.outcome.transition !== 'NEXT_TURN') return { state: current, turnsPlayed: i + 1, stoppedBy: result.outcome.transition };
  }
  return { state: current, turnsPlayed: turns, stoppedBy: null };
}

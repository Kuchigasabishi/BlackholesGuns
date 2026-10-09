/**
 * §14 state model. Every structure is deeply readonly: the engine never
 * mutates its inputs and always returns fresh (frozen) state.
 *
 * Note on §14's "Match" row: it lists series-level fields (seriesId, rules and
 * matrix versions, full lobby, series status, Match Wins, current matchId).
 * Those live on `Series` here, and `Match` carries the per-match fields.
 */
import type { AttackId, DefenseId } from './catalog';
import type { MatrixResult } from './matrix';

export type PlayerId = string;

/** §9 phases. Sudden Death and Overtime only exist while exactly two players are alive. */
export type Phase = 'NORMAL' | 'SUDDEN_DEATH' | 'OVERTIME';

export type ConnectionStatus = 'CONNECTED' | 'DISCONNECTED';

// ---------------------------------------------------------------- lifecycle

export interface Series {
  readonly seriesId: string;
  readonly rulesVersion: string;
  readonly matrixVersion: string;
  /** The full lobby, in canonical (seat) order. Restored in full at every new match. */
  readonly lobby: readonly PlayerId[];
  readonly status: 'IN_PROGRESS' | 'COMPLETE';
  /** Match Wins by player; persists across matches. */
  readonly matchWins: Readonly<Record<PlayerId, number>>;
  readonly currentMatchId: string;
  /** 1-based. */
  readonly matchIndex: number;
  /** Set once a player reaches the series win target. */
  readonly winnerId: PlayerId | null;
}

export interface Match {
  readonly matchId: string;
  readonly seriesId: string;
  readonly matchIndex: number;
  readonly status: 'IN_PROGRESS' | 'COMPLETE';
  readonly currentRoundId: string;
  /** 1-based; counts rounds in this match, including restarted ones. */
  readonly roundIndex: number;
  readonly winnerId: PlayerId | null;
}

export interface Round {
  readonly roundId: string;
  readonly matchId: string;
  readonly roundIndex: number;
  readonly survivorIds: readonly PlayerId[];
  /** Index of the current (open) turn within this round, 1-based. */
  readonly turnIndex: number;
  readonly phase: Phase;
  /** Consecutive no-elimination turns. Reset to 0 on any elimination (§9, §15). */
  readonly noEliminationStreak: number;
  readonly status: 'IN_PROGRESS' | 'COMPLETE';
}

export interface PlayerState {
  readonly playerId: PlayerId;
  readonly alive: boolean;
  /** 0..MAX_CHARGE */
  readonly charge: number;
  readonly matchWins: number;
  readonly connectionStatus: ConnectionStatus;
}

export interface Turn {
  readonly turnId: string;
  readonly roundId: string;
  /** Phase snapshot: governs action availability for this turn. */
  readonly phase: Phase;
  readonly eligiblePlayerIds: readonly PlayerId[];
  /** Epoch ms. The engine has no clock; the server stamps this (see `setTurnDeadline`). */
  readonly deadlineAt: number | null;
  readonly lockStatus: 'OPEN' | 'LOCKED';
}

/** Aggregate authoritative state for one series. */
export interface GameState {
  readonly series: Series;
  readonly match: Match;
  readonly round: Round;
  /** Every lobby member, alive or not. Iterate via `series.lobby` for stable ordering. */
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  /** The open turn; null once the series is complete. */
  readonly turn: Turn | null;
}

// ------------------------------------------------------------------ actions

export type RejectionCode =
  | 'TURN_NOT_OPEN'
  | 'STALE_TURN'
  | 'NOT_ALIVE'
  | 'NOT_ELIGIBLE'
  | 'UNKNOWN_ACTION'
  | 'UNAFFORDABLE'
  | 'PHASE_RESTRICTED'
  | 'ATTACK_MANDATORY'
  | 'INVALID_TARGETS';

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: RejectionCode; readonly message: string };

/** Fields common to every action (§12 payload + §14 Action row). */
interface ActionBase {
  readonly seriesId: string;
  readonly matchId: string;
  readonly roundId: string;
  readonly turnId: string;
  readonly playerId: PlayerId;
  readonly idempotencyKey: string;
  /** Server receipt time, epoch ms. */
  readonly acceptedAt: number;
  readonly validation: ValidationResult;
}

export interface ChargeAction extends ActionBase {
  readonly kind: 'CHARGE';
}

export interface AttackAction extends ActionBase {
  readonly kind: 'ATTACK';
  readonly weapon: AttackId;
  /**
   * Selected targets. Required (1 target) for single-target weapons and
   * (1-3 distinct) for 3-hit Combo / Grenade / Katana. For all-opponent
   * weapons it may be empty or the full opponent set.
   */
  readonly targets: readonly PlayerId[];
}

export interface DefenseAction extends ActionBase {
  readonly kind: 'DEFENSE';
  readonly defense: DefenseId;
}

export type Action = ChargeAction | AttackAction | DefenseAction;
export type ActionKind = Action['kind'];

/** What a resolved interaction's target was doing (used in events). */
export type ActionRef =
  | { readonly kind: 'CHARGE' }
  | { readonly kind: 'ATTACK'; readonly weapon: AttackId }
  | { readonly kind: 'DEFENSE'; readonly defense: DefenseId };

// ------------------------------------------------------- resolution output

export type ResolutionRuleType = 'MATRIX' | 'COLLISION' | 'CHARGE_HIT';

export type ResolutionOutcome =
  /** The selected target is eliminated. (For collisions: the target's own attack lost.) */
  | 'TARGET_ELIMINATED'
  /** The attacker is eliminated (reflection, or its attack lost the collision). */
  | 'ATTACKER_ELIMINATED'
  | 'BLOCKED'
  /** Both attacks cancelled; neither player is eliminated by this interaction. */
  | 'NEUTRALIZED';

/**
 * One resolved (source attack, selected target) interaction (§14 Resolution
 * event). Events are emitted in a deterministic order (`orderKey`): attackers in
 * lobby order, then targets in effect-set order.
 */
export interface ResolutionEvent {
  readonly orderKey: number;
  readonly turnId: string;
  readonly sourcePlayerId: PlayerId;
  readonly sourceWeapon: AttackId;
  readonly selectedTargetId: PlayerId;
  /** The complete effect target set of the source action (§7). */
  readonly effectTargetSet: readonly PlayerId[];
  readonly targetAction: ActionRef;
  readonly ruleType: ResolutionRuleType;
  /** e.g. `MATRIX_V2:GUN:REFLECT`, `COLLISION:HIGHER_TIER`, `CHARGE_HIT`. */
  readonly ruleId: string;
  /** The matrix cell label when `ruleType` is MATRIX. */
  readonly matrixResult: MatrixResult | null;
  readonly outcome: ResolutionOutcome;
  /** Players marked for elimination by this interaction. */
  readonly eliminationMarks: readonly PlayerId[];
}

export type TurnTransition =
  | 'NEXT_TURN'
  | 'NEXT_ROUND'
  /** Every living player was eliminated at once; see `resolveTurn` docs. */
  | 'ROUND_RESTARTED_NO_SURVIVORS'
  | 'MATCH_ENDED'
  | 'SERIES_ENDED';

export interface PlayerTurnResult {
  readonly playerId: PlayerId;
  readonly action: ActionRef;
  readonly chargeBefore: number;
  readonly chargeAfter: number;
  readonly eliminated: boolean;
}

/** Canonical per-turn summary (§10 "one canonical result event for the turn"). */
export interface TurnOutcome {
  readonly seriesId: string;
  readonly matchId: string;
  readonly roundId: string;
  readonly turnId: string;
  /** The phase this turn was played under. */
  readonly phase: Phase;
  readonly playerResults: readonly PlayerTurnResult[];
  readonly eliminatedPlayerIds: readonly PlayerId[];
  readonly survivorIds: readonly PlayerId[];
  readonly transition: TurnTransition;
  readonly matchWinnerId: PlayerId | null;
  readonly seriesWinnerId: PlayerId | null;
  /** Streak after this turn. */
  readonly noEliminationStreak: number;
  readonly phaseChange: { readonly from: Phase; readonly to: Phase } | null;
}

export interface ResolveTurnResult {
  readonly nextState: GameState;
  readonly events: readonly ResolutionEvent[];
  readonly outcome: TurnOutcome;
}

/**
 * §16 structured telemetry: newline-delimited JSON, one object per event.
 *
 * Hidden-information rule (§16): nothing here may reveal a player's action
 * before REVEAL. `action_submitted` therefore carries only WHO and WHEN;
 * the actions themselves first appear in `turn_revealed`.
 */
import { type ResolveTurnResult } from '../engine';
import type { GameState } from '../engine';
import type { PublicAction } from './protocol';

export const TELEMETRY_EVENT_TYPES = [
  'series_started',
  'match_started',
  'turn_opened',
  'action_submitted',
  'action_rejected',
  'turn_locked',
  'turn_revealed',
  'matrix_outcome',
  'attack_collision',
  'elimination',
  'phase_changed',
  'round_ended',
  'match_ended',
  'series_ended',
] as const;
export type EventType = (typeof TELEMETRY_EVENT_TYPES)[number];

export interface LogEntry {
  readonly timestamp: number;
  readonly type: EventType;
  readonly [key: string]: unknown;
}

export interface Telemetry {
  log(entry: { readonly type: EventType; readonly [key: string]: unknown }): void;
}

export function createStdoutTelemetry(): Telemetry {
  return { log: (entry) => console.log(JSON.stringify({ timestamp: Date.now(), ...entry })) };
}

/** Buffers entries in memory (tests, tooling). */
export function createBufferedTelemetry(now: () => number = Date.now): Telemetry & { readonly entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return { entries, log: (entry) => void entries.push({ timestamp: now(), ...entry }) };
}

export const createNullTelemetry = (): Telemetry => ({ log: () => undefined });

// -------------------------------------------------------------------------
// Event builders shared by the Room. Every event carries the §16 context:
// rules/matrix version, series & match scores, player count, phase, streak.
// -------------------------------------------------------------------------

/** Context block attached to every in-game event. */
export function contextOf(state: GameState): Record<string, unknown> {
  return {
    seriesId: state.series.seriesId,
    matchId: state.match.matchId,
    roundId: state.round.roundId,
    turnId: state.turn?.turnId ?? null,
    rulesVersion: state.series.rulesVersion,
    matrixVersion: state.series.matrixVersion,
    playerCount: state.round.survivorIds.length,
    lobbySize: state.series.lobby.length,
    phase: state.round.phase,
    noEliminationStreak: state.round.noEliminationStreak,
    matchWins: state.series.matchWins,
  };
}

export interface TurnLogInput {
  /** State at the moment the turn was resolved (its open turn). */
  readonly before: GameState;
  readonly after: GameState;
  readonly revealed: readonly PublicAction[];
  readonly result: ResolveTurnResult;
}

/** Emits everything that follows a resolved turn: reveal, outcomes, collisions, eliminations and transitions. */
export function logTurnOutcome(tel: Telemetry, { before, after, revealed, result }: TurnLogInput): void {
  const ctx = contextOf(before);
  const { outcome, events } = result;

  tel.log({
    type: 'turn_revealed',
    ...ctx,
    actions: revealed.map((a) => ({
      playerId: a.playerId,
      kind: a.kind,
      actionId: a.kind === 'ATTACK' ? a.weapon : a.kind === 'DEFENSE' ? a.defense : 'CHARGE',
      targets: a.kind === 'ATTACK' ? a.targets : [],
      timedOut: a.timedOut,
    })),
    costDeltas: outcome.playerResults.map((r) => ({
      playerId: r.playerId,
      chargeBefore: r.chargeBefore,
      chargeAfter: r.chargeAfter,
      delta: r.chargeAfter - r.chargeBefore,
    })),
  });

  for (const e of events) {
    const common = {
      ...ctx,
      eventOrderKey: e.orderKey,
      sourcePlayerId: e.sourcePlayerId,
      weapon: e.sourceWeapon,
      targetPlayerId: e.selectedTargetId,
      effectTargetSet: e.effectTargetSet,
      targetAction: e.targetAction,
      ruleId: e.ruleId,
      resultCode: e.matrixResult ?? e.outcome,
      outcome: e.outcome,
      eliminationMarks: e.eliminationMarks,
    };
    tel.log({ type: e.ruleType === 'COLLISION' ? 'attack_collision' : 'matrix_outcome', ...common });
  }

  for (const playerId of outcome.eliminatedPlayerIds) {
    tel.log({
      type: 'elimination',
      ...ctx,
      playerId,
      causes: events.filter((e) => e.eliminationMarks.includes(playerId)).map((e) => e.ruleId),
    });
  }

  if (outcome.phaseChange) {
    tel.log({ type: 'phase_changed', ...ctx, from: outcome.phaseChange.from, to: outcome.phaseChange.to });
  }

  if (outcome.eliminatedPlayerIds.length > 0) {
    tel.log({
      type: 'round_ended',
      ...ctx,
      transition: outcome.transition,
      eliminatedPlayerIds: outcome.eliminatedPlayerIds,
      survivorIds: outcome.survivorIds,
      turnsInRound: before.round.turnIndex,
    });
  }

  if (outcome.transition === 'MATCH_ENDED' || outcome.transition === 'SERIES_ENDED') {
    tel.log({
      type: 'match_ended',
      ...ctx,
      winnerId: outcome.matchWinnerId,
      matchWins: after.series.matchWins,
      roundsInMatch: before.match.roundIndex,
    });
  }
  if (outcome.transition === 'MATCH_ENDED') {
    tel.log({ type: 'match_started', ...contextOf(after) });
  }
  if (outcome.transition === 'SERIES_ENDED') {
    tel.log({ type: 'series_ended', ...ctx, winnerId: after.series.winnerId, matchWins: after.series.matchWins });
  }
}

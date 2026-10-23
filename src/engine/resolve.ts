/**
 * §10 RESOLVE + APPLY + COMPLETE: the pure turn resolver.
 *
 * `resolveTurn` reads one immutable snapshot, evaluates every (attack, target)
 * interaction against it, unions the elimination marks, and only then builds
 * the next state. Nothing is mutated mid-resolution, so action order cannot
 * influence the result.
 */
import { ATTACKS } from './catalog';
import { resolveAttackPair } from './collision';
import { MAX_CHARGE } from './constants';
import { EngineError } from './errors';
import { deepFreeze } from './freeze';
import { actionCost, resolveEffectTargets, validateAction } from './legality';
import { nextStreaks, openTurn, startRound } from './lifecycle';
import { lookupMatrix, matrixCellEffect } from './matrix';
import { phaseFor } from './phase';
import type {
  Action,
  ActionRef,
  AttackAction,
  ConnectionStatus,
  GameState,
  PlayerId,
  PlayerState,
  PlayerTurnResult,
  ResolutionEvent,
  ResolveTurnResult,
  Round,
  TurnOutcome,
  TurnTransition,
} from './types';

const refOf = (action: Action): ActionRef => {
  switch (action.kind) {
    case 'CHARGE':
      return { kind: 'CHARGE' };
    case 'ATTACK':
      return { kind: 'ATTACK', weapon: action.weapon };
    case 'DEFENSE':
      return { kind: 'DEFENSE', defense: action.defense };
  }
};

type InteractionResult = Pick<
  ResolutionEvent,
  'targetAction' | 'ruleType' | 'ruleId' | 'matrixResult' | 'outcome' | 'eliminationMarks'
>;

/**
 * One attacker against one selected target, using the target's locked action:
 *  - Charging target: eliminated (§3, §17 audit finding).
 *  - Defending target: matrix lookup (§5).
 *  - Attacking target: attack-versus-attack collision (§6), but ONLY when the
 *    target is attacking the attacker back (`aimedBack`: mutual targeting).
 *    Rules v1.1: a target attacking somebody else has no defense against this
 *    attacker, so it is eliminated just like a Charging target.
 */
function resolveInteraction(attackerId: PlayerId, attack: AttackAction, targetId: PlayerId, target: Action, aimedBack: boolean): InteractionResult {
  const targetAction = refOf(target);

  switch (target.kind) {
    case 'CHARGE':
      return {
        targetAction,
        ruleType: 'CHARGE_HIT',
        ruleId: 'CHARGE_HIT',
        matrixResult: null,
        outcome: 'TARGET_ELIMINATED',
        eliminationMarks: [targetId],
      };

    case 'DEFENSE': {
      const cell = lookupMatrix(attack.weapon, target.defense);
      const effect = matrixCellEffect(cell);
      return {
        targetAction,
        ruleType: 'MATRIX',
        ruleId: `MATRIX_V2:${attack.weapon}:${target.defense}`,
        matrixResult: cell,
        outcome: effect,
        eliminationMarks:
          effect === 'TARGET_ELIMINATED' ? [targetId] : effect === 'ATTACKER_ELIMINATED' ? [attackerId] : [],
      };
    }

    case 'ATTACK': {
      if (!aimedBack) {
        return {
          targetAction,
          ruleType: 'UNGUARDED',
          ruleId: 'UNGUARDED_ATTACKER',
          matrixResult: null,
          outcome: 'TARGET_ELIMINATED',
          eliminationMarks: [targetId],
        };
      }
      const collision = resolveAttackPair(attack.weapon, target.weapon);
      const base = { targetAction, ruleType: 'COLLISION', ruleId: `COLLISION:${collision.ruleId}`, matrixResult: null } as const;
      if (collision.loser === 'A') return { ...base, outcome: 'ATTACKER_ELIMINATED', eliminationMarks: [attackerId] };
      if (collision.loser === 'B') return { ...base, outcome: 'TARGET_ELIMINATED', eliminationMarks: [targetId] };
      return { ...base, outcome: 'NEUTRALIZED', eliminationMarks: [] };
    }
  }
}

function assertResolvable(state: GameState, living: readonly PlayerId[], locked: Readonly<Record<PlayerId, Action>>): void {
  if (state.series.status === 'COMPLETE' || !state.turn) {
    throw new EngineError('SERIES_COMPLETE', 'The series is complete; there is no turn to resolve');
  }
  for (const playerId of Object.keys(locked)) {
    if (!living.includes(playerId)) {
      throw new EngineError('UNEXPECTED_ACTION', `Action supplied for ${playerId}, who is not a living player`);
    }
  }
  for (const playerId of living) {
    const action = Object.hasOwn(locked, playerId) ? locked[playerId] : undefined;
    if (!action) throw new EngineError('MISSING_ACTION', `No locked action for living player ${playerId}`);
    if (action.playerId !== playerId) {
      throw new EngineError('INVALID_ACTION', `Action filed under ${playerId} belongs to ${action.playerId}`);
    }
    const verdict = validateAction(state, action);
    if (!verdict.ok) {
      throw new EngineError('INVALID_ACTION', `Illegal action by ${playerId}: ${verdict.code} - ${verdict.message}`);
    }
  }
}

/**
 * Resolves one turn.
 *
 * @param state          Authoritative state with an open turn.
 * @param lockedActions  One accepted, legal action per living player (see `lockTurn`).
 *
 * Lifecycle after resolution (§2, §10 COMPLETE, §15):
 *  - collisions: only between players attacking each other; an attacker hit by a third party it is not attacking is eliminated;
 *  - no elimination: the next turn opens, streak + 1, phase re-evaluated;
 *  - elimination, 2+ survivors: new round, survivors at 0 Charge;
 *  - elimination, 1 survivor: that player earns a Match Win; at
 *    `series.seriesWinTarget` the series ends, otherwise a new match starts with the
 *    full lobby;
 *  - elimination, 0 survivors: the GDD does not define this case (it only
 *    arises with 3+ players). The engine voids the round and restarts it with
 *    the same living roster at 0 Charge, so there is neither a draw nor a
 *    winner. The events still record every elimination mark.
 *
 * @throws EngineError when the input violates the contract (missing, extra or illegal actions).
 */
export function resolveTurn(state: GameState, lockedActions: Readonly<Record<PlayerId, Action>>): ResolveTurnResult {
  const living = state.series.lobby.filter((id) => state.players[id]?.alive);
  assertResolvable(state, living, lockedActions);
  const turn = state.turn!;
  const actionOf = (id: PlayerId): Action => lockedActions[id]!;

  // ---- RESOLVE: every interaction against the one snapshot -----------------
  const events: ResolutionEvent[] = [];
  const marks = new Set<PlayerId>();
  // Who each attacker's weapon is aimed at (the §7 effect target set), for mutual-targeting checks.
  const aimsAt = new Map<PlayerId, readonly PlayerId[]>();
  for (const id of living) {
    const a = actionOf(id);
    if (a.kind === 'ATTACK') aimsAt.set(id, resolveEffectTargets(ATTACKS[a.weapon], id, a.targets, living));
  }
  for (const attackerId of living) {
    const attack = actionOf(attackerId);
    if (attack.kind !== 'ATTACK') continue;
    const effectTargets = resolveEffectTargets(ATTACKS[attack.weapon], attackerId, attack.targets, living);
    for (const targetId of effectTargets) {
      const aimedBack = aimsAt.get(targetId)?.includes(attackerId) ?? false;
      const result = resolveInteraction(attackerId, attack, targetId, actionOf(targetId), aimedBack);
      events.push({
        orderKey: events.length,
        turnId: turn.turnId,
        sourcePlayerId: attackerId,
        sourceWeapon: attack.weapon,
        selectedTargetId: targetId,
        effectTargetSet: effectTargets,
        ...result,
      });
      for (const mark of result.eliminationMarks) marks.add(mark);
    }
  }

  // ---- APPLY: costs and gains, then all eliminations at once ----------------
  const eliminatedIds = living.filter((id) => marks.has(id));
  const survivorIds = living.filter((id) => !marks.has(id));

  const playerResults: PlayerTurnResult[] = living.map((playerId) => {
    const action = actionOf(playerId);
    const chargeBefore = state.players[playerId]!.charge;
    const gain = action.kind === 'CHARGE' ? 1 : 0;
    return {
      playerId,
      action: refOf(action),
      chargeBefore,
      chargeAfter: Math.min(MAX_CHARGE, chargeBefore - actionCost(action) + gain),
      eliminated: marks.has(playerId),
    };
  });
  const chargeAfter = new Map(playerResults.map((r) => [r.playerId, r.chargeAfter]));

  const streak = eliminatedIds.length > 0 ? 0 : state.round.noEliminationStreak + 1;
  const turnSummary = {
    seriesId: state.series.seriesId,
    matchId: state.match.matchId,
    roundId: state.round.roundId,
    turnId: turn.turnId,
    phase: turn.phase,
    playerResults,
    eliminatedPlayerIds: eliminatedIds,
    survivorIds,
    noEliminationStreak: streak,
  };

  const connection: Record<PlayerId, ConnectionStatus> = {};
  for (const id of state.series.lobby) connection[id] = state.players[id]!.connectionStatus;

  const finish = (
    nextState: GameState,
    transition: TurnTransition,
    matchWinnerId: PlayerId | null,
    seriesWinnerId: PlayerId | null,
  ): ResolveTurnResult => {
    const nextPhase = nextState.turn ? nextState.turn.phase : null;
    const outcome: TurnOutcome = {
      ...turnSummary,
      transition,
      matchWinnerId,
      seriesWinnerId,
      phaseChange: nextPhase !== null && nextPhase !== turn.phase ? { from: turn.phase, to: nextPhase } : null,
    };
    return deepFreeze({ nextState, events, outcome });
  };

  // ---- COMPLETE: advance the turn / round / match / series -----------------
  if (eliminatedIds.length === 0) {
    const round: Round = {
      ...state.round,
      turnIndex: state.round.turnIndex + 1,
      noEliminationStreak: streak,
      phase: phaseFor(living.length, streak),
    };
    const players: Record<PlayerId, PlayerState> = { ...state.players };
    for (const id of living) players[id] = { ...state.players[id]!, charge: chargeAfter.get(id)! };
    return finish({ ...state, round, players, turn: openTurn(round, living) }, 'NEXT_TURN', null, null);
  }

  const nextRoundIndex = state.match.roundIndex + 1;

  if (survivorIds.length === 0) {
    const restarted = startRound({
      series: state.series,
      matchIndex: state.match.matchIndex,
      roundIndex: nextRoundIndex,
      aliveIds: living,
      matchWins: state.series.matchWins,
      connection,
    });
    return finish(restarted, 'ROUND_RESTARTED_NO_SURVIVORS', null, null);
  }

  if (survivorIds.length > 1) {
    const nextRound = startRound({
      series: state.series,
      matchIndex: state.match.matchIndex,
      roundIndex: nextRoundIndex,
      aliveIds: survivorIds,
      matchWins: state.series.matchWins,
      connection,
    });
    return finish(nextRound, 'NEXT_ROUND', null, null);
  }

  // Exactly one survivor: match over.
  const winnerId = survivorIds[0]!;
  const matchWins = { ...state.series.matchWins, [winnerId]: (state.series.matchWins[winnerId] ?? 0) + 1 };
  const matchStreaks = nextStreaks(state.series.lobby, state.series.matchStreaks, winnerId);

  if (matchWins[winnerId]! >= state.series.seriesWinTarget) {
    const players: Record<PlayerId, PlayerState> = {};
    for (const id of state.series.lobby) {
      const before = state.players[id]!;
      players[id] = {
        ...before,
        alive: id === winnerId,
        charge: chargeAfter.get(id) ?? before.charge,
        matchWins: matchWins[id] ?? 0,
        currentMatchStreak: matchStreaks[id] ?? 0,
      };
    }
    const complete: GameState = {
      series: { ...state.series, status: 'COMPLETE', matchWins, matchStreaks, winnerId },
      match: { ...state.match, status: 'COMPLETE', winnerId },
      round: {
        ...state.round,
        survivorIds,
        noEliminationStreak: 0,
        phase: 'NORMAL',
        status: 'COMPLETE',
      },
      players,
      turn: null,
    };
    return finish(complete, 'SERIES_ENDED', winnerId, winnerId);
  }

  const nextMatch = startRound({
    series: { ...state.series, matchStreaks },
    matchIndex: state.match.matchIndex + 1,
    roundIndex: 1,
    aliveIds: state.series.lobby.filter((id) => !state.series.departed.includes(id)),
    matchWins,
    connection,
  });
  return finish(nextMatch, 'MATCH_ENDED', winnerId, null);
}

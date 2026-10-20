/**
 * A player quitting mid-series. The quitter is eliminated at once and sits out the rest of the
 * series; the others continue without waiting for a commit window. This reuses the elimination
 * lifecycle of `resolveTurn` (§15): 2+ survivors start a new round at 0 Charge, one survivor wins the
 * match, and a series ends early when only one participant is left. It is not a turn, so there is
 * no resolution event; the server announces it separately.
 */
import type { ConnectionStatus } from './types';
import { deepFreeze } from './freeze';
import { nextStreaks, startRound } from './lifecycle';
import type { GameState, PlayerId, PlayerState } from './types';

export type ForfeitTransition = 'NONE' | 'NEXT_ROUND' | 'MATCH_ENDED' | 'SERIES_ENDED';

export interface ForfeitResult {
  readonly state: GameState;
  readonly transition: ForfeitTransition;
  /** The player awarded a Match Win by the departure (only for `MATCH_ENDED`, or `SERIES_ENDED` by reaching the target). */
  readonly matchWinnerId: PlayerId | null;
  readonly seriesWinnerId: PlayerId | null;
  /** Players eliminated by this call (the quitters who were still alive). */
  readonly eliminatedIds: readonly PlayerId[];
}

const none = (state: GameState): ForfeitResult => ({ state, transition: 'NONE', matchWinnerId: null, seriesWinnerId: null, eliminatedIds: [] });

export function forfeitPlayers(state: GameState, ids: readonly PlayerId[]): ForfeitResult {
  if (state.series.status === 'COMPLETE' || !state.turn) return none(state);
  const leaving = [...new Set(ids)].filter((id) => state.series.lobby.includes(id) && !state.series.departed.includes(id));
  if (leaving.length === 0) return none(state);

  const series = { ...state.series, departed: [...state.series.departed, ...leaving] };
  const lobby = series.lobby;
  const living = lobby.filter((id) => state.players[id]?.alive);
  const eliminatedIds = living.filter((id) => leaving.includes(id));
  const survivors = living.filter((id) => !leaving.includes(id));
  const participants = lobby.filter((id) => !series.departed.includes(id));
  const connection: Record<PlayerId, ConnectionStatus> = {};
  for (const id of lobby) connection[id] = state.players[id]!.connectionStatus;

  const complete = (winnerId: PlayerId | null, matchWins: Readonly<Record<PlayerId, number>>, matchStreaks = series.matchStreaks): GameState => {
    const players: Record<PlayerId, PlayerState> = {};
    for (const id of lobby) players[id] = { ...state.players[id]!, alive: id === winnerId, matchWins: matchWins[id] ?? 0, currentMatchStreak: matchStreaks[id] ?? 0 };
    return deepFreeze({
      series: { ...series, status: 'COMPLETE' as const, matchWins, matchStreaks, winnerId },
      match: { ...state.match, status: 'COMPLETE', winnerId },
      round: { ...state.round, survivorIds: winnerId ? [winnerId] : [], noEliminationStreak: 0, phase: 'NORMAL', status: 'COMPLETE' },
      players,
      turn: null,
    });
  };

  // Only one participant is left in the whole series: they win it by forfeit (no Match Win awarded).
  if (participants.length <= 1) {
    const winner = participants[0] ?? null;
    return { state: complete(winner, series.matchWins), transition: 'SERIES_ENDED', matchWinnerId: null, seriesWinnerId: winner, eliminatedIds };
  }

  // The quitters were already out of this match: just remember they have left.
  if (eliminatedIds.length === 0) return none(deepFreeze({ ...state, series }));

  const nextMatch = (matchWins: Readonly<Record<PlayerId, number>>, matchStreaks = series.matchStreaks): GameState =>
    startRound({ series: { ...series, matchStreaks }, matchIndex: state.match.matchIndex + 1, roundIndex: 1, aliveIds: participants, matchWins, connection });

  if (survivors.length >= 2) {
    const next = startRound({ series, matchIndex: state.match.matchIndex, roundIndex: state.match.roundIndex + 1, aliveIds: survivors, matchWins: series.matchWins, connection });
    return { state: next, transition: 'NEXT_ROUND', matchWinnerId: null, seriesWinnerId: null, eliminatedIds };
  }

  if (survivors.length === 1) {
    const winnerId = survivors[0]!;
    const matchWins = { ...series.matchWins, [winnerId]: (series.matchWins[winnerId] ?? 0) + 1 };
    const matchStreaks = nextStreaks(lobby, series.matchStreaks, winnerId);
    if (matchWins[winnerId]! >= series.seriesWinTarget) {
      return { state: complete(winnerId, matchWins, matchStreaks), transition: 'SERIES_ENDED', matchWinnerId: winnerId, seriesWinnerId: winnerId, eliminatedIds };
    }
    return { state: nextMatch(matchWins, matchStreaks), transition: 'MATCH_ENDED', matchWinnerId: winnerId, seriesWinnerId: null, eliminatedIds };
  }

  // Every living player quit: nobody wins the match; a fresh match starts for those who remain.
  return { state: nextMatch(series.matchWins), transition: 'MATCH_ENDED', matchWinnerId: null, seriesWinnerId: null, eliminatedIds };
}

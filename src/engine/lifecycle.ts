/** Construction of series / match / round / turn state (§2, §15). */
import { DEFAULT_GAME_MODE, GAME_MODES, type GameMode } from './constants';
import { MATRIX_VERSION, MAX_PLAYERS, MIN_PLAYERS, RULES_VERSION, SERIES_WIN_TARGET, SERIES_WIN_TARGET_OPTIONS } from './constants';
import { EngineError } from './errors';
import { deepFreeze } from './freeze';
import { phaseFor } from './phase';
import type {
  ConnectionStatus,
  GameState,
  Match,
  PlayerId,
  PlayerState,
  Round,
  Series,
  Turn,
} from './types';

export const matchIdOf = (seriesId: string, matchIndex: number): string => `${seriesId}:m${matchIndex}`;
export const roundIdOf = (matchId: string, roundIndex: number): string => `${matchId}:r${roundIndex}`;
export const turnIdOf = (roundId: string, turnIndex: number): string => `${roundId}:t${turnIndex}`;

/** §10 OPEN: snapshot the living roster and phase into a new turn. */
export function openTurn(round: Round, livingIds: readonly PlayerId[]): Turn {
  return {
    turnId: turnIdOf(round.roundId, round.turnIndex),
    roundId: round.roundId,
    phase: round.phase,
    eligiblePlayerIds: [...livingIds],
    deadlineAt: null,
    lockStatus: 'OPEN',
  };
}

/**
 * "On Fire" tracking: when a match is won, the winner's streak goes up by one and every other
 * player's resets to 0 immediately.
 */
export function nextStreaks(lobby: readonly PlayerId[], previous: Readonly<Record<PlayerId, number>>, winnerId: PlayerId): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  for (const id of lobby) out[id] = id === winnerId ? (previous[id] ?? 0) + 1 : 0;
  return out;
}

export interface RoundStart {
  readonly series: Series;
  readonly matchIndex: number;
  readonly roundIndex: number;
  /** Players alive at the start of the round; everyone else sits out. */
  readonly aliveIds: readonly PlayerId[];
  readonly matchWins: Readonly<Record<PlayerId, number>>;
  readonly connection: Readonly<Record<PlayerId, ConnectionStatus>>;
  /** Charges carried into the new round (SNOWBALL survivors). Omitted = everyone starts at 0 (§15). */
  readonly charges?: Readonly<Record<PlayerId, number>>;
}

/**
 * Builds the state at the start of a round: every participant at 0 Charge,
 * round-local counters reset, Normal Phase (§15). Used for the first round of
 * a series, every later round, and every later match (which passes the whole
 * lobby as `aliveIds`).
 */
export function startRound(start: RoundStart): GameState {
  const { series: base, matchIndex, roundIndex, aliveIds, matchWins, connection, charges } = start;
  const matchId = matchIdOf(base.seriesId, matchIndex);
  const roundId = roundIdOf(matchId, roundIndex);
  const alive = new Set(aliveIds);

  const series: Series = {
    ...base,
    status: 'IN_PROGRESS',
    matchWins,
    currentMatchId: matchId,
    matchIndex,
    winnerId: null,
  };
  const match: Match = {
    matchId,
    seriesId: base.seriesId,
    matchIndex,
    status: 'IN_PROGRESS',
    currentRoundId: roundId,
    roundIndex,
    winnerId: null,
  };
  const livingInOrder = base.lobby.filter((id) => alive.has(id));
  const round: Round = {
    roundId,
    matchId,
    roundIndex,
    survivorIds: livingInOrder,
    turnIndex: 1,
    phase: phaseFor(livingInOrder.length, 0),
    noEliminationStreak: 0,
    status: 'IN_PROGRESS',
  };

  const players: Record<PlayerId, PlayerState> = {};
  for (const playerId of base.lobby) {
    players[playerId] = {
      playerId,
      alive: alive.has(playerId),
      charge: alive.has(playerId) ? (charges?.[playerId] ?? 0) : 0,
      matchWins: matchWins[playerId] ?? 0,
      currentMatchStreak: base.matchStreaks[playerId] ?? 0,
      connectionStatus: connection[playerId] ?? 'CONNECTED',
    };
  }

  return deepFreeze({ series, match, round, players, turn: openTurn(round, livingInOrder) });
}

export interface CreateSeriesConfig {
  readonly seriesId: string;
  /** 2-8 distinct player ids, in seat order. */
  readonly playerIds: readonly PlayerId[];
  /** Match Wins needed to win the series; defaults to `SERIES_WIN_TARGET`. */
  readonly seriesWinTarget?: number;
  /** Resource paradigm; defaults to STANDARD. */
  readonly gameMode?: GameMode;
}

/** §2: begins a series with the full lobby alive, first round at 0 Charge, Normal Phase. */
export function createSeries(config: CreateSeriesConfig): GameState {
  const { seriesId, playerIds, seriesWinTarget = SERIES_WIN_TARGET, gameMode = DEFAULT_GAME_MODE } = config;
  if (!(GAME_MODES as readonly string[]).includes(gameMode)) throw new EngineError('INVALID_LOBBY', `Unknown game mode ${String(gameMode)}`);
  if (!(SERIES_WIN_TARGET_OPTIONS as readonly number[]).includes(seriesWinTarget)) {
    throw new EngineError('INVALID_LOBBY', `Series win target must be one of ${SERIES_WIN_TARGET_OPTIONS.join(', ')}, got ${seriesWinTarget}`);
  }
  if (playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
    throw new EngineError('INVALID_LOBBY', `Lobby must have ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${playerIds.length}`);
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new EngineError('INVALID_LOBBY', 'Lobby player ids must be distinct');
  }

  const matchWins: Record<PlayerId, number> = {};
  for (const id of playerIds) matchWins[id] = 0;

  const series: Series = {
    seriesId,
    rulesVersion: RULES_VERSION,
    matrixVersion: MATRIX_VERSION,
    lobby: [...playerIds],
    status: 'IN_PROGRESS',
    matchWins,
    seriesWinTarget,
    gameMode,
    matchStreaks: Object.fromEntries(playerIds.map((id) => [id, 0])),
    departed: [],
    currentMatchId: matchIdOf(seriesId, 1),
    matchIndex: 1,
    winnerId: null,
  };
  return startRound({
    series,
    matchIndex: 1,
    roundIndex: 1,
    aliveIds: playerIds,
    matchWins,
    connection: {},
  });
}

/** Stamps the commit deadline on the open turn. The engine has no clock; the server supplies one. */
export function setTurnDeadline(state: GameState, deadlineAt: number | null): GameState {
  if (!state.turn) throw new EngineError('SERIES_COMPLETE', 'No open turn');
  return deepFreeze({ ...state, turn: { ...state.turn, deadlineAt } });
}

export function setConnectionStatus(
  state: GameState,
  playerId: PlayerId,
  connectionStatus: ConnectionStatus,
): GameState {
  const player = state.players[playerId];
  if (!player) throw new EngineError('INVALID_ACTION', `Unknown player ${playerId}`);
  return deepFreeze({
    ...state,
    players: { ...state.players, [playerId]: { ...player, connectionStatus } },
  });
}

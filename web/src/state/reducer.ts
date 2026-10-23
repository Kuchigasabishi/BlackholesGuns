/**
 * Pure client state. The server is authoritative; this only mirrors what the
 * server has told THIS player (public state plus their own private view).
 */
import { ATTACKS, MULTI_TARGET_LIMIT, type ActionAvailability, type GameState, type Phase, type PlayerId } from '../../../src/engine';
import type { Choice } from '../net/store';
import type {
  ActionPayload,
  LobbyView,
  PublicAction,
  SessionView,
  TurnOpenPayload,
  TurnResultPayload,
} from '../../../src/server/protocol';
import { describeTurn, type NameOf, type TurnLog } from '../format/describeTurn';

export interface Session {
  readonly roomCode: string;
  readonly playerId: PlayerId;
  readonly playerToken: string;
}

export type Stage = 'NONE' | 'COMMIT' | 'LOCKED' | 'BETWEEN_TURNS';

export interface OpenTurn {
  readonly turnId: string;
  readonly turnIndex: number;
  readonly phase: Phase;
  readonly eligiblePlayerIds: readonly PlayerId[];
  readonly deadlineAt: number | null;
  /** server clock minus client clock, so countdowns are right even if the local clock is off. */
  readonly clockSkewMs: number;
}

export interface ClientState {
  readonly connection: 'connecting' | 'connected' | 'disconnected';
  readonly session: Session | null;
  readonly lobby: LobbyView | null;
  readonly game: GameState | null;
  readonly turn: OpenTurn | null;
  readonly stage: Stage;
  readonly availability: ActionAvailability | null;
  readonly lockedPlayerIds: readonly PlayerId[];
  readonly ownCommit: ActionPayload | null;
  readonly lastResult: TurnResultPayload | null;
  /** The just-revealed actions, shown on the roster until the next turn opens. */
  readonly revealed: readonly PublicAction[] | null;
  readonly log: readonly TurnLog[];
  /** Set when a phase begins so the UI can warn once (§13). */
  readonly phaseNotice: Phase | null;
  /** The action the local player has picked but not locked in yet (targets are picked by clicking player cards). */
  readonly selection: Choice | null;
  /** The turn whose Turn Resolution popup the player has closed (so it does not reopen). */
  readonly resolutionDismissed: string | null;
  readonly seriesEnd: { readonly winnerId: PlayerId | null; readonly matchWins: Readonly<Record<PlayerId, number>> } | null;
  readonly error: string | null;
  readonly notice: string | null;
}

export const initialState: ClientState = {
  connection: 'connecting',
  session: null,
  lobby: null,
  game: null,
  turn: null,
  stage: 'NONE',
  availability: null,
  lockedPlayerIds: [],
  ownCommit: null,
  lastResult: null,
  revealed: null,
  log: [],
  phaseNotice: null,
  selection: null,
  resolutionDismissed: null,
  seriesEnd: null,
  error: null,
  notice: null,
};

export type ClientAction =
  | { type: 'connection'; status: ClientState['connection'] }
  | { type: 'session'; session: Session | null }
  | { type: 'snapshot'; view: SessionView; receivedAt: number }
  | { type: 'lobby'; lobby: LobbyView }
  | { type: 'gameStarted'; lobby: LobbyView; state: GameState }
  | { type: 'turnOpen'; payload: TurnOpenPayload; receivedAt: number }
  | { type: 'turnPrivate'; turnId: string; availability: ActionAvailability }
  | { type: 'progress'; turnId: string; lockedPlayerIds: readonly PlayerId[] }
  | { type: 'locked'; turnId: string }
  | { type: 'result'; payload: TurnResultPayload }
  | { type: 'stateSync'; state: GameState }
  | { type: 'playerConnection'; playerId: PlayerId; status: 'CONNECTED' | 'DISCONNECTED' }
  | { type: 'seriesEnded'; winnerId: PlayerId | null; matchWins: Readonly<Record<PlayerId, number>> }
  | { type: 'committed'; turnId: string; action: ActionPayload }
  | { type: 'roomClosed' }
  | { type: 'error'; message: string | null }
  | { type: 'notice'; message: string | null }
  | { type: 'dismissPhaseNotice' }
  | { type: 'seriesAcknowledged' }
  | { type: 'resolutionDismissed'; turnId: string }
  | { type: 'selectChoice'; choice: Choice }
  | { type: 'toggleTarget'; playerId: PlayerId }
  | { type: 'clearSelection' }
  | { type: 'seriesAborted'; notice: string }
  | { type: 'reset' };

/** Opponents of the local player who are still alive: the only valid targets. */
export const livingOpponents = (state: Pick<ClientState, 'game' | 'session'>): PlayerId[] =>
  state.game ? state.game.series.lobby.filter((id) => id !== state.session?.playerId && state.game!.players[id]?.alive) : [];

export const nameLookup = (state: Pick<ClientState, 'lobby'>): NameOf => {
  const names = new Map((state.lobby?.players ?? []).map((p) => [p.playerId, p.displayName]));
  return (id) => names.get(id) ?? id;
};

export const myPlayerId = (state: ClientState): PlayerId | null => state.session?.playerId ?? null;

const toOpenTurn = (p: TurnOpenPayload, receivedAt: number): OpenTurn => ({
  turnId: p.turnId,
  turnIndex: p.turnIndex,
  phase: p.phase,
  eligiblePlayerIds: p.eligiblePlayerIds,
  deadlineAt: p.deadlineAt,
  clockSkewMs: p.serverTime - receivedAt,
});

const phaseWarning = (from: Phase | undefined, to: Phase): Phase | null =>
  to !== 'NORMAL' && from !== to ? to : null;

export function reducer(state: ClientState, action: ClientAction): ClientState {
  switch (action.type) {
    case 'connection':
      return { ...state, connection: action.status };

    case 'session':
      return { ...state, session: action.session };

    case 'snapshot': {
      const { view } = action;
      const lobbyState = { ...state, lobby: view.lobby };
      const names = nameLookup(lobbyState);
      const t = view.turn;
      const log = view.lastResult && state.log.length === 0 ? [describeTurn(view.lastResult, names, state.session?.playerId ?? null)] : state.log;
      return {
        ...lobbyState,
        game: view.state,
        turn:
          t && view.state?.turn
            ? {
                turnId: t.turnId,
                turnIndex: view.state.round.turnIndex,
                phase: view.state.turn.phase,
                eligiblePlayerIds: view.state.turn.eligiblePlayerIds,
                deadlineAt: t.deadlineAt,
                clockSkewMs: view.serverTime - action.receivedAt,
              }
            : null,
        stage: t ? t.stage : 'NONE',
        availability: t?.availability ?? null,
        lockedPlayerIds: t?.lockedPlayerIds ?? [],
        ownCommit: t?.ownCommit?.action ?? null,
        selection: null,
        lastResult: view.lastResult,
        revealed: t?.stage === 'BETWEEN_TURNS' && view.lastResult ? view.lastResult.actions : null,
        log,
        error: null,
      };
    }

    case 'lobby': {
      // The server sends a finished series back to the waiting lobby: drop every live-play
      // field so the lobby (and host controls) show, but keep the final result for the
      // "Series over" overlay until the player acknowledges it.
      if (action.lobby.status === 'LOBBY' && state.game) {
        return { ...state, lobby: action.lobby, turn: null, stage: 'NONE', availability: null, lockedPlayerIds: [], ownCommit: null, phaseNotice: null };
      }
      return { ...state, lobby: action.lobby };
    }

    case 'seriesAborted':
      return {
        ...state,
        game: null,
        turn: null,
        stage: 'NONE',
        availability: null,
        lockedPlayerIds: [],
        ownCommit: null,
        selection: null,
        lastResult: null,
        revealed: null,
        log: [],
        phaseNotice: null,
        resolutionDismissed: null,
        seriesEnd: null,
        notice: action.notice,
      };

    case 'selectChoice': {
      let choice = action.choice;
      if (choice.kind === 'ATTACK') {
        const mode = ATTACKS[choice.weapon].targetMode;
        const foes = livingOpponents(state);
        if (mode === 'SINGLE' && foes.length === 1) choice = { ...choice, targets: [foes[0]!] };
        if (mode === 'ALL_OPPONENTS') choice = { ...choice, targets: [] };
      }
      return { ...state, selection: choice };
    }

    case 'toggleTarget': {
      const choice = state.selection;
      if (!choice || choice.kind !== 'ATTACK' || !livingOpponents(state).includes(action.playerId)) return state;
      const mode = ATTACKS[choice.weapon].targetMode;
      if (mode === 'ALL_OPPONENTS') return state;
      const has = choice.targets.includes(action.playerId);
      let targets: PlayerId[];
      if (mode === 'SINGLE') targets = [action.playerId];
      else if (has) targets = choice.targets.filter((t) => t !== action.playerId);
      else targets = choice.targets.length >= MULTI_TARGET_LIMIT ? [...choice.targets] : [...choice.targets, action.playerId];
      return { ...state, selection: { ...choice, targets } };
    }

    case 'clearSelection':
      return state.selection === null ? state : { ...state, selection: null };

    case 'resolutionDismissed':
      return { ...state, resolutionDismissed: action.turnId };

    case 'seriesAcknowledged':
      return { ...state, game: null, lastResult: null, revealed: null, seriesEnd: null, log: [] };

    case 'gameStarted':
      return { ...state, lobby: action.lobby, game: action.state, log: [], lastResult: null, seriesEnd: null, selection: null };

    case 'turnOpen': {
      const open = toOpenTurn(action.payload, action.receivedAt);
      const previousPhase = state.turn?.phase ?? state.game?.round.phase;
      return {
        ...state,
        turn: open,
        stage: 'COMMIT',
        availability: null,
        lockedPlayerIds: action.payload.turnId === state.turn?.turnId ? state.lockedPlayerIds : [],
        ownCommit: action.payload.turnId === state.turn?.turnId ? state.ownCommit : null,
        revealed: null,
        selection: action.payload.turnId === state.turn?.turnId ? state.selection : null,
        phaseNotice: phaseWarning(previousPhase, open.phase) ?? state.phaseNotice,
      };
    }

    case 'turnPrivate':
      return state.turn?.turnId === action.turnId ? { ...state, availability: action.availability } : state;

    case 'progress':
      return state.turn?.turnId === action.turnId ? { ...state, lockedPlayerIds: action.lockedPlayerIds } : state;

    case 'locked':
      return state.turn?.turnId === action.turnId ? { ...state, stage: 'LOCKED' } : state;

    case 'result': {
      const names = nameLookup(state);
      return {
        ...state,
        game: action.payload.state,
        lastResult: action.payload,
        revealed: action.payload.actions,
        stage: action.payload.state.series.status === 'COMPLETE' ? 'NONE' : 'BETWEEN_TURNS',
        availability: null,
        ownCommit: null,
        selection: null,
        lockedPlayerIds: [],
        log: [...state.log, describeTurn(action.payload, names, state.session?.playerId ?? null)],
      };
    }

    case 'stateSync':
      return {
        ...state,
        game: action.state,
        selection: null, // the roster may have changed (someone quit): pick again
        // Cached availability may belong to the old state; the panel recomputes from the new one until the server's arrives.
        availability: null,
        turn: state.turn && action.state.turn ? { ...state.turn, phase: action.state.turn.phase } : state.turn,
        phaseNotice: phaseWarning(state.turn?.phase, action.state.turn?.phase ?? 'NORMAL') ?? state.phaseNotice,
      };

    case 'playerConnection': {
      const connected = action.status === 'CONNECTED';
      const game =
        state.game && state.game.players[action.playerId]
          ? {
              ...state.game,
              players: {
                ...state.game.players,
                [action.playerId]: { ...state.game.players[action.playerId]!, connectionStatus: action.status },
              },
            }
          : state.game;
      const lobby = state.lobby
        ? { ...state.lobby, players: state.lobby.players.map((p) => (p.playerId === action.playerId ? { ...p, connected } : p)) }
        : state.lobby;
      return { ...state, game, lobby };
    }

    case 'seriesEnded':
      return { ...state, seriesEnd: { winnerId: action.winnerId, matchWins: action.matchWins }, stage: 'NONE' };

    case 'committed':
      return state.turn?.turnId === action.turnId
        ? {
            ...state,
            selection: null, // locked in: the player cards go back to neutral
            ownCommit: action.action,
            lockedPlayerIds: state.session && !state.lockedPlayerIds.includes(state.session.playerId)
              ? [...state.lockedPlayerIds, state.session.playerId]
              : state.lockedPlayerIds,
          }
        : state;

    case 'roomClosed':
      return { ...initialState, connection: state.connection, notice: 'The room was closed.' };

    case 'error':
      return { ...state, error: action.message };

    case 'notice':
      return { ...state, notice: action.message };

    case 'dismissPhaseNotice':
      return { ...state, phaseNotice: null };

    case 'reset':
      return { ...initialState, connection: state.connection };
  }
}

// ----------------------------------------------------------------- selectors

/** True while the Turn Resolution popup is (or should be) on screen. Match / series results wait for it. */
export const turnModalOpen = (state: ClientState): boolean =>
  state.game !== null && state.lastResult !== null && state.revealed !== null && state.resolutionDismissed !== state.lastResult.turnId;

export type Screen = 'home' | 'lobby' | 'game';

export const screenOf = (state: ClientState): Screen => {
  if (!state.session || !state.lobby) return 'home';
  return state.lobby.status === 'LOBBY' ? 'lobby' : 'game';
};

export type Badge = 'ELIMINATED' | 'READY' | 'HIDDEN';

/** Roster badge for one player (§13 Figure 1: READY, HIDDEN ?, ELIMINATED). */
export function badgeOf(state: ClientState, playerId: PlayerId): Badge {
  const player = state.game?.players[playerId];
  if (!player || !player.alive) return 'ELIMINATED';
  return state.stage === 'COMMIT' && !state.lockedPlayerIds.includes(playerId) ? 'HIDDEN' : 'READY';
}

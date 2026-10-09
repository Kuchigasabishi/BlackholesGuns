/** Wire protocol between clients and the authoritative server. */
import type {
  ActionAvailability,
  AttackId,
  DefenseId,
  GameState,
  PlayerId,
  Phase,
  RejectionCode,
  ResolutionEvent,
  TurnOutcome,
} from '../engine';

export const ClientEvents = {
  create: 'lobby:create',
  join: 'lobby:join',
  resume: 'session:resume',
  leave: 'lobby:leave',
  start: 'game:start',
  commit: 'action:commit',
} as const;

export const ServerEvents = {
  lobbyUpdate: 'lobby:update',
  gameStarted: 'game:started',
  /** OPEN: public turn description. */
  turnOpen: 'turn:open',
  /** Private to one player: what that player may do this turn. */
  turnPrivate: 'turn:private',
  /** COMMIT progress: WHO has locked in, never WHAT. */
  turnProgress: 'turn:progress',
  /** LOCK: the commit window closed. Carries no choices. */
  turnLocked: 'turn:locked',
  /** REVEAL + RESOLVE + APPLY as one atomic broadcast. */
  turnResult: 'turn:result',
  playerConnection: 'player:connection',
  /** Developer state rewrite (dev mode only): clients should replace their state. */
  stateSync: 'state:sync',
  seriesEnded: 'series:ended',
  roomClosed: 'room:closed',
} as const;

export type RoomErrorCode =
  | 'BAD_PAYLOAD'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_STARTED'
  | 'NOT_IN_ROOM'
  | 'INVALID_TOKEN'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'TURN_NOT_OPEN'
  | 'TURN_LOCKED'
  | 'LATE'
  | 'STALE_TURN'
  | 'ALREADY_COMMITTED'
  | 'INTERNAL'
  | RejectionCode;

export type Ack<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly code: RoomErrorCode; readonly message: string };

// ----------------------------------------------------------------- payloads

export interface LobbyView {
  readonly roomCode: string;
  readonly inviteUrl: string;
  readonly status: 'LOBBY' | 'IN_GAME' | 'COMPLETE';
  readonly hostId: PlayerId | null;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly players: readonly { readonly playerId: PlayerId; readonly displayName: string; readonly connected: boolean }[];
}

/** An action as it is described on the wire. Targets only apply to attacks. */
export interface ActionPayload {
  readonly kind: 'CHARGE' | 'ATTACK' | 'DEFENSE';
  readonly weapon?: AttackId;
  readonly defense?: DefenseId;
  readonly targets?: readonly PlayerId[];
}

export interface CommitRequest {
  readonly turnId: string;
  readonly idempotencyKey: string;
  readonly action: ActionPayload;
}

export interface PublicAction extends ActionPayload {
  readonly playerId: PlayerId;
  /** True when the server chose this action under the timeout rule (§10). */
  readonly timedOut: boolean;
}

export interface TurnOpenPayload {
  readonly turnId: string;
  readonly turnIndex: number;
  readonly phase: Phase;
  readonly eligiblePlayerIds: readonly PlayerId[];
  readonly deadlineAt: number | null;
  readonly serverTime: number;
}

export interface TurnResultPayload {
  readonly turnId: string;
  readonly phase: Phase;
  /** The revealed batch: every living player's final action. */
  readonly actions: readonly PublicAction[];
  readonly events: readonly ResolutionEvent[];
  readonly outcome: TurnOutcome;
  /** Authoritative state after APPLY/COMPLETE (the next turn is not yet open). */
  readonly state: GameState;
}

/** Everything a (re)connecting client needs; contains only that player's own hidden data. */
export interface SessionView {
  readonly playerId: PlayerId;
  readonly lobby: LobbyView;
  readonly state: GameState | null;
  readonly turn: {
    readonly turnId: string;
    readonly stage: 'COMMIT' | 'LOCKED' | 'BETWEEN_TURNS';
    readonly deadlineAt: number | null;
    readonly lockedPlayerIds: readonly PlayerId[];
    readonly availability: ActionAvailability | null;
    /** This player's own accepted action for the open turn, if any. */
    readonly ownCommit: { readonly idempotencyKey: string; readonly action: ActionPayload } | null;
  } | null;
  readonly lastResult: TurnResultPayload | null;
  readonly serverTime: number;
}

/**
 * The client's connection to the authoritative server plus its state.
 * Framework-agnostic (subscribe/getState) so React binds to it with
 * useSyncExternalStore and tests can drive it against a real server in Node.
 */
import { io, type Socket } from 'socket.io-client';
import type { AttackId, DefenseId, PlayerId } from '../../../src/engine';
import {
  ClientEvents,
  ServerEvents,
  type ActionPayload,
  type Ack,
  type SessionView,
} from '../../../src/server/protocol';
import { initialState, reducer, type ClientAction, type ClientState, type Session } from '../state/reducer';

export type Choice =
  | { readonly kind: 'CHARGE' }
  | { readonly kind: 'DEFENSE'; readonly defense: DefenseId }
  | { readonly kind: 'ATTACK'; readonly weapon: AttackId; readonly targets: readonly PlayerId[] };

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoreOptions {
  /** Server origin. Omit for same-origin (the browser default). */
  readonly url?: string;
  /** Where the seat credentials survive a page reload. Pass null to disable. */
  readonly storage?: KeyValueStorage | null;
  /** Inject a socket (tests). */
  readonly socket?: Socket;
  /** Client clock, injectable for tests. */
  readonly now?: () => number;
}

export interface GameStore {
  getState(): ClientState;
  subscribe(listener: () => void): () => void;
  dispatch(action: ClientAction): void;
  createRoom(displayName: string): Promise<boolean>;
  joinRoom(roomCodeOrLink: string, displayName: string): Promise<boolean>;
  setSeriesTarget(target: number): Promise<boolean>;
  startGame(): Promise<boolean>;
  leaveRoom(): Promise<void>;
  commit(choice: Choice): Promise<boolean>;
  dispose(): void;
}

const STORAGE_KEY = 'bng.session';

const MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: 'That room does not exist (or has closed). Check the code and try again.',
  ROOM_FULL: 'That room is full (8 players).',
  GAME_STARTED: 'That game has already started.',
  NOT_HOST: 'Only the host can start the game.',
  NOT_ENOUGH_PLAYERS: 'You need at least 2 players to start.',
  UNAFFORDABLE: 'You do not have enough Charge for that.',
  PHASE_RESTRICTED: 'That action is disabled in this phase.',
  ATTACK_MANDATORY: 'In Sudden Death you must attack when you can afford an attack.',
  STALE_TURN: 'That turn has already ended.',
  ALREADY_COMMITTED: 'You already locked in this turn.',
  INVALID_TOKEN: 'Your saved seat is no longer valid.',
  INVALID_TARGETS: 'Pick valid targets for that attack.',
  LATE: 'Too late: the commit window closed.',
  TURN_LOCKED: 'Too late: the commit window closed.',
};
const messageFor = (code: string, fallback: string): string => MESSAGES[code] ?? fallback;

export function createGameStore(options: StoreOptions = {}): GameStore {
  const now = options.now ?? Date.now;
  const storage = options.storage === undefined ? safeSessionStorage() : options.storage;
  const socket = options.socket ?? (options.url ? io(options.url, { autoConnect: false }) : io({ autoConnect: false }));

  let state: ClientState = initialState;
  const listeners = new Set<() => void>();
  const dispatch = (action: ClientAction): void => {
    const next = reducer(state, action);
    if (next === state) return;
    state = next;
    for (const l of [...listeners]) l();
  };

  // ---- seat persistence ----------------------------------------------------
  const saveSession = (session: Session | null): void => {
    dispatch({ type: 'session', session });
    if (!storage) return;
    try {
      if (session) storage.setItem(STORAGE_KEY, JSON.stringify(session));
      else storage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode etc.: reload-resume just won't work */
    }
  };
  const savedSession = (): Session | null => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  };

  const applySnapshot = (view: SessionView): void => dispatch({ type: 'snapshot', view, receivedAt: now() });

  // ---- (re)connect: resume the saved seat ---------------------------------
  const resume = (session: Session): Promise<boolean> =>
    new Promise((resolve) => {
      socket.emit(ClientEvents.resume, session, (ack: Ack<{ session: SessionView }>) => {
        if (ack.ok) {
          saveSession(session);
          applySnapshot(ack.session);
          resolve(true);
          return;
        }
        // The seat is gone (room closed / token invalid): forget it and go home.
        saveSession(null);
        dispatch({ type: 'reset' });
        dispatch({ type: 'notice', message: messageFor(ack.code, ack.message) });
        resolve(false);
      });
    });

  socket.on('connect', () => {
    dispatch({ type: 'connection', status: 'connected' });
    const session = state.session ?? savedSession();
    if (session) void resume(session);
  });
  socket.on('disconnect', () => dispatch({ type: 'connection', status: 'disconnected' }));
  socket.io.on('reconnect_attempt', () => dispatch({ type: 'connection', status: 'connecting' }));

  // ---- server -> client ------------------------------------------------------
  socket.on(ServerEvents.lobbyUpdate, (lobby) => dispatch({ type: 'lobby', lobby }));
  socket.on(ServerEvents.gameStarted, (p) => dispatch({ type: 'gameStarted', lobby: p.lobby, state: p.state }));
  socket.on(ServerEvents.turnOpen, (payload) => dispatch({ type: 'turnOpen', payload, receivedAt: now() }));
  socket.on(ServerEvents.turnPrivate, (p) => dispatch({ type: 'turnPrivate', turnId: p.turnId, availability: p.availability }));
  socket.on(ServerEvents.turnProgress, (p) => dispatch({ type: 'progress', turnId: p.turnId, lockedPlayerIds: p.lockedPlayerIds }));
  socket.on(ServerEvents.turnLocked, (p) => dispatch({ type: 'locked', turnId: p.turnId }));
  socket.on(ServerEvents.turnResult, (payload) => dispatch({ type: 'result', payload }));
  socket.on(ServerEvents.stateSync, (p) => dispatch({ type: 'stateSync', state: p.state }));
  socket.on(ServerEvents.playerConnection, (p) => dispatch({ type: 'playerConnection', playerId: p.playerId, status: p.status }));
  socket.on(ServerEvents.seriesEnded, (p) => dispatch({ type: 'seriesEnded', winnerId: p.winnerId, matchWins: p.matchWins }));
  socket.on(ServerEvents.roomClosed, () => {
    saveSession(null);
    dispatch({ type: 'roomClosed' });
  });

  // ---- client -> server --------------------------------------------------------
  const request = <T extends object>(event: string, payload?: unknown): Promise<Ack<T>> =>
    new Promise((resolve) => {
      if (!socket.connected) {
        resolve({ ok: false, code: 'INTERNAL', message: 'Not connected to the server yet. Try again in a moment.' });
        return;
      }
      socket.emit(event, payload, resolve);
    });

  const enterRoom = (ack: Ack<{ roomCode: string; playerId: PlayerId; playerToken: string; session: SessionView }>): boolean => {
    if (!ack.ok) {
      dispatch({ type: 'error', message: messageFor(ack.code, ack.message) });
      return false;
    }
    saveSession({ roomCode: ack.roomCode, playerId: ack.playerId, playerToken: ack.playerToken });
    applySnapshot(ack.session);
    return true;
  };

  const store: GameStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispatch,

    async createRoom(displayName) {
      dispatch({ type: 'error', message: null });
      return enterRoom(await request(ClientEvents.create, { displayName }));
    },

    async joinRoom(roomCodeOrLink, displayName) {
      dispatch({ type: 'error', message: null });
      return enterRoom(await request(ClientEvents.join, { roomCode: roomCodeOrLink, displayName }));
    },

    async setSeriesTarget(target) {
      const ack = await request(ClientEvents.setSeriesTarget, { target });
      if (!ack.ok) dispatch({ type: 'error', message: messageFor(ack.code, ack.message) });
      return ack.ok;
    },

    async startGame() {
      const ack = await request(ClientEvents.start);
      if (!ack.ok) dispatch({ type: 'error', message: messageFor(ack.code, ack.message) });
      return ack.ok;
    },

    async leaveRoom() {
      await request(ClientEvents.leave);
      saveSession(null);
      dispatch({ type: 'reset' });
    },

    async commit(choice) {
      const turn = state.turn;
      const playerId = state.session?.playerId;
      if (!turn || !playerId) return false;
      const action: ActionPayload =
        choice.kind === 'CHARGE'
          ? { kind: 'CHARGE' }
          : choice.kind === 'DEFENSE'
            ? { kind: 'DEFENSE', defense: choice.defense }
            : { kind: 'ATTACK', weapon: choice.weapon, targets: [...choice.targets] };
      const idempotencyKey = `${turn.turnId}:${playerId}:${Math.random().toString(36).slice(2, 10)}`;
      dispatch({ type: 'error', message: null });
      const ack = await request(ClientEvents.commit, { turnId: turn.turnId, idempotencyKey, action });
      if (!ack.ok) {
        dispatch({ type: 'error', message: messageFor(ack.code, ack.message) });
        return false;
      }
      dispatch({ type: 'committed', turnId: turn.turnId, action });
      return true;
    },

    dispose() {
      socket.removeAllListeners();
      socket.close();
      listeners.clear();
    },
  };

  socket.connect();
  return store;
}

function safeSessionStorage(): KeyValueStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

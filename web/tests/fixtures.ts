/**
 * Realistic client fixtures built from the REAL engine, so formatting and UI
 * tests run on genuine resolution data.
 */
import {
  createSeries,
  deepFreeze,
  getActionAvailability,
  resolveTurn,
  type Action,
  type AttackId,
  type DefenseId,
  type GameState,
  type PlayerId,
} from '../../src/engine';
import type { ActionPayload, LobbyView, PublicAction, SessionView, TurnResultPayload } from '../../src/server/protocol';
import { createGameStore, type GameStore } from '../src/net/store';
import { initialState, reducer, type ClientAction, type ClientState } from '../src/state/reducer';

export const NAMES = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'];

export const ids = (n: number): PlayerId[] => Array.from({ length: n }, (_, i) => `p${i + 1}`);

export function lobbyView(n: number, opts: { hostId?: PlayerId | null; status?: LobbyView['status']; offline?: PlayerId[] } = {}): LobbyView {
  return {
    roomCode: 'K7M2QP',
    inviteUrl: 'https://blackholesandguns.io/join/K7M2QP',
    status: opts.status ?? 'LOBBY',
    hostId: opts.hostId === undefined ? 'p1' : opts.hostId,
    minPlayers: 2,
    maxPlayers: 8,
    seriesWinTarget: 10,
    players: ids(n).map((id, i) => ({ playerId: id, displayName: NAMES[i]!, connected: !(opts.offline ?? []).includes(id) })),
  };
}

export const newGame = (n: number): GameState => createSeries({ seriesId: 'fx', playerIds: ids(n) });

export function withCharges(state: GameState, charges: Record<PlayerId, number>): GameState {
  const players = { ...state.players };
  for (const [id, charge] of Object.entries(charges)) players[id] = { ...players[id]!, charge };
  return deepFreeze({ ...state, players });
}

export function withStreak(state: GameState, streak: number, phase: GameState['round']['phase']): GameState {
  return deepFreeze({ ...state, round: { ...state.round, noEliminationStreak: streak, phase }, turn: { ...state.turn!, phase } });
}

type Spec = ActionPayload & { timedOut?: boolean };

/** Resolves one turn through the real engine and returns the payload the server would broadcast. */
export function resultFor(state: GameState, specs: Record<PlayerId, Spec>): TurnResultPayload {
  const turn = state.turn!;
  const locked: Record<PlayerId, Action> = {};
  for (const id of turn.eligiblePlayerIds) {
    const s = specs[id]!;
    const base = {
      seriesId: state.series.seriesId,
      matchId: state.match.matchId,
      roundId: state.round.roundId,
      turnId: turn.turnId,
      playerId: id,
      idempotencyKey: `${turn.turnId}:${id}`,
      acceptedAt: 0,
      validation: { ok: true } as const,
    };
    locked[id] =
      s.kind === 'CHARGE'
        ? { ...base, kind: 'CHARGE' }
        : s.kind === 'DEFENSE'
          ? { ...base, kind: 'DEFENSE', defense: s.defense! }
          : { ...base, kind: 'ATTACK', weapon: s.weapon!, targets: [...(s.targets ?? [])] };
  }
  const result = resolveTurn(state, locked);
  const actions: PublicAction[] = turn.eligiblePlayerIds.map((id) => {
    const { timedOut, ...payload } = specs[id]!;
    return { playerId: id, ...payload, timedOut: timedOut ?? false };
  });
  return { turnId: turn.turnId, phase: turn.phase, actions, events: result.events, outcome: result.outcome, state: result.nextState };
}

export const attack = (weapon: AttackId, ...targets: PlayerId[]): Spec => ({ kind: 'ATTACK', weapon, targets });
export const defend = (defense: DefenseId): Spec => ({ kind: 'DEFENSE', defense });
export const CHARGE: Spec = { kind: 'CHARGE' };

/** What the server's session view would contain mid-COMMIT for one player. */
export function sessionView(
  game: GameState,
  playerId: PlayerId,
  over: Partial<NonNullable<SessionView['turn']>> & { lastResult?: TurnResultPayload | null; lobby?: LobbyView } = {},
): SessionView {
  const { lastResult = null, lobby = lobbyView(game.series.lobby.length, { status: 'IN_GAME' }), ...turnOver } = over;
  return {
    playerId,
    lobby,
    state: game,
    turn: {
      turnId: game.turn!.turnId,
      stage: 'COMMIT',
      deadlineAt: Date.now() + 25_000,
      lockedPlayerIds: [],
      availability: getActionAvailability(game, playerId),
      ownCommit: null,
      ...turnOver,
    },
    lastResult,
    serverTime: Date.now(),
  };
}

/** Client state as it would be mid-game for `playerId`. */
export function clientStateFor(game: GameState, playerId: PlayerId, over: Parameters<typeof sessionView>[2] = {}): ClientState {
  let s = reducer(initialState, { type: 'connection', status: 'connected' });
  s = reducer(s, { type: 'session', session: { roomCode: 'K7M2QP', playerId, playerToken: 'tok' } });
  return reducer(s, { type: 'snapshot', view: sessionView(game, playerId, over), receivedAt: Date.now() });
}

export interface StubStore extends GameStore {
  readonly commits: unknown[];
  readonly started: number;
  readonly aborted: number;
  readonly kicks: string[];
  readonly targets: number[];
  set(state: ClientState): void;
}

/** A GameStore that runs the real reducer but talks to nothing; records commits. */
export function stubStore(initial: ClientState = initialState): StubStore {
  let state = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const base = createGameStore({ socket: fakeSocket(), storage: null });
  base.dispose();
  const commits: unknown[] = [];
  let started = 0;
  let aborted = 0;
  const kicks: string[] = [];
  const targets: number[] = [];
  const store: StubStore = {
    ...base,
    commits,
    targets,
    get started() {
      return started;
    },
    kicks,
    async kickPlayer(playerId: string) {
      kicks.push(playerId);
      return true;
    },
    get aborted() {
      return aborted;
    },
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    dispatch(a: ClientAction) {
      state = reducer(state, a);
      notify();
    },
    set(next) {
      state = next;
      notify();
    },
    async commit(choice) {
      commits.push(choice);
      const turnId = state.turn!.turnId;
      const action: ActionPayload =
        choice.kind === 'CHARGE' ? { kind: 'CHARGE' } : choice.kind === 'DEFENSE' ? { kind: 'DEFENSE', defense: choice.defense } : { kind: 'ATTACK', weapon: choice.weapon, targets: [...choice.targets] };
      store.dispatch({ type: 'committed', turnId, action });
      return true;
    },
    async setSeriesTarget(target: number) {
      targets.push(target);
      return true;
    },
    async abortSeries() {
      aborted++;
      return true;
    },
    async startGame() {
      started++;
      return true;
    },
    async createRoom() {
      return true;
    },
    async joinRoom() {
      return true;
    },
    async leaveRoom() {
      store.dispatch({ type: 'reset' });
    },
  };
  return store;
}

/** Minimal socket stand-in so `createGameStore` can be constructed without a network. */
function fakeSocket(): never {
  const handlers = new Map<string, unknown>();
  const noop = () => fake;
  const fake = {
    connected: false,
    on: (e: string, h: unknown) => (handlers.set(e, h), fake),
    emit: noop,
    connect: noop,
    close: noop,
    removeAllListeners: noop,
    io: { on: noop },
  };
  return fake as never;
}

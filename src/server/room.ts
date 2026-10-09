/**
 * One lobby / series. Owns the authoritative GameState and runs the §10 turn
 * pipeline: OPEN -> COMMIT -> LOCK -> REVEAL -> RESOLVE -> APPLY -> COMPLETE.
 *
 * Hidden information (§12): accepted-but-unrevealed actions live ONLY in
 * `commits`. They are never placed in any broadcast, hook-free public view or
 * ack to another player. The sole way they leave this object before REVEAL is
 * the committer's own `ownCommit` echo (ack + session resume).
 */
import { randomBytes } from 'node:crypto';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  createSeededRng,
  createSeries,
  getActionAvailability,
  lockTurn,
  resolveTurn,
  setConnectionStatus,
  setTurnDeadline,
  validateAction,
  type Action,
  type GameState,
  type PlayerId,
  type ResolveTurnResult,
  type Rng,
  type TurnOutcome,
} from '../engine';
import type { ServerConfig } from './config';
import {
  ServerEvents,
  type ActionPayload,
  type CommitRequest,
  type LobbyView,
  type PublicAction,
  type RoomErrorCode,
  type SessionView,
  type TurnOpenPayload,
  type TurnResultPayload,
} from './protocol';
import { inviteUrl } from './roomCodes';
import { fastForward, setCharges, setNoEliminationStreak, DevHookError } from './devHooks';
import { canonicalTurn, type ReplayEntry, type ReplayLog, type ReplayStore } from './replay';
import { contextOf, logTurnOutcome, type Telemetry } from './telemetry';

export class RoomError extends Error {
  readonly code: RoomErrorCode;
  constructor(code: RoomErrorCode, message: string) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}

export interface RoomEmitter {
  toRoom(event: string, payload: unknown): void;
  toPlayer(playerId: PlayerId, event: string, payload: unknown): void;
}

/** One hook per §10 stage. Server-internal (hooks see hidden data); used by telemetry in Phase 3. */
export interface TurnLifecycleHooks {
  onOpen?(e: { roomCode: string; turnId: string; state: GameState }): void;
  onCommit?(e: { roomCode: string; turnId: string; playerId: PlayerId; action: Action }): void;
  onLock?(e: {
    roomCode: string;
    turnId: string;
    reason: LockReason;
    timedOutPlayerIds: readonly PlayerId[];
    actions: readonly Action[];
  }): void;
  onReveal?(e: { roomCode: string; turnId: string; actions: readonly PublicAction[] }): void;
  onResolve?(e: { roomCode: string; turnId: string; result: ResolveTurnResult }): void;
  onApply?(e: { roomCode: string; turnId: string; state: GameState }): void;
  onComplete?(e: { roomCode: string; turnId: string; outcome: TurnOutcome }): void;
}

export type LockReason = 'ALL_COMMITTED' | 'DEADLINE' | 'DEV_FORCED';
type Stage = 'NONE' | 'COMMIT' | 'LOCKED' | 'BETWEEN_TURNS';
export type RoomStatus = 'LOBBY' | 'IN_GAME' | 'COMPLETE';

interface Member {
  readonly playerId: PlayerId;
  readonly displayName: string;
  readonly token: string;
  connected: boolean;
  socketId: string | null;
  graceTimer: NodeJS.Timeout | null;
}

interface StoredCommit {
  readonly turnId: string;
  readonly idempotencyKey: string;
  readonly action: Action;
  readonly echo: ActionPayload;
  readonly acceptedAt: number;
}

export interface RoomDeps {
  readonly emitter: RoomEmitter;
  readonly config: ServerConfig;
  readonly hooks?: TurnLifecycleHooks;
  readonly telemetry?: Telemetry;
  readonly replayStore?: ReplayStore;
  /** Called when the room has nobody left and should be forgotten. */
  readonly onClosed: (room: Room) => void;
}

const SEATS = Array.from({ length: MAX_PLAYERS }, (_, i) => `p${i + 1}`);

const toPayload = (action: Action): ActionPayload => {
  switch (action.kind) {
    case 'CHARGE':
      return { kind: 'CHARGE' };
    case 'DEFENSE':
      return { kind: 'DEFENSE', defense: action.defense };
    case 'ATTACK':
      return { kind: 'ATTACK', weapon: action.weapon, targets: [...action.targets] };
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseCommitRequest(raw: unknown): CommitRequest {
  const bad = (m: string): never => {
    throw new RoomError('BAD_PAYLOAD', m);
  };
  if (!isRecord(raw)) return bad('Commit must be an object');
  const { turnId, idempotencyKey, action } = raw;
  if (typeof turnId !== 'string' || turnId.length === 0 || turnId.length > 200) return bad('turnId required');
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0 || idempotencyKey.length > 128) {
    return bad('idempotencyKey required (1-128 chars)');
  }
  if (!isRecord(action)) return bad('action required');
  const { kind, weapon, defense, targets } = action;
  if (kind === 'CHARGE') return { turnId, idempotencyKey, action: { kind } };
  if (kind === 'DEFENSE') {
    if (typeof defense !== 'string') return bad('defense required');
    return { turnId, idempotencyKey, action: { kind, defense: defense as never } };
  }
  if (kind === 'ATTACK') {
    if (typeof weapon !== 'string') return bad('weapon required');
    if (targets !== undefined && (!Array.isArray(targets) || targets.length > MAX_PLAYERS || targets.some((t) => typeof t !== 'string'))) {
      return bad('targets must be an array of player ids');
    }
    return { turnId, idempotencyKey, action: { kind, weapon: weapon as never, targets: (targets ?? []) as string[] } };
  }
  return bad('Unknown action kind');
}

export class Room {
  readonly code: string;
  status: RoomStatus = 'LOBBY';

  private readonly members = new Map<PlayerId, Member>();
  private hostId: PlayerId | null = null;
  private game: GameState | null = null;
  private stage: Stage = 'NONE';
  private commits = new Map<PlayerId, StoredCommit>();
  private lastResult: TurnResultPayload | null = null;
  private rng: Rng;
  readonly seed: string;
  private initialState: GameState | null = null;
  private replayEntries: ReplayEntry[] = [];
  private savedEntryCount = -1;
  private commitTimer: NodeJS.Timeout | null = null;
  private nextTurnTimer: NodeJS.Timeout | null = null;
  private emptyTimer: NodeJS.Timeout | null = null;
  private closed = false;

  /** Overrides `config.baseUrl` for this room's invite link (tunnel mode). */
  publicBaseUrl: string | undefined;

  constructor(code: string, private readonly deps: RoomDeps) {
    this.code = code;
    this.seed = deps.config.seed ?? randomBytes(8).toString('hex');
    this.rng = createSeededRng(this.seed);
  }

  private get now(): number {
    return this.deps.config.now();
  }

  // ------------------------------------------------------------------ lobby

  lobbyView(): LobbyView {
    return {
      roomCode: this.code,
      inviteUrl: inviteUrl(this.publicBaseUrl ?? this.deps.config.baseUrl, this.code),
      status: this.status,
      hostId: this.hostId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      players: [...this.members.values()].map((m) => ({
        playerId: m.playerId,
        displayName: m.displayName,
        connected: m.connected,
      })),
    };
  }

  /** Adds a player to the lobby (enforces the 2-8 player cap and no mid-game joins). */
  join(displayName: string): { playerId: PlayerId; token: string } {
    if (this.status !== 'LOBBY') throw new RoomError('GAME_STARTED', 'This game has already started');
    if (this.members.size >= MAX_PLAYERS) throw new RoomError('ROOM_FULL', `Room is full (${MAX_PLAYERS} players)`);
    const playerId = SEATS.find((id) => !this.members.has(id))!;
    const member: Member = {
      playerId,
      displayName: displayName.trim().slice(0, 24) || `Player ${playerId.slice(1)}`,
      token: randomBytes(16).toString('hex'),
      connected: false,
      socketId: null,
      graceTimer: null,
    };
    this.members.set(playerId, member);
    if (this.hostId === null) this.hostId = playerId;
    return { playerId, token: member.token };
  }

  /** Binds a socket to a seat. Used for the first connection and for every reconnect. */
  attach(playerId: PlayerId, token: string, socketId: string): void {
    const member = this.members.get(playerId);
    if (!member || member.token !== token) throw new RoomError('INVALID_TOKEN', 'Unknown player or bad token');
    if (member.graceTimer) clearTimeout(member.graceTimer);
    member.graceTimer = null;
    member.socketId = socketId; // newest socket wins; a stale socket's later disconnect is ignored
    this.setConnected(member, true);
    this.cancelEmptyTimer();
  }

  /** A socket went away. No-op unless it is the member's current socket. */
  detach(socketId: string): void {
    for (const member of this.members.values()) {
      if (member.socketId !== socketId) continue;
      member.socketId = null;
      this.setConnected(member, false);
      if (this.status === 'LOBBY') {
        member.graceTimer = setTimeout(() => this.removeFromLobby(member.playerId), this.deps.config.reconnectGraceMs);
      }
    }
    this.checkEmpty();
  }

  leave(playerId: PlayerId): void {
    const member = this.members.get(playerId);
    if (!member) return;
    if (this.status === 'LOBBY') this.removeFromLobby(playerId);
    else {
      member.socketId = null;
      this.setConnected(member, false);
      this.checkEmpty();
    }
  }

  private removeFromLobby(playerId: PlayerId): void {
    const member = this.members.get(playerId);
    if (!member || this.status !== 'LOBBY') return;
    if (member.graceTimer) clearTimeout(member.graceTimer);
    this.members.delete(playerId);
    if (this.hostId === playerId) this.hostId = [...this.members.keys()][0] ?? null;
    this.deps.emitter.toRoom(ServerEvents.lobbyUpdate, this.lobbyView());
    this.checkEmpty();
  }

  private setConnected(member: Member, connected: boolean): void {
    if (member.connected === connected) return;
    member.connected = connected;
    if (this.game) this.game = setConnectionStatus(this.game, member.playerId, connected ? 'CONNECTED' : 'DISCONNECTED');
    this.deps.emitter.toRoom(ServerEvents.playerConnection, {
      playerId: member.playerId,
      status: connected ? 'CONNECTED' : 'DISCONNECTED',
    });
    if (this.status === 'LOBBY') this.deps.emitter.toRoom(ServerEvents.lobbyUpdate, this.lobbyView());
  }

  private checkEmpty(): void {
    if (this.closed || this.emptyTimer) return;
    if ([...this.members.values()].some((m) => m.connected)) return;
    this.emptyTimer = setTimeout(() => this.close('EMPTY'), this.deps.config.reconnectGraceMs);
  }

  private cancelEmptyTimer(): void {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  // ------------------------------------------------------------------- game

  start(playerId: PlayerId): void {
    if (this.status !== 'LOBBY') throw new RoomError('GAME_STARTED', 'The game has already started');
    if (playerId !== this.hostId) throw new RoomError('NOT_HOST', 'Only the host can start the game');
    if (this.members.size < MIN_PLAYERS) {
      throw new RoomError('NOT_ENOUGH_PLAYERS', `At least ${MIN_PLAYERS} players are required`);
    }
    for (const m of this.members.values()) {
      if (m.graceTimer) clearTimeout(m.graceTimer);
      m.graceTimer = null;
    }
    this.game = createSeries({
      seriesId: `${this.code}-${randomBytes(3).toString('hex')}`,
      playerIds: [...this.members.keys()],
    });
    for (const m of this.members.values()) {
      if (!m.connected) this.game = setConnectionStatus(this.game, m.playerId, 'DISCONNECTED');
    }
    this.status = 'IN_GAME';
    this.initialState = this.game;
    this.deps.telemetry?.log({
      type: 'series_started',
      ...contextOf(this.game),
      seed: this.seed,
      roomCode: this.code,
      lobby: this.game.series.lobby,
    });
    this.deps.telemetry?.log({ type: 'match_started', ...contextOf(this.game) });
    this.deps.emitter.toRoom(ServerEvents.lobbyUpdate, this.lobbyView());
    this.deps.emitter.toRoom(ServerEvents.gameStarted, { lobby: this.lobbyView(), state: this.game });
    this.openTurn();
  }

  /** §10 OPEN: stamp the deadline, start the commit window, tell everyone. */
  private openTurn(): void {
    if (this.closed || !this.game) return;
    this.game = setTurnDeadline(this.game, this.now + this.deps.config.commitWindowMs);
    const turn = this.game.turn!;
    this.commits = new Map();
    this.stage = 'COMMIT';

    this.deps.telemetry?.log({ type: 'turn_opened', ...contextOf(this.game), turnIndex: this.game.round.turnIndex, deadlineAt: turn.deadlineAt });
    this.hook('onOpen', { roomCode: this.code, turnId: turn.turnId, state: this.game });
    this.announceTurn();
    this.commitTimer = setTimeout(() => this.lockAndResolve('DEADLINE'), this.deps.config.commitWindowMs);
  }

  /** Tells every client about the open turn, and each player what they may do in it. */
  private announceTurn(): void {
    const game = this.game;
    const turn = game?.turn;
    if (!game || !turn) return;
    const open: TurnOpenPayload = {
      turnId: turn.turnId,
      turnIndex: game.round.turnIndex,
      phase: turn.phase,
      eligiblePlayerIds: turn.eligiblePlayerIds,
      deadlineAt: turn.deadlineAt,
      serverTime: this.now,
    };
    this.deps.emitter.toRoom(ServerEvents.turnOpen, open);
    for (const id of turn.eligiblePlayerIds) {
      this.deps.emitter.toPlayer(id, ServerEvents.turnPrivate, {
        turnId: turn.turnId,
        availability: getActionAvailability(game, id),
      });
    }
  }

  /** §10 COMMIT. Returns what the committer is told; never anything about other players. */
  commit(playerId: PlayerId, raw: unknown): { turnId: string; acceptedAt: number } {
    try {
      return this.commitInner(playerId, raw);
    } catch (error) {
      if (error instanceof RoomError && this.game) {
        // Rejections log WHO and WHY, never the rejected action's content.
        this.deps.telemetry?.log({ type: 'action_rejected', ...contextOf(this.game), playerId, code: error.code, message: error.message });
      }
      throw error;
    }
  }

  private commitInner(playerId: PlayerId, raw: unknown): { turnId: string; acceptedAt: number } {
    const req = parseCommitRequest(raw);
    const game = this.game;
    if (this.status !== 'IN_GAME' || !game || !game.turn) throw new RoomError('TURN_NOT_OPEN', 'No turn is open');
    const turn = game.turn;

    const existing = this.commits.get(playerId);
    if (existing && req.turnId === turn.turnId && existing.idempotencyKey === req.idempotencyKey) {
      return { turnId: existing.turnId, acceptedAt: existing.acceptedAt }; // idempotent replay
    }
    if (req.turnId !== turn.turnId) throw new RoomError('STALE_TURN', 'That turn is no longer open');
    if (this.stage !== 'COMMIT') throw new RoomError('TURN_LOCKED', 'The commit window has closed');
    const receivedAt = this.now;
    if (turn.deadlineAt !== null && receivedAt > turn.deadlineAt) throw new RoomError('LATE', 'Past the commit deadline');
    if (existing) throw new RoomError('ALREADY_COMMITTED', 'You already committed an action this turn');

    const action = this.buildAction(game, playerId, req, receivedAt);
    const verdict = validateAction(game, action);
    if (!verdict.ok) throw new RoomError(verdict.code, verdict.message);

    this.commits.set(playerId, {
      turnId: turn.turnId,
      idempotencyKey: req.idempotencyKey,
      action,
      echo: toPayload(action),
      acceptedAt: receivedAt,
    });
    this.deps.telemetry?.log({
      type: 'action_submitted',
      ...contextOf(game),
      playerId,
      msIntoWindow: turn.deadlineAt === null ? null : receivedAt - (turn.deadlineAt - this.deps.config.commitWindowMs),
    });
    this.hook('onCommit', { roomCode: this.code, turnId: turn.turnId, playerId, action });
    this.deps.emitter.toRoom(ServerEvents.turnProgress, { turnId: turn.turnId, lockedPlayerIds: this.lockedPlayerIds() });

    if (turn.eligiblePlayerIds.every((id) => this.commits.has(id))) this.lockAndResolve('ALL_COMMITTED');
    return { turnId: turn.turnId, acceptedAt: receivedAt };
  }

  private buildAction(game: GameState, playerId: PlayerId, req: CommitRequest, acceptedAt: number): Action {
    const base = {
      seriesId: game.series.seriesId,
      matchId: game.match.matchId,
      roundId: game.round.roundId,
      turnId: game.turn!.turnId,
      playerId,
      idempotencyKey: req.idempotencyKey,
      acceptedAt,
      validation: { ok: true } as const,
    };
    const a = req.action;
    switch (a.kind) {
      case 'CHARGE':
        return { ...base, kind: 'CHARGE' };
      case 'DEFENSE':
        return { ...base, kind: 'DEFENSE', defense: a.defense! };
      case 'ATTACK':
        return { ...base, kind: 'ATTACK', weapon: a.weapon!, targets: [...(a.targets ?? [])] };
    }
  }

  private lockedPlayerIds(): PlayerId[] {
    return (this.game?.turn?.eligiblePlayerIds ?? []).filter((id) => this.commits.has(id));
  }

  /**
   * §10 LOCK -> REVEAL -> RESOLVE -> APPLY -> COMPLETE as one synchronous,
   * server-controlled sequence. There is exactly one lock transition: once
   * `stage` leaves COMMIT every later commit is rejected, which gives requests
   * racing the deadline a deterministic acceptance boundary.
   */
  private lockAndResolve(reason: LockReason): void {
    if (this.stage !== 'COMMIT' || !this.game || this.closed) return;
    this.stage = 'LOCKED';
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = null;

    try {
      const state = this.game;
      const turnId = state.turn!.turnId;

      // LOCK: fill in timeouts (§10) for anyone without a valid committed action.
      const submitted: Record<PlayerId, Action> = {};
      for (const [id, c] of this.commits) submitted[id] = c.action;
      const lock = lockTurn(state, submitted, this.rng, this.now);
      const timedOut = new Set(lock.timedOutPlayerIds);
      const ordered = state.turn!.eligiblePlayerIds.map((id) => lock.actions[id]!);
      this.hook('onLock', { roomCode: this.code, turnId, reason, timedOutPlayerIds: lock.timedOutPlayerIds, actions: ordered });
      this.deps.telemetry?.log({
        type: 'turn_locked',
        ...contextOf(state),
        reason,
        committedPlayerIds: [...this.commits.keys()],
        timedOutPlayerIds: lock.timedOutPlayerIds,
        rejectedSubmissions: lock.rejected.map((r) => ({ playerId: r.playerId, code: r.code })),
      });
      this.deps.emitter.toRoom(ServerEvents.turnLocked, { turnId, reason });

      // REVEAL (assembled now, broadcast atomically with the result below).
      const revealed: PublicAction[] = ordered.map((a) => ({
        playerId: a.playerId,
        ...toPayload(a),
        timedOut: timedOut.has(a.playerId),
      }));
      this.hook('onReveal', { roomCode: this.code, turnId, actions: revealed });

      // RESOLVE
      const result = resolveTurn(state, lock.actions);
      this.hook('onResolve', { roomCode: this.code, turnId, result });

      // APPLY
      this.game = result.nextState;
      this.hook('onApply', { roomCode: this.code, turnId, state: this.game });

      // COMPLETE: one broadcast carries reveal + resolution + new state.
      const payload: TurnResultPayload = {
        turnId,
        phase: state.turn!.phase,
        actions: revealed,
        events: result.events,
        outcome: result.outcome,
        state: this.game,
      };
      this.lastResult = payload;
      this.replayEntries.push({ type: 'TURN', turnId, actions: ordered, canonical: canonicalTurn(result) });
      this.commits = new Map();

      if (this.deps.telemetry) logTurnOutcome(this.deps.telemetry, { before: state, after: this.game, revealed, result });

      this.deps.emitter.toRoom(ServerEvents.turnResult, payload);
      this.hook('onComplete', { roomCode: this.code, turnId, outcome: result.outcome });

      if (this.game.series.status === 'COMPLETE') {
        this.status = 'COMPLETE';
        this.stage = 'NONE';
        this.saveReplay();
        this.deps.emitter.toRoom(ServerEvents.seriesEnded, {
          winnerId: this.game.series.winnerId,
          matchWins: this.game.series.matchWins,
        });
        this.deps.emitter.toRoom(ServerEvents.lobbyUpdate, this.lobbyView());
        this.nextTurnTimer = setTimeout(() => this.close('SERIES_COMPLETE'), this.deps.config.reconnectGraceMs);
      } else {
        this.stage = 'BETWEEN_TURNS';
        this.nextTurnTimer = setTimeout(() => {
          this.nextTurnTimer = null;
          this.openTurn();
        }, this.deps.config.interTurnDelayMs);
      }
    } catch (error) {
      console.error(`[room ${this.code}] turn resolution failed`, error);
      this.close('ERROR');
    }
  }

  // ------------------------------------------------------------------- views

  /** What a (re)connecting player is allowed to know: public state plus their own hidden data. */
  sessionView(playerId: PlayerId): SessionView {
    const game = this.game;
    const turn = game?.turn ?? null;
    const own = this.commits.get(playerId);
    return {
      playerId,
      lobby: this.lobbyView(),
      state: game,
      turn:
        game && turn && this.stage !== 'NONE'
          ? {
              turnId: turn.turnId,
              stage: this.stage,
              deadlineAt: turn.deadlineAt,
              lockedPlayerIds: this.stage === 'COMMIT' ? this.lockedPlayerIds() : [],
              availability: this.stage === 'COMMIT' ? getActionAvailability(game, playerId) : null,
              ownCommit: own ? { idempotencyKey: own.idempotencyKey, action: own.echo } : null,
            }
          : null,
      lastResult: this.lastResult,
      serverTime: this.now,
    };
  }

  hasMember(playerId: PlayerId): boolean {
    return this.members.has(playerId);
  }

  /** The replayable record of this series so far, or null before the game starts. */
  getReplayLog(): ReplayLog | null {
    if (!this.game || !this.initialState) return null;
    return {
      formatVersion: 1,
      seriesId: this.initialState.series.seriesId,
      seed: this.seed,
      rulesVersion: this.initialState.series.rulesVersion,
      matrixVersion: this.initialState.series.matrixVersion,
      initialState: this.initialState,
      entries: [...this.replayEntries],
    };
  }

  private saveReplay(): void {
    const log = this.getReplayLog();
    const store = this.deps.replayStore;
    if (!log || !store || this.savedEntryCount === log.entries.length) return;
    this.savedEntryCount = log.entries.length;
    store.save(log).catch((error) => console.error(`[room ${this.code}] saving replay failed`, error));
  }

  // ------------------------------------------------------------ dev test hooks

  /** Applies a developer state change, records it in the replay, and resyncs clients. Dev mode only (enforced by the server). */
  devMutate(reason: string, change: (state: GameState) => GameState): void {
    if (this.status !== 'IN_GAME' || !this.game?.turn) throw new DevHookError('NOT_IN_GAME', 'The room has no game in progress');
    this.game = change(this.game);
    this.replayEntries.push({ type: 'OVERRIDE', reason, state: this.game });
    this.deps.emitter.toRoom(ServerEvents.stateSync, { reason, state: this.game });
    if (this.stage === 'COMMIT') this.announceTurn();
  }

  devSetCharges(charges: Record<PlayerId, number>): void {
    this.devMutate('setCharges', (g) => setCharges(g, charges));
  }

  devSetStreak(streak: number): void {
    this.devMutate('setNoEliminationStreak', (g) => setNoEliminationStreak(g, streak));
  }

  devFastForward(turns: number): { turnsPlayed: number; stoppedBy: string | null } {
    let report = { turnsPlayed: 0, stoppedBy: null as string | null };
    this.devMutate('fastForward', (g) => {
      const r = fastForward(g, turns, this.rng);
      report = { turnsPlayed: r.turnsPlayed, stoppedBy: r.stoppedBy };
      return r.state;
    });
    return report;
  }

  /**
   * Commits actions on behalf of players through the NORMAL commit path (so
   * legality, phase restrictions and affordability still apply), optionally
   * closing the window immediately. Returns per-player results.
   */
  devInjectActions(
    actions: Record<PlayerId, unknown>,
    lockNow: boolean,
  ): Record<PlayerId, { ok: true } | { ok: false; code: string; message: string }> {
    const turnId = this.game?.turn?.turnId;
    if (this.status !== 'IN_GAME' || !turnId) throw new DevHookError('NOT_IN_GAME', 'The room has no game in progress');
    const out: Record<PlayerId, { ok: true } | { ok: false; code: string; message: string }> = {};
    for (const [playerId, action] of Object.entries(actions)) {
      if (!this.members.has(playerId)) {
        out[playerId] = { ok: false, code: 'INVALID_PLAYER', message: `Unknown player ${playerId}` };
        continue;
      }
      try {
        this.commit(playerId, { turnId, idempotencyKey: `dev:${turnId}:${playerId}`, action });
        out[playerId] = { ok: true };
      } catch (error) {
        if (!(error instanceof RoomError)) throw error;
        out[playerId] = { ok: false, code: error.code, message: error.message };
      }
    }
    if (lockNow && this.game?.turn?.turnId === turnId) this.lockAndResolve('DEV_FORCED');
    return out;
  }

  // --------------------------------------------------------------- lifecycle

  close(reason: 'EMPTY' | 'SERIES_COMPLETE' | 'ERROR' | 'SHUTDOWN'): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of [this.commitTimer, this.nextTurnTimer, this.emptyTimer]) if (t) clearTimeout(t);
    for (const m of this.members.values()) if (m.graceTimer) clearTimeout(m.graceTimer);
    this.saveReplay();
    this.deps.emitter.toRoom(ServerEvents.roomClosed, { reason });
    this.deps.onClosed(this);
  }

  private hook<K extends keyof TurnLifecycleHooks>(name: K, event: Parameters<NonNullable<TurnLifecycleHooks[K]>>[0]): void {
    const fn = this.deps.hooks?.[name] as ((e: typeof event) => void) | undefined;
    try {
      fn?.(event);
    } catch (error) {
      console.error(`[room ${this.code}] hook ${name} threw`, error); // a bad observer must not break the game
    }
  }
}

import { io as connect, type Socket } from 'socket.io-client';
import { createGameServer, type GameServer, type GameServerOptions, type ServerConfig, type TurnLifecycleHooks } from '../../src/server';
import type { ActionPayload, Ack, SessionView, TurnOpenPayload, TurnResultPayload } from '../../src/server';

export interface Running {
  readonly server: GameServer;
  readonly url: string;
}

const running: Running[] = [];
const clients: TestClient[] = [];

/** Fast defaults so timeout tests take milliseconds. */
export async function startServer(
  config: Partial<ServerConfig> = {},
  hooks?: TurnLifecycleHooks,
  extra: Partial<GameServerOptions> = {},
): Promise<Running> {
  const server = createGameServer({
    config: { commitWindowMs: 5_000, interTurnDelayMs: 0, reconnectGraceMs: 5_000, seed: 'test-seed', ...config },
    ...(hooks ? { hooks } : {}),
    ...extra,
  });
  const port = await server.listen(0);
  const r = { server, url: `http://127.0.0.1:${port}` };
  running.push(r);
  return r;
}

export async function cleanup(): Promise<void> {
  for (const c of clients.splice(0)) c.socket.close();
  for (const r of running.splice(0)) await r.server.close();
}

interface LoggedEvent {
  readonly event: string;
  readonly payload: unknown;
}

export class TestClient {
  readonly log: LoggedEvent[] = [];
  roomCode = '';
  playerId = '';
  playerToken = '';
  private waiters: { event: string; pred: (p: any) => boolean; resolve: (p: any) => void }[] = [];

  private constructor(readonly socket: Socket, readonly url: string) {
    socket.onAny((event, payload) => {
      this.log.push({ event, payload });
      this.waiters = this.waiters.filter((w) => {
        if (w.event === event && w.pred(payload)) {
          w.resolve(payload);
          return false;
        }
        return true;
      });
    });
    clients.push(this);
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return new TestClient(socket, url);
  }

  emit<T = any>(event: string, payload?: unknown): Promise<Ack<T>> {
    return new Promise((resolve) => this.socket.emit(event, payload, resolve));
  }

  /** Resolves with the first matching event, whether it already arrived or arrives later. */
  waitFor<T = any>(event: string, pred: (p: T) => boolean = () => true, timeoutMs = 3_000): Promise<T> {
    const seen = this.log.find((l) => l.event === event && pred(l.payload as T));
    if (seen) return Promise.resolve(seen.payload as T);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
      this.waiters.push({
        event,
        pred,
        resolve: (p) => {
          clearTimeout(timer);
          resolve(p);
        },
      });
    });
  }

  events(name: string): any[] {
    return this.log.filter((l) => l.event === name).map((l) => l.payload);
  }

  async create(displayName: string): Promise<void> {
    const ack: any = await this.emit('lobby:create', { displayName });
    if (!ack.ok) throw new Error(`create failed: ${ack.code}`);
    Object.assign(this, { roomCode: ack.roomCode, playerId: ack.playerId, playerToken: ack.playerToken });
  }

  async join(roomCodeOrLink: string, displayName: string): Promise<Ack<any>> {
    const ack: any = await this.emit('lobby:join', { roomCode: roomCodeOrLink, displayName });
    if (ack.ok) Object.assign(this, { roomCode: ack.roomCode, playerId: ack.playerId, playerToken: ack.playerToken });
    return ack;
  }

  commit(turnId: string, action: ActionPayload, idempotencyKey = `${turnId}:${this.playerId}`): Promise<Ack<any>> {
    return this.emit('action:commit', { turnId, idempotencyKey, action });
  }

  resume(): Promise<Ack<{ session: SessionView }>> {
    return this.emit('session:resume', { roomCode: this.roomCode, playerId: this.playerId, playerToken: this.playerToken });
  }

  result(turnId: string): Promise<TurnResultPayload> {
    return this.waitFor<TurnResultPayload>('turn:result', (p) => p.turnId === turnId);
  }
}

/** Creates a room with `n` connected players, started, with turn 1 open for everyone. */
export async function startedGame(run: Running, n: number): Promise<{ players: TestClient[]; roomCode: string; turnId: string }> {
  const host = await TestClient.connect(run.url);
  await host.create('Host');
  const players = [host];
  for (let i = 1; i < n; i++) {
    const c = await TestClient.connect(run.url);
    const ack = await c.join(host.roomCode, `Player ${i + 1}`);
    if (!ack.ok) throw new Error(`join failed: ${ack.code}`);
    players.push(c);
  }
  const started = await host.emit('game:start');
  if (!started.ok) throw new Error(`start failed: ${started.code}`);
  const open = await Promise.all(players.map((p) => p.waitFor<TurnOpenPayload>('turn:open')));
  return { players, roomCode: host.roomCode, turnId: open[0]!.turnId };
}

export const CHARGE: ActionPayload = { kind: 'CHARGE' };
export const DODGE: ActionPayload = { kind: 'DEFENSE', defense: 'DODGE' };
export const SHIELD: ActionPayload = { kind: 'DEFENSE', defense: 'SHIELD' };

/** POSTs JSON to a dev endpoint and returns status + parsed body. */
export async function dev(run: Running, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${run.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

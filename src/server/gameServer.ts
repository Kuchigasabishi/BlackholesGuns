import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket } from 'socket.io';
import type { PlayerId } from '../engine';
import { DEFAULT_CONFIG, type ServerConfig } from './config';
import { ClientEvents, type Ack, type RoomErrorCode, type SessionView } from './protocol';
import { Room, RoomError, type RoomEmitter, type TurnLifecycleHooks } from './room';
import { extractRoomCode, generateRoomCode, inviteUrl } from './roomCodes';
import { handleHttp } from './http';
import { publicBaseFromHeaders } from './publicUrl';
import type { ReplayStore } from './replay';
import { createNullTelemetry, type Telemetry } from './telemetry';

export interface GameServerOptions {
  readonly config?: Partial<ServerConfig>;
  readonly hooks?: TurnLifecycleHooks;
  readonly telemetry?: Telemetry;
  /** Persists each series' replay log (on series end and room close). */
  readonly replayStore?: ReplayStore;
  /** Enables the /dev/* test hooks. NEVER enable in production. */
  readonly devMode?: boolean;
  /** When set, /dev/* requests must carry this value in the `x-dev-token` header. */
  readonly devToken?: string;
  /** Serve the built web client (and SPA fallback for invite links) from this directory. */
  readonly staticDir?: string;
  /** Attach to an existing HTTP server instead of creating one. */
  readonly httpServer?: HttpServer;
}

export interface GameServer {
  readonly io: Server;
  readonly httpServer: HttpServer;
  readonly config: ServerConfig;
  readonly rooms: ReadonlyMap<string, Room>;
  /** `host` omitted = every interface (IPv4 and IPv6), which is what a tunnel such as ngrok needs. */
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

interface Binding {
  readonly room: Room;
  readonly playerId: PlayerId;
}

const roomChannel = (code: string): string => `room:${code}`;
const playerChannel = (code: string, playerId: PlayerId): string => `player:${code}:${playerId}`;

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const config: ServerConfig = { ...DEFAULT_CONFIG, ...options.config };
  const rooms = new Map<string, Room>();
  const telemetry = options.telemetry ?? createNullTelemetry();
  const devMode = options.devMode ?? false;
  const httpServer = options.httpServer ?? createServer();

  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigin as string | string[] },
    // Actions are tiny; refuse anything big before it is parsed.
    maxHttpBufferSize: 16 * 1024,
  });

  if (!options.httpServer) {
    httpServer.on('request', (req, res) =>
      handleHttp(req, res, { config, rooms, devMode, devToken: options.devToken, staticDir: options.staticDir }),
    );
  }

  const emitterFor = (code: string): RoomEmitter => ({
    toRoom: (event, payload) => void io.to(roomChannel(code)).emit(event, payload),
    toPlayer: (playerId, event, payload) => void io.to(playerChannel(code, playerId)).emit(event, payload),
    disconnectPlayer: (playerId) => void io.in(playerChannel(code, playerId)).disconnectSockets(true),
  });

  const createRoom = (): Room => {
    const code = generateRoomCode(config.roomCodeLength, (c) => rooms.has(c));
    const room = new Room(code, {
      emitter: emitterFor(code),
      config,
      telemetry,
      ...(options.replayStore ? { replayStore: options.replayStore } : {}),
      ...(options.hooks ? { hooks: options.hooks } : {}),
      onClosed: (r) => {
        rooms.delete(r.code);
        io.in(roomChannel(r.code)).socketsLeave([roomChannel(r.code)]);
      },
    });
    rooms.set(code, room);
    return room;
  };

  /** Puts the socket into the room's channels and records who it is. */
  const bind = (socket: Socket, room: Room, playerId: PlayerId): void => {
    const previous = socket.data.binding as Binding | undefined;
    if (previous && (previous.room !== room || previous.playerId !== playerId)) {
      socket.leave(roomChannel(previous.room.code));
      socket.leave(playerChannel(previous.room.code, previous.playerId));
      previous.room.detach(socket.id);
    }
    socket.join(roomChannel(room.code));
    socket.join(playerChannel(room.code, playerId));
    socket.data.binding = { room, playerId } satisfies Binding;
  };

  const requireBinding = (socket: Socket): Binding => {
    const binding = socket.data.binding as Binding | undefined;
    if (!binding || !binding.room.hasMember(binding.playerId)) throw new RoomError('NOT_IN_ROOM', 'Join or resume a room first');
    return binding;
  };

  const displayNameOf = (payload: unknown): string => {
    const name = (payload as { displayName?: unknown } | null)?.displayName;
    return typeof name === 'string' ? name : '';
  };

  /** Runs a handler, turning thrown RoomErrors into `{ ok:false }` acks. */
  const handle =
    <T extends object>(fn: (payload: unknown, socket: Socket) => T) =>
    (socket: Socket) =>
    (payload: unknown, ack?: (a: Ack<T>) => void): void => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      try {
        reply({ ok: true, ...fn(payload, socket) } as Ack<T>);
      } catch (error) {
        if (error instanceof RoomError) reply({ ok: false, code: error.code, message: error.message });
        else {
          console.error('[server] unexpected handler error', error);
          reply({ ok: false, code: 'INTERNAL' satisfies RoomErrorCode, message: 'Internal error' });
        }
      }
    };

  const onCreate = handle((payload, socket) => {
    const room = createRoom();
    if (config.inferBaseUrl) room.publicBaseUrl = publicBaseFromHeaders(socket.handshake.headers);
    const { playerId, token } = room.join(displayNameOf(payload));
    bind(socket, room, playerId);
    room.attach(playerId, token, socket.id);
    return { roomCode: room.code, inviteUrl: inviteUrl(room.publicBaseUrl ?? config.baseUrl, room.code), playerId, playerToken: token, session: room.sessionView(playerId) };
  });

  const onJoin = handle((payload, socket) => {
    const code = extractRoomCode((payload as { roomCode?: unknown } | null)?.roomCode);
    const room = code ? rooms.get(code) : undefined;
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'No such room');
    const { playerId, token } = room.join(displayNameOf(payload));
    bind(socket, room, playerId);
    room.attach(playerId, token, socket.id);
    return { roomCode: room.code, playerId, playerToken: token, session: room.sessionView(playerId) };
  });

  const onResume = handle((payload, socket): { session: SessionView } => {
    const p = (payload ?? {}) as { roomCode?: unknown; playerId?: unknown; playerToken?: unknown };
    const code = extractRoomCode(p.roomCode);
    const room = code ? rooms.get(code) : undefined;
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'No such room');
    if (typeof p.playerId !== 'string' || typeof p.playerToken !== 'string') throw new RoomError('BAD_PAYLOAD', 'playerId and playerToken required');
    room.attach(p.playerId, p.playerToken, socket.id); // throws INVALID_TOKEN on mismatch
    bind(socket, room, p.playerId);
    return { session: room.sessionView(p.playerId) };
  });

  const onStart = handle((_payload, socket) => {
    const { room, playerId } = requireBinding(socket);
    room.start(playerId);
    return {};
  });

  const onSetSeriesTarget = handle((payload, socket) => {
    const { room, playerId } = requireBinding(socket);
    room.setSeriesWinTarget(playerId, (payload as { target?: unknown } | null)?.target);
    return {};
  });

  const onAbort = handle((_payload, socket) => {
    const { room, playerId } = requireBinding(socket);
    room.abortSeries(playerId);
    return {};
  });

  const onSetGameMode = handle((payload, socket) => {
    const { room, playerId } = requireBinding(socket);
    room.setGameMode(playerId, (payload as { gameMode?: unknown } | null)?.gameMode);
    return {};
  });

  const onKick = handle((payload, socket) => {
    const { room, playerId } = requireBinding(socket);
    room.kick(playerId, (payload as { playerId?: unknown } | null)?.playerId);
    return {};
  });

  const onLeave = handle((_payload, socket) => {
    const { room, playerId } = requireBinding(socket);
    socket.leave(roomChannel(room.code));
    socket.leave(playerChannel(room.code, playerId));
    socket.data.binding = undefined;
    room.leave(playerId);
    return {};
  });

  const onCommit = handle((payload, socket) => {
    // The acting seat comes from the socket's binding, never from the payload.
    const { room, playerId } = requireBinding(socket);
    return room.commit(playerId, payload);
  });

  io.on('connection', (socket) => {
    socket.on(ClientEvents.create, onCreate(socket));
    socket.on(ClientEvents.join, onJoin(socket));
    socket.on(ClientEvents.resume, onResume(socket));
    socket.on(ClientEvents.start, onStart(socket));
    socket.on(ClientEvents.setSeriesTarget, onSetSeriesTarget(socket));
    socket.on(ClientEvents.abort, onAbort(socket));
    socket.on(ClientEvents.kick, onKick(socket));
    socket.on(ClientEvents.setGameMode, onSetGameMode(socket));
    socket.on(ClientEvents.leave, onLeave(socket));
    socket.on(ClientEvents.commit, onCommit(socket));
    socket.on('disconnect', () => {
      (socket.data.binding as Binding | undefined)?.room.detach(socket.id);
    });
  });

  return {
    io,
    httpServer,
    config,
    rooms,
    listen: (port = 0, host) =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        const done = () => resolve((httpServer.address() as AddressInfo).port);
        if (host) httpServer.listen(port, host, done);
        else httpServer.listen(port, done);
      }),
    close: async () => {
      for (const room of [...rooms.values()]) room.close('SHUTDOWN');
      await io.close(); // also closes the underlying HTTP server
    },
  };
}

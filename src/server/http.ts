/** HTTP surface: health, invite lookup, developer test hooks (dev mode only) and the static web client. */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { MAX_PLAYERS, MIN_PLAYERS } from '../engine';
import type { ServerConfig } from './config';
import { DevHookError } from './devHooks';
import { verifyReplay } from './replay';
import { RoomError, type Room } from './room';
import { extractRoomCode, inviteUrl } from './roomCodes';

export interface HttpOptions {
  readonly config: ServerConfig;
  readonly rooms: ReadonlyMap<string, Room>;
  readonly devMode: boolean;
  /** If set, dev requests must send this value in the `x-dev-token` header. */
  readonly devToken: string | undefined;
  /** Directory of the built web client; enables static serving and SPA fallback. */
  readonly staticDir: string | undefined;
}

const MAX_BODY_BYTES = 64 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.map': 'application/json; charset=utf-8',
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new DevHookError('BAD_PAYLOAD', 'Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolveBody(text ? JSON.parse(text) : {});
      } catch {
        reject(new DevHookError('BAD_PAYLOAD', 'Body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function handleHttp(req: IncomingMessage, res: ServerResponse, opts: HttpOptions): void {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
  if (path.startsWith('/socket.io')) return; // handled by Socket.IO

  if (path === '/healthz') return sendJson(res, 200, { ok: true });

  if (path.startsWith('/dev/')) {
    if (!opts.devMode) return sendJson(res, 404, { error: 'Not found' }); // hidden entirely outside dev mode
    void handleDev(req, res, path, query, opts);
    return;
  }

  const roomMatch = /^\/api\/rooms\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && roomMatch) {
    const code = extractRoomCode(roomMatch[1]);
    const room = code ? opts.rooms.get(code) : undefined;
    if (!room) return sendJson(res, 404, { exists: false });
    const lobby = room.lobbyView();
    return sendJson(res, 200, {
      exists: true,
      roomCode: room.code,
      inviteUrl: inviteUrl(room.publicBaseUrl ?? opts.config.baseUrl, room.code),
      joinable: lobby.status === 'LOBBY' && lobby.players.length < MAX_PLAYERS,
      players: lobby.players.length,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
    });
  }

  if (req.method === 'GET' && opts.staticDir && !path.startsWith('/api/')) return serveStatic(res, path, opts.staticDir);
  sendJson(res, 404, { error: 'Not found' });
}

function serveStatic(res: ServerResponse, urlPath: string, staticDir: string): void {
  const root = resolve(staticDir);
  const requested = resolve(join(root, normalize(urlPath)));
  const inside = requested === root || requested.startsWith(root + sep);
  let file = inside && existsSync(requested) && statSync(requested).isFile() ? requested : null;
  // Single-page app: unknown non-asset paths (e.g. /join/K7M2QP) get index.html.
  if (!file && !extname(urlPath)) file = join(root, 'index.html');
  if (!file || !existsSync(file)) return sendJson(res, 404, { error: 'Not found' });
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : file.includes(`${sep}sounds${sep}`) ? 'public, max-age=86400' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

async function handleDev(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams, opts: HttpOptions): Promise<void> {
  try {
    if (opts.devToken !== undefined && req.headers['x-dev-token'] !== opts.devToken) {
      throw new DevHookError('FORBIDDEN', 'Missing or wrong x-dev-token');
    }
    const roomOf = (raw: unknown): Room => {
      const code = extractRoomCode(raw);
      const room = code ? opts.rooms.get(code) : undefined;
      if (!room) throw new DevHookError('ROOM_NOT_FOUND', 'No such room');
      return room;
    };

    // GET /dev/replay/:code[?verify=1]  -> the series' replay log (optionally verified)
    const replayMatch = /^\/dev\/replay\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && replayMatch) {
      const room = roomOf(replayMatch[1]);
      const log = room.getReplayLog();
      if (!log) throw new DevHookError('NOT_IN_GAME', 'The game has not started');
      if (query.get('verify') === '1') {
        const outcomes = verifyReplay(log);
        return sendJson(res, 200, { ok: true, verifiedTurns: outcomes.length, log });
      }
      return sendJson(res, 200, { ok: true, log });
    }

    if (req.method !== 'POST') throw new DevHookError('BAD_PAYLOAD', 'Use POST');
    const body = (await readJson(req)) as Record<string, unknown>;
    const room = roomOf(body.roomCode);

    switch (path) {
      case '/dev/charges': {
        if (typeof body.charges !== 'object' || body.charges === null) throw new DevHookError('BAD_PAYLOAD', 'charges required');
        room.devSetCharges(body.charges as Record<string, number>);
        return sendJson(res, 200, { ok: true });
      }
      case '/dev/streak': {
        if (typeof body.streak !== 'number') throw new DevHookError('BAD_PAYLOAD', 'streak required');
        room.devSetStreak(body.streak);
        return sendJson(res, 200, { ok: true });
      }
      case '/dev/fastforward': {
        if (typeof body.turns !== 'number') throw new DevHookError('BAD_PAYLOAD', 'turns required');
        return sendJson(res, 200, { ok: true, ...room.devFastForward(body.turns) });
      }
      case '/dev/actions': {
        if (typeof body.actions !== 'object' || body.actions === null) throw new DevHookError('BAD_PAYLOAD', 'actions required');
        const results = room.devInjectActions(body.actions as Record<string, unknown>, body.lock === true);
        return sendJson(res, 200, { ok: true, results });
      }
      default:
        throw new DevHookError('BAD_PAYLOAD', 'Unknown dev hook');
    }
  } catch (error) {
    if (error instanceof DevHookError) {
      const status = error.code === 'ROOM_NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : 400;
      return sendJson(res, status, { ok: false, code: error.code, message: error.message });
    }
    if (error instanceof RoomError) return sendJson(res, 400, { ok: false, code: error.code, message: error.message });
    console.error('[dev hook] unexpected error', error);
    sendJson(res, 500, { ok: false, code: 'INTERNAL', message: 'Internal error' });
  }
}

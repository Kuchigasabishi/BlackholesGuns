import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { readNetworkEnv } from '../../src/env';
import { ClientEvents, createGameServer, publicBaseFromHeaders, type GameServer } from '../../src/server';

const servers: GameServer[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const start = async (config: Parameters<typeof createGameServer>[0] = {}, host?: string) => {
  const server = createGameServer(config);
  servers.push(server);
  const port = await server.listen(0, host);
  return { server, port };
};

const client = (url: string, extraHeaders?: Record<string, string>): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const s = connect(url, { transports: ['websocket'], extraHeaders: extraHeaders ?? {}, reconnection: false });
    sockets.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });

const createRoom = (s: Socket): Promise<{ ok: boolean; roomCode: string; inviteUrl: string }> =>
  new Promise((resolve) => s.emit(ClientEvents.create, { displayName: 'Ada' }, resolve));

const lanAddress = (): string | undefined =>
  Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

describe('binding: reachable by a tunnel / other machines', () => {
  it('with no host, listens on every interface (not just loopback)', async () => {
    const { server } = await start();
    const address = server.httpServer.address() as { address: string };
    expect(['::', '0.0.0.0']).toContain(address.address);
  });

  it('accepts a real Socket.IO client over IPv4 loopback', async () => {
    const { port } = await start();
    const s = await client(`http://127.0.0.1:${port}`);
    expect((await createRoom(s)).ok).toBe(true);
  });

  it('accepts a real Socket.IO client on this machine\'s LAN address (what a forwarded connection looks like)', async (ctx) => {
    const lan = lanAddress();
    if (!lan) return ctx.skip();
    const { port } = await start();
    const s = await client(`http://${lan}:${port}`);
    expect((await createRoom(s)).ok).toBe(true);
  });

  it('dual-stack by default: also accepts IPv6 loopback, which is what `localhost` can resolve to', async (ctx) => {
    const probe = createServer();
    const ipv6 = await new Promise<boolean>((resolve) => {
      probe.once('error', () => resolve(false));
      probe.listen(0, '::1', () => resolve(true));
    });
    probe.close();
    if (!ipv6) return ctx.skip();
    const { port } = await start();
    const s = await client(`http://[::1]:${port}`);
    expect((await createRoom(s)).ok).toBe(true);
  });

  it('HOST=127.0.0.1 keeps it local-only (and a LAN address then refuses)', async (ctx) => {
    const { server, port } = await start({}, '127.0.0.1');
    expect((server.httpServer.address() as { address: string }).address).toBe('127.0.0.1');
    const lan = lanAddress();
    if (!lan) return ctx.skip();
    await expect(client(`http://${lan}:${port}`)).rejects.toBeTruthy();
  });
});

describe('CORS', () => {
  const handshake = (port: number, origin: string) =>
    fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, { headers: { origin } });

  it('default: a foreign origin is not granted access', async () => {
    const { port } = await start();
    const res = await handshake(port, 'https://abc123.ngrok-free.app');
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://abc123.ngrok-free.app');
  });

  it('corsOrigin "*" (tunnel mode) lets a browser on the ngrok origin through', async () => {
    const { port } = await start({ config: { corsOrigin: '*' } });
    const res = await handshake(port, 'https://abc123.ngrok-free.app');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('an explicit allow-list admits listed origins only', async () => {
    const { port } = await start({ config: { corsOrigin: ['https://abc123.ngrok-free.app'] } });
    expect((await handshake(port, 'https://abc123.ngrok-free.app')).headers.get('access-control-allow-origin')).toBe('https://abc123.ngrok-free.app');
    expect((await handshake(port, 'https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('invite links through a tunnel', () => {
  const tunnelHeaders = { 'x-forwarded-host': 'abc123.ngrok-free.app', 'x-forwarded-proto': 'https' };

  it('by default the link uses the configured base URL (spec §20.3), ignoring forwarded headers', async () => {
    const { port } = await start();
    const room = await createRoom(await client(`http://127.0.0.1:${port}`, tunnelHeaders));
    expect(room.inviteUrl).toBe(`https://blackholesandguns.io/join/${room.roomCode}`);
  });

  it('with inferBaseUrl (tunnel mode) the link points at the ngrok URL, in the create ack and the lobby', async () => {
    const { port, server } = await start({ config: { inferBaseUrl: true } });
    const s = await client(`http://127.0.0.1:${port}`, tunnelHeaders);
    const room = await createRoom(s);
    expect(room.inviteUrl).toBe(`https://abc123.ngrok-free.app/join/${room.roomCode}`);
    expect(server.rooms.get(room.roomCode)!.lobbyView().inviteUrl).toBe(room.inviteUrl);
    const info = await (await fetch(`http://127.0.0.1:${port}/api/rooms/${room.roomCode}`)).json();
    expect(info.inviteUrl).toBe(room.inviteUrl);
  });

  it('without a proxy header it uses the Host the client really used', async () => {
    const { port } = await start({ config: { inferBaseUrl: true } });
    const room = await createRoom(await client(`http://127.0.0.1:${port}`));
    expect(room.inviteUrl).toBe(`http://127.0.0.1:${port}/join/${room.roomCode}`);
  });

  it('rejects a malformed forwarded host rather than putting it in a link', () => {
    for (const bad of ['evil.com/<script>', 'a b', 'x.com/path', '', 'host:99999999']) {
      expect(publicBaseFromHeaders({ 'x-forwarded-host': bad, host: 'ok.example' }), bad).toBeUndefined();
    }
    expect(publicBaseFromHeaders({ 'x-forwarded-host': 'x.ngrok.app', 'x-forwarded-proto': 'javascript' })).toBeUndefined();
    expect(publicBaseFromHeaders({ 'x-forwarded-host': 'a.ngrok.app, proxy.internal', 'x-forwarded-proto': 'https, http' })).toBe('https://a.ngrok.app');
    expect(publicBaseFromHeaders({ host: '[::1]:3000' })).toBe('http://[::1]:3000');
  });
});

describe('environment settings (src/env.ts)', () => {
  it('defaults: port 3000, every interface, no tunnel, server default CORS', () => {
    expect(readNetworkEnv({})).toEqual({ port: 3000, host: undefined, tunnel: false, corsOrigin: undefined, inferBaseUrl: false });
  });

  it('TUNNEL=1 opens CORS and infers invite links; PUBLIC_BASE_URL pins the link instead', () => {
    expect(readNetworkEnv({ TUNNEL: '1' })).toMatchObject({ tunnel: true, corsOrigin: '*', inferBaseUrl: true });
    expect(readNetworkEnv({ TUNNEL: '1', PUBLIC_BASE_URL: 'https://x.ngrok.app' })).toMatchObject({ inferBaseUrl: false });
  });

  it('CORS_ORIGIN accepts "*" or a comma-separated list, and HOST / PORT are honoured', () => {
    expect(readNetworkEnv({ CORS_ORIGIN: ' https://a.example , https://b.example ' }).corsOrigin).toEqual(['https://a.example', 'https://b.example']);
    expect(readNetworkEnv({ CORS_ORIGIN: 'https://a.example,*' }).corsOrigin).toBe('*');
    expect(readNetworkEnv({ HOST: '0.0.0.0', PORT: '4000' })).toMatchObject({ host: '0.0.0.0', port: 4000 });
    expect(readNetworkEnv({ HOST: '  ' }).host).toBeUndefined();
  });
});

describe('no hardcoded endpoints (regression guard)', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === 'node_modules' || name === 'dist') return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });

  it('server and client source never point at localhost / 127.0.0.1; the client socket is same-origin unless VITE_SERVER_URL is set', () => {
    for (const file of [...walk('src'), ...walk('web/src')]) {
      const text = readFileSync(file, 'utf8');
      expect(/https?:\/\/(?:localhost|127\.0\.0\.1)/.test(text), file).toBe(false);
    }
    const store = readFileSync('web/src/net/store.ts', 'utf8');
    expect(store).toContain('io({ autoConnect: false })'); // no URL = window.location.origin
    expect(readFileSync('web/src/main.tsx', 'utf8')).toContain('VITE_SERVER_URL');
  });
});

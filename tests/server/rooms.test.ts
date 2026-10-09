import { afterEach, describe, expect, it } from 'vitest';
import { extractRoomCode, inviteUrl, ROOM_CODE_ALPHABET } from '../../src/server';
import { cleanup, startServer, startedGame, TestClient, CHARGE } from './harness';

afterEach(cleanup);

const CODE = /^[A-HJ-NP-Z2-9]{6}$/;

describe('room codes and invite links (§20.3)', () => {
  it('builds the canonical invite link https://blackholesandguns.io/join/{ROOM_CODE}', () => {
    expect(inviteUrl('https://blackholesandguns.io', 'K7M2QP')).toBe('https://blackholesandguns.io/join/K7M2QP');
    expect(inviteUrl('https://blackholesandguns.io/', 'K7M2QP')).toBe('https://blackholesandguns.io/join/K7M2QP');
  });

  it('extracts a code from a bare code or an invite link, rejecting junk', () => {
    expect(extractRoomCode('k7m2qp')).toBe('K7M2QP');
    expect(extractRoomCode('  K7M2QP ')).toBe('K7M2QP');
    expect(extractRoomCode('https://blackholesandguns.io/join/K7M2QP')).toBe('K7M2QP');
    expect(extractRoomCode('https://blackholesandguns.io/join/k7m2qp/?ref=x')).toBe('K7M2QP');
    for (const bad of ['', 'ab', '../etc/passwd', 'K7M2 QP', 42, null, undefined, {}]) expect(extractRoomCode(bad)).toBeNull();
  });

  it('uses an unambiguous alphabet', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01OI]/);
  });

  it('creates a room with a short code and the canonical invite link', async () => {
    const run = await startServer();
    const host = await TestClient.connect(run.url);
    const ack: any = await host.emit('lobby:create', { displayName: 'Ada' });
    expect(ack.ok).toBe(true);
    expect(ack.roomCode).toMatch(CODE);
    expect(ack.inviteUrl).toBe(`https://blackholesandguns.io/join/${ack.roomCode}`);
    expect(ack.playerId).toBe('p1');
    expect(ack.session.lobby).toMatchObject({ hostId: 'p1', minPlayers: 2, maxPlayers: 8, status: 'LOBBY' });
  });

  it('generates distinct codes for distinct rooms', async () => {
    const run = await startServer();
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const c = await TestClient.connect(run.url);
      await c.create(`h${i}`);
      codes.add(c.roomCode);
    }
    expect(codes.size).toBe(20);
  });
});

describe('joining and the 2-8 player limit', () => {
  it('joins by code, by lowercase code, and by invite link; everyone sees the lobby update', async () => {
    const run = await startServer();
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    const byCode = await TestClient.connect(run.url);
    const byLower = await TestClient.connect(run.url);
    const byLink = await TestClient.connect(run.url);
    expect((await byCode.join(host.roomCode, 'A')).ok).toBe(true);
    expect((await byLower.join(host.roomCode.toLowerCase(), 'B')).ok).toBe(true);
    expect((await byLink.join(`https://blackholesandguns.io/join/${host.roomCode}`, 'C')).ok).toBe(true);
    const lobby: any = await host.waitFor('lobby:update', (l: any) => l.players.length === 4);
    expect(lobby.players.map((p: any) => p.playerId)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(lobby.players.every((p: any) => p.connected)).toBe(true);
  });

  it('allows exactly 8 players and rejects the 9th with ROOM_FULL', async () => {
    const run = await startServer();
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    for (let i = 2; i <= 8; i++) {
      const c = await TestClient.connect(run.url);
      expect((await c.join(host.roomCode, `P${i}`)).ok, `player ${i}`).toBe(true);
    }
    const ninth = await TestClient.connect(run.url);
    expect(await ninth.join(host.roomCode, 'P9')).toMatchObject({ ok: false, code: 'ROOM_FULL' });
  });

  it('rejects unknown rooms and malformed join payloads', async () => {
    const run = await startServer();
    const c = await TestClient.connect(run.url);
    expect(await c.join('ZZZZZZ', 'x')).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(await c.emit('lobby:join', 'not-an-object')).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(await c.emit('lobby:join')).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  });

  it('sanitises display names', async () => {
    const run = await startServer();
    const c = await TestClient.connect(run.url);
    const ack: any = await c.emit('lobby:create', { displayName: `  ${'x'.repeat(100)}  ` });
    expect(ack.session.lobby.players[0].displayName).toHaveLength(24);
    const d = await TestClient.connect(run.url);
    const ack2: any = await d.emit('lobby:create', { displayName: 42 });
    expect(ack2.session.lobby.players[0].displayName).toBe('Player 1');
  });
});

describe('starting a game', () => {
  it('only the host can start, and not with fewer than 2 players', async () => {
    const run = await startServer();
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    expect(await host.emit('game:start')).toMatchObject({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
    const guest = await TestClient.connect(run.url);
    await guest.join(host.roomCode, 'Guest');
    expect(await guest.emit('game:start')).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(await host.emit('game:start')).toMatchObject({ ok: true });
  });

  it('refuses new joins once the game is under way', async () => {
    const run = await startServer();
    const { roomCode } = await startedGame(run, 2);
    const late = await TestClient.connect(run.url);
    expect(await late.join(roomCode, 'Late')).toMatchObject({ ok: false, code: 'GAME_STARTED' });
  });

  it('a socket that has not joined anything cannot start or commit', async () => {
    const run = await startServer();
    const stranger = await TestClient.connect(run.url);
    expect(await stranger.emit('game:start')).toMatchObject({ ok: false, code: 'NOT_IN_ROOM' });
    expect(await stranger.commit('x', CHARGE)).toMatchObject({ ok: false, code: 'NOT_IN_ROOM' });
  });
});

describe('lobby isolation', () => {
  it('events from one room never reach another room', async () => {
    const run = await startServer();
    const a = await startedGame(run, 2);
    const hostB = await TestClient.connect(run.url);
    await hostB.create('B-host');
    const guestB = await TestClient.connect(run.url);
    await guestB.join(hostB.roomCode, 'B-guest');
    expect(hostB.roomCode).not.toBe(a.roomCode);

    // Play a full turn in room A.
    await Promise.all(a.players.map((p) => p.commit(a.turnId, CHARGE)));
    await a.players[0]!.result(a.turnId);

    // Room B only ever saw its own lobby traffic.
    const seenByB = new Set([...hostB.log, ...guestB.log].map((l) => l.event));
    expect([...seenByB].every((e) => e === 'lobby:update' || e === 'player:connection')).toBe(true);
    expect(JSON.stringify([...hostB.log, ...guestB.log])).not.toContain(a.roomCode);
    expect(run.server.rooms.size).toBe(2);
  });
});

describe('HTTP surface', () => {
  it('serves /healthz and invite lookups', async () => {
    const run = await startServer();
    expect(await (await fetch(`${run.url}/healthz`)).json()).toEqual({ ok: true });

    const host = await TestClient.connect(run.url);
    await host.create('Host');
    const before: any = await (await fetch(`${run.url}/api/rooms/${host.roomCode.toLowerCase()}`)).json();
    expect(before).toMatchObject({ exists: true, roomCode: host.roomCode, joinable: true, players: 1, maxPlayers: 8 });
    expect(before.inviteUrl).toBe(`https://blackholesandguns.io/join/${host.roomCode}`);

    const guest = await TestClient.connect(run.url);
    await guest.join(host.roomCode, 'G');
    await host.emit('game:start');
    const after: any = await (await fetch(`${run.url}/api/rooms/${host.roomCode}`)).json();
    expect(after.joinable).toBe(false);

    const missing = await fetch(`${run.url}/api/rooms/NOPE99`);
    expect(missing.status).toBe(404);
  });
});

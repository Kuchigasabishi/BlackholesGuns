import { afterEach, describe, expect, it } from 'vitest';
import { CHARGE, cleanup, startServer, startedGame, TestClient } from './harness';

afterEach(cleanup);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Host kick: lobby', () => {
  it('only the host may kick; the target is told, disconnected and removed from everyone\'s roster', async () => {
    const run = await startServer();
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    const a = await TestClient.connect(run.url);
    await a.join(host.roomCode, 'Amy');
    const b = await TestClient.connect(run.url);
    await b.join(host.roomCode, 'Bob');

    expect(((await a.emit('player:kick', { playerId: 'p3' })) as any).code).toBe('NOT_HOST');
    expect(((await host.emit('player:kick', { playerId: 'p1' })) as any).code).toBe('BAD_PAYLOAD'); // not yourself
    expect(((await host.emit('player:kick', { playerId: 'p9' })) as any).code).toBe('BAD_PAYLOAD'); // nobody there

    expect(((await host.emit('player:kick', { playerId: 'p3' })) as any).ok).toBe(true);
    const kicked: any = await b.waitFor('player:kicked');
    expect(kicked.reason).toBe('KICKED_BY_HOST');
    await sleep(100);
    expect(b.socket.connected).toBe(false); // their socket was cut
    const lobby = host.events('lobby:update').at(-1);
    expect(lobby.players.map((p: any) => p.playerId)).toEqual(['p1', 'p2']);
    expect(a.events('lobby:update').at(-1).players).toHaveLength(2);
    // the evicted seat is really gone: the old token no longer works
    const again = await TestClient.connect(run.url);
    Object.assign(again, { roomCode: b.roomCode, playerId: b.playerId, playerToken: b.playerToken });
    expect(((await again.resume()) as any).ok).toBe(false);
  });
});

describe('Host kick: mid-game', () => {
  it('kicking a player eliminates them instantly and the round resolves without waiting for them', async () => {
    const run = await startServer();
    const { players } = await startedGame(run, 3);
    const [host, p2, p3] = players as [TestClient, TestClient, TestClient];
    const open: any = await host.waitFor('turn:open');
    await p2.commit(open.turnId, CHARGE); // everybody except p3 is ready: p3 is the one holding up the turn

    expect(((await p2.emit('player:kick', { playerId: 'p3' })) as any).code).toBe('NOT_HOST');
    expect(((await host.emit('player:kick', { playerId: 'p3' })) as any).ok).toBe(true);

    await p3.waitFor('player:kicked');
    const quit: any = await p2.waitFor('player:quit');
    expect(quit).toMatchObject({ playerId: 'p3', kicked: true });
    const sync = p2.events('state:sync').at(-1).state;
    expect(sync.players.p3.alive).toBe(false); // ELIMINATED
    expect(sync.round.survivorIds).toEqual(['p1', 'p2']); // ALIVE count is now 2
    expect(sync.series.departed).toEqual(['p3']);

    // a fresh turn opens at once for the two survivors and resolves normally
    const next: any = await host.waitFor('turn:open', (t: any) => t.turnId !== open.turnId);
    expect(next.eligiblePlayerIds).toEqual(['p1', 'p2']);
    await host.commit(next.turnId, CHARGE);
    await p2.commit(next.turnId, CHARGE);
    const result: any = await host.waitFor('turn:result', (r: any) => r.turnId === next.turnId);
    expect(result.outcome.survivorIds).toEqual(['p1', 'p2']);

    // the evicted player cannot get back in
    await sleep(50);
    expect(p3.socket.connected).toBe(false);
  });

  it('kicking a disconnected (AFK) player works too', async () => {
    const run = await startServer();
    const { players } = await startedGame(run, 3);
    const [host, p2, p3] = players as [TestClient, TestClient, TestClient];
    p3.socket.disconnect();
    await host.waitFor('player:connection', (e: any) => e.playerId === 'p3' && e.status === 'DISCONNECTED');
    expect(((await host.emit('player:kick', { playerId: 'p3' })) as any).ok).toBe(true);
    await p2.waitFor('player:quit');
    expect(p2.events('state:sync').at(-1).state.players.p3.alive).toBe(false);
  });

  it('if the kick leaves one participant, the series ends at once and everyone is routed back to the lobby', async () => {
    const run = await startServer();
    const { players } = await startedGame(run, 2);
    const [host, guest] = players as [TestClient, TestClient];
    expect(((await host.emit('player:kick', { playerId: 'p2' })) as any).ok).toBe(true);
    const ended: any = await host.waitFor('series:ended');
    expect(ended.winnerId).toBe('p1');
    await guest.waitFor('player:kicked');
    expect(host.events('lobby:update').at(-1)).toMatchObject({ status: 'LOBBY', hostId: 'p1' });
    expect(host.events('lobby:update').at(-1).players.map((p: any) => p.playerId)).toEqual(['p1']);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, dev, startServer, TestClient } from './harness';

afterEach(cleanup);

describe('Game Mode setting', () => {
  it('defaults to STANDARD; only the host can change it; everyone is told on room:settings_updated; it locks at start', async () => {
    const run = await startServer();
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    const guest = await TestClient.connect(run.url);
    await guest.join(host.roomCode, 'Guest');
    expect(run.server.rooms.get(host.roomCode)!.lobbyView().gameMode).toBe('STANDARD');

    expect(((await guest.emit('lobby:setGameMode', { gameMode: 'SNOWBALL' })) as any).code).toBe('NOT_HOST');
    expect(((await host.emit('lobby:setGameMode', { gameMode: 'CHAOS' })) as any).code).toBe('BAD_PAYLOAD');
    expect(((await host.emit('lobby:setGameMode', { gameMode: 'SNOWBALL' })) as any).ok).toBe(true);

    for (const c of [host, guest]) {
      const update: any = await c.waitFor('room:settings_updated', (u: any) => u.gameMode === 'SNOWBALL');
      expect(update).toMatchObject({ gameMode: 'SNOWBALL', seriesWinTarget: 10 });
      expect(c.events('lobby:update').at(-1).gameMode).toBe('SNOWBALL');
    }
    // changing the series target announces the full settings too
    expect(((await host.emit('lobby:setSeriesTarget', { target: 5 })) as any).ok).toBe(true);
    expect(await guest.waitFor('room:settings_updated', (u: any) => u.seriesWinTarget === 5)).toMatchObject({ gameMode: 'SNOWBALL' });

    expect(((await host.emit('game:start')) as any).ok).toBe(true);
    const started: any = await host.waitFor('game:started');
    expect(started.state.series.gameMode).toBe('SNOWBALL');
    expect(((await host.emit('lobby:setGameMode', { gameMode: 'STANDARD' })) as any).code).toBe('GAME_STARTED');
  });

  it('a snowball series keeps the survivors Charge across an elimination over the wire', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    const a = await TestClient.connect(run.url);
    await a.join(host.roomCode, 'A');
    const b = await TestClient.connect(run.url);
    await b.join(host.roomCode, 'B');
    await host.emit('lobby:setGameMode', { gameMode: 'SNOWBALL' });
    await host.emit('game:start');
    const open: any = await host.waitFor('turn:open');
    await dev(run, '/dev/charges', { roomCode: host.roomCode, charges: { p1: 3, p2: 2 } });
    await dev(run, '/dev/actions', {
      roomCode: host.roomCode,
      lock: true,
      actions: { p1: { kind: 'ATTACK', weapon: 'GUN', targets: ['p3'] }, p2: { kind: 'CHARGE' }, p3: { kind: 'CHARGE' } },
    });
    const result: any = await host.waitFor('turn:result', (r: any) => r.turnId === open.turnId);
    expect(result.outcome.transition).toBe('NEXT_ROUND');
    expect(result.state.players.p1.charge).toBe(2);
    expect(result.state.players.p2.charge).toBe(3);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { CHARGE, cleanup, dev, startServer, TestClient } from './harness';

afterEach(cleanup);

describe('series ends at the host-configured Series Win Target', () => {
  it('target 3: ends on the 3rd Match Win, starts no 4th match, and returns the room to the lobby', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    const guest = await TestClient.connect(run.url);
    await guest.join(host.roomCode, 'Guest');
    expect(((await host.emit('lobby:setSeriesTarget', { target: 3 })) as any).ok).toBe(true);
    expect(((await host.emit('game:start')) as any).ok).toBe(true);

    for (let match = 1; match <= 3; match++) {
      const open: any = await host.waitFor('turn:open', (t: any) => t.turnId.includes(`:m${match}:`));
      await dev(run, '/dev/charges', { roomCode: host.roomCode, charges: { p1: 1 } });
      await dev(run, '/dev/actions', { roomCode: host.roomCode, lock: true, actions: { p1: { kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] }, p2: CHARGE } });
      const result: any = await host.waitFor('turn:result', (r: any) => r.turnId === open.turnId);
      expect(result.outcome.transition).toBe(match < 3 ? 'MATCH_ENDED' : 'SERIES_ENDED');
    }

    const ended: any = await guest.waitFor('series:ended');
    expect(ended).toMatchObject({ winnerId: 'p1', matchWins: { p1: 3, p2: 0 } });
    await new Promise((r) => setTimeout(r, 100));
    expect(host.events('turn:open').filter((t: any) => t.turnId.includes(':m4:'))).toHaveLength(0);

    // Back in the waiting lobby: roster, host and target are preserved; game state is gone.
    const lobby = host.events('lobby:update').at(-1);
    expect(lobby).toMatchObject({ status: 'LOBBY', hostId: 'p1', seriesWinTarget: 3 });
    expect(lobby.players.map((p: any) => p.playerId)).toEqual(['p1', 'p2']);
    const resumed: any = await guest.resume();
    expect(resumed.session.state).toBeNull();
    expect(resumed.session.turn).toBeNull();

    // The host controls are live again and a fresh series can start.
    expect(((await host.emit('lobby:setSeriesTarget', { target: 5 })) as any).ok).toBe(true);
    expect(((await host.emit('game:start')) as any).ok).toBe(true);
    const restarted: any = await host.waitFor('game:started', (g: any) => g.state.series.seriesWinTarget === 5);
    expect(restarted.state.series.matchWins).toEqual({ p1: 0, p2: 0 });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { CHARGE, cleanup, startServer, startedGame, TestClient } from './harness';

afterEach(cleanup);

const stateOf = (c: TestClient): any => c.events('state:sync').at(-1)?.state;

describe('Quit / Leave Match (server-authoritative)', () => {
  it('a player quitting a 3-player game is eliminated at once and the others continue without waiting', async () => {
    const run = await startServer();
    const { players } = await startedGame(run, 3);
    const [host, p2, p3] = players as [TestClient, TestClient, TestClient];
    // Everyone has a turn open; p2 even locked in already.
    const open: any = await host.waitFor('turn:open');
    await p2.commit(open.turnId, CHARGE);

    expect(((await p3.emit('lobby:leave')) as any).ok).toBe(true);
    const quit: any = await host.waitFor('player:quit');
    expect(quit.playerId).toBe('p3');
    const sync = stateOf(host);
    expect(sync.players.p3.alive).toBe(false);
    expect(sync.round.survivorIds).toEqual(['p1', 'p2']); // ALIVE is now 2
    expect(sync.series.departed).toEqual(['p3']);
    // A fresh turn opens immediately for the survivors (new round), with no waiting on the 30 s window.
    const next: any = await host.waitFor('turn:open', (t: any) => t.turnId !== open.turnId);
    expect(next.eligiblePlayerIds).toEqual(['p1', 'p2']);
    // ...and it can be played to completion.
    await host.commit(next.turnId, CHARGE);
    await p2.commit(next.turnId, CHARGE);
    const result: any = await host.waitFor('turn:result', (r: any) => r.turnId === next.turnId);
    expect(result.outcome.survivorIds).toEqual(['p1', 'p2']);
  });

  it('a quitter cannot come back with their old token', async () => {
    const run = await startServer();
    const { players } = await startedGame(run, 3);
    await players[2]!.emit('lobby:leave');
    await players[0]!.waitFor('player:quit');
    const back: any = await players[2]!.resume();
    expect(back.ok).toBe(false);
  });

  it('when only one participant is left they win the series and the room returns to the lobby', async () => {
    const run = await startServer();
    const { players } = await startedGame(run, 2);
    await players[1]!.emit('lobby:leave');
    const ended: any = await players[0]!.waitFor('series:ended');
    expect(ended.winnerId).toBe('p1');
    const lobby = players[0]!.events('lobby:update').at(-1);
    expect(lobby).toMatchObject({ status: 'LOBBY', hostId: 'p1' });
    expect(lobby.players.map((p: any) => p.playerId)).toEqual(['p1']); // the quitter is not carried over
  });

  it('host migration: if the host quits, the next player becomes host', async () => {
    const run = await startServer();
    const { players } = await startedGame(run, 3);
    await players[0]!.emit('lobby:leave');
    await players[1]!.waitFor('player:quit');
    const lobby = players[1]!.events('lobby:update').at(-1);
    expect(lobby.hostId).toBe('p2');
    // the new host can abort the series
    expect(((await players[1]!.emit('game:abort')) as any).ok).toBe(true);
  });

  it('quitting in the lobby still just removes the player', async () => {
    const run = await startServer();
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    const guest = await TestClient.connect(run.url);
    await guest.join(host.roomCode, 'Guest');
    await guest.emit('lobby:leave');
    await new Promise((r) => setTimeout(r, 50));
    expect(host.events('lobby:update').at(-1).players).toHaveLength(1);
    expect(host.events('player:quit')).toHaveLength(0);
  });
});

describe('Return to Lobby (host abort)', () => {
  it('only the host can abort; everyone goes back to the waiting lobby with scores discarded', async () => {
    const run = await startServer();
    const { players } = await startedGame(run, 3);
    const [host, p2, p3] = players as [TestClient, TestClient, TestClient];
    expect(((await p2.emit('game:abort')) as any).code).toBe('NOT_HOST');
    expect(((await host.emit('game:abort')) as any).ok).toBe(true);
    for (const p of [host, p2, p3]) {
      const aborted: any = await p.waitFor('series:aborted');
      expect(aborted.byPlayerId).toBe('p1');
      const lobby = p.events('lobby:update').at(-1);
      expect(lobby).toMatchObject({ status: 'LOBBY', hostId: 'p1' });
      expect(lobby.players).toHaveLength(3);
    }
    const resumed: any = await p2.resume();
    expect(resumed.session.state).toBeNull();
    // a new series starts from scratch
    expect(((await host.emit('game:start')) as any).ok).toBe(true);
    const fresh: any = await host.waitFor('game:started', (g: any) => g.state.series.seriesId !== undefined && g.state.series.matchWins.p1 === 0 && g.state.series.departed.length === 0);
    expect(fresh.state.series.matchWins).toEqual({ p1: 0, p2: 0, p3: 0 });
  });

  it('is rejected outside a game', async () => {
    const run = await startServer();
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    expect(((await host.emit('game:abort')) as any).code).toBe('NO_GAME');
  });
});

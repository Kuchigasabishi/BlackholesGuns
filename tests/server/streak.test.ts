import { afterEach, describe, expect, it } from 'vitest';
import { CHARGE, cleanup, dev, startServer, TestClient } from './harness';

afterEach(cleanup);

describe('On Fire streaks over the WebSocket', () => {
  it('every turn result carries each player streak; a different winner clears the leader streak', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    const guest = await TestClient.connect(run.url);
    await guest.join(host.roomCode, 'Guest');
    await host.emit('game:start');

    const winMatch = async (match: number, winner: 'p1' | 'p2') => {
      const loser = winner === 'p1' ? 'p2' : 'p1';
      const open: any = await guest.waitFor('turn:open', (t: any) => t.turnId.includes(`:m${match}:`));
      await dev(run, '/dev/charges', { roomCode: host.roomCode, charges: { [winner]: 1 } });
      await dev(run, '/dev/actions', { roomCode: host.roomCode, lock: true, actions: { [winner]: { kind: 'ATTACK', weapon: 'GUN', targets: [loser] }, [loser]: CHARGE } });
      const r: any = await guest.waitFor('turn:result', (x: any) => x.turnId === open.turnId);
      return Object.fromEntries(Object.entries(r.state.players).map(([id, p]: any) => [id, p.currentMatchStreak]));
    };

    expect(await winMatch(1, 'p1')).toEqual({ p1: 1, p2: 0 });
    expect(await winMatch(2, 'p1')).toEqual({ p1: 2, p2: 0 });
    expect(await winMatch(3, 'p1')).toEqual({ p1: 3, p2: 0 });
    expect(await winMatch(4, 'p2')).toEqual({ p1: 0, p2: 1 }); // streak cleared on the very next state sync
  });
});

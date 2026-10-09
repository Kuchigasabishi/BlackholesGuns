import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, startServer, startedGame, TestClient, CHARGE, DODGE, SHIELD } from './harness';

afterEach(cleanup);

const SECRET = 'KEY-SECRET-7f3a91';

/** Everything a client has been sent, as one string, so leaks are caught wherever they hide. */
const everythingSeenBy = (c: TestClient): string => JSON.stringify(c.log);

describe('§12 hidden information during COMMIT', () => {
  it('never sends one player\'s committed action to anyone else before REVEAL', async () => {
    const run = await startServer();
    const { players, turnId } = await startedGame(run, 3);
    const [p1, p2, p3] = players as [TestClient, TestClient, TestClient];

    const ack: any = await p1.commit(turnId, SHIELD, SECRET);
    expect(ack.ok).toBe(true);
    await p2.waitFor('turn:progress', (p: any) => p.lockedPlayerIds.includes('p1'));
    await p3.waitFor('turn:progress', (p: any) => p.lockedPlayerIds.includes('p1'));

    for (const observer of [p2, p3]) {
      const seen = everythingSeenBy(observer);
      expect(seen, 'idempotency key leaked').not.toContain(SECRET);
      expect(observer.events('turn:result'), 'result before reveal').toHaveLength(0);
      expect(seen, 'an action object leaked').not.toContain('"kind"');
      // The only commit-related signal is who has locked in.
      expect(observer.events('turn:progress')).toEqual([{ turnId, lockedPlayerIds: ['p1'] }]);
    }
  });

  it('the committer\'s ack echoes nothing about anyone else', async () => {
    const run = await startServer();
    const { players, turnId } = await startedGame(run, 2);
    await players[1]!.commit(turnId, DODGE, SECRET);
    const ack: any = await players[0]!.commit(turnId, CHARGE);
    // p2's pending action is gone from the world by the time the turn auto-resolves; the ack carries only own data.
    expect(Object.keys(ack).sort()).toEqual(['acceptedAt', 'ok', 'turnId']);
  });

  it('reveals the whole batch atomically in a single event, with no key material', async () => {
    const run = await startServer();
    const { players, turnId } = await startedGame(run, 3);
    await players[0]!.commit(turnId, CHARGE, SECRET);
    await players[1]!.commit(turnId, DODGE);
    const before = players[2]!.log.length;
    await players[2]!.commit(turnId, SHIELD);
    const result = await players[2]!.result(turnId);

    expect(result.actions).toHaveLength(3);
    // Between the last commit and the result, observers got only the lock notice, never partial actions.
    const revealEvents = players[0]!.log.filter((l) => JSON.stringify(l.payload).includes('"timedOut"'));
    expect(revealEvents.map((l) => l.event)).toEqual(['turn:result']);
    expect(players[0]!.log.length).toBeGreaterThan(before - 1);
    for (const p of players) expect(everythingSeenBy(p)).not.toContain(SECRET);
  });

  it('a reconnecting player gets their own commit back, and nobody else\'s', async () => {
    const run = await startServer();
    const { players, turnId } = await startedGame(run, 3);
    const [p1, p2] = players as [TestClient, TestClient, TestClient];
    await p1.commit(turnId, DODGE, SECRET);
    await p2.commit(turnId, SHIELD, 'p2-secret-key-55');

    const rejoin = await TestClient.connect(run.url);
    Object.assign(rejoin, { roomCode: p2.roomCode, playerId: p2.playerId, playerToken: p2.playerToken });
    const ack: any = await rejoin.resume();
    expect(ack.ok).toBe(true);
    const session = ack.session;
    expect(session.turn.ownCommit).toEqual({ idempotencyKey: 'p2-secret-key-55', action: { kind: 'DEFENSE', defense: 'SHIELD' } });
    expect(session.turn.lockedPlayerIds).toEqual(['p1', 'p2']);
    // p1's choice and key are nowhere in p2's restored state.
    const text = JSON.stringify(session);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('DODGE"}'); // p1's action payload shape
    expect(session.lastResult).toBeNull();
  });

  it('cannot resume as another seat: a wrong or borrowed token is rejected', async () => {
    const run = await startServer();
    const { players, roomCode } = await startedGame(run, 2);
    const [p1, p2] = players as [TestClient, TestClient];
    const thief = await TestClient.connect(run.url);
    const stolenAttempt = await thief.emit('session:resume', { roomCode, playerId: 'p1', playerToken: p2.playerToken });
    expect(stolenAttempt).toMatchObject({ ok: false, code: 'INVALID_TOKEN' });
    expect(await thief.emit('session:resume', { roomCode, playerId: 'p1', playerToken: 'guess' })).toMatchObject({ ok: false, code: 'INVALID_TOKEN' });
    expect(await thief.emit('session:resume', { roomCode, playerId: 'p9', playerToken: p1.playerToken })).toMatchObject({ ok: false, code: 'INVALID_TOKEN' });
    // And the failed attempts did not bind the thief to anything.
    expect(await thief.commit('x', CHARGE)).toMatchObject({ ok: false, code: 'NOT_IN_ROOM' });
    expect(thief.log.filter((l) => l.event.startsWith('turn:'))).toEqual([]);
  });

  it('a seat-less connection that knows the room code receives no game traffic', async () => {
    const run = await startServer();
    const { players, roomCode, turnId } = await startedGame(run, 2);
    const eavesdropper = await TestClient.connect(run.url);
    await eavesdropper.join(roomCode, 'late').catch(() => undefined); // rejected: GAME_STARTED
    await Promise.all(players.map((p) => p.commit(turnId, CHARGE)));
    await players[0]!.result(turnId);
    expect(eavesdropper.log).toEqual([]);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { ATTACKS, type AttackId } from '../../src/engine';
import type { TurnOpenPayload, TurnResultPayload } from '../../src/server';
import { CHARGE, DODGE, cleanup, startServer, startedGame, TestClient } from './harness';

afterEach(cleanup);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Both players Charge until turn 11 opens in Sudden Death (turns 1-10 are Normal Phase). */
async function intoSuddenDeath(players: TestClient[], firstTurnId: string): Promise<TurnOpenPayload> {
  let turn: TurnOpenPayload = { turnId: firstTurnId } as TurnOpenPayload;
  for (let i = 1; i <= 10; i++) {
    await Promise.all(players.map((p) => p.commit(turn.turnId, CHARGE)));
    turn = await players[0]!.waitFor<TurnOpenPayload>('turn:open', (t) => t.turnIndex === i + 1);
  }
  return turn;
}

describe('§10 timeout policy', () => {
  it('a player who misses the window is locked in as Charge; the lock reason is DEADLINE', async () => {
    const run = await startServer({ commitWindowMs: 150 });
    const { players, turnId } = await startedGame(run, 2);
    await players[0]!.commit(turnId, DODGE);
    // p2 says nothing.
    const locked: any = await players[0]!.waitFor('turn:locked');
    expect(locked).toEqual({ turnId, reason: 'DEADLINE' });
    const result = await players[1]!.result(turnId);
    expect(result.actions).toEqual([
      { playerId: 'p1', kind: 'DEFENSE', defense: 'DODGE', timedOut: false },
      { playerId: 'p2', kind: 'CHARGE', timedOut: true },
    ]);
    expect(result.state.players.p2!.charge).toBe(1);
  });

  it('with nobody committing, everyone defaults to Charge and the game keeps going', async () => {
    const run = await startServer({ commitWindowMs: 100 });
    const { players, turnId } = await startedGame(run, 3);
    const result = await players[0]!.result(turnId);
    expect(result.actions.every((a) => a.kind === 'CHARGE' && a.timedOut)).toBe(true);
    await players[0]!.waitFor('turn:open', (t: TurnOpenPayload) => t.turnIndex === 2);
  });

  it('opens each turn with a server-stamped deadline one commit window away', async () => {
    const run = await startServer({ commitWindowMs: 1234, now: () => 1_000_000 });
    const { players } = await startedGame(run, 2);
    const open: any = await players[0]!.waitFor('turn:open');
    expect(open).toMatchObject({ deadlineAt: 1_001_234, serverTime: 1_000_000 });
  });

  describe('Sudden Death', () => {
    it('forces Charge to be refused and, on timeout, picks an affordable attack for each player', async () => {
      const run = await startServer({ commitWindowMs: 400 });
      const { players, turnId } = await startedGame(run, 2);
      const sd = await intoSuddenDeath(players, turnId);
      expect(sd.phase).toBe('SUDDEN_DEATH');

      // Both are at 5 Charge: Charge and every defense are illegal now.
      expect(await players[0]!.commit(sd.turnId, CHARGE)).toMatchObject({ ok: false, code: 'ATTACK_MANDATORY' });
      expect(await players[0]!.commit(sd.turnId, DODGE)).toMatchObject({ ok: false, code: 'PHASE_RESTRICTED' });

      // Nobody commits a legal action: the timeout rule picks attacks.
      const result = await players[0]!.result(sd.turnId);
      expect(result.phase).toBe('SUDDEN_DEATH');
      expect(result.actions).toHaveLength(2);
      for (const action of result.actions) {
        expect(action.timedOut).toBe(true);
        expect(action.kind).toBe('ATTACK');
        expect(ATTACKS[action.weapon as AttackId].cost).toBeLessThanOrEqual(5);
      }
    });

    it('is reproducible from the server seed', async () => {
      const pick = async (): Promise<TurnResultPayload['actions']> => {
        const run = await startServer({ commitWindowMs: 300, seed: 'repro-seed' });
        const { players, turnId } = await startedGame(run, 2);
        const sd = await intoSuddenDeath(players, turnId);
        return (await players[0]!.result(sd.turnId)).actions;
      };
      expect(await pick()).toEqual(await pick());
    });

    it('a player who commits a legal attack keeps it; only the silent one is replaced', async () => {
      const run = await startServer({ commitWindowMs: 300 });
      const { players, turnId } = await startedGame(run, 2);
      const sd = await intoSuddenDeath(players, turnId);
      await players[0]!.commit(sd.turnId, { kind: 'ATTACK', weapon: 'AXE', targets: ['p2'] });
      const result = await players[1]!.result(sd.turnId);
      expect(result.actions[0]).toEqual({ playerId: 'p1', kind: 'ATTACK', weapon: 'AXE', targets: ['p2'], timedOut: false });
      expect(result.actions[1]).toMatchObject({ playerId: 'p2', kind: 'ATTACK', timedOut: true });
    });
  });
});

describe('disconnects and reconnects', () => {
  it('restores a player\'s pending commit after a reload without resolving the turn', async () => {
    const run = await startServer({ commitWindowMs: 5_000 });
    const { players, turnId, roomCode } = await startedGame(run, 3);
    const [p1, p2] = players as [TestClient, TestClient, TestClient];
    await p1.commit(turnId, DODGE, 'my-key');
    p1.socket.close();
    const dropped: any = await p2.waitFor('player:connection', (e: any) => e.playerId === 'p1' && e.status === 'DISCONNECTED');
    expect(dropped.status).toBe('DISCONNECTED');

    const reloaded = await TestClient.connect(run.url);
    Object.assign(reloaded, { roomCode, playerId: 'p1', playerToken: p1.playerToken });
    const ack: any = await reloaded.resume();
    expect(ack.ok).toBe(true);
    expect(ack.session.turn).toMatchObject({
      turnId,
      stage: 'COMMIT',
      ownCommit: { idempotencyKey: 'my-key', action: { kind: 'DEFENSE', defense: 'DODGE' } },
    });
    expect(ack.session.state.players.p1.connectionStatus).toBe('CONNECTED');
    await p2.waitFor('player:connection', (e: any) => e.playerId === 'p1' && e.status === 'CONNECTED');

    // The reloaded client can re-send its commit safely, but cannot change it.
    expect(await reloaded.commit(turnId, DODGE, 'my-key')).toMatchObject({ ok: true });
    expect(await reloaded.commit(turnId, CHARGE, 'another-key')).toMatchObject({ ok: false, code: 'ALREADY_COMMITTED' });

    // The turn then completes normally with the original action, un-timed-out.
    await p2.commit(turnId, DODGE);
    await players[2]!.commit(turnId, DODGE);
    const result = await reloaded.result(turnId);
    expect(result.actions[0]).toEqual({ playerId: 'p1', kind: 'DEFENSE', defense: 'DODGE', timedOut: false });
  });

  it('a reload before committing restores the private view and still allows a commit', async () => {
    const run = await startServer({ commitWindowMs: 5_000 });
    const { players, turnId, roomCode } = await startedGame(run, 2);
    const [p1, p2] = players as [TestClient, TestClient];
    p1.socket.close();
    await p2.waitFor('player:connection', (e: any) => e.status === 'DISCONNECTED');

    const reloaded = await TestClient.connect(run.url);
    Object.assign(reloaded, { roomCode, playerId: 'p1', playerToken: p1.playerToken });
    const ack: any = await reloaded.resume();
    expect(ack.session.turn.ownCommit).toBeNull();
    expect(ack.session.turn.availability.charge.available).toBe(true);
    expect(ack.session.turn.deadlineAt).toBeGreaterThan(ack.session.serverTime);

    await reloaded.commit(turnId, CHARGE);
    await p2.commit(turnId, CHARGE);
    expect((await reloaded.result(turnId)).actions.map((a) => a.timedOut)).toEqual([false, false]);
  });

  it('a player who stays away is timed out each turn while the game carries on', async () => {
    const run = await startServer({ commitWindowMs: 120 });
    const { players, turnId } = await startedGame(run, 2);
    const [p1, p2] = players as [TestClient, TestClient];
    p2.socket.close();
    await p1.waitFor('player:connection', (e: any) => e.status === 'DISCONNECTED');

    await p1.commit(turnId, CHARGE);
    const r1 = await p1.result(turnId);
    expect(r1.actions[1]).toEqual({ playerId: 'p2', kind: 'CHARGE', timedOut: true });
    expect(r1.state.players.p2!.connectionStatus).toBe('DISCONNECTED');

    const t2: TurnOpenPayload = await p1.waitFor('turn:open', (t: TurnOpenPayload) => t.turnIndex === 2);
    const r2 = await p1.result(t2.turnId); // p1 silent too: both time out
    expect(r2.actions.every((a) => a.timedOut)).toBe(true);
  });

  it('a reconnect while the old socket is still open wins, and the old socket closing later does not drop the player', async () => {
    const run = await startServer({ commitWindowMs: 5_000 });
    const { players, roomCode } = await startedGame(run, 2);
    const [p1, p2] = players as [TestClient, TestClient];
    const fresh = await TestClient.connect(run.url);
    Object.assign(fresh, { roomCode, playerId: 'p1', playerToken: p1.playerToken });
    expect((await fresh.resume()).ok).toBe(true);

    p1.socket.close(); // the stale socket finally goes away
    await sleep(100);
    expect(p2.events('player:connection').filter((e) => e.playerId === 'p1')).toEqual([]);
    const check: any = await fresh.resume();
    expect(check.session.state.players.p1.connectionStatus).toBe('CONNECTED');
  });

  it('deliveries after a reload target the new socket: the resumed player receives the turn result', async () => {
    const run = await startServer({ commitWindowMs: 5_000 });
    const { players, turnId, roomCode } = await startedGame(run, 2);
    const [p1, p2] = players as [TestClient, TestClient];
    p1.socket.close();
    await p2.waitFor('player:connection', (e: any) => e.status === 'DISCONNECTED');
    const reloaded = await TestClient.connect(run.url);
    Object.assign(reloaded, { roomCode, playerId: 'p1', playerToken: p1.playerToken });
    await reloaded.resume();

    await Promise.all([reloaded.commit(turnId, CHARGE), p2.commit(turnId, CHARGE)]);
    const [a, b] = await Promise.all([reloaded.result(turnId), p2.result(turnId)]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('between turns a resumed client is told so and gets the last public result to catch up', async () => {
    const run = await startServer({ commitWindowMs: 5_000, interTurnDelayMs: 400 });
    const { players, turnId, roomCode } = await startedGame(run, 2);
    const [p1, p2] = players as [TestClient, TestClient];
    await Promise.all(players.map((p) => p.commit(turnId, CHARGE)));
    await p1.result(turnId);

    const reloaded = await TestClient.connect(run.url);
    Object.assign(reloaded, { roomCode, playerId: 'p2', playerToken: p2.playerToken });
    const ack: any = await reloaded.resume();
    expect(ack.session.turn.stage).toBe('BETWEEN_TURNS');
    expect(ack.session.turn.ownCommit).toBeNull();
    expect(ack.session.lastResult.turnId).toBe(turnId);
    await reloaded.waitFor('turn:open', (t: TurnOpenPayload) => t.turnIndex === 2);
  });

  it('holds a lobby seat through a reload, but frees it (and reassigns host) after the grace period', async () => {
    const run = await startServer({ reconnectGraceMs: 200 });
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    const guest = await TestClient.connect(run.url);
    await guest.join(host.roomCode, 'Guest');

    host.socket.close();
    await guest.waitFor('lobby:update', (l: any) => l.players[0].connected === false);
    const back = await TestClient.connect(run.url);
    Object.assign(back, { roomCode: host.roomCode, playerId: 'p1', playerToken: host.playerToken });
    expect((await back.resume()).ok).toBe(true); // within grace: seat kept

    guest.socket.close();
    await back.waitFor('lobby:update', (l: any) => l.players.length === 1);
    expect((await back.emit('game:start')).ok).toBe(false); // alone again
  });

  it('closes a room that has stayed empty past the grace period', async () => {
    const run = await startServer({ reconnectGraceMs: 150 });
    const host = await TestClient.connect(run.url);
    await host.create('Host');
    expect(run.server.rooms.size).toBe(1);
    host.socket.close();
    await sleep(400);
    expect(run.server.rooms.size).toBe(0);
  });
});

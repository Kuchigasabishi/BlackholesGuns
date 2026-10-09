import { afterEach, describe, expect, it } from 'vitest';
import type { TurnLifecycleHooks, TurnOpenPayload } from '../../src/server';
import { CHARGE, DODGE, cleanup, startServer, startedGame, SHIELD } from './harness';

afterEach(cleanup);

describe('§10 turn lifecycle hooks', () => {
  it('fires OPEN, COMMIT, LOCK, REVEAL, RESOLVE, APPLY, COMPLETE in order, then OPEN again', async () => {
    const stages: string[] = [];
    const hooks: TurnLifecycleHooks = {
      onOpen: (e) => stages.push(`OPEN:${e.turnId}`),
      onCommit: (e) => stages.push(`COMMIT:${e.playerId}`),
      onLock: (e) => stages.push(`LOCK:${e.reason}`),
      onReveal: (e) => stages.push(`REVEAL:${e.actions.length}`),
      onResolve: () => stages.push('RESOLVE'),
      onApply: () => stages.push('APPLY'),
      onComplete: (e) => stages.push(`COMPLETE:${e.outcome.transition}`),
    };
    const run = await startServer({}, hooks);
    const { players, turnId } = await startedGame(run, 2);
    await players[0]!.commit(turnId, CHARGE);
    await players[1]!.commit(turnId, DODGE);
    await players[0]!.waitFor('turn:open', (p: TurnOpenPayload) => p.turnIndex === 2);

    expect(stages).toEqual([
      `OPEN:${turnId}`,
      'COMMIT:p1',
      'COMMIT:p2',
      'LOCK:ALL_COMMITTED',
      'REVEAL:2',
      'RESOLVE',
      'APPLY',
      'COMPLETE:NEXT_TURN',
      expect.stringMatching(/^OPEN:.*:t2$/),
    ]);
  });

  it('a throwing hook cannot break the game', async () => {
    const run = await startServer({}, {
      onResolve: () => {
        throw new Error('observer bug');
      },
    });
    const { players, turnId } = await startedGame(run, 2);
    await Promise.all(players.map((p) => p.commit(turnId, CHARGE)));
    expect((await players[0]!.result(turnId)).outcome.transition).toBe('NEXT_TURN');
  });
});

describe('synchronized turn results', () => {
  it('every client receives the identical canonical result, in order: open, locked, result, next open', async () => {
    const run = await startServer();
    const { players, turnId } = await startedGame(run, 3);
    await Promise.all([
      players[0]!.commit(turnId, CHARGE),
      players[1]!.commit(turnId, DODGE),
      players[2]!.commit(turnId, SHIELD),
    ]);
    const results = await Promise.all(players.map((p) => p.result(turnId)));
    expect(JSON.stringify(results[1])).toBe(JSON.stringify(results[0]));
    expect(JSON.stringify(results[2])).toBe(JSON.stringify(results[0]));

    const r = results[0]!;
    expect(r.actions).toEqual([
      { playerId: 'p1', kind: 'CHARGE', timedOut: false },
      { playerId: 'p2', kind: 'DEFENSE', defense: 'DODGE', timedOut: false },
      { playerId: 'p3', kind: 'DEFENSE', defense: 'SHIELD', timedOut: false },
    ]);
    expect(r.outcome.transition).toBe('NEXT_TURN');
    expect(r.state.players.p1!.charge).toBe(1);
    expect(r.state.players.p2!.charge).toBe(0);

    for (const p of players) {
      await p.waitFor('turn:open', (t: TurnOpenPayload) => t.turnIndex === 2);
      const order = p.log.map((l) => l.event).filter((e) => ['turn:open', 'turn:locked', 'turn:result'].includes(e));
      expect(order).toEqual(['turn:open', 'turn:locked', 'turn:result', 'turn:open']);
    }
  });

  it('broadcasts WHO has committed (never what) as the window fills', async () => {
    const run = await startServer();
    const { players, turnId } = await startedGame(run, 3);
    await players[1]!.commit(turnId, DODGE);
    const progress: any = await players[2]!.waitFor('turn:progress', (p: any) => p.lockedPlayerIds.length === 1);
    expect(progress).toEqual({ turnId, lockedPlayerIds: ['p2'] });
  });

  it('gives each player a private availability view at OPEN', async () => {
    const run = await startServer();
    const { players, turnId } = await startedGame(run, 2);
    const priv: any = await players[0]!.waitFor('turn:private');
    expect(priv.turnId).toBe(turnId);
    expect(priv.availability.charge.available).toBe(true);
    expect(priv.availability.attacks.GUN).toEqual({ available: false, reason: 'UNAFFORDABLE' });
  });

  it('plays through an elimination: match ends, wins persist, next match opens with the full lobby', async () => {
    const run = await startServer();
    const { players, turnId } = await startedGame(run, 2);
    await Promise.all(players.map((p) => p.commit(turnId, CHARGE)));
    const t2: TurnOpenPayload = await players[0]!.waitFor('turn:open', (t: TurnOpenPayload) => t.turnIndex === 2);

    await players[0]!.commit(t2.turnId, { kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] });
    await players[1]!.commit(t2.turnId, CHARGE);
    const result = await players[1]!.result(t2.turnId);
    expect(result.outcome).toMatchObject({ transition: 'MATCH_ENDED', matchWinnerId: 'p1', eliminatedPlayerIds: ['p2'] });
    expect(result.state.series.matchWins).toEqual({ p1: 1, p2: 0 });
    expect(result.events[0]).toMatchObject({ ruleType: 'CHARGE_HIT', outcome: 'TARGET_ELIMINATED' });

    const next: TurnOpenPayload = await players[1]!.waitFor('turn:open', (t: TurnOpenPayload) => t.turnId.includes(':m2:'));
    expect(next.eligiblePlayerIds).toEqual(['p1', 'p2']);
  });
});

describe('commit validation over the wire', () => {
  it('rejects illegal, stale, duplicate and malformed commits with precise codes', async () => {
    const run = await startServer();
    const { players, turnId } = await startedGame(run, 2);
    const [p1, p2] = players as [typeof players[0], typeof players[0]];

    expect(await p1.commit(turnId, { kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] })).toMatchObject({ ok: false, code: 'UNAFFORDABLE' });
    expect(await p1.commit(turnId, { kind: 'DEFENSE', defense: 'FORCEFIELD' as never })).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
    expect(await p1.commit('someone-elses-turn', CHARGE)).toMatchObject({ ok: false, code: 'STALE_TURN' });
    expect(await p1.emit('action:commit', { turnId })).toMatchObject({ ok: false, code: 'BAD_PAYLOAD' });
    expect(await p1.emit('action:commit', 'nope')).toMatchObject({ ok: false, code: 'BAD_PAYLOAD' });
    expect(await p1.emit('action:commit', { turnId, idempotencyKey: 'k', action: { kind: 'TELEPORT' } })).toMatchObject({ ok: false, code: 'BAD_PAYLOAD' });

    // Rejections did not consume the player's one commit.
    expect(await p1.commit(turnId, CHARGE, 'first')).toMatchObject({ ok: true });
    expect(await p1.commit(turnId, DODGE, 'second')).toMatchObject({ ok: false, code: 'ALREADY_COMMITTED' });
    // Replaying the same idempotency key is safe and returns the original acceptance.
    expect(await p1.commit(turnId, CHARGE, 'first')).toMatchObject({ ok: true });
    expect(await p1.commit(turnId, DODGE, 'first')).toMatchObject({ ok: true }); // same key: payload ignored, original stands

    await p2.commit(turnId, DODGE);
    const result = await p1.result(turnId);
    expect(result.actions[0]).toMatchObject({ playerId: 'p1', kind: 'CHARGE' }); // not the replayed Dodge

    // After the turn resolved, its token is stale.
    expect(await p1.commit(turnId, CHARGE, 'late')).toMatchObject({ ok: false, code: 'STALE_TURN' });
  });

  it('the acting seat comes from the socket binding, never from the payload', async () => {
    const run = await startServer();
    const { players, turnId } = await startedGame(run, 2);
    const [p1, p2] = players as [typeof players[0], typeof players[0]];
    await p2.emit('action:commit', { turnId, idempotencyKey: 'x', playerId: 'p1', action: { kind: 'CHARGE', playerId: 'p1' } });
    await p1.commit(turnId, DODGE);
    const result = await p1.result(turnId);
    expect(result.actions).toEqual([
      { playerId: 'p1', kind: 'DEFENSE', defense: 'DODGE', timedOut: false },
      { playerId: 'p2', kind: 'CHARGE', timedOut: false },
    ]);
  });
});

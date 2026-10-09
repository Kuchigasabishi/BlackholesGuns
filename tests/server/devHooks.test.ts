import { afterEach, describe, expect, it } from 'vitest';
import { createSeededRng, createSeries, type GameState } from '../../src/engine';
import { DevHookError, fastForward, setCharges, setNoEliminationStreak } from '../../src/server';
import { CHARGE, DODGE, cleanup, dev, startServer, startedGame } from './harness';

afterEach(cleanup);

describe('dev hook transformations (pure)', () => {
  const fresh = (n = 2): GameState => createSeries({ seriesId: 's', playerIds: Array.from({ length: n }, (_, i) => `p${i + 1}`) });

  it('setCharges sets balances and validates range, integers, and living players', () => {
    const state = setCharges(fresh(), { p1: 5, p2: 3 });
    expect([state.players.p1!.charge, state.players.p2!.charge]).toEqual([5, 3]);
    for (const bad of [6, -1, 1.5, Number.NaN]) {
      expect(() => setCharges(fresh(), { p1: bad })).toThrowError(DevHookError);
    }
    expect(() => setCharges(fresh(), { p9: 1 })).toThrowError(expect.objectContaining({ code: 'INVALID_PLAYER' }));
  });

  it('setNoEliminationStreak recomputes the phase with the engine\'s own rule', () => {
    expect(setNoEliminationStreak(fresh(), 9).turn!.phase).toBe('NORMAL');
    expect(setNoEliminationStreak(fresh(), 10).turn!.phase).toBe('SUDDEN_DEATH');
    expect(setNoEliminationStreak(fresh(), 15).round.phase).toBe('OVERTIME');
    expect(setNoEliminationStreak(fresh(3), 40).turn!.phase).toBe('NORMAL'); // 3 players never enter Sudden Death
  });

  it('fastForward plays real turns through the engine and stops at an elimination', () => {
    const r = fastForward(fresh(), 5, createSeededRng('x'));
    expect(r).toMatchObject({ turnsPlayed: 5, stoppedBy: null });
    expect(r.state.round.noEliminationStreak).toBe(5);
    // Past Sudden Death entry the rules (not the hook) pick the actions.
    const deep = fastForward(fresh(), 40, createSeededRng('y'));
    expect(deep.turnsPlayed).toBeGreaterThan(10);
  });
});

describe('dev endpoints', () => {
  it('do not exist unless dev mode is on (plain 404, indistinguishable from any unknown path)', async () => {
    const run = await startServer();
    const res = await dev(run, '/dev/charges', { roomCode: 'ABCDEF', charges: { p1: 5 } });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('require the x-dev-token when one is configured', async () => {
    const run = await startServer({}, undefined, { devMode: true, devToken: 'sesame' });
    const { roomCode } = await startedGame(run, 2);
    expect((await dev(run, '/dev/streak', { roomCode, streak: 9 })).status).toBe(403);
    expect((await dev(run, '/dev/streak', { roomCode, streak: 9 }, { 'x-dev-token': 'wrong' })).status).toBe(403);
    expect((await dev(run, '/dev/streak', { roomCode, streak: 9 }, { 'x-dev-token': 'sesame' })).status).toBe(200);
  });

  it('seed Charge balances: clients immediately see updated state and availability', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const { players, roomCode } = await startedGame(run, 2);
    const res = await dev(run, '/dev/charges', { roomCode, charges: { p1: 5, p2: 2 } });
    expect(res).toMatchObject({ status: 200, body: { ok: true } });

    const sync: any = await players[0]!.waitFor('state:sync');
    expect(sync.state.players.p1.charge).toBe(5);
    const priv: any = await players[0]!.waitFor('turn:private', (p: any) => p.availability.attacks.BLACKHOLE.available);
    expect(priv.availability.attacks.BLACKHOLE.available).toBe(true);
    const priv2: any = await players[1]!.waitFor('turn:private', (p: any) => p.availability.attacks.AXE.available);
    expect(priv2.availability.attacks.KATANA).toEqual({ available: false, reason: 'UNAFFORDABLE' });
  });

  it('a 9-turn streak plus one quiet turn opens Sudden Death immediately', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    expect((await dev(run, '/dev/streak', { roomCode, streak: 9 })).status).toBe(200);

    // Turn 1 is still Normal Phase (9 < 10): Dodge is legal.
    await Promise.all(players.map((p) => p.commit(turnId, DODGE)));
    const next: any = await players[0]!.waitFor('turn:open', (t: any) => t.turnId !== turnId);
    expect(next.phase).toBe('SUDDEN_DEATH');
    const priv: any = await players[0]!.waitFor('turn:private', (p: any) => p.turnId === next.turnId);
    expect(priv.availability.defenses.DODGE).toEqual({ available: false, reason: 'PHASE_RESTRICTED' });
    expect(priv.availability.charge.available).toBe(true); // both at 0 Charge: nothing affordable
  });

  it('a streak of 10 re-announces the open turn as Sudden Death right away', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    await dev(run, '/dev/streak', { roomCode, streak: 10 });
    const reopened: any = await players[1]!.waitFor('turn:open', (t: any) => t.turnId === turnId && t.phase === 'SUDDEN_DEATH');
    expect(reopened.phase).toBe('SUDDEN_DEATH');
    expect(await players[0]!.commit(turnId, DODGE)).toMatchObject({ ok: false, code: 'PHASE_RESTRICTED' });
  });

  it('fast-forward advances the round by real turns', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const { players, roomCode } = await startedGame(run, 2);
    const res = await dev(run, '/dev/fastforward', { roomCode, turns: 6 });
    expect(res.body).toMatchObject({ ok: true, turnsPlayed: 6, stoppedBy: null });
    const sync: any = await players[0]!.waitFor('state:sync', (s: any) => s.reason === 'fastForward');
    expect(sync.state.round.noEliminationStreak).toBe(6);
    expect(sync.state.round.turnIndex).toBe(7);
  });

  it('inject action sets through the normal commit path, optionally closing the window', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 3);
    const res = await dev(run, '/dev/actions', {
      roomCode,
      lock: true,
      actions: { p1: CHARGE, p2: DODGE, p3: { kind: 'ATTACK', weapon: 'NUKE', targets: [] } },
    });
    // Still bound by the rules: p3 cannot afford a Nuke at 0 Charge, so it times out to Charge.
    expect(res.body.results).toMatchObject({ p1: { ok: true }, p2: { ok: true }, p3: { ok: false, code: 'UNAFFORDABLE' } });
    const result = await players[0]!.result(turnId);
    expect(result.actions.map((a) => [a.playerId, a.kind, a.timedOut])).toEqual([
      ['p1', 'CHARGE', false],
      ['p2', 'DEFENSE', false],
      ['p3', 'CHARGE', true],
    ]);
  });

  it('can stage a full scenario: seed Charge, then inject an attack that eliminates a charger', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    await dev(run, '/dev/charges', { roomCode, charges: { p1: 3 } });
    await dev(run, '/dev/actions', {
      roomCode,
      lock: true,
      actions: { p1: { kind: 'ATTACK', weapon: 'KATANA', targets: ['p2'] }, p2: CHARGE },
    });
    const result = await players[1]!.result(turnId);
    expect(result.outcome).toMatchObject({ eliminatedPlayerIds: ['p2'], matchWinnerId: 'p1', transition: 'MATCH_ENDED' });
  });

  it('reject bad input with precise codes', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    expect((await dev(run, '/dev/charges', { roomCode: 'ZZZZZZ', charges: {} })).body).toMatchObject({ code: 'ROOM_NOT_FOUND' });
    const { roomCode } = await startedGame(run, 2);
    expect((await dev(run, '/dev/charges', { roomCode })).body).toMatchObject({ code: 'BAD_PAYLOAD' });
    expect((await dev(run, '/dev/charges', { roomCode, charges: { p1: 99 } })).body).toMatchObject({ code: 'BAD_PAYLOAD' });
    expect((await dev(run, '/dev/streak', { roomCode, streak: -3 })).body).toMatchObject({ code: 'BAD_PAYLOAD' });
    expect((await dev(run, '/dev/nope', { roomCode })).body).toMatchObject({ code: 'BAD_PAYLOAD' });
    const lobbyOnly = await fetch(`${run.url}/dev/charges`, { method: 'POST', body: '{not json' });
    expect(lobbyOnly.status).toBe(400);
  });

  it('do not change the rules: Charge still dies to an attack, and hooks cannot exceed the cap', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    await dev(run, '/dev/charges', { roomCode, charges: { p1: 5, p2: 5 } });
    await dev(run, '/dev/actions', { roomCode, lock: true, actions: { p1: CHARGE, p2: { kind: 'ATTACK', weapon: 'GUN', targets: ['p1'] } } });
    const result = await players[0]!.result(turnId);
    expect(result.outcome.eliminatedPlayerIds).toEqual(['p1']);
  });
});

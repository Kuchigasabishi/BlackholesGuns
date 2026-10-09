import { afterEach, describe, expect, it } from 'vitest';
import { TELEMETRY_EVENT_TYPES, createBufferedTelemetry, type LogEntry } from '../../src/server';
import { CHARGE, DODGE, cleanup, dev, startServer, startedGame, type Running, type TestClient } from './harness';

afterEach(cleanup);

const SECRET_KEY = 'KEY-SECRET-telemetry-91c2';

const ofType = (entries: readonly LogEntry[], type: string): LogEntry[] => entries.filter((e) => e.type === type);

/**
 * One scripted series that exercises every §16 event: a quiet Normal turn, a
 * rejected action, a timeout, a Sudden Death transition, a matrix outcome, a
 * collision, a 3-player round end, a match end, and finally a series end.
 */
async function playEverything(run: Running): Promise<void> {
  const { players, roomCode } = await startedGame(run, 3);
  const [p1, p2, p3] = players as [TestClient, TestClient, TestClient];
  const open = async (n: number): Promise<any> => p1.waitFor('turn:open', (t: any) => t.turnIndex === n && !t.turnId.includes(':r2'));

  // Turn 1: p1 submits an illegal attack (rejected), then Charges; p2 Dodges; p3 times out.
  const t1: any = await open(1);
  await p1.commit(t1.turnId, { kind: 'ATTACK', weapon: 'NUKE', targets: [] }, SECRET_KEY);
  await p1.commit(t1.turnId, CHARGE, SECRET_KEY + '-ok');
  await p2.commit(t1.turnId, DODGE);
  await dev(run, '/dev/actions', { roomCode, lock: true, actions: {} }); // closes the window; p3 times out

  // Turn 2: a collision (Gun vs Gun neutralize) and a matrix outcome (Gatling vs Dodge blocks nothing: eliminates).
  await p1.waitFor('turn:result', (r: any) => r.turnId === t1.turnId);
  const t2: any = await open(2);
  await dev(run, '/dev/charges', { roomCode, charges: { p1: 2, p2: 1, p3: 0 } });
  await dev(run, '/dev/actions', {
    roomCode,
    lock: true,
    actions: { p1: { kind: 'ATTACK', weapon: 'GATLING_GUN', targets: ['p3'] }, p2: DODGE, p3: DODGE },
  });
  await p1.waitFor('turn:result', (r: any) => r.turnId === t2.turnId);

  // Round 2 (p1, p2 alive): force 9 -> 10 quiet turns to trigger Sudden Death, then end the match.
  const r2: any = await p1.waitFor('turn:open', (t: any) => t.turnId.includes(':r2'));
  await dev(run, '/dev/streak', { roomCode, streak: 9 });
  await dev(run, '/dev/actions', { roomCode, lock: true, actions: { p1: DODGE, p2: DODGE } });
  await p1.waitFor('turn:result', (r: any) => r.turnId === r2.turnId);
  const sd: any = await p1.waitFor('turn:open', (t: any) => t.phase === 'SUDDEN_DEATH');
  // Sudden Death attack turn: Gun vs Knife is a collision (ranged beats melee) and ends match 1.
  await dev(run, '/dev/charges', { roomCode, charges: { p1: 1, p2: 1 } });
  await dev(run, '/dev/actions', {
    roomCode,
    lock: true,
    actions: { p1: { kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] }, p2: { kind: 'ATTACK', weapon: 'KNIFE', targets: ['p1'] } },
  });
  await p1.waitFor('turn:result', (r: any) => r.turnId === sd.turnId);

  // Win the series: nine more matches (a Grenade at both opponents ends a 3-player match in one turn).
  for (let m = 2; m <= 10; m++) {
    const o: any = await p1.waitFor('turn:open', (t: any) => t.turnId.includes(`:m${m}:r1:`) && t.turnIndex === 1);
    await dev(run, '/dev/charges', { roomCode, charges: { p1: 3 } });
    await dev(run, '/dev/actions', { roomCode, lock: true, actions: { p1: { kind: 'ATTACK', weapon: 'GRENADE', targets: ['p2', 'p3'] }, p2: CHARGE, p3: CHARGE } });
    await p1.waitFor('turn:result', (r: any) => r.turnId === o.turnId);
  }
  await p1.waitFor('series:ended');
}

describe('§16 telemetry: all 14 lifecycle events', () => {
  it('emits every event type at least once across a full series', async () => {
    const telemetry = createBufferedTelemetry();
    const run = await startServer({}, undefined, { devMode: true, telemetry });
    await playEverything(run);

    const seen = new Set(telemetry.entries.map((e) => e.type));
    const missing = TELEMETRY_EVENT_TYPES.filter((t) => !seen.has(t));
    expect(missing).toEqual([]);
    expect(TELEMETRY_EVENT_TYPES).toHaveLength(14);
  }, 20_000);

  it('is structured JSON: every entry round-trips through JSON and carries a timestamp and type', async () => {
    const telemetry = createBufferedTelemetry();
    const run = await startServer({}, undefined, { telemetry });
    const { players, turnId } = await startedGame(run, 2);
    await Promise.all(players.map((p) => p.commit(turnId, CHARGE)));
    await players[0]!.result(turnId);
    expect(telemetry.entries.length).toBeGreaterThan(4);
    for (const entry of telemetry.entries) {
      expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
      expect(typeof entry.timestamp).toBe('number');
      expect(TELEMETRY_EVENT_TYPES).toContain(entry.type);
    }
  });

  it('records the §16 fields: versions, scores, player count, phase, streak, seed, action ids, cost deltas, target sets, result codes', async () => {
    const telemetry = createBufferedTelemetry();
    const run = await startServer({ seed: 'telemetry-seed' }, undefined, { devMode: true, telemetry });
    const { players, roomCode, turnId } = await startedGame(run, 3);
    await dev(run, '/dev/charges', { roomCode, charges: { p1: 3 } });
    await dev(run, '/dev/actions', {
      roomCode,
      lock: true,
      actions: { p1: { kind: 'ATTACK', weapon: 'KATANA', targets: ['p2', 'p3'] }, p2: DODGE, p3: { kind: 'DEFENSE', defense: 'SHIELD' } },
    });
    await players[0]!.result(turnId);

    const started = ofType(telemetry.entries, 'series_started')[0]!;
    expect(started).toMatchObject({ seed: 'telemetry-seed', rulesVersion: '1.0.4', matrixVersion: 'v2', playerCount: 3, lobby: ['p1', 'p2', 'p3'] });

    const revealed = ofType(telemetry.entries, 'turn_revealed')[0]!;
    expect(revealed).toMatchObject({ phase: 'NORMAL', noEliminationStreak: 0, matchWins: { p1: 0, p2: 0, p3: 0 } });
    expect(revealed.actions).toEqual([
      { playerId: 'p1', kind: 'ATTACK', actionId: 'KATANA', targets: ['p2', 'p3'], timedOut: false },
      { playerId: 'p2', kind: 'DEFENSE', actionId: 'DODGE', targets: [], timedOut: false },
      { playerId: 'p3', kind: 'DEFENSE', actionId: 'SHIELD', targets: [], timedOut: false },
    ]);
    expect(revealed.costDeltas).toEqual([
      { playerId: 'p1', chargeBefore: 3, chargeAfter: 0, delta: -3 },
      { playerId: 'p2', chargeBefore: 0, chargeAfter: 0, delta: 0 },
      { playerId: 'p3', chargeBefore: 0, chargeAfter: 0, delta: 0 },
    ]);

    const outcomes = ofType(telemetry.entries, 'matrix_outcome');
    expect(outcomes.map((o) => [o.targetPlayerId, o.ruleId, o.resultCode, o.outcome])).toEqual([
      ['p2', 'MATRIX_V2:KATANA:DODGE', 'BLOCK', 'BLOCKED'],
      ['p3', 'MATRIX_V2:KATANA:SHIELD', 'BLOCK', 'BLOCKED'],
    ]);
    expect(outcomes[0]).toMatchObject({ weapon: 'KATANA', effectTargetSet: ['p2', 'p3'], sourcePlayerId: 'p1' });
  });

  it('logs attack collisions separately from matrix outcomes, and eliminations with their causes', async () => {
    const telemetry = createBufferedTelemetry();
    const run = await startServer({}, undefined, { devMode: true, telemetry });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    await dev(run, '/dev/charges', { roomCode, charges: { p1: 1, p2: 2 } });
    await dev(run, '/dev/actions', {
      roomCode,
      lock: true,
      actions: { p1: { kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] }, p2: { kind: 'ATTACK', weapon: 'AXE', targets: ['p1'] } },
    });
    await players[0]!.result(turnId);

    const collisions = ofType(telemetry.entries, 'attack_collision');
    expect(collisions.map((c) => [c.sourcePlayerId, c.ruleId, c.outcome])).toEqual([
      ['p1', 'COLLISION:HIGHER_TIER', 'ATTACKER_ELIMINATED'],
      ['p2', 'COLLISION:HIGHER_TIER', 'TARGET_ELIMINATED'],
    ]);
    expect(ofType(telemetry.entries, 'matrix_outcome')).toHaveLength(0);
    expect(ofType(telemetry.entries, 'elimination')).toMatchObject([{ playerId: 'p1', causes: ['COLLISION:HIGHER_TIER', 'COLLISION:HIGHER_TIER'] }]);
    expect(ofType(telemetry.entries, 'match_ended')[0]).toMatchObject({ winnerId: 'p2', matchWins: { p1: 0, p2: 1 } });
    expect(ofType(telemetry.entries, 'match_started')).toHaveLength(2); // the first match and the rollover
  });

  it('logs action_rejected with who/why but not what, and phase_changed with from/to', async () => {
    const telemetry = createBufferedTelemetry();
    const run = await startServer({}, undefined, { devMode: true, telemetry });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    await players[0]!.commit(turnId, { kind: 'ATTACK', weapon: 'NUKE', targets: [] }, SECRET_KEY);
    const rejected = ofType(telemetry.entries, 'action_rejected');
    expect(rejected).toMatchObject([{ playerId: 'p1', code: 'UNAFFORDABLE' }]);
    expect(JSON.stringify(rejected)).not.toContain('NUKE');

    await dev(run, '/dev/streak', { roomCode, streak: 9 });
    await dev(run, '/dev/actions', { roomCode, lock: true, actions: { p1: DODGE, p2: DODGE } });
    await players[0]!.result(turnId);
    expect(ofType(telemetry.entries, 'phase_changed')).toMatchObject([{ from: 'NORMAL', to: 'SUDDEN_DEATH', noEliminationStreak: 9 }]);
  });

  it('never logs a player\'s action before REVEAL', async () => {
    const telemetry = createBufferedTelemetry();
    const run = await startServer({}, undefined, { telemetry });
    const { players, turnId } = await startedGame(run, 3);
    await players[0]!.commit(turnId, { kind: 'DEFENSE', defense: 'SHIELD' }, SECRET_KEY);
    await players[1]!.commit(turnId, DODGE);
    await players[0]!.waitFor('turn:progress', (p: any) => p.lockedPlayerIds.length === 2);

    // Two players have committed; the turn has not been revealed. Nothing logged so far may reveal either choice.
    const beforeReveal = JSON.stringify(telemetry.entries);
    expect(beforeReveal).not.toContain('SHIELD');
    expect(beforeReveal).not.toContain('DODGE');
    expect(beforeReveal).not.toContain(SECRET_KEY);
    expect(ofType(telemetry.entries, 'action_submitted')).toHaveLength(2);
    expect(ofType(telemetry.entries, 'turn_revealed')).toHaveLength(0);

    await players[2]!.commit(turnId, CHARGE);
    await players[0]!.result(turnId);
    expect(JSON.stringify(ofType(telemetry.entries, 'turn_revealed'))).toContain('SHIELD'); // revealed now
  });

  it('logs turn_locked with the reason and who timed out', async () => {
    const telemetry = createBufferedTelemetry();
    const run = await startServer({ commitWindowMs: 150 }, undefined, { telemetry });
    const { players, turnId } = await startedGame(run, 2);
    await players[0]!.commit(turnId, DODGE);
    await players[0]!.result(turnId);
    expect(ofType(telemetry.entries, 'turn_locked')[0]).toMatchObject({
      reason: 'DEADLINE',
      committedPlayerIds: ['p1'],
      timedOutPlayerIds: ['p2'],
    });
  });
});

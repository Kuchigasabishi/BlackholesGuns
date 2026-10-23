import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ReplayError,
  createFileReplayStore,
  parseReplay,
  replay,
  serializeReplay,
  verifyReplay,
  type ReplayLog,
} from '../../src/server';
import { CHARGE, DODGE, cleanup, dev, startServer, startedGame, type Running, type TestClient } from './harness';

afterEach(cleanup);

/**
 * Plays a varied game: Normal turns, a dev-forced Sudden Death, timeouts that
 * pick random attacks, an elimination, and a new match. Returns the live log.
 */
async function playVariedGame(run: Running, players: TestClient[], roomCode: string, firstTurnId: string): Promise<ReplayLog> {
  // Turn 1: a plain Charge/Dodge turn.
  await players[0]!.commit(firstTurnId, CHARGE);
  await players[1]!.commit(firstTurnId, DODGE);
  const t2: any = await players[0]!.waitFor('turn:open', (t: any) => t.turnIndex === 2);

  // Force Sudden Death with both at 3 Charge, then let the SECOND player time out (random attack).
  await dev(run, '/dev/charges', { roomCode, charges: { p1: 3, p2: 3 } });
  await dev(run, '/dev/streak', { roomCode, streak: 10 });
  await players[0]!.commit(t2.turnId, { kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] });
  await dev(run, '/dev/actions', { roomCode, lock: true, actions: {} }); // close the window: p2 times out
  await players[0]!.waitFor('turn:result', (r: any) => r.turnId === t2.turnId);

  const body: any = await (await fetch(`${run.url}/dev/replay/${roomCode}`)).json();
  return body.log as ReplayLog;
}

describe('§16 deterministic replay', () => {
  it('records initial state, versions, seed, and one entry per turn plus dev overrides', async () => {
    const run = await startServer({ seed: 'replay-seed' }, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    const log = await playVariedGame(run, players, roomCode, turnId);

    expect(log).toMatchObject({ formatVersion: 1, seed: 'replay-seed', rulesVersion: '1.1.0', matrixVersion: 'v2' });
    expect(log.initialState.round.turnIndex).toBe(1);
    expect(log.entries.map((e) => (e.type === 'OVERRIDE' ? `OVERRIDE:${e.reason}` : 'TURN'))).toEqual([
      'TURN',
      'OVERRIDE:setCharges',
      'OVERRIDE:setNoEliminationStreak',
      'TURN',
    ]);
  });

  it('replays to byte-identical canonical outcomes (including timeout-chosen actions)', async () => {
    const run = await startServer({ seed: 'replay-seed' }, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    const log = await playVariedGame(run, players, roomCode, turnId);

    const recorded = log.entries.filter((e) => e.type === 'TURN').map((e) => (e as { canonical: string }).canonical);
    const first = verifyReplay(log);
    const second = replay(log);
    expect(first).toEqual(recorded); // byte-for-byte what the live server produced
    expect(second).toEqual(first); // and stable across runs
    // The Sudden Death turn really did involve a server-chosen (timed-out) attack.
    const sdTurn = log.entries.filter((e) => e.type === 'TURN')[1]!;
    expect(sdTurn.type === 'TURN' && sdTurn.actions[1]!.kind).toBe('ATTACK');
  });

  it('survives a JSON round trip (what the file store writes)', async () => {
    const run = await startServer({ seed: 'rt' }, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    const log = await playVariedGame(run, players, roomCode, turnId);
    const reloaded = parseReplay(serializeReplay(log));
    expect(verifyReplay(reloaded)).toEqual(verifyReplay(log));
  });

  it('detects tampering: altering a recorded action changes the outcome and fails verification', async () => {
    const run = await startServer({ seed: 'tamper' }, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    const log = await playVariedGame(run, players, roomCode, turnId);

    const entries = log.entries.map((e) =>
      e.type === 'TURN' && e.actions[0]!.kind === 'ATTACK'
        ? { ...e, actions: [{ ...e.actions[0]!, targets: [] as string[], kind: 'CHARGE' as const }, ...e.actions.slice(1)] }
        : e,
    );
    const tampered = { ...log, entries } as unknown as ReplayLog;
    expect(() => verifyReplay(tampered)).toThrowError(expect.objectContaining({ name: 'ReplayError', code: expect.stringMatching(/OUTCOME_MISMATCH|BAD_LOG/) }));
  });

  it('refuses to replay under different rules or matrix versions', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    const log = await playVariedGame(run, players, roomCode, turnId);
    expect(() => verifyReplay({ ...log, matrixVersion: 'v3' })).toThrowError(expect.objectContaining({ code: 'VERSION_MISMATCH' }));
    expect(() => verifyReplay({ ...log, rulesVersion: '9.9.9' })).toThrowError(ReplayError);
  });

  it('the server can verify its own log on demand', async () => {
    const run = await startServer({ seed: 'verify' }, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 2);
    await playVariedGame(run, players, roomCode, turnId);
    const res: any = await (await fetch(`${run.url}/dev/replay/${roomCode}?verify=1`)).json();
    expect(res).toMatchObject({ ok: true, verifiedTurns: 2 });
  });

  it('replays an undisturbed 3-player game with an elimination and a match rollover', async () => {
    const run = await startServer({ seed: 'three' }, undefined, { devMode: true });
    const { players, roomCode, turnId } = await startedGame(run, 3);
    await dev(run, '/dev/charges', { roomCode, charges: { p1: 3 } });
    await dev(run, '/dev/actions', {
      roomCode,
      lock: true,
      actions: { p1: { kind: 'ATTACK', weapon: 'GRENADE', targets: ['p2', 'p3'] }, p2: CHARGE, p3: CHARGE },
    });
    await players[0]!.result(turnId);
    const body: any = await (await fetch(`${run.url}/dev/replay/${roomCode}`)).json();
    const log = body.log as ReplayLog;
    const outcomes = verifyReplay(log);
    expect(outcomes).toHaveLength(1);
    expect(JSON.parse(outcomes[0]!).outcome.transition).toBe('MATCH_ENDED');
  });
});

describe('replay persistence', () => {
  it('writes <seriesId>.replay.json when the room closes, and the file verifies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bng-replay-'));
    try {
      const run = await startServer({ seed: 'file', reconnectGraceMs: 100 }, undefined, { devMode: true, replayStore: createFileReplayStore(dir) });
      const { players, roomCode, turnId } = await startedGame(run, 2);
      await Promise.all(players.map((p) => p.commit(turnId, CHARGE)));
      await players[0]!.result(turnId);
      for (const p of players) p.socket.close();
      await new Promise((r) => setTimeout(r, 500)); // grace period elapses, room closes and saves

      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/\.replay\.json$/);
      const log = parseReplay(await readFile(join(dir, files[0]!), 'utf8'));
      expect(log.seed).toBe('file');
      expect(log.entries).toHaveLength(1);
      expect(verifyReplay(log)).toHaveLength(1);
      expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes the log as soon as a series is won (10 match wins)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bng-replay-'));
    try {
      const run = await startServer({}, undefined, { devMode: true, replayStore: createFileReplayStore(dir) });
      const { players, roomCode } = await startedGame(run, 2);
      for (let match = 0; match < 10; match++) {
        const open: any = await players[0]!.waitFor('turn:open', (t: any) => t.turnId.includes(`:m${match + 1}:`));
        await dev(run, '/dev/charges', { roomCode, charges: { p1: 1 } });
        await dev(run, '/dev/actions', { roomCode, lock: true, actions: { p1: { kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] }, p2: CHARGE } });
        await players[0]!.waitFor('turn:result', (r: any) => r.turnId === open.turnId);
      }
      await players[0]!.waitFor('series:ended');
      await new Promise((r) => setTimeout(r, 100));
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      const log = parseReplay(await readFile(join(dir, files[0]!), 'utf8'));
      expect(log.entries.filter((e) => e.type === 'TURN')).toHaveLength(10);
      expect(verifyReplay(log)).toHaveLength(10);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

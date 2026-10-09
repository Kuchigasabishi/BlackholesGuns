import { io } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createGameStore, type GameStore, type KeyValueStorage } from '../src/net/store';
import { screenOf, type ClientState } from '../src/state/reducer';
import { cleanup as cleanupServers, dev, startServer, type Running } from '../../tests/server/harness';

const stores: GameStore[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) s.dispose();
  await cleanupServers();
});

const memoryStorage = (): KeyValueStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

/** A client store wired to the real server over a real WebSocket, exactly as the browser app does. */
function client(run: Running, storage: KeyValueStorage | null = memoryStorage()): GameStore {
  const socket = io(run.url, { transports: ['websocket'], forceNew: true, autoConnect: false, reconnection: false });
  const store = createGameStore({ socket, storage });
  stores.push(store);
  return store;
}

function until(store: GameStore, predicate: (s: ClientState) => boolean, label: string, timeoutMs = 4000): Promise<ClientState> {
  return new Promise((resolve, reject) => {
    if (predicate(store.getState())) return resolve(store.getState());
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for: ${label}`));
    }, timeoutMs);
    const off = store.subscribe(() => {
      if (predicate(store.getState())) {
        clearTimeout(timer);
        off();
        resolve(store.getState());
      }
    });
  });
}

const online = (s: GameStore) => until(s, (st) => st.connection === 'connected', 'connected');

async function startedPair(run: Running): Promise<{ a: GameStore; b: GameStore; roomCode: string }> {
  const a = client(run);
  const b = client(run);
  await Promise.all([online(a), online(b)]);
  expect(await a.createRoom('Ada')).toBe(true);
  const roomCode = a.getState().session!.roomCode;
  expect(await b.joinRoom(`https://blackholesandguns.io/join/${roomCode}`, 'Bo')).toBe(true);
  expect(await a.startGame()).toBe(true);
  await Promise.all([until(a, (s) => s.stage === 'COMMIT' && s.availability !== null, 'a turn open'), until(b, (s) => s.stage === 'COMMIT' && s.availability !== null, 'b turn open')]);
  return { a, b, roomCode };
}

describe('client store against the real server', () => {
  it('create -> join by invite link -> lobby roster on both -> start -> both in the game screen', async () => {
    const run = await startServer({}, undefined, {});
    const a = client(run);
    const b = client(run);
    await Promise.all([online(a), online(b)]);

    await a.createRoom('Ada');
    expect(screenOf(a.getState())).toBe('lobby');
    expect(a.getState().lobby!.inviteUrl).toBe(`https://blackholesandguns.io/join/${a.getState().session!.roomCode}`);

    await b.joinRoom(a.getState().session!.roomCode.toLowerCase(), 'Bo');
    const lobby = await until(a, (s) => s.lobby?.players.length === 2, 'two players in the lobby');
    expect(lobby.lobby!.players.map((p) => p.displayName)).toEqual(['Ada', 'Bo']);

    await a.startGame();
    const [sa, sb] = await Promise.all([until(a, (s) => screenOf(s) === 'game' && s.turn !== null, 'a in game'), until(b, (s) => screenOf(s) === 'game' && s.turn !== null, 'b in game')]);
    expect(sa.turn!.turnId).toBe(sb.turn!.turnId);
    expect(sa.game!.series.lobby).toEqual(['p1', 'p2']);
  });

  it('surfaces friendly errors for a bad room, a bad start and an unaffordable action', async () => {
    const run = await startServer();
    const a = client(run);
    await online(a);
    expect(await a.joinRoom('ZZZZZZ', 'Ada')).toBe(false);
    expect(a.getState().error).toContain('does not exist');
    expect(screenOf(a.getState())).toBe('home');

    await a.createRoom('Ada');
    expect(await a.startGame()).toBe(false);
    expect(a.getState().error).toBe('You need at least 2 players to start.');

    const b = client(run);
    await online(b);
    await b.joinRoom(a.getState().session!.roomCode, 'Bo');
    await a.startGame();
    await until(a, (s) => s.stage === 'COMMIT', 'turn open');
    expect(await a.commit({ kind: 'ATTACK', weapon: 'NUKE', targets: [] })).toBe(false);
    expect(a.getState().error).toBe('You do not have enough Charge for that.');
    expect(a.getState().ownCommit).toBeNull();
  });

  it('simultaneous reveal: both clients get the same turn, log, and the next turn opens', async () => {
    // A realistic pause between turns: with 0ms the next turn:open can clear the reveal before we look.
    const run = await startServer({ interTurnDelayMs: 400 }, undefined, {});
    const { a, b } = await startedPair(run);
    const turnId = a.getState().turn!.turnId;

    expect(await a.commit({ kind: 'CHARGE' })).toBe(true);
    // Hidden information: b learns THAT a locked in, never WHAT.
    const mid = await until(b, (s) => s.lockedPlayerIds.includes('p1'), 'b sees a locked');
    expect(mid.lockedPlayerIds).toEqual(['p1']);
    expect(mid.ownCommit).toBeNull();
    expect(mid.revealed).toBeNull();
    expect(mid.lastResult).toBeNull();
    expect(mid.log).toHaveLength(0);

    await b.commit({ kind: 'DEFENSE', defense: 'DODGE' });
    const [ra, rb] = await Promise.all([until(a, (s) => s.log.length === 1, 'a log'), until(b, (s) => s.log.length === 1, 'b log')]);
    // Charge fog of war (§12): the logs match except each client only sees its OWN Charge change.
    const withoutCharge = (log: typeof ra.log) => log.map((l) => ({ ...l, blocks: l.blocks.filter((x) => !x.text.startsWith('⚡ Charge')) }));
    expect(withoutCharge(rb.log)).toEqual(withoutCharge(ra.log));
    expect(ra.log[0]!.blocks.find((x) => x.text.startsWith('⚡ Charge'))!.text).toBe('⚡ Charge: Ada +1 (now 1)');
    expect(rb.log[0]!.blocks.some((x) => x.text.startsWith('⚡ Charge'))).toBe(false);
    expect(ra.log[0]!.heading).toBe('Turn 1 · NORMAL PHASE');
    expect(ra.log[0]!.blocks[0]!.text).toBe('REVEAL — all actions at once:\n  Ada cast [CHARGE]\n  Bo cast [DODGE]');
    expect(ra.revealed).toHaveLength(2);
    expect(ra.game!.players.p1!.charge).toBe(1);

    const [na, nb] = await Promise.all([until(a, (s) => s.turn?.turnIndex === 2 && s.stage === 'COMMIT' && s.availability !== null, 'a turn 2'), until(b, (s) => s.turn?.turnIndex === 2 && s.stage === 'COMMIT' && s.availability !== null, 'b turn 2')]);
    expect(na.turn!.turnId).not.toBe(turnId);
    expect(na.ownCommit).toBeNull();
    expect(nb.revealed).toBeNull();
    expect(na.availability!.attacks.GUN.available).toBe(true); // a has 1 Charge now
    expect(nb.availability!.attacks.GUN.available).toBe(false);
  });

  it('plays an elimination through to a match win, shown in the log and roster state', async () => {
    const run = await startServer({}, undefined, {});
    const { a, b } = await startedPair(run);
    await Promise.all([a.commit({ kind: 'CHARGE' }), b.commit({ kind: 'CHARGE' })]);
    await until(a, (s) => s.turn?.turnIndex === 2 && s.stage === 'COMMIT' && s.availability !== null, 'turn 2');
    await a.commit({ kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] });
    await b.commit({ kind: 'CHARGE' });
    const s = await until(b, (st) => st.log.length === 2, 'match result');
    expect(s.log[1]!.blocks.some((blk) => blk.text.includes('Bo [ELIMINATED]') || blk.text.includes('[ELIMINATED]'))).toBe(true);
    expect(s.log[1]!.blocks.at(-1)!.text).toContain('MATCH OVER — Ada wins the match!');
    expect(s.lastResult!.outcome.transition).toBe('MATCH_ENDED');
    expect(s.game!.series.matchWins).toEqual({ p1: 1, p2: 0 });
    await until(b, (st) => st.turn?.turnId.includes(':m2:') === true && st.stage === 'COMMIT', 'next match');
  });

  it('reload: a new store with the same saved seat resumes, including its own pending commit', async () => {
    const run = await startServer({ reconnectGraceMs: 5000 }, undefined, {});
    const storage = memoryStorage();
    const a = client(run, storage);
    const b = client(run);
    await Promise.all([online(a), online(b)]);
    await a.createRoom('Ada');
    await b.joinRoom(a.getState().session!.roomCode, 'Bo');
    await a.startGame();
    await until(a, (s) => s.stage === 'COMMIT' && s.availability !== null, 'turn open');
    await a.commit({ kind: 'DEFENSE', defense: 'SHIELD' });
    expect(JSON.parse(storage.data.get('bng.session')!)).toMatchObject({ playerId: 'p1' });

    a.dispose(); // the tab is closed / reloaded
    await until(b, (s) => s.lobby?.players.find((p) => p.playerId === 'p1')?.connected === false, 'b sees a leave');

    const reloaded = client(run, storage); // same sessionStorage
    const s = await until(reloaded, (st) => screenOf(st) === 'game' && st.turn !== null, 'resumed');
    expect(s.session!.playerId).toBe('p1');
    expect(s.stage).toBe('COMMIT');
    expect(s.ownCommit).toEqual({ kind: 'DEFENSE', defense: 'SHIELD' }); // restored
    expect(s.lockedPlayerIds).toContain('p1');
    expect(s.availability).not.toBeNull();
    await until(b, (st) => st.lobby?.players.find((p) => p.playerId === 'p1')?.connected === true, 'b sees a return');
    // and b's view never contained a's choice:
    expect(JSON.stringify(b.getState().ownCommit)).toBe('null');
  });

  it('a stale saved seat (room gone) falls back to home with a notice instead of hanging', async () => {
    const run = await startServer();
    const storage = memoryStorage();
    storage.setItem('bng.session', JSON.stringify({ roomCode: 'GONE22', playerId: 'p1', playerToken: 'x' }));
    const c = client(run, storage);
    const s = await until(c, (st) => st.notice !== null, 'notice');
    expect(screenOf(s)).toBe('home');
    expect(s.notice).toContain('does not exist');
    expect(storage.data.has('bng.session')).toBe(false);
  });

  it('leaving forgets the seat', async () => {
    const run = await startServer();
    const storage = memoryStorage();
    const a = client(run, storage);
    await online(a);
    await a.createRoom('Ada');
    expect(storage.data.has('bng.session')).toBe(true);
    await a.leaveRoom();
    expect(storage.data.has('bng.session')).toBe(false);
    expect(screenOf(a.getState())).toBe('home');
  });

  it('timeouts reach the UI: a silent player is shown as timed out in the log', async () => {
    const run = await startServer({ commitWindowMs: 200 }, undefined, {});
    const { a } = await startedPair(run);
    await a.commit({ kind: 'DEFENSE', defense: 'DODGE' });
    const s = await until(a, (st) => st.log.length === 1, 'timeout result');
    expect(s.log[0]!.blocks[0]!.text).toContain('Bo cast [CHARGE] (timed out: chosen by the server)');
  });

  it('dev-forced Sudden Death surfaces the notice, banner state and disabled defenses', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const { a, roomCode } = await startedPair(run);
    await dev(run, '/dev/streak', { roomCode, streak: 10 });
    const s = await until(a, (st) => st.phaseNotice === 'SUDDEN_DEATH' && st.availability?.defenses.DODGE.available === false, 'sudden death');
    expect(s.turn!.phase).toBe('SUDDEN_DEATH');
    expect(s.game!.round.noEliminationStreak).toBe(10);
    expect(s.availability!.defenses.DODGE).toEqual({ available: false, reason: 'PHASE_RESTRICTED' });
  });

  it('the full series flow ends with a series winner on every client', async () => {
    const run = await startServer({}, undefined, { devMode: true });
    const { a, b, roomCode } = await startedPair(run);
    for (let match = 1; match <= 10; match++) {
      await until(a, (s) => s.turn?.turnId.includes(`:m${match}:`) === true && s.stage === 'COMMIT' && s.availability !== null, `match ${match} open`);
      await dev(run, '/dev/charges', { roomCode, charges: { p1: 1 } });
      await dev(run, '/dev/actions', { roomCode, lock: true, actions: { p1: { kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] }, p2: { kind: 'CHARGE' } } });
    }
    const [sa, sb] = await Promise.all([until(a, (s) => s.seriesEnd !== null, 'a series end'), until(b, (s) => s.seriesEnd !== null, 'b series end')]);
    expect(sa.seriesEnd).toEqual({ winnerId: 'p1', matchWins: { p1: 10, p2: 0 } });
    expect(sb.seriesEnd).toEqual(sa.seriesEnd);
    expect(sa.log.at(-1)!.blocks.at(-1)!.text).toContain('SERIES OVER — Ada wins the series!');
  }, 20_000);
});

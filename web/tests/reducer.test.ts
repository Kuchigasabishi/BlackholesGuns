import { describe, expect, it } from 'vitest';
import { badgeOf, initialState, nameLookup, reducer, screenOf, type ClientAction, type ClientState } from '../src/state/reducer';
import { CHARGE, attack, clientStateFor, defend, lobbyView, newGame, resultFor, sessionView, withCharges, withStreak } from './fixtures';

const run = (state: ClientState, ...actions: ClientAction[]): ClientState => actions.reduce(reducer, state);
const t0 = 1_000_000;

describe('screen routing', () => {
  it('home until a seat is held, then lobby, then game', () => {
    expect(screenOf(initialState)).toBe('home');
    const lobby = run(initialState, { type: 'session', session: { roomCode: 'K7M2QP', playerId: 'p1', playerToken: 't' } }, { type: 'lobby', lobby: lobbyView(2) });
    expect(screenOf(lobby)).toBe('lobby');
    const game = run(lobby, { type: 'lobby', lobby: lobbyView(2, { status: 'IN_GAME' }) });
    expect(screenOf(game)).toBe('game');
  });
});

describe('turn lifecycle', () => {
  const game = newGame(3);
  const base = clientStateFor(game, 'p1');

  it('a snapshot restores stage, availability, locks, own commit and the clock skew', () => {
    const view = sessionView(game, 'p1', {
      lockedPlayerIds: ['p2'],
      ownCommit: { idempotencyKey: 'k', action: { kind: 'DEFENSE', defense: 'DODGE' } },
    });
    const s = reducer(initialState, { type: 'snapshot', view: { ...view, serverTime: t0 + 500 }, receivedAt: t0 });
    expect(s.stage).toBe('COMMIT');
    expect(s.lockedPlayerIds).toEqual(['p2']);
    expect(s.ownCommit).toEqual({ kind: 'DEFENSE', defense: 'DODGE' });
    expect(s.turn?.clockSkewMs).toBe(500);
    expect(s.availability?.charge.available).toBe(true);
  });

  it('turn:open resets locks and own commit for a new turn, but keeps them for a re-announce of the same turn', () => {
    const locked = run(base, { type: 'progress', turnId: base.turn!.turnId, lockedPlayerIds: ['p2'] }, { type: 'committed', turnId: base.turn!.turnId, action: CHARGE });
    const sameTurn = reducer(locked, { type: 'turnOpen', payload: { turnId: base.turn!.turnId, turnIndex: 1, phase: 'NORMAL', eligiblePlayerIds: ['p1', 'p2', 'p3'], deadlineAt: 1, serverTime: 1 }, receivedAt: 1 });
    expect(sameTurn.lockedPlayerIds).toContain('p2');
    expect(sameTurn.ownCommit).toEqual(CHARGE);
    const nextTurn = reducer(locked, { type: 'turnOpen', payload: { turnId: 'fx:m1:r1:t2', turnIndex: 2, phase: 'NORMAL', eligiblePlayerIds: ['p1', 'p2', 'p3'], deadlineAt: 1, serverTime: 1 }, receivedAt: 1 });
    expect(nextTurn.lockedPlayerIds).toEqual([]);
    expect(nextTurn.ownCommit).toBeNull();
    expect(nextTurn.stage).toBe('COMMIT');
    expect(nextTurn.revealed).toBeNull();
  });

  it('ignores private/progress/locked messages for a different turn', () => {
    const s = run(base, { type: 'progress', turnId: 'other', lockedPlayerIds: ['p2'] }, { type: 'locked', turnId: 'other' });
    expect(s.lockedPlayerIds).toEqual([]);
    expect(s.stage).toBe('COMMIT');
  });

  it('turn:locked moves to LOCKED; a result moves to BETWEEN_TURNS, reveals actions and appends one log entry', () => {
    const result = resultFor(withCharges(game, { p1: 1 }), { p1: attack('GUN', 'p2'), p2: defend('DODGE'), p3: CHARGE });
    const s = run(base, { type: 'locked', turnId: base.turn!.turnId }, { type: 'result', payload: result });
    expect(s.stage).toBe('BETWEEN_TURNS');
    expect(s.revealed).toHaveLength(3);
    expect(s.log).toHaveLength(1);
    expect(s.log[0]!.heading).toBe('Turn 1 · NORMAL PHASE');
    expect(s.game).toBe(result.state);
    expect(s.availability).toBeNull();
  });

  it('log lines use display names from the lobby', () => {
    const s = run(base, { type: 'result', payload: resultFor(game, { p1: CHARGE, p2: CHARGE, p3: CHARGE }) });
    expect(s.log[0]!.blocks[0]!.text).toContain('Ada cast [CHARGE]');
    expect(nameLookup(s)('p2')).toBe('Bo');
    expect(nameLookup(s)('p9')).toBe('p9');
  });

  it('the log accumulates across turns in order', () => {
    const t1 = resultFor(game, { p1: CHARGE, p2: CHARGE, p3: CHARGE });
    const t2 = resultFor(t1.state, { p1: CHARGE, p2: CHARGE, p3: CHARGE });
    const s = run(base, { type: 'result', payload: t1 }, { type: 'result', payload: t2 });
    expect(s.log.map((l) => l.turnNumber)).toEqual([1, 2]);
  });
});

describe('badges (Figure 1)', () => {
  const game = newGame(3);

  it('HIDDEN ? until a player locks in, then READY', () => {
    let s = clientStateFor(game, 'p1');
    expect(['p1', 'p2', 'p3'].map((id) => badgeOf(s, id))).toEqual(['HIDDEN', 'HIDDEN', 'HIDDEN']);
    s = reducer(s, { type: 'progress', turnId: s.turn!.turnId, lockedPlayerIds: ['p2'] });
    expect(badgeOf(s, 'p2')).toBe('READY');
    expect(badgeOf(s, 'p3')).toBe('HIDDEN');
  });

  it('ELIMINATED once a player is out, whatever the stage', () => {
    const result = resultFor(withCharges(game, { p1: 1 }), { p1: attack('GUN', 'p2'), p2: CHARGE, p3: defend('DODGE') });
    const s = reducer(clientStateFor(game, 'p1'), { type: 'result', payload: result });
    expect(badgeOf(s, 'p2')).toBe('ELIMINATED');
    expect(badgeOf(s, 'p1')).toBe('READY');
  });
});

describe('phase notices (§13)', () => {
  it('sets a one-time notice when a turn opens in Sudden Death, and can be dismissed', () => {
    const s0 = clientStateFor(newGame(2), 'p1');
    const sd = reducer(s0, { type: 'turnOpen', payload: { turnId: 'fx:m1:r1:t11', turnIndex: 11, phase: 'SUDDEN_DEATH', eligiblePlayerIds: ['p1', 'p2'], deadlineAt: 1, serverTime: 1 }, receivedAt: 1 });
    expect(sd.phaseNotice).toBe('SUDDEN_DEATH');
    expect(reducer(sd, { type: 'dismissPhaseNotice' }).phaseNotice).toBeNull();
    // Another Sudden Death turn does not re-warn once dismissed.
    const dismissed = reducer(sd, { type: 'dismissPhaseNotice' });
    const again = reducer(dismissed, { type: 'turnOpen', payload: { turnId: 'fx:m1:r1:t12', turnIndex: 12, phase: 'SUDDEN_DEATH', eligiblePlayerIds: ['p1', 'p2'], deadlineAt: 1, serverTime: 1 }, receivedAt: 1 });
    expect(again.phaseNotice).toBeNull();
  });

  it('a state sync drops stale availability so illegal actions never look available', () => {
    const s0 = clientStateFor(withCharges(newGame(2), { p1: 3 }), 'p1');
    expect(s0.availability?.defenses.DODGE.available).toBe(true);
    const s = reducer(s0, { type: 'stateSync', state: withStreak(withCharges(newGame(2), { p1: 3 }), 10, 'SUDDEN_DEATH') });
    expect(s.availability).toBeNull();
  });

  it('a dev state sync into Sudden Death also warns', () => {
    const s0 = clientStateFor(newGame(2), 'p1');
    const s = reducer(s0, { type: 'stateSync', state: withStreak(newGame(2), 10, 'SUDDEN_DEATH') });
    expect(s.phaseNotice).toBe('SUDDEN_DEATH');
    expect(s.turn?.phase).toBe('SUDDEN_DEATH');
  });
});

describe('connection, series end, room close', () => {
  it('tracks other players\' connection status in game and lobby', () => {
    const s0 = clientStateFor(newGame(2), 'p1');
    const s = reducer(s0, { type: 'playerConnection', playerId: 'p2', status: 'DISCONNECTED' });
    expect(s.game!.players.p2!.connectionStatus).toBe('DISCONNECTED');
    expect(s.lobby!.players.find((p) => p.playerId === 'p2')!.connected).toBe(false);
  });

  it('series end is recorded and stops the turn stage', () => {
    const s = reducer(clientStateFor(newGame(2), 'p1'), { type: 'seriesEnded', winnerId: 'p1', matchWins: { p1: 10, p2: 3 } });
    expect(s.seriesEnd).toEqual({ winnerId: 'p1', matchWins: { p1: 10, p2: 3 } });
    expect(s.stage).toBe('NONE');
  });

  it('a closed room returns to the home screen with a notice', () => {
    const s = reducer(clientStateFor(newGame(2), 'p1'), { type: 'roomClosed' });
    expect(screenOf(s)).toBe('home');
    expect(s.notice).toBe('The room was closed.');
  });
});

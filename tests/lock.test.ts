import { describe, expect, it } from 'vitest';
import { ATTACKS, ATTACK_IDS, createSeededRng, lockTurn, resolveTurn, type Action, type AttackId } from '../src/engine';
import { charge, defend, lockedFor, makeAction, newGame, withCharges, withStreak } from './helpers';

const rng = (seed: string | number = 1) => createSeededRng(seed);

describe('timeout default (§10 LOCK)', () => {
  it('defaults a silent player to Charge', () => {
    const state = newGame(3);
    const submitted = lockedFor(state, [defend('p1', 'DODGE')]);
    const { actions, timedOutPlayerIds } = lockTurn(state, submitted, rng(), 1000);
    expect(timedOutPlayerIds).toEqual(['p2', 'p3']);
    expect(actions.p1!.kind).toBe('DEFENSE');
    expect(actions.p2!.kind).toBe('CHARGE');
    expect(actions.p3!.kind).toBe('CHARGE');
    expect(actions.p2!.acceptedAt).toBe(1000);
  });

  it('keeps valid submissions untouched', () => {
    const state = newGame(2);
    const submitted = lockedFor(state, [charge('p1'), defend('p2', 'SHIELD')]);
    const { actions, timedOutPlayerIds } = lockTurn(state, submitted, rng(), 0);
    expect(timedOutPlayerIds).toEqual([]);
    expect(actions).toEqual(submitted);
  });

  it('at 5 Charge the timeout Charge leaves the balance at 5', () => {
    const state = withCharges(newGame(2), { p1: 5, p2: 5 });
    const { actions } = lockTurn(state, {}, rng(), 0);
    const next = resolveTurn(state, actions).nextState;
    expect(next.players.p1!.charge).toBe(5);
    expect(next.players.p2!.charge).toBe(5);
  });

  it('defaults to Charge in Normal Phase even when attacks are affordable', () => {
    const state = withCharges(newGame(2), { p1: 5, p2: 3 });
    const { actions } = lockTurn(state, {}, rng(), 0);
    expect(actions.p1!.kind).toBe('CHARGE');
    expect(actions.p2!.kind).toBe('CHARGE');
  });

  it('defaults to Charge in Overtime (normal rules)', () => {
    const state = withCharges(withStreak(newGame(2), 15), { p1: 4 });
    expect(lockTurn(state, {}, rng(), 0).actions.p1!.kind).toBe('CHARGE');
  });

  it('replaces an invalid submission with the timeout action and reports it', () => {
    const state = newGame(2);
    const bad: Action = makeAction(state, 'p1', { kind: 'ATTACK', weapon: 'NUKE', targets: [] }); // 0 Charge
    const stale: Action = { ...makeAction(state, 'p2', { kind: 'CHARGE' }), turnId: 'old' };
    const { actions, timedOutPlayerIds, rejected } = lockTurn(state, { p1: bad, p2: stale }, rng(), 0);
    expect(timedOutPlayerIds).toEqual(['p1', 'p2']);
    expect(rejected.map((r) => [r.playerId, r.code])).toEqual([
      ['p1', 'UNAFFORDABLE'],
      ['p2', 'STALE_TURN'],
    ]);
    expect(actions.p1!.kind).toBe('CHARGE');
  });

  it('ignores a submission that claims to be from a different player', () => {
    const state = newGame(2);
    const spoof = makeAction(state, 'p2', { kind: 'CHARGE' });
    const { actions, timedOutPlayerIds } = lockTurn(state, { p1: spoof }, rng(), 0);
    expect(timedOutPlayerIds).toContain('p1');
    expect(actions.p1!.playerId).toBe('p1');
  });

  it('always produces a set resolveTurn accepts', () => {
    const state = withCharges(withStreak(newGame(2), 10), { p1: 5, p2: 0 });
    const { actions } = lockTurn(state, {}, rng(), 0);
    expect(() => resolveTurn(state, actions)).not.toThrow();
  });
});

describe('Sudden Death timeout (§10)', () => {
  const sd = (charges: Record<string, number>) => withCharges(withStreak(newGame(2), 10), charges);

  it('picks an attack when one is affordable, because Charge is illegal', () => {
    const { actions } = lockTurn(sd({ p1: 3, p2: 1 }), {}, rng(), 0);
    expect(actions.p1!.kind).toBe('ATTACK');
    expect(actions.p2!.kind).toBe('ATTACK');
  });

  it('Charges at 0 Charge, when no attack is affordable', () => {
    expect(lockTurn(sd({ p1: 0, p2: 0 }), {}, rng(), 0).actions.p1!.kind).toBe('CHARGE');
  });

  it.each([1, 2, 3, 4, 5])('chooses only from the attacks affordable at %i Charge, and eventually every one of them', (balance) => {
    const state = sd({ p1: balance });
    const affordable = ATTACK_IDS.filter((id) => ATTACKS[id].cost <= balance);
    const seen = new Set<AttackId>();
    const source = rng(`coverage-${balance}`);
    for (let i = 0; i < 600; i++) {
      const action = lockTurn(state, {}, source, 0).actions.p1!;
      expect(action.kind).toBe('ATTACK');
      if (action.kind === 'ATTACK') {
        expect(affordable).toContain(action.weapon);
        seen.add(action.weapon);
      }
    }
    expect([...seen].sort()).toEqual([...affordable].sort());
  });

  it('targets the sole opponent for targeted weapons, and nobody for all-opponent weapons', () => {
    const state = sd({ p1: 5 });
    const source = rng('targets');
    for (let i = 0; i < 200; i++) {
      const action = lockTurn(state, {}, source, 0).actions.p1!;
      if (action.kind !== 'ATTACK') throw new Error('expected an attack');
      const expected = ATTACKS[action.weapon].targetMode === 'ALL_OPPONENTS' ? [] : ['p2'];
      expect(action.targets).toEqual(expected);
    }
  });

  it('is reproducible from a seed and differs between seeds', () => {
    const state = sd({ p1: 5, p2: 5 });
    const pick = (seed: string) => {
      const source = rng(seed);
      return Array.from({ length: 20 }, () => {
        const a = lockTurn(state, {}, source, 0).actions.p1!;
        return a.kind === 'ATTACK' ? a.weapon : a.kind;
      });
    };
    expect(pick('seed-A')).toEqual(pick('seed-A'));
    expect(pick('seed-A')).not.toEqual(pick('seed-B'));
  });

  it('a submitted legal attack is kept; a submitted Dodge is replaced by a random attack', () => {
    const state = sd({ p1: 2, p2: 2 });
    const legal = makeAction(state, 'p1', { kind: 'ATTACK', weapon: 'AXE', targets: ['p2'] });
    const illegal = makeAction(state, 'p2', { kind: 'DEFENSE', defense: 'DODGE' });
    const { actions, timedOutPlayerIds, rejected } = lockTurn(state, { p1: legal, p2: illegal }, rng(), 0);
    expect(actions.p1).toBe(legal);
    expect(timedOutPlayerIds).toEqual(['p2']);
    expect(rejected[0]).toMatchObject({ playerId: 'p2', code: 'PHASE_RESTRICTED' });
    expect(actions.p2!.kind).toBe('ATTACK');
  });
});

describe('seeded RNG', () => {
  it('is deterministic and returns floats in [0, 1)', () => {
    const a = createSeededRng('x');
    const b = createSeededRng('x');
    for (let i = 0; i < 1000; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

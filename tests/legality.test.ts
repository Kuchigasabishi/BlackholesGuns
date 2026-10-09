import { describe, expect, it } from 'vitest';
import { ATTACK_IDS, DEFENSE_IDS, getActionAvailability, validateAction, type RejectionCode } from '../src/engine';
import { attack, charge, ids, makeAction, newGame, play, withCharges } from './helpers';

const verdict = (state: ReturnType<typeof newGame>, player: string, choice: Parameters<typeof makeAction>[2]) =>
  validateAction(state, makeAction(state, player, choice));

const rejectedWith = (code: RejectionCode) => expect.objectContaining({ ok: false, code });

describe('action availability (Normal Phase)', () => {
  it('at 0 Charge: Charge, Dodge, Shield only', () => {
    const a = getActionAvailability(newGame(2), 'p1');
    expect(a.charge.available).toBe(true);
    expect(a.defenses.DODGE.available).toBe(true);
    expect(a.defenses.SHIELD.available).toBe(true);
    for (const id of ['REFLECT', 'DOUBLE_REFLECT', 'TRIPLE_REFLECT', 'QUAD_REFLECT'] as const) {
      expect(a.defenses[id], id).toEqual({ available: false, reason: 'UNAFFORDABLE' });
    }
    for (const id of ATTACK_IDS) expect(a.attacks[id], id).toEqual({ available: false, reason: 'UNAFFORDABLE' });
  });

  it.each([1, 2, 3, 4, 5])('at %i Charge: exactly the attacks and Reflects costing <= Charge are enabled', (balance) => {
    const a = getActionAvailability(withCharges(newGame(2), { p1: balance }), 'p1');
    const cost = { GUN: 1, KNIFE: 1, GATLING_GUN: 2, FLAMETHROWER: 2, AXE: 2, THREE_HIT_COMBO: 3, GRENADE: 3, KATANA: 3, BOMB: 4, NUKE: 4, MJOLNIR: 4, BLACKHOLE: 5 };
    for (const id of ATTACK_IDS) expect(a.attacks[id].available, id).toBe(cost[id] <= balance);
    const reflectCost = { DODGE: 0, SHIELD: 0, REFLECT: 1, DOUBLE_REFLECT: 2, TRIPLE_REFLECT: 3, QUAD_REFLECT: 4 };
    for (const id of DEFENSE_IDS) expect(a.defenses[id].available, id).toBe(reflectCost[id] <= balance);
  });

  it('Charge stays legal at 5 Charge', () => {
    expect(getActionAvailability(withCharges(newGame(2), { p1: 5 }), 'p1').charge.available).toBe(true);
  });

  it('everything is unavailable for an eliminated or unknown player', () => {
    let state = withCharges(newGame(3), { p1: 1 });
    state = play(state, attack('p1', 'GUN', 'p2'), charge('p2'), charge('p3')).nextState;
    for (const player of ['p2', 'ghost']) {
      const a = getActionAvailability(state, player);
      expect(a.charge).toEqual({ available: false, reason: 'NOT_ALIVE' });
      expect(Object.values(a.attacks).every((x) => !x.available)).toBe(true);
      expect(Object.values(a.defenses).every((x) => !x.available)).toBe(true);
    }
  });
});

describe('validateAction', () => {
  it('accepts legal actions', () => {
    const state = withCharges(newGame(2), { p1: 2 });
    expect(verdict(state, 'p1', { kind: 'CHARGE' })).toEqual({ ok: true });
    expect(verdict(state, 'p1', { kind: 'DEFENSE', defense: 'DOUBLE_REFLECT' })).toEqual({ ok: true });
    expect(verdict(state, 'p1', { kind: 'ATTACK', weapon: 'AXE', targets: ['p2'] })).toEqual({ ok: true });
  });

  it('rejects unaffordable attacks and defenses', () => {
    const state = withCharges(newGame(2), { p1: 2 });
    expect(verdict(state, 'p1', { kind: 'ATTACK', weapon: 'KATANA', targets: ['p2'] })).toEqual(rejectedWith('UNAFFORDABLE'));
    expect(verdict(state, 'p1', { kind: 'DEFENSE', defense: 'TRIPLE_REFLECT' })).toEqual(rejectedWith('UNAFFORDABLE'));
  });

  it('rejects unknown ids', () => {
    const state = newGame(2);
    const unknownAttack = { ...makeAction(state, 'p1', { kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] }), weapon: 'RAYGUN' };
    const unknownDefense = { ...makeAction(state, 'p1', { kind: 'DEFENSE', defense: 'DODGE' }), defense: 'FORCEFIELD' };
    // @ts-expect-error deliberately malformed
    expect(validateAction(state, unknownAttack)).toEqual(rejectedWith('UNKNOWN_ACTION'));
    // @ts-expect-error deliberately malformed
    expect(validateAction(state, unknownDefense)).toEqual(rejectedWith('UNKNOWN_ACTION'));
  });

  it('rejects stale ids at every level', () => {
    const state = newGame(2);
    const good = makeAction(state, 'p1', { kind: 'CHARGE' });
    for (const patch of [{ turnId: 'x' }, { roundId: 'x' }, { matchId: 'x' }, { seriesId: 'x' }]) {
      expect(validateAction(state, { ...good, ...patch }), JSON.stringify(patch)).toEqual(rejectedWith('STALE_TURN'));
    }
  });

  it('rejects actions from eliminated players', () => {
    let state = withCharges(newGame(3), { p1: 1 });
    state = play(state, attack('p1', 'GUN', 'p2'), charge('p2'), charge('p3')).nextState;
    const action = { ...makeAction(state, 'p1', { kind: 'CHARGE' }), playerId: 'p2' };
    expect(validateAction(state, action)).toEqual(rejectedWith('NOT_ALIVE'));
  });

  it('rejects everything once the series is over', () => {
    let state = newGame(2);
    const stale = makeAction(state, 'p1', { kind: 'CHARGE' });
    for (let i = 0; i < 10; i++) {
      state = play(withCharges(state, { p1: 1 }), attack('p1', 'GUN', 'p2'), charge('p2')).nextState;
    }
    expect(validateAction(state, stale)).toEqual(rejectedWith('TURN_NOT_OPEN'));
  });
});

describe('target validation (§7)', () => {
  const state5 = withCharges(newGame(5), { p1: 5 });
  const check = (weapon: 'GUN' | 'KATANA' | 'BOMB', targets: string[], state = state5) =>
    verdict(state, 'p1', { kind: 'ATTACK', weapon, targets });

  it('single-target weapons need exactly one target', () => {
    expect(check('GUN', ['p2'])).toEqual({ ok: true });
    expect(check('GUN', [])).toEqual(rejectedWith('INVALID_TARGETS'));
    expect(check('GUN', ['p2', 'p3'])).toEqual(rejectedWith('INVALID_TARGETS'));
  });

  it('3-hit Combo / Grenade / Katana take 1 to 3 distinct opponents', () => {
    expect(check('KATANA', ['p2'])).toEqual({ ok: true });
    expect(check('KATANA', ['p2', 'p3'])).toEqual({ ok: true });
    expect(check('KATANA', ['p2', 'p3', 'p4'])).toEqual({ ok: true });
    expect(check('KATANA', [])).toEqual(rejectedWith('INVALID_TARGETS'));
    expect(check('KATANA', ['p2', 'p3', 'p4', 'p5'])).toEqual(rejectedWith('INVALID_TARGETS'));
    expect(check('KATANA', ['p2', 'p2'])).toEqual(rejectedWith('INVALID_TARGETS'));
  });

  it('with fewer than three opponents, the group may target the available ones', () => {
    const duel = withCharges(newGame(2), { p1: 3 });
    expect(check('KATANA', ['p2'], duel)).toEqual({ ok: true });
    const trio = withCharges(newGame(3), { p1: 3 });
    expect(check('KATANA', ['p2', 'p3'], trio)).toEqual({ ok: true });
  });

  it('no attack can target its user', () => {
    expect(check('GUN', ['p1'])).toEqual(rejectedWith('INVALID_TARGETS'));
    expect(check('KATANA', ['p2', 'p1'])).toEqual(rejectedWith('INVALID_TARGETS'));
  });

  it('targets must be living players in the lobby', () => {
    expect(check('GUN', ['nobody'])).toEqual(rejectedWith('INVALID_TARGETS'));
    let state = withCharges(newGame(3), { p1: 1 });
    state = play(state, attack('p1', 'GUN', 'p2'), charge('p2'), charge('p3')).nextState; // p2 eliminated
    expect(check('GUN', ['p2'], withCharges(state, { p1: 5 }))).toEqual(rejectedWith('INVALID_TARGETS'));
  });

  it('all-opponent weapons accept no explicit targets or the full opponent set, nothing partial', () => {
    expect(check('BOMB', [])).toEqual({ ok: true });
    expect(check('BOMB', ids(5).slice(1))).toEqual({ ok: true });
    expect(check('BOMB', ['p2'])).toEqual(rejectedWith('INVALID_TARGETS'));
  });
});

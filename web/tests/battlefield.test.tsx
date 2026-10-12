import { describe, expect, it } from 'vitest';
import { ATTACK_IDS, DEFENSE_IDS } from '../../src/engine';
import { describeBattlefield } from '../src/format/describeTurn';
import { ATTACK_EMOJI, CHARGE_EMOJI, DEFENSE_EMOJI } from '../src/format/emoji';
import { CHARGE, NAMES, attack, defend, newGame, resultFor, withCharges } from './fixtures';

const nameOf = (id: string): string => NAMES[Number(id.slice(1)) - 1] ?? id;
const three = () => withCharges(newGame(3), { p1: 1, p3: 1 });
describe('emoji map', () => {
  it('maps the GDD examples and gives every attack and defense its own emoji', () => {
    expect(ATTACK_EMOJI.GUN).toBe('🔫');
    expect(ATTACK_EMOJI.KNIFE).toBe('🔪');
    expect(ATTACK_EMOJI.BLACKHOLE).toBe('🕳️');
    expect(DEFENSE_EMOJI.SHIELD).toBe('🛡️');
    expect(CHARGE_EMOJI).toBe('⚡');
    const all = [...ATTACK_IDS.map((a) => ATTACK_EMOJI[a]), ...DEFENSE_IDS.map((d) => DEFENSE_EMOJI[d]), CHARGE_EMOJI];
    expect(all.every((e) => e && e.length > 0)).toBe(true);
    expect(new Set(all).size).toBe(ATTACK_IDS.length + DEFENSE_IDS.length + 1);
  });
});

describe('describeBattlefield (data from the canonical events)', () => {
  it('has one card per participant: attacker, shielded defender and charger', () => {
    const r = resultFor(three(), { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    const [ada, bo, cy] = describeBattlefield(r, nameOf);
    expect(ada).toMatchObject({ name: 'Ada', emoji: '🔫', label: 'Gun', kind: 'ATTACK', aimedAt: ['Bo'], eliminated: false });
    expect(bo).toMatchObject({ name: 'Bo', emoji: '🛡️', label: 'SHIELD', kind: 'DEFENSE', eliminated: false });
    expect(bo!.incoming).toEqual([expect.objectContaining({ fromName: 'Ada', weaponEmoji: '🔫', result: 'BLOCKED', note: "blocked Ada's Gun with SHIELD" })]);
    expect(cy).toMatchObject({ emoji: '⚡', label: 'Charge', kind: 'CHARGE', incoming: [] });
  });

  it('reflect: the defender shows REFLECTED and the attacker is the eliminated one', () => {
    const r = resultFor(withCharges(three(), { p2: 1 }), { p1: attack('GUN', 'p2'), p2: defend('REFLECT'), p3: CHARGE });
    const [ada, bo] = describeBattlefield(r, nameOf);
    expect(bo!.incoming[0]!.result).toBe('REFLECTED');
    expect(ada!.eliminated).toBe(true);
    expect(bo!.eliminated).toBe(false);
  });

  it('collision: the winner sees CLASH_WON, the loser sees ELIMINATED', () => {
    const r = resultFor(withCharges(newGame(2), { p1: 1, p2: 1 }), { p1: attack('GUN', 'p2'), p2: attack('KNIFE', 'p1') });
    const [ada, bo] = describeBattlefield(r, nameOf);
    expect(ada!.incoming[0]!.result).toBe('CLASH_WON');
    expect(bo!.incoming[0]!.result).toBe('ELIMINATED');
    expect(bo!.eliminated).toBe(true);
  });

  it('a Charging player who is hit is eliminated', () => {
    const r = resultFor(three(), { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE });
    const bo = describeBattlefield(r, nameOf)[1]!;
    expect(bo.incoming[0]!.result).toBe('ELIMINATED');
    expect(bo.eliminated).toBe(true);
  });
});

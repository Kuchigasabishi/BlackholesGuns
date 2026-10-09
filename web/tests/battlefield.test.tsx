// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ATTACK_IDS, DEFENSE_IDS } from '../../src/engine';
import { BF_TIMING } from '../src/components/Battlefield';
import { TurnResolutionModal } from '../src/components/TurnResolutionModal';
import { describeBattlefield } from '../src/format/describeTurn';
import { ATTACK_EMOJI, CHARGE_EMOJI, DEFENSE_EMOJI } from '../src/format/emoji';
import { SettingsProvider, StoreProvider } from '../src/hooks';
import { reducer } from '../src/state/reducer';
import { CHARGE, NAMES, attack, clientStateFor, defend, newGame, resultFor, stubStore, withCharges } from './fixtures';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const nameOf = (id: string): string => NAMES[Number(id.slice(1)) - 1] ?? id;
const three = () => withCharges(newGame(3), { p1: 1, p3: 1 });
const mount = (ui: ReactElement, store: ReturnType<typeof stubStore>) =>
  render(
    <StoreProvider store={store}>
      <SettingsProvider>{ui}</SettingsProvider>
    </StoreProvider>,
  );
const modalFor = (game: ReturnType<typeof newGame>, actions: Parameters<typeof resultFor>[1]) =>
  stubStore(reducer(clientStateFor(game, 'p1'), { type: 'result', payload: resultFor(game, actions) }));

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

describe('Battlefield in the Turn Resolution modal', () => {
  it('shows every participant at once, with bold emoji action slots and names', () => {
    mount(<TurnResolutionModal />, modalFor(three(), { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE }));
    const field = screen.getByTestId('battlefield');
    expect(within(field).getAllByRole('listitem', { name: /:/ })).toHaveLength(3);
    expect(screen.getByTestId('bf-p1').textContent).toContain('Ada');
    expect(within(screen.getByTestId('bf-p1')).getByTestId('bf-action').textContent).toBe('🔫');
    expect(within(screen.getByTestId('bf-p2')).getByTestId('bf-action').textContent).toBe('🛡️');
    expect(within(screen.getByTestId('bf-p3')).getByTestId('bf-action').textContent).toBe('⚡');
  });

  it('Gun vs SHIELD: the gun lunges, flies into the shield, which pops; the block result appears after', () => {
    mount(<TurnResolutionModal />, modalFor(three(), { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE }));
    const ada = screen.getByTestId('bf-p1');
    const bo = screen.getByTestId('bf-p2');
    const lunge = ada.querySelector('.anim-bf-lunge') as HTMLElement;
    expect(lunge.style.animationDelay).toBe(`${BF_TIMING.lunge}ms`);
    const projectile = within(bo).getByTestId('bf-projectile');
    expect(projectile.textContent).toBe('🔫');
    expect(projectile.className).toContain('anim-bf-fly');
    expect(projectile.style.animationDelay).toBe(`${BF_TIMING.fly}ms`);
    expect((within(bo).getByTestId('bf-action') as HTMLElement).className).toContain('anim-bf-impact');
    expect((within(bo).getByTestId('bf-action') as HTMLElement).style.animationDelay).toBe(`${BF_TIMING.hit}ms`);
    expect(within(bo).getByTestId('bf-results-p2').textContent).toContain('[BLOCKED]');
    // sequence: fly lands before the impact, and the result appears after the impact begins
    expect(BF_TIMING.fly).toBeLessThan(BF_TIMING.hit);
    expect(BF_TIMING.hit).toBeLessThanOrEqual(BF_TIMING.result);
  });

  it('in parallel: the charger pulses while the clash plays, on the same shared clock', () => {
    mount(<TurnResolutionModal />, modalFor(three(), { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE }));
    const cy = screen.getByTestId('bf-p3');
    const pulse = cy.querySelector('.anim-bf-charge') as HTMLElement;
    expect(pulse).toBeTruthy();
    expect(pulse.style.animationDelay).toBe(`${BF_TIMING.charge}ms`);
    // the clash and the charge both begin before the clash's impact lands: they overlap in time
    expect(BF_TIMING.charge).toBeLessThan(BF_TIMING.hit);
    // no card is staggered behind another: every card's animations use the module's fixed delays only
    const delays = new Set([...document.querySelectorAll<HTMLElement>('[data-testid="battlefield"] [style*="animation-delay"]')].map((el) => el.style.animationDelay));
    const allowed = new Set(Object.values(BF_TIMING).map((ms) => `${ms}ms`).concat([`${BF_TIMING.result + 150}ms`]));
    for (const d of delays) expect(allowed.has(d), d).toBe(true);
  });

  it('an eliminated player is greyscale with an explicit [ELIMINATED] label (not colour alone)', () => {
    mount(<TurnResolutionModal />, modalFor(three(), { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE }));
    const bo = screen.getByTestId('bf-p2');
    expect(bo.getAttribute('data-eliminated')).toBe('true');
    expect(bo.textContent).toContain('[ELIMINATED]');
    expect(bo.innerHTML).toContain('grayscale');
    // an eliminated charger does not get the successful-gather pulse
    expect(bo.querySelector('.anim-bf-charge')).toBeNull();
  });

  it('keeps the exact text breakdown available in a disclosure', () => {
    mount(<TurnResolutionModal />, modalFor(three(), { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE }));
    expect(screen.getByTestId('tr-details').textContent).toContain("Bo successfully blocked Ada's Gun using SHIELD!");
  });

  it('never reveals opponents\' Charge balances (§12): no "+1" or balance text on cards', () => {
    mount(<TurnResolutionModal />, modalFor(three(), { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE }));
    expect(screen.getByTestId('battlefield').textContent).not.toMatch(/\+\d|now \d|⚡ \d/);
  });

  it('with reduced motion: no animation classes, but the finished picture (emoji, results) is all there', () => {
    localStorage.setItem('bng.reducedMotion', '1');
    mount(<TurnResolutionModal />, modalFor(three(), { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE }));
    const field = screen.getByTestId('battlefield');
    expect(field.innerHTML).not.toContain('anim-bf');
    expect(field.innerHTML).not.toContain('animation-delay');
    expect(within(screen.getByTestId('bf-p2')).getByTestId('bf-projectile').textContent).toBe('🔫');
    expect(screen.getByTestId('bf-results-p2').textContent).toContain('[BLOCKED]');
  });
});

describe('battlefield CSS', () => {
  const css = readFileSync('web/src/index.css', 'utf8');
  const rules = css.split(/\r?\n/).filter((l) => l.startsWith('.anim-bf-'));

  it('defines every animation, none loops forever, and the charge pulse repeats a fixed 2 times', () => {
    expect(rules.length).toBe(6);
    for (const r of rules) expect(r, r).not.toContain('infinite');
    expect(rules.find((r) => r.startsWith('.anim-bf-charge'))).toContain(' 2 both');
    for (const k of ['bf-fly', 'bf-lunge', 'bf-impact', 'bf-charge', 'bf-result', 'bf-grey']) expect(css).toContain(`@keyframes ${k}`);
  });

  it('the global reduced-motion rules still switch every animation off', () => {
    expect(css).toMatch(/data-reduced-motion="true"\] \*,[\s\S]*animation: none !important/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  });
});

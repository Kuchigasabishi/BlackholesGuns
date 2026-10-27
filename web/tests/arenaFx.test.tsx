// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeriesResultModal } from '../src/components/SeriesResultModal';
import { TurnResolutionModal } from '../src/components/TurnResolutionModal';
import { readFileSync } from 'node:fs';
import { flyerMotion } from '../src/components/ArenaFX';
import { FX_TIMING, buildSchedule, planTurn, reactionsAt, shakeTierAt } from '../src/format/fxPlan';
import { FxTimelineProvider } from '../src/fx/FxTimeline';
import { SettingsProvider, StoreProvider } from '../src/hooks';
import { GameScreen } from '../src/screens/Game';
import { reducer } from '../src/state/reducer';
import { CHARGE, attack, clientStateFor, defend, newGame, resultFor, stubStore, withCharges } from './fixtures';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const three = () => withCharges(newGame(3), { p1: 1, p3: 1 });
const mount = (ui: ReactElement, store: ReturnType<typeof stubStore>) =>
  render(
    <StoreProvider store={store}>
      <SettingsProvider>
        <FxTimelineProvider>{ui}</FxTimelineProvider>
      </SettingsProvider>
    </StoreProvider>,
  );

/** A store with the game open and no result yet; the result arrives afterwards, so it animates. */
const liveStore = (game: ReturnType<typeof newGame>) => stubStore(clientStateFor(game, 'p1'));
const deliver = (store: ReturnType<typeof stubStore>, game: ReturnType<typeof newGame>, actions: Parameters<typeof resultFor>[1]) =>
  act(() => store.dispatch({ type: 'result', payload: resultFor(game, actions) }));
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('fxPlan (built from the canonical events)', () => {
  it('Gun vs Shield: one projectile, blocked, with a clash emoji on the defender', () => {
    const plan = planTurn(resultFor(three(), { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE }));
    expect(plan.projectiles).toEqual([expect.objectContaining({ from: 'p1', to: 'p2', emoji: '🔫', end: 'BLOCKED' })]);
    expect(plan.cards.p2).toMatchObject({ actionEmoji: '🛡️', reaction: 'CLASH', clashEmoji: '🛡️' });
    expect(plan.cards.p3).toMatchObject({ actionEmoji: '⚡', kind: 'CHARGE' });
  });

  it('a Gun on a charging player lands: the victim is hit and eliminated', () => {
    const plan = planTurn(resultFor(three(), { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE }));
    expect(plan.projectiles[0]).toMatchObject({ end: 'HIT', to: 'p2' });
    expect(plan.cards.p2).toMatchObject({ reaction: 'HIT', eliminated: true });
    expect(plan.damaged).toContain('p2');
  });

  it('Reflect sends the projectile back and damages the attacker', () => {
    const plan = planTurn(resultFor(withCharges(three(), { p2: 1 }), { p1: attack('GUN', 'p2'), p2: defend('REFLECT'), p3: CHARGE }));
    expect(plan.projectiles[0]!.end).toBe('REFLECTED');
    expect(plan.cards.p1!.reaction).toBe('HIT');
    expect(plan.cards.p2!.reaction).toBe('CLASH');
  });

  it('defenders and chargers are face-up at 0; attackers are revealed one by one, 700 ms apart', () => {
    const game = withCharges(newGame(3), { p1: 1, p2: 1 });
    const sched = buildSchedule(planTurn(resultFor(game, { p1: attack('GUN', 'p3'), p2: attack('KNIFE', 'p3'), p3: defend('SHIELD') })));
    expect(sched.attackers.map((a) => [a.playerId, a.revealAt])).toEqual([['p1', FX_TIMING.lead], ['p2', FX_TIMING.lead + FX_TIMING.maxStep]]);
    expect(sched.shots.every((x) => x.launchAt === sched.attackers.find((a) => a.playerId === x.shot.from)!.revealAt)).toBe(true);
    expect(sched.settleAt).toBeGreaterThan(sched.shots.at(-1)!.impactAt);
  });

  it('compresses the step (never below the minimum) so even 7 attackers finish about inside the 4 s pause', () => {
    const game = withCharges(newGame(8), { p1: 1, p2: 1, p3: 1, p4: 1, p5: 1, p6: 1, p7: 1 });
    const acts: Parameters<typeof resultFor>[1] = { p8: defend('SHIELD') };
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']) acts[id] = attack('GUN', 'p8');
    const sched = buildSchedule(planTurn(resultFor(game, acts)));
    const gaps = sched.attackers.slice(1).map((a, i) => a.revealAt - sched.attackers[i]!.revealAt);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(FX_TIMING.minStep);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(FX_TIMING.shake); // one shake finishes before the next starts
    expect(sched.settleAt).toBeLessThan(4200);
  });

  it.each([
    ['GUN', 1],
    ['GATLING_GUN', 2],
    ['KATANA', 3],
    ['BOMB', 4],
    ['BLACKHOLE', 5],
  ] as const)('%s shakes the screen at tier %i, for one 300 ms burst, then stops', (weapon, tier) => {
    const game = withCharges(newGame(2), { p1: 5 });
    const sched = buildSchedule(planTurn(resultFor(game, { p1: weapon === 'BLACKHOLE' || weapon === 'BOMB' ? attack(weapon) : attack(weapon, 'p2'), p2: CHARGE })));
    const at = sched.attackers[0]!.revealAt;
    expect(shakeTierAt(sched, at - 1)).toBeNull();
    expect(shakeTierAt(sched, at)).toBe(tier);
    expect(shakeTierAt(sched, at + FX_TIMING.shake - 1)).toBe(tier);
    expect(shakeTierAt(sched, at + FX_TIMING.shake)).toBeNull();
  });

  it('reactionsAt only fires once a projectile has landed', () => {
    const sched = buildSchedule(planTurn(resultFor(three(), { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE })));
    const landing = sched.shots[0]!.impactAt;
    expect(reactionsAt(sched, landing - 1).p2).toBeUndefined();
    expect(reactionsAt(sched, landing).p2).toEqual({ hit: false, clashEmoji: '🛡️' });
  });
});

describe('Turn Resolution popup with the emoji clash timeline', () => {
  it("opens a focused dialog with every acting player's card and a single Next turn button", () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    expect(screen.queryByRole('dialog')).toBeNull();
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    const dialog = screen.getByRole('dialog', { name: 'Turn Resolution' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByTestId('bf-p1').textContent).toContain('❔'); // the attacker is revealed after the lead-in
    advance(FX_TIMING.lead);
    expect(within(dialog).getByTestId('bf-p1').querySelector('[data-action-icon="GUN"]')).toBeTruthy();
    expect(within(dialog).getByTestId('bf-p2').querySelector('[data-action-icon="SHIELD"]')).toBeTruthy(); // vector Shield, not the emoji
    expect(within(dialog).getByTestId('bf-p3').querySelector('[data-action-icon="CHARGE"]')).toBeTruthy();
    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByTestId('tr-next').textContent).toContain('Next turn');
    expect(document.activeElement).toBe(screen.getByTestId('tr-next'));
  });

  it('reveals attackers one by one: face-down first, then the shake, the weapon flying and the shield clash', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    const card = (id: string) => screen.getByTestId(`bf-${id}`);
    expect(card('p2').getAttribute('data-revealed')).toBe('true'); // defenders and chargers are face-up at once
    expect(card('p3').getAttribute('data-revealed')).toBe('true');
    expect(card('p1').getAttribute('data-revealed')).toBe('false'); // the attacker is still face-down
    expect(card('p1').textContent).toContain('❔');
    expect(card('p3').querySelector('[data-glyph="CHARGE"]')!.className).toContain('fx-gather'); // breathing Charge
    expect(screen.queryByTestId('fx-projectile')).toBeNull();
    expect(screen.getByTestId('turn-resolution').getAttribute('data-shake')).toBeNull();

    advance(FX_TIMING.lead);
    expect(card('p1').getAttribute('data-revealed')).toBe('true');
    expect(card('p1').querySelector('[data-action-icon="GUN"]')).toBeTruthy();
    expect(screen.getByTestId('turn-resolution').getAttribute('data-shake')).toBe('1'); // Gun = tier 1
    expect(screen.getByTestId('turn-resolution').className).toContain('anim-shake-t1');
    const shot = screen.getByTestId('fx-projectile');
    expect(shot.querySelector('[data-action-icon="GUN"]')).toBeTruthy(); // the flying weapon is the vector Gun
    expect(shot.getAttribute('data-end')).toBe('BLOCKED');
    expect(screen.queryByTestId('clash-p2')).toBeNull();

    advance(FX_TIMING.shake); // the shake ends and the window is back to rest
    expect(screen.getByTestId('turn-resolution').getAttribute('data-shake')).toBeNull();
    expect(screen.getByTestId('turn-resolution').className).not.toContain('anim-shake');

    advance(FX_TIMING.flight - FX_TIMING.shake); // the shot lands on the shield
    expect(screen.getByTestId('clash-p2').querySelector('[data-action-icon="SHIELD"]')).toBeTruthy();
    expect(card('p2').getAttribute('data-fx')).toBe('clash');
    expect(screen.queryByTestId('bf-results-p2')).toBeNull(); // text results wait for the sequence

    advance(FX_TIMING.tail);
    expect(screen.queryByTestId('fx-projectile')).toBeNull();
    expect(screen.getByTestId('bf-results-p2').textContent).toContain('[BLOCKED]');
  });

  it('two attackers are revealed 700 ms apart and the stronger weapon shakes harder', () => {
    const game = withCharges(newGame(3), { p1: 1, p2: 3 });
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p3'), p2: attack('KATANA', 'p3'), p3: CHARGE });
    advance(FX_TIMING.lead);
    expect(screen.getByTestId('bf-p1').getAttribute('data-revealed')).toBe('true');
    expect(screen.getByTestId('bf-p2').getAttribute('data-revealed')).toBe('false');
    advance(FX_TIMING.maxStep);
    expect(screen.getByTestId('bf-p2').getAttribute('data-revealed')).toBe('true');
    expect(screen.getByTestId('turn-resolution').getAttribute('data-shake')).toBe('3'); // Katana = tier 3
  });

  it('a landed attack shakes the victim and shows a damage overlay before the [ELIMINATED] result', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE });
    advance(FX_TIMING.lead + FX_TIMING.flight);
    expect(screen.getByTestId('bf-p2').getAttribute('data-fx')).toBe('hit');
    expect(screen.getByTestId('damage-p2')).toBeTruthy();
    expect(screen.queryByTestId('tr-end')).toBeNull();
    expect(screen.getByTestId('bf-p2').querySelector('[data-testid="digital-dust"]')).toBeTruthy(); // the eliminated card crumbles
    advance(FX_TIMING.dissolve - 1);
    expect(screen.queryByTestId('bf-results-p2')).toBeNull(); // permanent state waits for the dust to finish
    advance(1);
    expect(screen.queryByTestId('digital-dust')).toBeNull();
    expect(screen.getByTestId('bf-results-p2').textContent).toContain('[ELIMINATED]');
    expect(screen.getByTestId('tr-end').textContent).toContain('ROUND OVER');
  });

  it('Next turn closes it and it stays closed for that turn', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: CHARGE, p2: CHARGE, p3: CHARGE });
    act(() => screen.getByTestId('tr-next').click());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes by itself when the next turn opens, so it never blocks play', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: CHARGE, p2: CHARGE, p3: CHARGE });
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => store.dispatch({ type: 'turnOpen', payload: { turnId: 'fx:m1:r1:t2', turnIndex: 2, phase: 'NORMAL', eligiblePlayerIds: ['p1', 'p2', 'p3'], deadlineAt: 1, serverTime: 1 }, receivedAt: 1 }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with reduced motion there is no animation: the finished picture shows immediately', () => {
    localStorage.setItem('bng.reducedMotion', '1');
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE });
    expect(screen.queryByTestId('fx-projectile')).toBeNull();
    expect(screen.getByTestId('bf-results-p2').textContent).toContain('[ELIMINATED]');
    expect(screen.getByTestId('bf-p1').querySelector('[data-testid="bf-action"]')!.className).not.toContain('anim-');
  });

  it('does not replay on reload: a result already in the snapshot shows settled', () => {
    const game = three();
    const result = resultFor(game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE });
    mount(<TurnResolutionModal />, stubStore(reducer(clientStateFor(game, 'p1'), { type: 'result', payload: result })));
    expect(screen.queryByTestId('fx-projectile')).toBeNull();
    expect(screen.getByTestId('bf-results-p2').textContent).toContain('[ELIMINATED]');
  });

  it('a match-ending turn shows the MATCH OVER result and a Match results button', () => {
    const game = withCharges(newGame(2), { p1: 1, p2: 1 });
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: attack('KNIFE', 'p1') });
    expect(screen.queryByTestId('tr-end')).toBeNull();
    advance(5000);
    expect(screen.getByTestId('tr-end').textContent).toContain('Ada wins the match!');
    expect(screen.getByTestId('tr-end').textContent).toContain('+1 Match Win');
    expect(screen.getByTestId('tr-next').textContent).toContain('Match results');
  });

  it('the game screen has no Lock In button until an action is chosen, so nothing needs scrolling', () => {
    mount(<GameScreen />, liveStore(three()));
    expect(screen.queryByTestId('lock-in')).toBeNull();
  });
});

describe('series result dialog', () => {
  it('waits for the turn popup, then shows; Return to lobby clears the finished game', () => {
    const base = withCharges(newGame(2), { p1: 1 });
    const game = { ...base, series: { ...base.series, matchWins: { p1: 9, p2: 0 } } }; // the next win is #10
    const store = liveStore(game);
    mount(
      <>
        <TurnResolutionModal />
        <SeriesResultModal />
      </>,
      store,
    );
    act(() => store.dispatch({ type: 'seriesEnded', winnerId: 'p1', matchWins: { p1: 3, p2: 1 } }));
    act(() => store.dispatch({ type: 'result', payload: resultFor(game, { p1: attack('GUN', 'p2'), p2: CHARGE }) }));
    advance(5000);
    expect(screen.queryByTestId('series-result')).toBeNull(); // the turn popup is still open
    expect(screen.getByTestId('tr-next').textContent).toContain('Series results');
    act(() => screen.getByTestId('tr-next').click());
    expect(screen.getByTestId('sr-winner').textContent).toContain('Ada wins the series!');
    act(() => screen.getByTestId('sr-return').click());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.getState().game).toBeNull();
  });
});

describe('Figma vector icons replace the Charge / Dodge / Shield / Gun / Knife / Reflect emoji', () => {
  const icon = (id: string, name: string) => screen.getByTestId(id).querySelector(`[data-action-icon="${name}"]`);

  it('a Shield is held back at low opacity until the projectile lands, then lights up; Charge shows at once', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    const lit = () => screen.getByTestId('bf-p2').querySelector('[data-glyph="SHIELD"]')!.getAttribute('data-lit');
    expect(icon('bf-p2', 'SHIELD')).toBeTruthy();
    expect(lit()).toBe('false');
    expect(screen.getByTestId('bf-p3').querySelector('[data-glyph="CHARGE"]')!.getAttribute('data-lit')).toBe('true');
    advance(FX_TIMING.lead + FX_TIMING.flight - 1);
    expect(lit()).toBe('false');
    advance(1); // impact
    expect(lit()).toBe('true');
  });

  it('with no incoming attack a Dodge is lit straight away, and the Gun / Knife / Reflect glyphs are vectors too', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('KNIFE', 'p3'), p2: defend('DODGE'), p3: defend('REFLECT') });
    advance(FX_TIMING.lead);
    expect(screen.getByTestId('bf-p2').querySelector('[data-glyph="DODGE"]')!.getAttribute('data-lit')).toBe('true');
    expect(icon('bf-p1', 'KNIFE')).toBeTruthy();
    expect(icon('bf-p3', 'REFLECT')).toBeTruthy();
  });

  it('every icon draws in currentColor so the theme colour and dimming apply', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    for (const svg of screen.getByTestId('bf-p1').querySelectorAll('[data-action-icon]')) {
      const paints = [...svg.querySelectorAll('[stroke],[fill]')].flatMap((e) => [e.getAttribute('stroke'), e.getAttribute('fill')]).filter((v) => v && v !== 'none');
      expect(paints.length).toBeGreaterThan(0);
      expect(paints.every((v) => v === 'currentColor' || v!.startsWith('var(--icon-cut'))).toBe(true);
    }
  });
});

describe('Icon combat choreography (CSS keyframes on the Figma icons)', () => {
  const glyph = (card: string, name: string) => screen.getByTestId(card).querySelector(`[data-glyph="${name}"]`)!;
  const impact = FX_TIMING.lead + FX_TIMING.flight;

  it('Charge breathes from the start; a Shield springs up exactly at the impact tick while the bullet flies at it', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    expect(glyph('bf-p3', 'CHARGE').getAttribute('data-fx')).toBe('gather');
    expect(glyph('bf-p2', 'SHIELD').getAttribute('data-fx')).toBeNull(); // armed, waiting for the weapon
    advance(FX_TIMING.lead);
    const shot = screen.getByTestId('fx-projectile');
    expect(shot.getAttribute('data-motion')).toBe('fx-bullet-blocked');
    expect(shot.className).toContain('fx-bullet-blocked');
    advance(FX_TIMING.flight - 1);
    expect(glyph('bf-p2', 'SHIELD').getAttribute('data-fx')).toBeNull();
    advance(1);
    expect(glyph('bf-p2', 'SHIELD').getAttribute('data-fx')).toBe('activate');
    expect(glyph('bf-p2', 'SHIELD').className).toContain('fx-activate');
  });

  it('a Dodge slides away from the attacker at impact', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: defend('DODGE'), p3: CHARGE });
    expect(glyph('bf-p2', 'DODGE').getAttribute('data-fx')).toBeNull();
    advance(impact);
    const dodge = glyph('bf-p2', 'DODGE') as HTMLElement;
    expect(dodge.getAttribute('data-fx')).toBe('avoid');
    expect(dodge.style.getPropertyValue('--dir')).toBe('1'); // the attacker's card is to the left, so it slides right
  });

  it('a successful Reflect flips the mirror and streaks a particle back when the weapon lands', () => {
    const game = withCharges(three(), { p2: 1 });
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: defend('REFLECT'), p3: CHARGE });
    advance(FX_TIMING.lead);
    expect(screen.getByTestId('fx-projectile').getAttribute('data-motion')).toBe('fx-bullet-reflected');
    advance(FX_TIMING.flight * 1.7);
    const mirror = glyph('bf-p2', 'REFLECT');
    expect(mirror.getAttribute('data-fx')).toBe('reflect');
    expect(mirror.className).toContain('fx-reflect');
    expect(mirror.querySelector('.fx-reflect-bounce')).toBeTruthy();
  });

  it('a Knife attack dashes and slashes (meleeStrike) while a Gun fires a bullet', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('KNIFE', 'p2'), p2: CHARGE, p3: attack('GUN', 'p2') });
    advance(FX_TIMING.lead);
    const motions = screen.getAllByTestId('fx-projectile').map((x) => x.getAttribute('data-motion'));
    expect(motions).toContain('fx-melee');
  });

  it('the victim shakes for 300 ms at impact; reduced motion plays none of it', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE });
    advance(impact);
    expect(screen.getByTestId('bf-p2').className).toContain('anim-fx-hit');
    cleanup();
    localStorage.setItem('bng.reducedMotion', '1');
    const store2 = liveStore(game);
    mount(<TurnResolutionModal />, store2);
    deliver(store2, game, { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    expect(glyph('bf-p2', 'SHIELD').getAttribute('data-fx')).toBeNull();
    expect(glyph('bf-p2', 'SHIELD').getAttribute('data-lit')).toBe('true');
    expect(screen.queryByTestId('fx-projectile')).toBeNull();
  });

  it('flyerMotion scales each animation to land on its impact tick', () => {
    expect(flyerMotion({ end: 'HIT', emoji: '🔫' })).toEqual({ cls: 'fx-bullet', duration: FX_TIMING.flight * 1.15 });
    expect(flyerMotion({ end: 'HIT', emoji: '🔪' }).cls).toBe('fx-melee');
    expect(flyerMotion({ end: 'REFLECTED', emoji: '🔫' }).cls).toBe('fx-bullet-reflected');
    expect(flyerMotion({ end: 'NEUTRALIZED', emoji: '🔪' }).cls).toBe('fx-bullet-clash');
    const melee = flyerMotion({ end: 'HIT', emoji: '🔪' });
    expect(melee.duration * 0.6).toBeCloseTo(FX_TIMING.flight, -1); // the slash frame (60%) is the impact tick
  });

  it('the stylesheet defines the six keyframes with translate3d / scale3d only, and disables them for reduced motion', () => {
    const css = readFileSync('web/src/index.css', 'utf8');
    for (const k of ['fireBullet', 'meleeStrike', 'activateDefenses', 'reflectBounce', 'gatherEnergy', 'avoidManeuver']) expect(css).toContain(`@keyframes ${k} {`);
    const section = css.slice(css.indexOf('/* A hit: 300 ms shake'), css.indexOf('/* Tier power-up glow'));
    expect(section).not.toMatch(/translate\(|scale\(|translateX|translateY/); // only the 3d forms (compositor-friendly)
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  });
});

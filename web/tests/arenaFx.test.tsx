// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeriesResultModal } from '../src/components/SeriesResultModal';
import { TurnResolutionModal } from '../src/components/TurnResolutionModal';
import { FX_TIMING, planTurn, stageAt } from '../src/format/fxPlan';
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

  it('the shared clock is ordered and finishes well inside the 4 s inter-turn pause', () => {
    expect(FX_TIMING.reveal).toBeLessThan(FX_TIMING.launch);
    expect(FX_TIMING.launch + FX_TIMING.flight).toBeLessThanOrEqual(FX_TIMING.impact);
    expect(FX_TIMING.impact).toBeLessThan(FX_TIMING.settle);
    expect(FX_TIMING.settle).toBeLessThan(4000);
    expect([0, FX_TIMING.launch, FX_TIMING.impact, FX_TIMING.settle].map(stageAt)).toEqual(['reveal', 'fly', 'impact', 'settled']);
  });
});

describe('Turn Resolution popup with the emoji clash timeline', () => {
  it("opens a focused dialog with every acting player's card and a single Next turn button", () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    expect(screen.queryByRole('dialog')).toBeNull();
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    const dialog = screen.getByRole('dialog', { name: 'TURN RESOLUTION' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByTestId('bf-p1').textContent).toContain('🔫');
    expect(within(dialog).getByTestId('bf-p2').textContent).toContain('🛡️');
    expect(within(dialog).getByTestId('bf-p3').textContent).toContain('⚡');
    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByTestId('tr-next').textContent).toContain('Next turn');
    expect(document.activeElement).toBe(screen.getByTestId('tr-next'));
  });

  it('plays reveal, then the weapon flies card to card, then the shield clash, then settles with result tags', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    expect(screen.queryByTestId('fx-projectile')).toBeNull(); // still revealing
    expect(screen.getByTestId('bf-p3').querySelector('[data-testid="bf-action"]')!.className).toContain('anim-fx-charge'); // pulsing Charge
    advance(FX_TIMING.launch);
    const shot = screen.getByTestId('fx-projectile');
    expect(shot.textContent).toBe('🔫');
    expect(shot.getAttribute('data-end')).toBe('BLOCKED');
    expect(screen.queryByTestId('clash-p2')).toBeNull();
    advance(FX_TIMING.impact - FX_TIMING.launch);
    expect(screen.getByTestId('clash-p2').textContent).toBe('🛡️');
    expect(screen.getByTestId('bf-p2').getAttribute('data-fx')).toBe('clash');
    expect(screen.queryByTestId('bf-results-p2')).toBeNull(); // text results wait for the animation
    advance(FX_TIMING.settle - FX_TIMING.impact);
    expect(screen.queryByTestId('fx-projectile')).toBeNull();
    expect(screen.getByTestId('bf-results-p2').textContent).toContain('[BLOCKED]');
  });

  it('a landed attack shakes the victim and shows a damage overlay before the [ELIMINATED] result', () => {
    const game = three();
    const store = liveStore(game);
    mount(<TurnResolutionModal />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE });
    advance(FX_TIMING.impact);
    expect(screen.getByTestId('bf-p2').getAttribute('data-fx')).toBe('hit');
    expect(screen.getByTestId('damage-p2')).toBeTruthy();
    expect(screen.queryByTestId('tr-end')).toBeNull();
    advance(FX_TIMING.settle - FX_TIMING.impact);
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
    advance(FX_TIMING.settle);
    expect(screen.getByTestId('tr-end').textContent).toContain('Ada wins the match! (+1 Match Win)');
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
    advance(FX_TIMING.settle);
    expect(screen.queryByTestId('series-result')).toBeNull(); // the turn popup is still open
    expect(screen.getByTestId('tr-next').textContent).toContain('Series results');
    act(() => screen.getByTestId('tr-next').click());
    expect(screen.getByTestId('sr-winner').textContent).toContain('Ada wins the series!');
    act(() => screen.getByTestId('sr-return').click());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.getState().game).toBeNull();
  });
});

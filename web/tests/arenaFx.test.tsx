// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeriesResultModal } from '../src/components/SeriesResultModal';
import { TurnBanner } from '../src/components/TurnBanner';
import { FX_TIMING, planTurn, stageAt } from '../src/format/fxPlan';
import { FxTimelineProvider } from '../src/fx/FxTimeline';
import { SettingsProvider, StoreProvider } from '../src/hooks';
import { GameScreen, Roster } from '../src/screens/Game';
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

describe('in-line arena animation (no popup)', () => {
  it('never opens a dialog for a turn result; emojis appear on the cards', () => {
    const game = three();
    const store = liveStore(game);
    mount(<GameScreen />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('action-emoji-p1').textContent).toBe('🔫');
    expect(screen.getByTestId('action-emoji-p2').textContent).toBe('🛡️');
    expect(screen.getByTestId('action-emoji-p3').textContent).toBe('⚡');
    expect(screen.getByTestId('action-emoji-p3').className).toContain('anim-fx-charge'); // pulsing Charge
  });

  it('plays reveal, then a projectile card-to-card, then the shield clash, then settles', () => {
    const game = three();
    const store = liveStore(game);
    mount(<Roster />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    expect(screen.queryByTestId('fx-projectile')).toBeNull(); // still revealing
    advance(FX_TIMING.launch);
    const shot = screen.getByTestId('fx-projectile');
    expect(shot.textContent).toBe('🔫');
    expect(shot.getAttribute('data-end')).toBe('BLOCKED');
    expect(screen.queryByTestId('clash-p2')).toBeNull();
    advance(FX_TIMING.impact - FX_TIMING.launch);
    expect(screen.getByTestId('clash-p2').textContent).toBe('🛡️');
    expect(screen.getByTestId('player-p2').getAttribute('data-fx')).toBe('clash');
    advance(FX_TIMING.settle - FX_TIMING.impact);
    expect(screen.queryByTestId('fx-projectile')).toBeNull();
    expect(screen.queryByTestId('clash-p2')).toBeNull();
  });

  it('a landed attack shakes the victim and shows a damage overlay; eliminated text waits for the impact', () => {
    const game = three();
    const store = liveStore(game);
    mount(<Roster />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE });
    expect(screen.getByTestId('badge-p2').textContent).not.toContain('ELIMINATED'); // static text lags the animation
    advance(FX_TIMING.impact);
    expect(screen.getByTestId('player-p2').getAttribute('data-fx')).toBe('hit');
    expect(screen.getByTestId('damage-p2')).toBeTruthy();
    expect(screen.getByTestId('badge-p2').textContent).not.toContain('ELIMINATED');
    advance(FX_TIMING.settle - FX_TIMING.impact);
    expect(screen.getByTestId('badge-p2').textContent).toContain('ELIMINATED');
    expect(screen.queryByTestId('damage-p2')).toBeNull();
  });

  it('own Charge and Match Wins update only when the animation settles', () => {
    const game = withCharges(newGame(2), { p1: 1, p2: 1 });
    const store = liveStore(game);
    mount(<Roster />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: attack('KNIFE', 'p1') });
    const card = () => screen.getByTestId('player-p1').textContent!;
    expect(card()).toContain('⚡ 1');
    expect(card()).toContain('🏆 0/10'); // the winner's +1 is not shown yet
    expect(screen.getByTestId('badge-p2').textContent).not.toContain('ELIMINATED');
    advance(FX_TIMING.settle);
    expect(card()).toContain('🏆 1/10');
  });

  it('with reduced motion there is no animation: the finished picture shows immediately', () => {
    localStorage.setItem('bng.reducedMotion', '1');
    const game = three();
    const store = liveStore(game);
    mount(<Roster />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE });
    expect(screen.queryByTestId('fx-projectile')).toBeNull();
    expect(screen.getByTestId('badge-p2').textContent).toContain('ELIMINATED');
    expect(screen.getByTestId('action-emoji-p1').className).not.toContain('anim-');
  });

  it('does not replay on reload: a result already in the snapshot shows settled', () => {
    const game = three();
    const result = resultFor(game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE });
    mount(<Roster />, stubStore(reducer(clientStateFor(game, 'p1'), { type: 'result', payload: result })));
    expect(screen.queryByTestId('fx-projectile')).toBeNull();
    expect(screen.getByTestId('badge-p2').textContent).toContain('ELIMINATED');
  });

  it('the round / match end banner is inline and appears after the animation settles', () => {
    const game = withCharges(newGame(2), { p1: 1, p2: 1 });
    const store = liveStore(game);
    mount(<TurnBanner />, store);
    deliver(store, game, { p1: attack('GUN', 'p2'), p2: attack('KNIFE', 'p1') });
    expect(screen.queryByTestId('turn-banner')).toBeNull();
    advance(FX_TIMING.settle);
    expect(screen.getByTestId('turn-banner').textContent).toContain('Ada wins the match! (+1 Match Win)');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('series result dialog', () => {
  it('shows after the final turn settles and Return to lobby clears the finished game', () => {
    const game = withCharges(newGame(2), { p1: 1 });
    const store = liveStore(game);
    mount(<SeriesResultModal />, store);
    act(() => store.dispatch({ type: 'seriesEnded', winnerId: 'p1', matchWins: { p1: 3, p2: 1 } }));
    act(() => store.dispatch({ type: 'result', payload: resultFor(game, { p1: attack('GUN', 'p2'), p2: CHARGE }) }));
    expect(screen.queryByRole('dialog')).toBeNull();
    advance(FX_TIMING.settle);
    expect(screen.getByTestId('sr-winner').textContent).toContain('Ada wins the series!');
    act(() => screen.getByTestId('sr-return').click());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.getState().game).toBeNull();
  });
});

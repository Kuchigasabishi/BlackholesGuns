// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeriesResultModal } from '../src/components/SeriesResultModal';
import { TurnResolutionModal } from '../src/components/TurnResolutionModal';
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
    const dialog = screen.getByRole('dialog', { name: 'TURN RESOLUTION' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByTestId('bf-p1').textContent).toContain('❔'); // the attacker is revealed after the lead-in
    advance(FX_TIMING.lead);
    expect(within(dialog).getByTestId('bf-p1').textContent).toContain('🔫');
    expect(within(dialog).getByTestId('bf-p2').textContent).toContain('🛡️');
    expect(within(dialog).getByTestId('bf-p3').textContent).toContain('⚡');
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
    expect(card('p3').querySelector('[data-testid="bf-action"]')!.className).toContain('anim-fx-charge'); // pulsing Charge
    expect(screen.queryByTestId('fx-projectile')).toBeNull();
    expect(screen.getByTestId('turn-resolution').getAttribute('data-shake')).toBeNull();

    advance(FX_TIMING.lead);
    expect(card('p1').getAttribute('data-revealed')).toBe('true');
    expect(card('p1').textContent).toContain('🔫');
    expect(screen.getByTestId('turn-resolution').getAttribute('data-shake')).toBe('1'); // Gun = tier 1
    expect(screen.getByTestId('turn-resolution').className).toContain('anim-shake-t1');
    const shot = screen.getByTestId('fx-projectile');
    expect(shot.textContent).toBe('🔫');
    expect(shot.getAttribute('data-end')).toBe('BLOCKED');
    expect(screen.queryByTestId('clash-p2')).toBeNull();

    advance(FX_TIMING.shake); // the shake ends and the window is back to rest
    expect(screen.getByTestId('turn-resolution').getAttribute('data-shake')).toBeNull();
    expect(screen.getByTestId('turn-resolution').className).not.toContain('anim-shake');

    advance(FX_TIMING.flight - FX_TIMING.shake); // the shot lands on the shield
    expect(screen.getByTestId('clash-p2').textContent).toBe('🛡️');
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

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/audio/AudioManager';
import { SOUND_FILES, surgeRate, tickGapMs, tickRate } from '../src/audio/sounds';
import { ControlPanel } from '../src/components/ControlPanel';
import { TurnResolutionModal } from '../src/components/TurnResolutionModal';
import { FX_TIMING, buildSchedule, planTurn } from '../src/format/fxPlan';
import { FxTimelineProvider } from '../src/fx/FxTimeline';
import { SettingsProvider, StoreProvider } from '../src/hooks';
import { TopBar, VolumeControl } from '../src/screens/Game';
import { CHARGE, attack, clientStateFor, defend, newGame, resultFor, stubStore, withCharges } from './fixtures';
import type { PlayRecord } from './setup';

const plays = (): PlayRecord[] => (globalThis as unknown as { __plays: PlayRecord[] }).__plays;
const played = (): string[] => plays().map((p) => p.src.replace('/sounds/', '').replace('.wav', ''));

beforeEach(() => {
  localStorage.clear();
  plays().length = 0;
  audio.setMuted(false);
  audio.setVolume(0.7);
  vi.useFakeTimers();
});
afterEach(() => {
  audio.stopTicking();
  cleanup();
  vi.useRealTimers();
});

const mount = (ui: ReactElement, store: ReturnType<typeof stubStore>) =>
  render(
    <StoreProvider store={store}>
      <SettingsProvider>
        <FxTimelineProvider>{ui}</FxTimelineProvider>
      </SettingsProvider>
    </StoreProvider>,
  );
/** Advances in 250 ms slices, each in its own act(), so React re-renders (and the countdown state updates) like in a browser. */
const advance = (ms: number) => {
  for (let left = ms; left > 0; left -= 250) {
    act(() => {
      vi.advanceTimersByTime(Math.min(250, left));
    });
  }
};

describe('audio assets and curves', () => {
  it('every sound is a small web-ready file', async () => {
    const { statSync } = await import('node:fs');
    for (const f of Object.values(SOUND_FILES)) expect(statSync(`web/public${f.src}`).size).toBeLessThan(100 * 1024);
  });

  it('the charge surge rises with the Charge held; the tick speeds up and tightens toward 0', () => {
    expect([0, 1, 2, 5].map(surgeRate)).toEqual([1, 1.12, 1.24, 1.6]);
    expect(surgeRate(50)).toBe(2);
    expect(tickRate(9)).toBeLessThan(tickRate(5));
    expect(tickRate(5)).toBeLessThan(tickRate(0));
    expect(tickGapMs(9)).toBeGreaterThan(tickGapMs(3));
    expect(tickGapMs(0)).toBe(350);
  });
});

describe('Charging Surge', () => {
  it.each([0, 2, 4])('pressing Charge +1 at %i Charge plays the surge at a rate that rises with Charge', async (charge) => {
    vi.useRealTimers();
    const game = withCharges(newGame(2), { p1: charge });
    mount(<ControlPanel />, stubStore(clientStateFor(game, 'p1')));
    await userEvent.click(document.querySelector('button[data-action="CHARGE"]')!);
    expect(plays()).toEqual([{ src: '/sounds/charge.wav', rate: surgeRate(charge) }]);
  });
});

describe('Collision sound matrix, fired at the exact moment of visual impact', () => {
  const run = (actions: Parameters<typeof resultFor>[1], game = withCharges(newGame(3), { p1: 1, p2: 1, p3: 1 })) => {
    const store = stubStore(clientStateFor(game, 'p1'));
    mount(<TurnResolutionModal />, store);
    act(() => store.dispatch({ type: 'result', payload: resultFor(game, actions) }));
    return { game, impactAt: buildSchedule(planTurn(resultFor(game, actions))).shots[0]!.impactAt };
  };

  it.each([
    ['Weapon vs Shield', { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE }, ['clang']],
    ['Weapon vs Dodge', { p1: attack('GUN', 'p2'), p2: defend('DODGE'), p3: CHARGE }, ['whoosh']],
    ['Weapon vs Reflect', { p1: attack('GUN', 'p2'), p2: defend('REFLECT'), p3: CHARGE }, ['ping', 'boom']],
    ['Successful elimination', { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE }, ['boom']],
  ] as const)('%s', (_name, actions, expected) => {
    const { impactAt } = run(actions as Parameters<typeof resultFor>[1]);
    advance(impactAt - 1);
    expect(played()).toEqual([]); // nothing before the impact
    advance(1);
    expect(played()).toEqual(expected); // exactly at the impact
    advance(5000);
    expect(played()).toEqual(expected); // and only once
  });

  it('the elimination boom lands on the same tick that the digital-dust crumble starts', () => {
    const { impactAt } = run({ p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE });
    advance(impactAt);
    expect(played()).toEqual(['boom']);
    expect(screen.getByTestId('bf-p2').querySelector('[data-testid="digital-dust"]')).toBeTruthy();
  });

  it('rapid back-to-back turns leave no stray timers or double plays', () => {
    const game = withCharges(newGame(3), { p1: 1, p2: 1, p3: 1 });
    const store = stubStore(clientStateFor(game, 'p1'));
    mount(<TurnResolutionModal />, store);
    for (const actions of [
      { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE },
      { p1: attack('GUN', 'p2'), p2: defend('DODGE'), p3: CHARGE },
    ]) {
      const result = { ...resultFor(game, actions), turnId: `t${Math.random()}` };
      act(() => store.dispatch({ type: 'result', payload: result }));
      advance(FX_TIMING.lead + FX_TIMING.flight);
      advance(100); // the next turn arrives before the animation finished
    }
    advance(10_000);
    expect(played()).toEqual(['clang', 'whoosh']);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Ticking clock tension', () => {
  const setup = () => {
    const game = withCharges(newGame(3), { p1: 0 });
    const store = stubStore(clientStateFor(game, 'p1'));
    mount(<TopBar />, store);
    return { game, store };
  };
  const ticks = () => plays().filter((p) => p.src.endsWith('tick.wav'));

  it('is silent above 10 s, then ticks faster and faster as the timer nears 0', () => {
    setup(); // 25 s on the clock
    advance(14_000);
    expect(ticks()).toHaveLength(0);
    advance(3_000); // ~8 s left
    const early = ticks().length;
    expect(early).toBeGreaterThan(0);
    expect(audio.ticking).toBe(true);
    advance(5_000); // ~3 s left
    const rates = ticks().map((t) => t.rate);
    expect(rates.at(-1)!).toBeGreaterThan(rates[0]!);
    // tempo: more ticks per second near zero than at the start of the loop
    const start = ticks().length;
    advance(2_000);
    expect(ticks().length - start).toBeGreaterThanOrEqual(3);
  });

  it('stops the instant the player locks in, and when the turn ends', () => {
    const { store } = setup();
    advance(17_000);
    expect(audio.ticking).toBe(true);
    const turnId = store.getState().turn!.turnId;
    act(() => store.dispatch({ type: 'committed', turnId, action: { kind: 'CHARGE' } }));
    expect(audio.ticking).toBe(false);
    const n = ticks().length;
    advance(8_000);
    expect(ticks()).toHaveLength(n);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // only the countdown display interval remains
  });

  it('stops when the component unmounts (server state change / navigation)', () => {
    setup();
    advance(17_000);
    expect(audio.ticking).toBe(true);
    cleanup();
    expect(audio.ticking).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Mute and volume control in the status bar', () => {
  it('has a mute toggle and a volume slider that silence and scale all sound, and are remembered', async () => {
    vi.useRealTimers();
    const game = withCharges(newGame(2), { p1: 0 });
    mount(<VolumeControl />, stubStore(clientStateFor(game, 'p1')));
    const toggle = screen.getByTestId('mute-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    audio.play('boom');
    expect(played()).toEqual(['boom']);
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('bng.muted')).toBe('1');
    audio.play('boom');
    expect(played()).toEqual(['boom']); // muted: nothing new
    await userEvent.click(toggle);
    const slider = screen.getByTestId('volume-slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '30' } });
    expect(audio.getSnapshot().volume).toBeCloseTo(0.3);
    expect(localStorage.getItem('bng.volume')).toBe('0.3');
  });

  it('muting stops a running tick loop immediately', () => {
    vi.useFakeTimers();
    const game = withCharges(newGame(2), { p1: 0 });
    mount(<TopBar />, stubStore(clientStateFor(game, 'p1')));
    advance(17_000);
    expect(audio.ticking).toBe(true);
    act(() => audio.setMuted(true));
    expect(audio.ticking).toBe(false);
  });
});

describe('Background music', () => {
  const bgm = () => (globalThis as unknown as { __bgm: import('./setup').BgmRecord }).__bgm;
  beforeEach(() => {
    audio.dispose();
    Object.assign(bgm(), { playing: false, fades: [], volume: 0 });
  });

  it('is a seamless loop that fades in quietly (0.15) when a match starts and fades out and stops after', () => {
    audio.startBgm();
    expect(bgm().loop).toBe(true);
    expect(bgm().playing).toBe(true);
    expect(bgm().fades.at(-1)).toMatchObject({ to: 0.15, ms: 2000 });
    audio.stopBgm();
    expect(bgm().fades.at(-1)).toMatchObject({ to: 0, ms: 800 });
    expect(bgm().playing).toBe(true); // still fading
    advance(800);
    expect(bgm().playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starting again during a fade-out cancels the pending stop (no cut-off on rapid scene changes)', () => {
    audio.startBgm();
    audio.stopBgm();
    advance(300);
    audio.startBgm();
    advance(2000);
    expect(bgm().playing).toBe(true);
    expect(audio.bgmActive).toBe(true);
  });

  it('follows the screens: plays in the game view, fades out in the lobby / home', async () => {
    const { App } = await import('../src/App');
    const { initialState, reducer } = await import('../src/state/reducer');
    const { lobbyView } = await import('./fixtures');
    let s = reducer(initialState, { type: 'session', session: { roomCode: 'K7M2QP', playerId: 'p1', playerToken: 't' } });
    s = reducer(s, { type: 'lobby', lobby: lobbyView(2) });
    const store = stubStore(s);
    render(
      <StoreProvider store={store}>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </StoreProvider>,
    );
    expect(bgm().playing).toBe(false); // lobby: silent
    const game = newGame(2);
    act(() => store.set(clientStateFor(game, 'p1')));
    expect(bgm().playing).toBe(true); // match started
    act(() => store.dispatch({ type: 'reset' }));
    advance(800);
    expect(bgm().playing).toBe(false); // back to the main menu
  });

  it('is silenced by the master mute (Howler.mute applies to every sound, BGM included)', async () => {
    const { Howler } = await import('howler');
    audio.setMuted(true);
    expect(Howler.mute).toHaveBeenLastCalledWith(true);
    audio.setMuted(false);
    expect(Howler.mute).toHaveBeenLastCalledWith(false);
  });
});

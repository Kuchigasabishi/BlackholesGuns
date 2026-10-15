// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTACK_IDS, ATTACKS, DEFENSES, DEFENSE_IDS } from '../../src/engine';
import { App } from '../src/App';
import { EventLog } from '../src/components/EventLog';
import { ControlPanel } from '../src/components/ControlPanel';
import { StoreProvider, SettingsProvider } from '../src/hooks';
import { LobbyScreen } from '../src/screens/Lobby';
import { MatchResultsModal } from '../src/components/MatchResultsModal';
import { GameScreen, PhaseNotice, Roster, TopBar } from '../src/screens/Game';
import { initialState, reducer, screenOf } from '../src/state/reducer';
import { CHARGE, attack, clientStateFor, defend, lobbyView, newGame, resultFor, stubStore, withCharges, withStreak, type StubStore } from './fixtures';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mount = (ui: ReactElement, store: StubStore) =>
  render(
    <StoreProvider store={store}>
      <SettingsProvider>{ui}</SettingsProvider>
    </StoreProvider>,
  );

const button = (id: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`button[data-action="${id}"]`)!;
const disabled = (id: string): boolean => button(id).getAttribute('aria-disabled') === 'true';

/** Mid-COMMIT game for p1 (Ada) with the given Charge. */
const inGame = (n: number, charge: number, extra: Parameters<typeof withCharges>[1] = {}) => {
  const game = withCharges(newGame(n), { p1: charge, ...extra });
  return { game, store: stubStore(clientStateFor(game, 'p1')) };
};

// ------------------------------------------------------------------------ lobby

describe('Lobby screen', () => {
  const lobbyStore = (n: number, hostId = 'p1', me = 'p1') => {
    let s = reducer(initialState, { type: 'connection', status: 'connected' });
    s = reducer(s, { type: 'session', session: { roomCode: 'K7M2QP', playerId: me, playerToken: 't' } });
    s = reducer(s, { type: 'lobby', lobby: lobbyView(n, { hostId }) });
    return stubStore(s);
  };

  it('lets only the host change the Series Win Target (3 / 5 / 10, default 10)', async () => {
    const store = lobbyStore(2);
    mount(<LobbyScreen />, store);
    const select = screen.getByTestId('series-target') as HTMLSelectElement;
    expect(select.value).toBe('10');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['3 Wins', '5 Wins', '10 Wins (default)']);
    await userEvent.setup().selectOptions(select, '5');
    expect(store.targets).toEqual([5]);
  });

  it('disables the Series Win Target for guests', () => {
    mount(<LobbyScreen />, lobbyStore(2, 'p1', 'p2'));
    expect((screen.getByTestId('series-target') as HTMLSelectElement).disabled).toBe(true);
  });

  it('shows the room code, the canonical invite link and an 8-slot waiting roster', () => {
    mount(<LobbyScreen />, lobbyStore(3));
    expect(screen.getByTestId('room-code').textContent).toBe('K7M2QP');
    expect((screen.getByLabelText('Invite link') as HTMLInputElement).value).toBe('https://blackholesandguns.io/join/K7M2QP');
    const roster = screen.getByRole('list', { name: 'Waiting roster' });
    expect(within(roster).getAllByRole('listitem')).toHaveLength(8);
    expect(within(roster).getByText('Ada')).toBeTruthy();
    expect(within(roster).getAllByText(/Waiting for player/)).toHaveLength(5);
    expect(screen.getByTestId('player-count').textContent).toBe('3 / 8 players · minimum 2');
  });

  it('marks you, the host and connection state with text, not just colour', () => {
    const store = lobbyStore(2);
    store.set(reducer(store.getState(), { type: 'lobby', lobby: lobbyView(2, { offline: ['p2'] }) }));
    mount(<LobbyScreen />, store);
    expect(screen.getByText('[YOU]')).toBeTruthy();
    expect(screen.getByText('[HOST]')).toBeTruthy();
    expect(screen.getByText(/CONNECTED/)).toBeTruthy();
    expect(screen.getByText(/OFFLINE/)).toBeTruthy();
  });

  it('the host can start with 2+ players', async () => {
    const store = lobbyStore(2);
    mount(<LobbyScreen />, store);
    const start = screen.getByRole('button', { name: 'Start game' });
    expect(start.getAttribute('aria-disabled')).toBe('false');
    await userEvent.click(start);
    expect(store.started).toBe(1);
  });

  it('with one player, Start is disabled and says how many more are needed', async () => {
    const store = lobbyStore(1);
    mount(<LobbyScreen />, store);
    const start = screen.getByRole('button', { name: 'Start game' });
    expect(start.getAttribute('aria-disabled')).toBe('true');
    expect(start.getAttribute('aria-describedby')).toBe('start-hint');
    expect(screen.getByText('Need 1 more player to start.')).toBeTruthy();
    await userEvent.click(start);
    expect(store.started).toBe(0);
  });

  it('guests see a waiting message instead of Start', () => {
    mount(<LobbyScreen />, lobbyStore(2, 'p1', 'p2'));
    expect(screen.queryByRole('button', { name: 'Start game' })).toBeNull();
    expect(screen.getByText('Waiting for the host to start…')).toBeTruthy();
  });

  it('shows all 8 players when the room is full', () => {
    mount(<LobbyScreen />, lobbyStore(8));
    expect(screen.queryAllByText(/Waiting for player/)).toHaveLength(0);
    expect(screen.getByTestId('player-count').textContent).toBe('8 / 8 players · minimum 2');
  });

  it('copies the code and the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount(<LobbyScreen />, lobbyStore(2));
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenNthCalledWith(1, 'K7M2QP');
    expect(writeText).toHaveBeenNthCalledWith(2, 'https://blackholesandguns.io/join/K7M2QP');
  });
});

// ---------------------------------------------------------------- control panel

describe('Control panel: names, costs and affordability (Figure 1)', () => {
  it('shows every defense with its exact GDD name and cost', () => {
    mount(<ControlPanel />, inGame(2, 0).store);
    for (const id of DEFENSE_IDS) {
      expect(button(id).textContent).toContain(DEFENSES[id].name);
      expect(button(id).textContent).toContain(`(${DEFENSES[id].cost}⚡)`);
    }
    expect(DEFENSE_IDS.map((id) => DEFENSES[id].name)).toEqual(['Dodge', 'Shield', 'Reflect', 'Double Reflect', 'Triple Reflect', 'Quad Reflect']);
  });

  it('keeps only the 0-cost defenses on the top row and nests each Reflect in its matching tier group', () => {
    mount(<ControlPanel />, inGame(2, 1).store);
    const top = screen.getByRole('group', { name: 'Defensive actions and Charge' });
    expect(within(top).queryByRole('button', { name: /Reflect/ })).toBeNull();
    expect(within(top).getByRole('button', { name: /Dodge/ })).toBeTruthy();
    expect(within(top).getByRole('button', { name: /Shield/ })).toBeTruthy();
    const tiers: [string, string][] = [['TIER 1', 'REFLECT'], ['TIER 2', 'DOUBLE_REFLECT'], ['TIER 3', 'TRIPLE_REFLECT'], ['TIER 4', 'QUAD_REFLECT']];
    for (const [tier, name] of tiers) {
      const group = screen.getByRole('group', { name: new RegExp(`^${tier},`) });
      expect(group.contains(button(name))).toBe(true);
    }
    // Still cost-gated: with 1 Charge, Reflect is enabled and Double Reflect is not.
    expect(button('REFLECT').getAttribute('aria-disabled')).not.toBe('true');
    expect(button('DOUBLE_REFLECT').getAttribute('aria-disabled')).toBe('true');
  });

  it('shows matrix tooltips on hover and focus, and hides them when the pointer leaves', async () => {
    mount(<ControlPanel />, inGame(2, 5).store);
    const user = userEvent.setup();
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.hover(button('FLAMETHROWER'));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Effective against: SHIELD (Eliminates Target)');
    expect(tip.textContent).toContain('Blocked by: DODGE');
    await user.unhover(button('FLAMETHROWER'));
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.hover(button('GATLING_GUN'));
    expect(screen.getByRole('tooltip').textContent).toContain('Effective against: DODGE (Eliminates Target)');
    expect(screen.getByRole('tooltip').textContent).toContain('Blocked by: SHIELD');
    await user.unhover(button('GATLING_GUN'));
    act(() => button('DOUBLE_REFLECT').focus()); // a tap on a phone focuses the button
    expect(screen.getByRole('tooltip').textContent).toContain('Reflects (attacker is eliminated): GUN');
    act(() => button('DOUBLE_REFLECT').blur());
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.hover(button('DODGE'));
    expect(screen.queryByRole('tooltip')).toBeNull(); // only attacks and Reflects have one
  });

  it('lists all 12 attacks grouped by tier with their costs', () => {
    mount(<ControlPanel />, inGame(2, 5).store);
    expect(document.querySelectorAll('button[data-kind="attack"]')).toHaveLength(12);
    for (const id of ATTACK_IDS) expect(button(id).textContent).toContain(`${ATTACKS[id].name}`);
    for (const label of ['TIER 1 (1⚡):', 'TIER 2 (2⚡):', 'TIER 3 (3⚡):', 'TIER 4 (4⚡):', 'TIER 5 (5⚡):']) expect(screen.getByText(label)).toBeTruthy();
  });

  it.each([0, 1, 2, 3, 4, 5])('at %i Charge exactly the attacks costing <= Charge are enabled, the rest are dimmed', (charge) => {
    mount(<ControlPanel />, inGame(2, charge).store);
    for (const id of ATTACK_IDS) {
      const affordable = ATTACKS[id].cost <= charge;
      expect(disabled(id), `${id} disabled`).toBe(!affordable);
      expect(button(id).className.includes('opacity-40'), `${id} dimmed`).toBe(!affordable);
    }
    for (const id of DEFENSE_IDS) expect(disabled(id), id).toBe(DEFENSES[id].cost > charge);
    expect(screen.getByTestId('my-charge').textContent).toBe(`YOUR CHARGE: ${charge}⚡`);
  });

  it('keeps disabled buttons focusable and explains why, on focus and on hover', () => {
    mount(<ControlPanel />, inGame(2, 2).store);
    const nuke = button('NUKE');
    act(() => nuke.focus());
    expect(document.activeElement).toBe(nuke);
    expect(screen.getByTestId('why-line').textContent).toBe('Needs 4⚡ — you have 2⚡');
    fireEvent.mouseEnter(button('BLACKHOLE'));
    expect(screen.getByTestId('why-line').textContent).toBe('Needs 5⚡ — you have 2⚡');
    expect(nuke.getAttribute('aria-describedby')).toContain('why-NUKE');
    expect(document.getElementById('why-NUKE')!.textContent).toBe('Needs 4⚡ — you have 2⚡');
  });

  it('clicking a disabled action selects nothing', async () => {
    mount(<ControlPanel />, inGame(2, 1).store);
    await userEvent.click(button('NUKE'));
    expect(button('NUKE').getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('confirm-drawer')).toBeNull(); // nothing chosen, so no confirmation drawer
  });
});

describe('Control panel: choosing, targeting and locking in', () => {
  it('a targeted attack asks for a target, then commits it', async () => {
    const { store } = inGame(3, 1);
    mount(<ControlPanel />, store);
    await userEvent.click(button('GUN'));
    const picker = screen.getByTestId('target-picker');
    expect(within(picker).getByText('Choose 1 target for Gun')).toBeTruthy();
    expect(screen.getByTestId('lock-in').getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByTestId('lock-in')); // not ready: nothing sent
    expect(store.commits).toHaveLength(0);

    await userEvent.click(within(picker).getByRole('button', { name: 'Bo' }));
    expect(screen.getByTestId('confirm-choice').textContent).toBe('Gun → Bo');
    await userEvent.click(screen.getByTestId('lock-in'));
    expect(store.commits).toEqual([{ kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] }]);
  });

  it('shows a clear locked indicator afterwards and disables the whole panel', async () => {
    const { store } = inGame(2, 1);
    mount(<ControlPanel />, store);
    await userEvent.click(button('GUN')); // 2 players: the only opponent is auto-targeted
    await userEvent.click(screen.getByTestId('lock-in'));
    expect(screen.getByTestId('locked-indicator').textContent).toContain('LOCKED: Gun → Bo');
    expect(screen.getByTestId('locked-indicator').textContent).toContain('waiting for 1 more');
    for (const id of ['GUN', 'DODGE', 'CHARGE']) expect(disabled(id)).toBe(true);
    expect(screen.queryByTestId('lock-in')).toBeNull();
  });

  it('a 3-player Katana may pick up to 3 targets but no more; toggling removes', async () => {
    const { store } = inGame(5, 3);
    mount(<ControlPanel />, store);
    await userEvent.click(button('KATANA'));
    const picker = screen.getByTestId('target-picker');
    expect(within(picker).getByText('Choose up to 3 targets for Katana')).toBeTruthy();
    for (const n of ['Bo', 'Cy', 'Di', 'Ed']) await userEvent.click(within(picker).getByRole('button', { name: new RegExp(n) }));
    expect(screen.getByTestId('confirm-choice').textContent).toBe('Katana → Bo, Cy, Di'); // the 4th is refused
    await userEvent.click(within(picker).getByRole('button', { name: /Cy/ }));
    expect(screen.getByTestId('confirm-choice').textContent).toBe('Katana → Bo, Di');
    await userEvent.click(screen.getByTestId('lock-in'));
    expect(store.commits).toEqual([{ kind: 'ATTACK', weapon: 'KATANA', targets: ['p2', 'p4'] }]);
  });

  it('all-opponent weapons need no targets', async () => {
    const { store } = inGame(4, 4);
    mount(<ControlPanel />, store);
    await userEvent.click(button('BOMB'));
    expect(screen.queryByTestId('target-picker')).toBeNull();
    expect(screen.getByText(/Hits every opponent: Bo, Cy, Di/)).toBeTruthy();
    await userEvent.click(screen.getByTestId('lock-in'));
    expect(store.commits).toEqual([{ kind: 'ATTACK', weapon: 'BOMB', targets: [] }]);
  });

  it('defenses and Charge need no targets and commit directly', async () => {
    const { store } = inGame(3, 0);
    mount(<ControlPanel />, store);
    await userEvent.click(button('SHIELD'));
    await userEvent.click(screen.getByTestId('lock-in'));
    expect(store.commits).toEqual([{ kind: 'DEFENSE', defense: 'SHIELD' }]);
  });

  it('a new turn clears the selection', async () => {
    const { store } = inGame(3, 0);
    mount(<ControlPanel />, store);
    await userEvent.click(button('DODGE'));
    expect(button('DODGE').getAttribute('aria-pressed')).toBe('true');
    act(() => store.dispatch({ type: 'turnOpen', payload: { turnId: 'fx:m1:r1:t2', turnIndex: 2, phase: 'NORMAL', eligiblePlayerIds: ['p1', 'p2', 'p3'], deadlineAt: Date.now() + 9000, serverTime: Date.now() }, receivedAt: Date.now() }));
    expect(button('DODGE').getAttribute('aria-pressed')).toBe('false');
  });

  it('between turns every action is disabled with a waiting message', () => {
    const { game } = inGame(2, 3);
    const s = reducer(clientStateFor(game, 'p1'), { type: 'result', payload: resultFor(game, { p1: CHARGE, p2: CHARGE }) });
    mount(<ControlPanel />, stubStore(s));
    for (const id of ['DODGE', 'GUN', 'CHARGE']) expect(disabled(id)).toBe(true);
    expect(screen.getByText(/Reveal in progress/)).toBeTruthy();
  });
});

describe('Control panel: Sudden Death (§9)', () => {
  const sdStore = (charge: number) => {
    const game = withCharges(withStreak(newGame(2), 10, 'SUDDEN_DEATH'), { p1: charge });
    return stubStore(clientStateFor(game, 'p1'));
  };

  it('disables all six defenses and says why', () => {
    mount(<ControlPanel />, sdStore(3));
    for (const id of DEFENSE_IDS) expect(disabled(id), id).toBe(true);
    act(() => button('SHIELD').focus());
    expect(screen.getByTestId('why-line').textContent).toBe('Disabled: all defenses are off in Sudden Death');
  });

  it('makes attacking mandatory when any attack is affordable', () => {
    mount(<ControlPanel />, sdStore(3));
    expect(disabled('CHARGE')).toBe(true);
    act(() => button('CHARGE').focus());
    expect(screen.getByTestId('why-line').textContent).toContain('you must attack');
    expect(disabled('KATANA')).toBe(false);
  });

  it('allows Charge only when broke', () => {
    mount(<ControlPanel />, sdStore(0));
    expect(disabled('CHARGE')).toBe(false);
  });
});

describe('Control panel: eliminated players', () => {
  it('replaces the controls with an explicit [ELIMINATED] notice', () => {
    const game = withCharges(newGame(3), { p1: 1 });
    const result = resultFor(game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: defend('DODGE') });
    const store = stubStore(clientStateFor(result.state, 'p2'));
    mount(<ControlPanel />, store);
    expect(screen.getByText('[ELIMINATED]')).toBeTruthy();
    expect(document.querySelectorAll('button[data-action]')).toHaveLength(0);
  });
});

// ----------------------------------------------------------------- keyboard

describe('Keyboard: roving arrows, focus stability and optional shortcuts', () => {
  it('focus survives re-renders (buttons are not remounted when the hint updates)', () => {
    mount(<ControlPanel />, inGame(2, 2).store);
    const dodge = button('DODGE');
    act(() => dodge.focus());
    fireEvent.mouseEnter(button('NUKE')); // updates state -> re-render
    fireEvent.mouseEnter(button('BLACKHOLE'));
    expect(button('DODGE')).toBe(dodge); // same DOM node: not remounted
    expect(document.activeElement).toBe(dodge);
  });

  it('arrow keys move across the grid; Up/Down keep the column; Home/End jump', async () => {
    mount(<ControlPanel />, inGame(2, 5).store);
    act(() => button('DODGE').focus());
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(button('SHIELD'));
    await userEvent.keyboard('{ArrowLeft}{ArrowDown}');
    expect(document.activeElement).toBe(button('GUN')); // row 1, column 0
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(button('GATLING_GUN'));
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(button('DODGE'));
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(button('BLACKHOLE'));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(button('DODGE'));
  });

  it('Enter selects the focused action; Escape clears it', async () => {
    mount(<ControlPanel />, inGame(2, 0).store);
    act(() => button('SHIELD').focus());
    await userEvent.keyboard('{Enter}');
    expect(button('SHIELD').getAttribute('aria-pressed')).toBe('true');
    await userEvent.keyboard('{Escape}');
    // Escape handling is a Keyboard-mode shortcut; the explicit Cancel button always works:
    await userEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(button('SHIELD').getAttribute('aria-pressed')).toBe('false');
  });

  it('single-key shortcuts do nothing until Keyboard mode is switched on', async () => {
    const { store } = inGame(2, 0);
    mount(<ControlPanel />, store);
    await userEvent.keyboard('c');
    expect(button('CHARGE').getAttribute('aria-pressed')).toBe('false');
    await userEvent.keyboard('l');
    expect(store.commits).toHaveLength(0);
  });

  it('with Keyboard mode on: C picks Charge, L locks in, Esc clears, digits toggle targets', async () => {
    localStorage.setItem('bng.keyboardMode', '1');
    const { store } = inGame(3, 1);
    mount(<ControlPanel />, store);

    await userEvent.keyboard('c');
    expect(button('CHARGE').getAttribute('aria-pressed')).toBe('true');
    await userEvent.keyboard('{Escape}');
    expect(button('CHARGE').getAttribute('aria-pressed')).toBe('false');

    await userEvent.click(button('GUN'));
    await userEvent.keyboard('2'); // second opponent: Cy
    expect(screen.getByTestId('confirm-choice').textContent).toBe('Gun → Cy');
    await userEvent.keyboard('l');
    expect(store.commits).toEqual([{ kind: 'ATTACK', weapon: 'GUN', targets: ['p3'] }]);
  });

  it('shortcuts are ignored while typing in a text field', async () => {
    localStorage.setItem('bng.keyboardMode', '1');
    const { store } = inGame(2, 0);
    mount(
      <>
        <input aria-label="chat" />
        <ControlPanel />
      </>,
      store,
    );
    await userEvent.type(screen.getByLabelText('chat'), 'cl');
    expect(button('CHARGE').getAttribute('aria-pressed')).toBe('false');
    expect(store.commits).toHaveLength(0);
  });

  it('the app offers the toggle and a keyboard help panel', async () => {
    mount(<App />, inGame(2, 0).store);
    const toggle = screen.getByRole('switch', { name: /Keyboard shortcuts/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('bng.keyboardMode')).toBe('1');
    await userEvent.click(screen.getByRole('button', { name: /Show keyboard help/ }));
    expect(screen.getByTestId('keyboard-help').textContent).toContain('lock in your choice');
    expect(screen.getByRole('link', { name: 'Skip to action panel' })).toBeTruthy();
  });
});

// -------------------------------------------------------- roster, banner, status

describe('Roster: status badges and colour-independent elimination', () => {
  it('shows READY / HIDDEN ? by lock status', () => {
    const game = newGame(3);
    const s = reducer(clientStateFor(game, 'p1'), { type: 'progress', turnId: game.turn!.turnId, lockedPlayerIds: ['p2'] });
    mount(<Roster />, stubStore(s));
    expect(screen.getByTestId('badge-p1').textContent).toContain('HIDDEN ?');
    expect(screen.getByTestId('badge-p2').textContent).toContain('READY');
    expect(screen.getByTestId('badge-p3').textContent).toContain('HIDDEN ?');
  });

  it('eliminated players get an explicit [ELIMINATED] text label, a greyscale avatar and a cross mark', () => {
    const game = withCharges(newGame(3), { p1: 1 });
    const result = resultFor(game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: defend('DODGE') });
    const s = reducer(clientStateFor(game, 'p1'), { type: 'result', payload: result });
    mount(<Roster />, stubStore(s));
    const card = screen.getByTestId('player-p2');
    expect(card.getAttribute('data-eliminated')).toBe('true');
    expect(within(card).getByTestId('badge-p2').textContent).toContain('[ELIMINATED]');
    expect(card.getAttribute('aria-label')).toContain('eliminated');
    expect(card.innerHTML).toContain('grayscale(1)');
    expect(card.textContent).toContain('✖');
    expect(screen.getByTestId('player-p3').getAttribute('data-eliminated')).toBe('false');
  });

  it('shows each player\'s revealed action on their card after a turn resolves', () => {
    const game = withCharges(newGame(3), { p1: 1 });
    const result = resultFor(game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: defend('DODGE') });
    mount(<Roster />, stubStore(reducer(clientStateFor(game, 'p1'), { type: 'result', payload: result })));
    expect(screen.getByTestId('reveal-p1').textContent).toBe('[GUN] → Bo');
    expect(screen.getByTestId('reveal-p2').textContent).toBe('[CHARGE]');
    expect(screen.getByTestId('reveal-p3').textContent).toBe('[DODGE]');
  });

  it('shows Charge, Match Wins, [YOU] and [OFFLINE]', () => {
    const game = withCharges(newGame(2), { p1: 3 });
    let s = clientStateFor(game, 'p1');
    s = reducer(s, { type: 'playerConnection', playerId: 'p2', status: 'DISCONNECTED' });
    mount(<Roster />, stubStore(s));
    expect(screen.getByTestId('player-p1').textContent).toContain('⚡ 3');
    expect(screen.getByTestId('player-p1').textContent).toContain('[YOU]');
    expect(screen.getByTestId('player-p2').textContent).toContain('[OFFLINE]');
  });
});

describe('Top bar and phase banner', () => {
  it('shows room, turn index, phase, exact streak counter, timer and your status', () => {
    mount(<TopBar />, inGame(3, 0).store);
    expect(screen.getByText('[ ROOM: #K7M2QP ]')).toBeTruthy();
    expect(screen.getByTestId('turn-index').textContent).toBe('[ TURN: 1 ]');
    expect(screen.getByTestId('phase-banner').textContent).toBe('[ PHASE: NORMAL PHASE ]');
    expect(screen.getByTestId('streak').textContent).toBe('[ STREAK: 0 NO-ELIM ]');
    expect(screen.getByTestId('timer').textContent).toMatch(/\[ COMMIT TIMER: 00:2[45] \]/);
    expect(screen.getByTestId('my-status').textContent).toBe('[ YOUR STATUS: HIDDEN ? ]');
  });

  it('shows the exact no-elimination streak from the server', () => {
    const game = withStreak(newGame(3), 3, 'NORMAL');
    mount(<TopBar />, stubStore(clientStateFor(game, 'p1')));
    expect(screen.getByTestId('streak').textContent).toBe('[ STREAK: 3 NO-ELIM ]');
  });

  it('counts down to Sudden Death when two players remain, but not with three', () => {
    mount(<TopBar />, stubStore(clientStateFor(withStreak(newGame(2), 3, 'NORMAL'), 'p1')));
    expect(screen.getByTestId('sd-countdown').textContent).toContain('after 7 more turns');
    cleanup();
    mount(<TopBar />, stubStore(clientStateFor(withStreak(newGame(3), 3, 'NORMAL'), 'p1')));
    expect(screen.queryByTestId('sd-countdown')).toBeNull();
  });

  it.each([
    ['SUDDEN_DEATH', 10, '[ PHASE: SUDDEN DEATH ]', 'all six defenses are disabled'],
    ['OVERTIME', 15, '[ PHASE: OVERTIME ]', 'normal combat rules'],
  ] as const)('shows the %s banner with an explanation', (phase, streak, label, help) => {
    mount(<TopBar />, stubStore(clientStateFor(withStreak(newGame(2), streak, phase), 'p1')));
    expect(screen.getByTestId('phase-banner').textContent).toBe(label);
    expect(screen.getByTestId('phase-help').textContent).toContain(help);
  });

  it('warns once when Sudden Death begins, and the warning can be dismissed', async () => {
    const store = stubStore(clientStateFor(newGame(2), 'p1'));
    mount(<PhaseNotice />, store);
    expect(screen.queryByTestId('phase-notice')).toBeNull();
    act(() => store.dispatch({ type: 'turnOpen', payload: { turnId: 'fx:m1:r1:t11', turnIndex: 11, phase: 'SUDDEN_DEATH', eligiblePlayerIds: ['p1', 'p2'], deadlineAt: Date.now() + 9000, serverTime: Date.now() }, receivedAt: Date.now() }));
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain('SUDDEN DEATH');
    await userEvent.click(within(notice).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByTestId('phase-notice')).toBeNull();
  });

});

// ------------------------------------------------------------------- event log

describe('Event log', () => {
  const twoTurns = () => {
    const game = withCharges(newGame(3), { p1: 3 });
    const t1 = resultFor(game, { p1: attack('KATANA', 'p2', 'p3'), p2: defend('DODGE'), p3: CHARGE });
    return { game, t1 };
  };

  it('is a labelled, focusable, polite live log containing the multi-line breakdown', () => {
    const { game, t1 } = twoTurns();
    localStorage.setItem('bng.reducedMotion', '1');
    const store = stubStore(reducer(clientStateFor(game, 'p1'), { type: 'result', payload: t1 }));
    mount(<EventLog entries={store.getState().log} />, store);
    const log = screen.getByRole('log', { name: 'Event log' });
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(log.getAttribute('tabindex')).toBe('0');
    expect(log.textContent).toContain('Ada targeted Bo, Cy with Katana:');
    expect(log.textContent).toContain('→ Bo [BLOCKED] Dodge blocked Katana.');
    expect(log.textContent).toContain('→ Cy [ELIMINATED] was Charging and was hit by Katana.');
    expect(log.textContent).toContain('Cy [ELIMINATED]');
    expect(screen.getByRole('heading', { name: '[ Turn 1 · NORMAL PHASE ]' })).toBeTruthy();
  });

  it('preserves line breaks in multi-line blocks', () => {
    const { game, t1 } = twoTurns();
    localStorage.setItem('bng.reducedMotion', '1');
    mount(<EventLog entries={reducer(clientStateFor(game, 'p1'), { type: 'result', payload: t1 }).log} />, stubStore());
    const block = [...document.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Ada targeted'))!;
    expect(block.className).toContain('whitespace-pre-wrap');
    expect(block.textContent!.split('\n').length).toBeGreaterThan(2);
  });

  it('with reduced motion, a new turn appears all at once (no playback delay)', () => {
    vi.useFakeTimers();
    localStorage.setItem('bng.reducedMotion', '1');
    const { game, t1 } = twoTurns();
    const store = stubStore();
    const first = reducer(clientStateFor(game, 'p1'), { type: 'result', payload: t1 });
    store.set(first); // history already present, so the "first render" shortcut cannot hide a bug
    const wrap = () => (
      <StoreProvider store={store}>
        <SettingsProvider>
          <EventLog entries={store.getState().log} />
        </SettingsProvider>
      </StoreProvider>
    );
    const { rerender } = render(wrap());
    act(() => store.dispatch({ type: 'result', payload: resultFor(first.game!, { p1: CHARGE, p2: CHARGE }) }));
    rerender(wrap());
    // Everything is visible immediately, without advancing any timers.
    expect(screen.getByRole('log').textContent).toContain('No eliminations. No-elimination streak: 1.');
    expect(screen.queryByRole('button', { name: 'Show everything' })).toBeNull();
  });

  it('otherwise plays the new turn back block by block, and "Show everything" skips ahead', () => {
    vi.useFakeTimers();
    const { game, t1 } = twoTurns();
    const store = stubStore(clientStateFor(game, 'p1'));
    const Live = () => {
      return <EventLog entries={store.getState().log} />;
    };
    const wrap = (ui: ReactElement) => (
      <StoreProvider store={store}>
        <SettingsProvider>{ui}</SettingsProvider>
      </StoreProvider>
    );
    // Start with one turn already in the log (history is shown immediately), then land another.
    const first = reducer(clientStateFor(game, 'p1'), { type: 'result', payload: t1 });
    store.set(first);
    const { rerender } = render(wrap(<Live />));
    expect(screen.getByRole('log').textContent).toContain('Cy [ELIMINATED]');

    const t2 = resultFor(first.game!, { p1: CHARGE, p2: CHARGE });
    act(() => store.dispatch({ type: 'result', payload: t2 }));
    rerender(wrap(<Live />));
    const total = store.getState().log.at(-1)!.blocks.length;
    expect(total).toBeGreaterThan(2);
    // Nothing of turn 2's body yet…
    expect(screen.getByRole('log').textContent).not.toContain('REVEAL — all actions at once:\n  Ada cast [CHARGE]');
    act(() => void vi.advanceTimersByTime(450));
    expect(screen.getByRole('log').textContent).toContain('Ada cast [CHARGE]');
    expect(screen.getByRole('log').textContent).not.toContain('No eliminations');
    act(() => void vi.advanceTimersByTime(450 * total));
    expect(screen.getByRole('log').textContent).toContain('No eliminations');
  });

  it('is empty-state friendly', () => {
    mount(<EventLog entries={[]} />, stubStore());
    expect(screen.getByText(/Nothing has happened yet/)).toBeTruthy();
  });
});

describe('Whole game screen and settings', () => {
  it('lays out status bar, roster, control panel and log together', () => {
    mount(<GameScreen />, inGame(4, 2).store);
    expect(screen.getByTestId('phase-banner')).toBeTruthy();
    expect(screen.getByTestId('roster')).toBeTruthy();
    expect(screen.getByTestId('control-panel')).toBeTruthy();
    expect(screen.getByRole('log')).toBeTruthy();
  });

  it('the Reduced motion switch persists and marks the document', async () => {
    mount(<App />, inGame(2, 0).store);
    const toggle = screen.getByRole('switch', { name: /Reduced motion/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('bng.reducedMotion')).toBe('1');
    expect(document.documentElement.dataset.reducedMotion).toBe('true');
  });
});

describe('Charge fog of war (§12)', () => {
  it('shows your own Charge but masks every opponent, also after a turn resolves', () => {
    const game = withCharges(newGame(3), { p1: 3, p2: 2 });
    const result = resultFor(game, { p1: CHARGE, p2: CHARGE, p3: CHARGE });
    mount(<Roster />, stubStore(reducer(clientStateFor(game, 'p1'), { type: 'result', payload: result })));
    expect(screen.getByTestId('player-p1').textContent).toContain('⚡ 4');
    for (const id of ['p2', 'p3']) {
      const li = screen.getByTestId(`player-${id}`);
      expect(li.textContent).toContain('⚡ ?');
      expect(li.getAttribute('aria-label')).toContain('charge hidden');
      expect(li.textContent).not.toMatch(/⚡ \d/);
    }
  });
});

describe('Match Results & Series Standings modal', () => {
  it('opens for a match-ending turn with sorted standings, leader line and Start Next Match', async () => {
    const game = withCharges(newGame(2), { p1: 1, p2: 1 });
    const result = resultFor(game, { p1: attack('GUN', 'p2'), p2: attack('KNIFE', 'p1') });
    const s = reducer(clientStateFor(game, 'p1'), { type: 'result', payload: result });
    const store = stubStore({ ...s, game: { ...s.game!, series: { ...s.game!.series, seriesWinTarget: 5, matchWins: { p1: 4, p2: 2 } } } });
    store.dispatch({ type: 'resolutionDismissed', turnId: store.getState().lastResult!.turnId }); // the turn popup was closed
    mount(<MatchResultsModal />, store);
    const user = userEvent.setup();
    const dialog = screen.getByRole('dialog', { name: /MATCH RESULTS/ });
    expect(within(dialog).getByTestId('mr-standings').textContent).toMatch(/1st: Ada.*4 Wins.*2nd: Bo.*2 Wins/);
    expect(within(dialog).getByTestId('mr-row-p1').getAttribute('data-match-winner')).toBe('true');
    expect(within(dialog).getByTestId('mr-leader-line').textContent).toContain('Ada is leading the series and needs 1 more win to win the series!');
    await user.click(within(dialog).getByTestId('mr-start'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Return to lobby after the series', () => {
  it('a LOBBY update drops live-turn state but keeps the result overlay data until acknowledged', () => {
    let s = reducer(clientStateFor(newGame(2), 'p1'), { type: 'seriesEnded', winnerId: 'p1', matchWins: { p1: 3, p2: 1 } });
    s = reducer(s, { type: 'lobby', lobby: lobbyView(2, { status: 'LOBBY' }) });
    expect(screenOf(s)).toBe('lobby');
    expect(s.turn).toBeNull();
    expect(s.stage).toBe('NONE');
    expect(s.seriesEnd).not.toBeNull();
    s = reducer(s, { type: 'seriesAcknowledged' });
    expect(s).toMatchObject({ game: null, lastResult: null, seriesEnd: null });
    expect(s.lobby!.players).toHaveLength(2);
  });
});

describe('Confirmation drawer (no scrolling to Lock In)', () => {
  it('opens the moment a legal action is tapped with Confirm and Cancel; Cancel closes it', async () => {
    const { store } = inGame(2, 1);
    mount(<ControlPanel />, store);
    expect(screen.queryByTestId('confirm-drawer')).toBeNull();
    await userEvent.click(button('DODGE'));
    const drawer = screen.getByTestId('confirm-drawer');
    expect(within(drawer).getByRole('button', { name: /Confirm Action \[Lock In\]/ })).toBeTruthy();
    expect(drawer.className).toContain('fixed'); // pinned to the viewport, so it is always on screen
    await userEvent.click(within(drawer).getByRole('button', { name: /Cancel \/ Go Back/ }));
    expect(screen.queryByTestId('confirm-drawer')).toBeNull();
    await userEvent.click(button('DODGE'));
    await userEvent.click(screen.getByTestId('lock-in'));
    expect(store.commits).toEqual([{ kind: 'DEFENSE', defense: 'DODGE' }]);
  });
});

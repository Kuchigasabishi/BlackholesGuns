// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTACK_IDS, ATTACKS, DEFENSES, DEFENSE_IDS } from '../../src/engine';
import { App } from '../src/App';
import { ControlPanel } from '../src/components/ControlPanel';
import { StoreProvider, SettingsProvider } from '../src/hooks';
import { LobbyScreen } from '../src/screens/Lobby';
import { MatchResultsModal } from '../src/components/MatchResultsModal';
import { GameScreen, MatchMenu, NoticeBar, PhaseNotice, Roster, TopBar } from '../src/screens/Game';
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

/** The arena roster (clickable target cards) next to the control panel, as on the real game screen. */
const Arena = () => (
  <>
    <Roster />
    <ControlPanel />
  </>
);

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
    for (const n of [1, 2, 3, 4, 5]) {
      const row = screen.getByRole('group', { name: new RegExp(`^TIER ${n},`) });
      expect(within(row).getByText(`TIER ${n}`)).toBeTruthy();
      expect(within(row).getAllByText(`${n} CHARGE`, { exact: false }).length).toBeGreaterThan(0);
    }
  });

  it.each([0, 1, 2, 3, 4, 5])('at %i Charge exactly the attacks costing <= Charge are enabled, the rest are dimmed', (charge) => {
    mount(<ControlPanel />, inGame(2, charge).store);
    for (const id of ATTACK_IDS) {
      const affordable = ATTACKS[id].cost <= charge;
      expect(disabled(id), `${id} disabled`).toBe(!affordable);
      expect(button(id).className.includes('cursor-not-allowed'), `${id} dimmed`).toBe(!affordable);
      expect(button(id).querySelector('[data-lock-icon]') !== null, `${id} lock icon`).toBe(!affordable);
    }
    for (const id of DEFENSE_IDS) expect(disabled(id), id).toBe(DEFENSES[id].cost > charge);
    expect(screen.getByTestId('my-charge').textContent).toBe(`YOUR CHARGE${charge} ⚡`);
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
  it('a targeted attack asks you to tap an opponent card, then commits that target', async () => {
    const { store } = inGame(3, 1);
    mount(<Arena />, store);
    await userEvent.click(button('GUN'));
    expect(screen.getByTestId('target-hint').textContent).toContain('Tap an opponent');
    expect(screen.queryByTestId('target-picker')).toBeNull(); // the old name list is gone
    expect(screen.getByTestId('lockin-popup').getAttribute('data-anchor')).toBe('button:GUN'); // the prompt is by the weapon until a target is chosen
    expect(screen.queryByTestId('lock-in')).toBeNull(); // nothing to lock in yet
    expect(store.commits).toHaveLength(0);

    // opponents are highlighted as targets, you and nobody else are not
    expect(screen.getByTestId('player-p2').getAttribute('data-targetable')).toBe('true');
    expect(screen.getByTestId('player-p3').getAttribute('data-targetable')).toBe('true');
    expect(screen.getByTestId('player-p1').getAttribute('data-targetable')).toBeNull();

    await userEvent.click(screen.getByTestId('player-p2')); // tap the card itself
    expect(screen.getByTestId('player-p2').getAttribute('data-targeted')).toBe('true');
    expect(screen.getByTestId('reticle-p2').textContent).toContain('TARGET');
    expect(screen.getByTestId('confirm-choice').textContent).toBe('Gun → Bo');
    expect(screen.getByTestId('lockin-popup').getAttribute('data-anchor')).toBe('card:p2'); // Lock In now floats by Bo's card
    await userEvent.click(screen.getByTestId('player-p3')); // changing your mind moves the target (and the popup)
    expect(screen.getByTestId('confirm-choice').textContent).toBe('Gun → Cy');
    expect(screen.getByTestId('lockin-popup').getAttribute('data-anchor')).toBe('card:p3');
    expect(screen.queryByTestId('reticle-p2')).toBeNull();
    await userEvent.click(screen.getByTestId('lock-in'));
    expect(store.commits).toEqual([{ kind: 'ATTACK', weapon: 'GUN', targets: ['p3'] }]);
  });

  it('cards go back to neutral on Cancel, on Esc, when another action is chosen, and once you lock in', async () => {
    const { store } = inGame(3, 1);
    mount(<Arena />, store);
    const neutral = () => document.querySelectorAll('[data-targetable],[data-targeted]').length === 0;
    expect(neutral()).toBe(true);
    await userEvent.click(button('GUN'));
    expect(neutral()).toBe(false);
    await userEvent.click(screen.getByTestId('cancel-action'));
    expect(neutral()).toBe(true);
    await userEvent.click(button('GUN'));
    await userEvent.click(screen.getByTestId('player-p2'));
    await userEvent.keyboard('{Escape}');
    expect(neutral()).toBe(true);
    expect(screen.queryByTestId('confirm-drawer')).toBeNull();
    await userEvent.click(button('GUN'));
    await userEvent.click(button('DODGE')); // a non-attack needs no target
    expect(neutral()).toBe(true);
    await userEvent.click(button('GUN'));
    await userEvent.click(screen.getByTestId('player-p2'));
    await userEvent.click(screen.getByTestId('lock-in'));
    expect(neutral()).toBe(true);
    expect(store.commits).toEqual([{ kind: 'ATTACK', weapon: 'GUN', targets: ['p2'] }]);
  });

  it('only living opponents can be targeted: your own and eliminated cards are not clickable', async () => {
    const game = withCharges(newGame(4), { p1: 1 });
    const dead = { ...game, players: { ...game.players, p3: { ...game.players.p3!, alive: false } } };
    const store = stubStore(clientStateFor(dead, 'p1'));
    mount(<Arena />, store);
    await userEvent.click(button('GUN'));
    expect(screen.getByTestId('player-p2').getAttribute('data-targetable')).toBe('true');
    expect(screen.getByTestId('player-p3').getAttribute('data-targetable')).toBeNull();
    await userEvent.click(screen.getByTestId('player-p1')); // your own card is not a target: it counts as clicking outside
    expect(screen.queryByTestId('lockin-popup')).toBeNull();
    expect(store.getState().selection).toBeNull();
  });

  it('target cards can be reached and chosen with the keyboard (an overlay button per card)', async () => {
    const { store } = inGame(3, 1);
    mount(<Arena />, store);
    await userEvent.click(button('GUN'));
    act(() => screen.getByTestId('target-p3').focus());
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('confirm-choice').textContent).toBe('Gun → Cy');
    expect(screen.getByTestId('target-p3').getAttribute('aria-pressed')).toBe('true');
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

  it('a Katana may pick up to 3 targets by tapping cards, but no more; tapping again removes', async () => {
    const { store } = inGame(5, 3);
    mount(<Arena />, store);
    await userEvent.click(button('KATANA'));
    expect(screen.getByTestId('target-hint').textContent).toContain('Tap an opponent');
    for (const id of ['p2', 'p3', 'p4', 'p5']) await userEvent.click(screen.getByTestId(`player-${id}`));
    expect(screen.getByTestId('confirm-choice').textContent).toBe('Katana → Bo, Cy, Di'); // the 4th is refused
    expect(screen.getByTestId('target-hint').textContent).toContain('Tap up to 3 cards');
    await userEvent.click(screen.getByTestId('player-p3'));
    expect(screen.getByTestId('confirm-choice').textContent).toBe('Katana → Bo, Di');
    await userEvent.click(screen.getByTestId('lock-in'));
    expect(store.commits).toEqual([{ kind: 'ATTACK', weapon: 'KATANA', targets: ['p2', 'p4'] }]);
  });

  it('all-opponent weapons need no targets', async () => {
    const { store } = inGame(4, 4);
    mount(<Arena />, store);
    await userEvent.click(button('BOMB'));
    expect(screen.queryByTestId('target-picker')).toBeNull();
    for (const id of ['p2', 'p3', 'p4']) {
      expect(screen.getByTestId(`reticle-${id}`)).toBeTruthy(); // every opponent is hit
      expect(screen.getByTestId(`player-${id}`).getAttribute('data-targetable')).toBeNull(); // nothing to choose
    }
    expect(screen.queryByTestId('reticle-p1')).toBeNull();
    expect(screen.getByTestId('lockin-popup').textContent).toContain('Hits every opponent');
    expect(screen.getByTestId('lockin-popup').getAttribute('data-anchor')).toBe('button:BOMB'); // no card to choose: it sits by the weapon
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
    await userEvent.keyboard('{Escape}'); // Esc always resets the pick, with or without Keyboard mode
    expect(button('SHIELD').getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('confirm-drawer')).toBeNull();
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
    mount(<Arena />, store);

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
  it('shows LOCKED (no HIDDEN ?) with the holographic shader once a player locks in; others stay HIDDEN ?', () => {
    const game = newGame(3);
    const s = reducer(clientStateFor(game, 'p1'), { type: 'progress', turnId: game.turn!.turnId, lockedPlayerIds: ['p2'] });
    mount(<Roster />, stubStore(s));
    expect(screen.getByTestId('badge-p1').textContent).toContain('HIDDEN ?');
    expect(screen.getByTestId('badge-p2').textContent).toContain('LOCKED');
    expect(screen.getByTestId('badge-p2').textContent).not.toContain('HIDDEN');
    expect(screen.getByTestId('badge-p3').textContent).toContain('HIDDEN ?');
    expect(screen.getByTestId('lock-shader-p2').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('lock-shader-p2').className).toContain('pointer-events-none');
    expect(screen.queryByTestId('lock-shader-p1')).toBeNull();
    expect(screen.queryByTestId('lock-shader-p3')).toBeNull();
  });

  it('the shader fades out and is removed when the COMMIT window ends (reveal), leaving the card face clear', () => {
    vi.useFakeTimers();
    try {
      const game = newGame(3);
      const store = stubStore(reducer(clientStateFor(game, 'p1'), { type: 'progress', turnId: game.turn!.turnId, lockedPlayerIds: ['p2'] }));
      mount(<Roster />, store);
      expect(screen.getByTestId('lock-shader-p2')).toBeTruthy();
      act(() => store.dispatch({ type: 'result', payload: resultFor(game, { p1: CHARGE, p2: CHARGE, p3: CHARGE }) }));
      expect(screen.getByTestId('lock-shader-p2').getAttribute('data-leaving')).toBe('true'); // fading out
      act(() => void vi.advanceTimersByTime(300));
      expect(screen.queryByTestId('lock-shader-p2')).toBeNull();
      expect(screen.getByTestId('badge-p2').textContent).not.toContain('LOCKED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the shader animates transform only (GPU-friendly) and is defined in CSS', () => {
    const css = readFileSync('web/src/index.css', 'utf8');
    for (const k of ['lock-spin', 'lock-sheen']) {
      const body = new RegExp(String.raw`@keyframes ${k} \{([\s\S]*?)\n\}`).exec(css)![1]!;
      expect(body).toContain('transform');
      expect(body).not.toMatch(/background|box-shadow|filter/);
    }
    expect(css).toContain('repeating-conic-gradient');
  });

  it('a freshly eliminated player crumbles to digital dust for 1 s after the popup closes, then snaps to grayscale', () => {
    vi.useFakeTimers();
    try {
      const game = withCharges(newGame(3), { p1: 1 });
      const result = resultFor(game, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: defend('DODGE') });
      const store = stubStore(reducer(clientStateFor(game, 'p1'), { type: 'result', payload: result }));
      mount(<Roster />, store);
      const card = () => screen.getByTestId('player-p2');
      // The popup is still open: the card keeps its alive face.
      expect(card().getAttribute('data-eliminated')).toBe('false');
      expect(screen.getByTestId('badge-p2').textContent).not.toContain('ELIMINATED');
      expect(screen.queryByTestId('digital-dust')).toBeNull();
      // Popup closed: the dust animation plays.
      act(() => store.dispatch({ type: 'resolutionDismissed', turnId: result.turnId }));
      expect(card().getAttribute('data-crumble')).toBe('true');
      expect(screen.getByTestId('digital-dust').querySelectorAll('.dust-p')).toHaveLength(16);
      expect(card().getAttribute('data-eliminated')).toBe('false'); // not grayscale yet
      act(() => void vi.advanceTimersByTime(1000));
      expect(card().getAttribute('data-eliminated')).toBe('true');
      expect(card().getAttribute('data-crumble')).toBeNull();
      expect(screen.queryByTestId('digital-dust')).toBeNull();
      expect(screen.getByTestId('badge-p2').textContent).toContain('[ELIMINATED]');
      expect(screen.getByTestId('player-p3').getAttribute('data-eliminated')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('eliminated players get an explicit [ELIMINATED] text label, a greyscale avatar and a cross mark', () => {
    localStorage.setItem('bng.reducedMotion', '1'); // no animation: straight to the final state
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
  it('shows only the commit timer, alive count and series target', () => {
    mount(<TopBar />, inGame(3, 0).store);
    expect(screen.getByTestId('timer').textContent).toMatch(/COMMIT TIMER\s*00:2[45]/);
    expect(screen.getByTestId('alive').textContent).toContain('03 players');
    expect(screen.getByTestId('series-target-chip').textContent).toBe('SERIES TARGETFirst to 10 wins');
    for (const id of ['turn-index', 'phase-banner', 'streak', 'my-status']) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.queryByText(/ROOM:/)).toBeNull();
  });

  it('counts down to Sudden Death when two players remain, but not with three', () => {
    mount(<TopBar />, stubStore(clientStateFor(withStreak(newGame(2), 3, 'NORMAL'), 'p1')));
    expect(screen.getByTestId('sd-countdown').textContent).toContain('after 7 more turns');
    cleanup();
    mount(<TopBar />, stubStore(clientStateFor(withStreak(newGame(3), 3, 'NORMAL'), 'p1')));
    expect(screen.queryByTestId('sd-countdown')).toBeNull();
  });

  it.each([
    ['SUDDEN_DEATH', 10, 'all six defenses are disabled'],
    ['OVERTIME', 15, 'normal combat rules'],
  ] as const)('explains the %s phase in a note (there is no phase chip any more)', (phase, streak, help) => {
    mount(<TopBar />, stubStore(clientStateFor(withStreak(newGame(2), streak, phase), 'p1')));
    expect(screen.queryByTestId('phase-banner')).toBeNull();
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

describe('Whole game screen and settings', () => {
  it('lays out status bar, roster, control panel and the standings, with no event log', () => {
    mount(<GameScreen />, inGame(4, 2).store);
    expect(screen.getByTestId('timer')).toBeTruthy();
    expect(screen.getByTestId('roster')).toBeTruthy();
    expect(screen.getByTestId('control-panel')).toBeTruthy();
    expect(screen.getByTestId('series-standings')).toBeTruthy();
    expect(screen.queryByRole('log')).toBeNull();
  });

  it('Series Standings sorts by Match Wins, shares places on ties and updates when a match ends', () => {
    const store = inGame(3, 0).store;
    const withWins = (wins: Record<string, number>) => {
      const s = store.getState();
      store.set({ ...s, game: { ...s.game!, series: { ...s.game!.series, matchWins: wins } } });
    };
    withWins({ p1: 1, p2: 2, p3: 2 });
    mount(<GameScreen />, store);
    const text = () => screen.getByTestId('series-standings').textContent!;
    expect(text()).toMatch(/👑 1st: Bo.*2 Wins.*1st: Cy.*2 Wins.*3rd: Ada.*1 Win/);
    act(() => withWins({ p1: 3, p2: 2, p3: 2 }));
    expect(text()).toMatch(/👑 1st: Ada.*3 Wins.*2nd: Bo.*2 Wins/);
    expect(text()).toContain('First to 10 Match Wins');
    // one progress segment per win needed, filled as wins are earned
    const filled = (id: string) => screen.getByTestId(`progress-${id}`).querySelectorAll('[data-filled]').length;
    expect([filled('p1'), filled('p2'), screen.getByTestId('progress-p2').children.length]).toEqual([3, 2, 10]);
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

describe('Floating Lock In popup (no bottom bar, no vertical mouse travel)', () => {
  const rect = (x: number, y: number, w: number, h: number) =>
    ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;

  it('a non-targeted action gets Lock In / Cancel right at its own button', async () => {
    const { store } = inGame(2, 1);
    mount(<ControlPanel />, store);
    expect(screen.queryByTestId('lockin-popup')).toBeNull();
    expect(screen.queryByText(/Confirm Action/)).toBeNull(); // the old bottom bar is gone
    await userEvent.click(button('DODGE'));
    const popup = screen.getByTestId('lockin-popup');
    expect(popup.getAttribute('data-anchor')).toBe('button:DODGE');
    expect(within(popup).getByTestId('lock-in').textContent).toBe('Lock In');
    expect(within(popup).getByRole('button', { name: /Cancel \/ Go Back/ })).toBeTruthy();
    expect(popup.style.position).toBe('fixed');
    await userEvent.click(within(popup).getByRole('button', { name: /Cancel \/ Go Back/ }));
    expect(screen.queryByTestId('lockin-popup')).toBeNull();
    await userEvent.click(button('DODGE'));
    await userEvent.click(screen.getByTestId('lock-in'));
    expect(store.commits).toEqual([{ kind: 'DEFENSE', defense: 'DODGE' }]);
    expect(screen.queryByTestId('lockin-popup')).toBeNull();
  });

  it.each([
    ['CHARGE', 'CHARGE'],
    ['SHIELD', 'SHIELD'],
    ['REFLECT', 'REFLECT'],
  ])('%s opens the popup by its own button', async (id) => {
    mount(<ControlPanel />, inGame(2, 1).store);
    await userEvent.click(button(id));
    expect(screen.getByTestId('lockin-popup').getAttribute('data-anchor')).toBe(`button:${id}`);
  });

  it('clicking outside, pressing Esc or Cancel all dismiss it and reset the cards', async () => {
    const { store } = inGame(3, 1);
    mount(
      <>
        <Arena />
        <p data-testid="elsewhere">somewhere else</p>
      </>,
      store,
    );
    await userEvent.click(button('GUN'));
    await userEvent.click(screen.getByTestId('player-p2'));
    expect(screen.getByTestId('lockin-popup')).toBeTruthy();
    await userEvent.click(screen.getByTestId('elsewhere')); // outside
    expect(screen.queryByTestId('lockin-popup')).toBeNull();
    expect(document.querySelectorAll('[data-targetable],[data-targeted]')).toHaveLength(0);
    expect(store.getState().selection).toBeNull();

    await userEvent.click(button('GUN'));
    await userEvent.click(screen.getByTestId('player-p2'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('lockin-popup')).toBeNull();
    expect(screen.getByTestId('player-p2').getAttribute('data-targeted')).toBeNull();

    // clicking the popup itself, another action or a card does NOT dismiss it
    await userEvent.click(button('GUN'));
    await userEvent.click(screen.getByTestId('player-p2'));
    await userEvent.click(within(screen.getByTestId('lockin-popup')).getByTestId('confirm-choice'));
    expect(screen.getByTestId('lockin-popup')).toBeTruthy();
    await userEvent.click(button('KNIFE'));
    expect(screen.getByTestId('lockin-popup').getAttribute('data-anchor')).toBe('button:KNIFE');
  });

  it('is placed from its anchor and clamped inside a small phone viewport (never clips off-screen)', async () => {
    const { store } = inGame(3, 1);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 });
    const proto = HTMLElement.prototype;
    const rectSpy = vi.spyOn(proto, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.cardId === 'p3') return rect(300, 560, 100, 120); // a card hanging off the right/bottom edge
      return rect(0, 0, 100, 40);
    });
    const widthSpy = vi.spyOn(proto, 'offsetWidth', 'get').mockReturnValue(320);
    const heightSpy = vi.spyOn(proto, 'offsetHeight', 'get').mockReturnValue(120);
    try {
      mount(<Arena />, store);
      await userEvent.click(button('GUN'));
      await userEvent.click(screen.getByTestId('player-p3'));
      const popup = screen.getByTestId('lockin-popup');
      const top = parseFloat(popup.style.top);
      const left = parseFloat(popup.style.left);
      expect(left).toBeGreaterThanOrEqual(8);
      expect(left + 320).toBeLessThanOrEqual(360 - 8); // inside the right edge
      expect(top).toBeGreaterThanOrEqual(8);
      expect(top + 120).toBeLessThanOrEqual(640 - 8); // inside the bottom edge
      expect(top + 120).toBeLessThanOrEqual(560); // no room below the card: it floats above it
    } finally {
      rectSpy.mockRestore();
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });
});

describe('Tier power-up glow', () => {
  it.each([0, 1, 2, 3, 4, 5])('at %i Charge only affordable weapons glow, at their own tier', (charge) => {
    mount(<ControlPanel />, inGame(2, charge).store);
    for (const id of ATTACK_IDS) {
      const cost = ATTACKS[id].cost;
      const glowing = button(id).classList.contains(`power-t${cost}`);
      expect(glowing).toBe(cost <= charge);
      expect(button(id).getAttribute('data-power')).toBe(cost <= charge ? String(cost) : null);
    }
    expect(button('CHARGE').classList.contains('power-up')).toBe(false);
    expect(button('DODGE').classList.contains('power-up')).toBe(false);
  });

  it('Reflects glow with their tier, and the glow disappears when the Charge is spent', () => {
    const { store } = inGame(2, 2);
    mount(<ControlPanel />, store);
    expect(button('DOUBLE_REFLECT').classList.contains('power-t2')).toBe(true);
    expect(button('TRIPLE_REFLECT').classList.contains('power-up')).toBe(false);
    const s = store.getState();
    act(() => store.set({ ...s, availability: null, game: { ...s.game!, players: { ...s.game!.players, p1: { ...s.game!.players.p1!, charge: 0 } } } }));
    expect(document.querySelectorAll('.power-up')).toHaveLength(0);
  });

  it('defines an escalating pulseGlow for all five tiers using opacity on a pseudo-element', () => {
    const css = readFileSync('web/src/index.css', 'utf8');
    expect(css).toContain('@keyframes pulseGlow');
    const blur = [1, 2, 3, 4, 5].map((t) => Number(new RegExp(String.raw`\.power-t${t} \{[^}]*--glow-blur: (\d+)px`).exec(css)![1]));
    expect([...blur].sort((a, b) => a - b)).toEqual(blur);
    expect(new Set(blur).size).toBe(5);
    expect(css).toMatch(/\.power-up::after[\s\S]*?animation: pulseGlow/);
  });
});

describe('Mid-game exit controls', () => {
  const asPlayer = (me: string) => {
    const game = newGame(3);
    let s = clientStateFor(game, me);
    s = reducer(s, { type: 'lobby', lobby: lobbyView(3, { status: 'IN_GAME', hostId: 'p1' }) });
    return stubStore(s);
  };

  it('the host sees Return to Lobby and Quit; everyone else sees only Quit', () => {
    mount(<MatchMenu />, asPlayer('p1'));
    expect(screen.getByTestId('return-lobby')).toBeTruthy();
    expect(screen.getByTestId('quit-match')).toBeTruthy();
    cleanup();
    mount(<MatchMenu />, asPlayer('p2'));
    expect(screen.queryByTestId('return-lobby')).toBeNull();
    expect(screen.getByTestId('quit-match')).toBeTruthy();
  });

  it('Return to Lobby asks first, then tells the server to abort the series', async () => {
    const store = asPlayer('p1');
    mount(<MatchMenu />, store);
    await userEvent.click(screen.getByTestId('return-lobby'));
    expect(store.aborted).toBe(0); // not yet: needs confirmation
    expect(screen.getByTestId('menu-confirm').textContent).toContain('return to the lobby');
    await userEvent.click(screen.getByTestId('menu-no'));
    expect(store.aborted).toBe(0);
    await userEvent.click(screen.getByTestId('return-lobby'));
    await userEvent.click(screen.getByTestId('menu-yes'));
    expect(store.aborted).toBe(1);
  });

  it('Quit asks first, then leaves the room and returns to the home screen', async () => {
    const store = asPlayer('p2');
    mount(<MatchMenu />, store);
    await userEvent.click(screen.getByTestId('quit-match'));
    expect(screen.getByTestId('menu-confirm').textContent).toContain('eliminated');
    expect(store.getState().session).not.toBeNull();
    await userEvent.click(screen.getByTestId('menu-yes'));
    expect(store.getState().session).toBeNull(); // reset -> home
  });

  it('the game screen carries the menu in the status bar, and the lobby abort clears the game with a notice', () => {
    const store = asPlayer('p1');
    mount(<GameScreen />, store);
    expect(screen.getByTestId('match-menu')).toBeTruthy();
    act(() => store.dispatch({ type: 'seriesAborted', notice: 'The host returned everyone to the lobby.' }));
    expect(store.getState()).toMatchObject({ game: null, turn: null, seriesEnd: null });
    cleanup();
    mount(<NoticeBar />, store);
    expect(screen.getByTestId('notice-bar').textContent).toContain('returned everyone to the lobby');
  });
});

describe('On Fire streak aura on the Series Standings', () => {
  const withStreaks = (store: StubStore, streaks: Record<string, number>) => {
    const s = store.getState();
    const players = Object.fromEntries(Object.entries(s.game!.players).map(([id, p]) => [id, { ...p, currentMatchStreak: streaks[id] ?? 0 }]));
    store.set({ ...s, game: { ...s.game!, players } });
  };

  it('no aura at 0-1, an orange pulsing aura at 2, burning flames at 3+, and it clears when someone else wins', () => {
    const store = inGame(3, 0).store;
    mount(<GameScreen />, store);
    const row = (id: string) => screen.getByTestId(`standing-${id}`);
    act(() => withStreaks(store, { p1: 1 }));
    expect(row('p1').getAttribute('data-fire')).toBeNull();
    expect(screen.queryByTestId('streak-p1')).toBeNull();

    act(() => withStreaks(store, { p1: 2 }));
    expect(row('p1').getAttribute('data-fire')).toBe('fire-2');
    expect(row('p1').className).toContain('fire-row');
    expect(screen.queryByTestId('flames-p1')).toBeNull();
    expect(screen.getByTestId('streak-p1').textContent).toContain('2-win streak'); // not colour alone

    act(() => withStreaks(store, { p1: 3 }));
    expect(row('p1').getAttribute('data-fire')).toBe('fire-3');
    expect(screen.getByTestId('flames-p1')).toBeTruthy();
    expect(screen.getByTestId('streak-p1').textContent).toContain('ON FIRE');

    // another player wins the next match: the server resets p1 to 0 and the flames are removed
    act(() => withStreaks(store, { p2: 1 }));
    expect(row('p1').getAttribute('data-fire')).toBeNull();
    expect(screen.queryByTestId('flames-p1')).toBeNull();
    expect(screen.queryByTestId('streak-p1')).toBeNull();
  });

  it('the aura animates opacity / transform only', () => {
    const css = readFileSync('web/src/index.css', 'utf8');
    for (const k of ['fireAura', 'burningFlame']) {
      const body = new RegExp(String.raw`@keyframes ${k} \{([\s\S]*?)\n\}`).exec(css)![1]!;
      expect(body).not.toMatch(/box-shadow|background|filter|width|height|margin/);
    }
  });
});

describe('Card visuals: identity under the lock shader, target glow and reticle', () => {
  it('a locked card keeps its avatar and name; the shader is a translucent layer behind them', () => {
    const game = newGame(3);
    const s = reducer(clientStateFor(game, 'p1'), { type: 'progress', turnId: game.turn!.turnId, lockedPlayerIds: ['p2'] });
    mount(<Roster />, stubStore(s));
    const card = screen.getByTestId('player-p2');
    expect(card.textContent).toContain('Bo');
    expect(card.textContent).toContain('🦊'); // Bo's avatar
    expect(card.className).toContain('isolate');
    const shader = screen.getByTestId('lock-shader-p2');
    expect(shader.className).toContain('z-[-1]'); // behind the content, not over it
    expect(shader.innerHTML).toContain('bg-[#070b18]/55'); // semi-translucent panel
    expect(shader.textContent).toBe('');
  });

  it('opponents pulse with a neon glow while choosing a target; the chosen card becomes a steady ring with a reticle', async () => {
    const { store } = inGame(3, 1);
    mount(<Arena />, store);
    await userEvent.click(button('GUN'));
    expect(screen.getByTestId('player-p2').className).toContain('target-pulse');
    expect(screen.getByTestId('player-p1').className).not.toContain('target-pulse');
    await userEvent.click(screen.getByTestId('player-p2'));
    const chosen = screen.getByTestId('player-p2');
    expect(chosen.className).toContain('target-lock');
    expect(chosen.className).not.toContain('target-pulse');
    expect(screen.getByTestId('reticle-p2').textContent).toContain('🎯');
    expect(screen.getByTestId('player-p3').className).toContain('target-pulse'); // the others keep inviting a click
    const css = readFileSync('web/src/index.css', 'utf8');
    const body = new RegExp(String.raw`@keyframes targetPulse \{([\s\S]*?)\n\}`).exec(css)![1]!;
    expect(body).not.toMatch(/box-shadow|width|height|margin|border/); // opacity only
  });
});

describe('Host kick controls', () => {
  const lobbyAs = (me: string, n = 3) => {
    let s = reducer(initialState, { type: 'connection', status: 'connected' });
    s = reducer(s, { type: 'session', session: { roomCode: 'K7M2QP', playerId: me, playerToken: 't' } });
    s = reducer(s, { type: 'lobby', lobby: lobbyView(n, { hostId: 'p1' }) });
    return stubStore(s);
  };

  it('lobby: the host sees a Kick button on every guest row (not on themself); guests see none', async () => {
    const store = lobbyAs('p1');
    mount(<LobbyScreen />, store);
    expect(screen.queryByTestId('kick-p1')).toBeNull();
    await userEvent.click(screen.getByTestId('kick-p3'));
    expect(store.kicks).toEqual(['p3']);
    expect(screen.getByTestId('kick-p2')).toBeTruthy();
    cleanup();
    mount(<LobbyScreen />, lobbyAs('p2'));
    expect(screen.queryByTestId('kick-p3')).toBeNull();
  });

  const gameAs = (me: string, opts: { offline?: string; locked?: string[] } = {}) => {
    const game = newGame(3);
    const withOffline = opts.offline ? { ...game, players: { ...game.players, [opts.offline]: { ...game.players[opts.offline]!, connectionStatus: 'DISCONNECTED' as const } } } : game;
    let s = clientStateFor(withOffline, me);
    s = reducer(s, { type: 'lobby', lobby: lobbyView(3, { status: 'IN_GAME', hostId: 'p1' }) });
    if (opts.locked) s = reducer(s, { type: 'progress', turnId: game.turn!.turnId, lockedPlayerIds: opts.locked });
    return stubStore(s);
  };

  it('in game: shown over the card of an offline opponent, to the host only, with a confirmation step', async () => {
    const store = gameAs('p1', { offline: 'p3' });
    mount(<Roster />, store);
    expect(screen.queryByTestId('kick-p2')).toBeNull(); // online and not stalling
    await userEvent.click(screen.getByTestId('kick-p3'));
    expect(store.kicks).toEqual([]); // asks first
    await userEvent.click(screen.getByTestId('kick-no-p3'));
    await userEvent.click(screen.getByTestId('kick-p3'));
    await userEvent.click(screen.getByTestId('kick-yes-p3'));
    expect(store.kicks).toEqual(['p3']);
    cleanup();
    mount(<Roster />, gameAs('p2', { offline: 'p3' })); // a non-host never gets it
    expect(screen.queryByTestId('kick-p3')).toBeNull();
  });

  it('in game: also offered for the one player still holding up the commit window', () => {
    mount(<Roster />, gameAs('p1', { locked: ['p1', 'p2'] }));
    expect(screen.getByTestId('kick-p3')).toBeTruthy();
    expect(screen.queryByTestId('kick-p2')).toBeNull(); // already locked in
  });

  it('being kicked returns the player to the home screen with a message', () => {
    const store = gameAs('p2');
    act(() => store.dispatch({ type: 'kicked' }));
    expect(screenOf(store.getState())).toBe('home');
    expect(store.getState().notice).toContain('removed you');
  });
});

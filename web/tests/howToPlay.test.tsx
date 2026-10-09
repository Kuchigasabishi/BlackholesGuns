// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ATTACK_IDS, DEFENSE_IDS, INTERACTION_MATRIX_V2, matrixCellEffect } from '../../src/engine';
import { HowToPlay } from '../src/components/HowToPlay';
import { SettingsProvider, StoreProvider } from '../src/hooks';
import { HomeScreen } from '../src/screens/Home';
import { stubStore } from './fixtures';

afterEach(cleanup);

const open = async () => {
  const user = userEvent.setup();
  render(<HowToPlay />);
  await user.click(screen.getByRole('button', { name: /how to play/i }));
  return { user, dialog: screen.getByRole('dialog', { name: 'How to play' }) };
};

describe('How to play: Main Menu entry', () => {
  it('the Home screen has a How to play button that opens the dialog without touching the game store', async () => {
    const store = stubStore();
    const user = userEvent.setup();
    render(
      <StoreProvider store={store}>
        <SettingsProvider>
          <HomeScreen />
        </SettingsProvider>
      </StoreProvider>,
    );
    await user.click(screen.getByTestId('how-to-play-button'));
    expect(screen.getByRole('dialog', { name: 'How to play' })).toBeTruthy();
    expect(store.commits).toHaveLength(0);
  });
});

describe('How to play: dialog behaviour and keyboard accessibility', () => {
  it('is a modal dialog; focus moves to Close; Esc closes and returns focus to the button', async () => {
    const { user, dialog } = await open();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: /close/i }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('how-to-play-button'));
  });

  it('Close button and backdrop click dismiss it', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByTestId('how-to-play-button'));
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByRole('dialog').parentElement! });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps Tab inside the dialog in both directions', async () => {
    const { user, dialog } = await open();
    const inside = () => dialog.contains(document.activeElement);
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(inside()).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      await user.tab({ shift: true });
      expect(inside()).toBe(true);
    }
  });

  it('the wide matrix is a keyboard-focusable, labelled scroll region', async () => {
    await open();
    const region = screen.getByRole('region', { name: /attack versus defense matrix/i });
    expect(region.getAttribute('tabindex')).toBe('0');
  });
});

describe('How to play: matrix matches the authoritative §5 matrix', () => {
  it('has 12 attack rows x 6 defense columns with proper headers', async () => {
    await open();
    const table = screen.getByTestId('interaction-matrix');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(1 + DEFENSE_IDS.length);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(ATTACK_IDS.length);
    expect(table.querySelectorAll('td')).toHaveLength(ATTACK_IDS.length * DEFENSE_IDS.length);
  });

  it('every one of the 72 cells states the engine result in words, not just colour', async () => {
    await open();
    const word = { BLOCKED: 'BLOCK', TARGET_ELIMINATED: 'ELIM', ATTACKER_ELIMINATED: 'REFLECT' } as const;
    for (const a of ATTACK_IDS) {
      for (const d of DEFENSE_IDS) {
        const cell = document.querySelector(`[data-cell="${a}:${d}"]`)!;
        expect(cell.textContent, `${a} vs ${d}`).toContain(word[matrixCellEffect(INTERACTION_MATRIX_V2[a][d])]);
      }
    }
  });

  it('spot-checks the rules a new player is told: Blackhole beats every defense, Gun is reflected by Reflect', async () => {
    await open();
    for (const d of DEFENSE_IDS) expect(document.querySelector(`[data-cell="BLACKHOLE:${d}"]`)!.textContent).toContain('ELIM');
    expect(document.querySelector('[data-cell="GUN:REFLECT"]')!.textContent).toContain('REFLECT');
    expect(document.querySelector('[data-cell="GUN:DODGE"]')!.textContent).toContain('BLOCK');
  });

  it('explains tiers, ranged-vs-melee, Charge fog of war and the no-draw Overtime', async () => {
    const { dialog } = await open();
    const text = dialog.textContent!;
    expect(text).toMatch(/Higher tier wins/);
    expect(text).toMatch(/ranged wins/);
    expect(text).toMatch(/only ever see your own Charge/);
    expect(text).toMatch(/no draw/i);
  });
});

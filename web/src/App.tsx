import { useState } from 'react';
import { GameScreen } from './screens/Game';
import { codeFromLocation, HomeScreen } from './screens/Home';
import { LobbyScreen } from './screens/Lobby';
import { useGameState, useSettings } from './hooks';
import { screenOf } from './state/reducer';

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      onClick={() => onChange(!checked)}
      className="bracket flex items-center gap-2 rounded border border-edge px-3 py-1 text-xs text-ink-dim hover:text-ink"
    >
      <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-full border ${checked ? 'border-ok bg-ok' : 'border-ink-dim'}`} />
      {label}: <strong className={checked ? 'text-ok' : ''}>{checked ? 'ON' : 'OFF'}</strong>
    </button>
  );
}

export function KeyboardHelp() {
  return (
    <section aria-labelledby="kb-h" className="neon-box rounded-xl p-4 text-sm" data-testid="keyboard-help">
      <h2 id="kb-h" className="font-display text-neon">
        Keyboard controls
      </h2>
      <ul className="bracket mt-2 grid gap-1 sm:grid-cols-2">
        <li><kbd>Tab</kbd> — move between sections</li>
        <li><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> — move across the action grid</li>
        <li><kbd>Enter</kbd> / <kbd>Space</kbd> — select the focused action</li>
        <li><kbd>Esc</kbd> — clear your selection</li>
        <li className="text-gold">Keyboard shortcuts ON adds:</li>
        <li><kbd>C</kbd> — choose Charge</li>
        <li><kbd>1</kbd>–<kbd>7</kbd> — toggle a target (numbers shown on target buttons)</li>
        <li><kbd>L</kbd> — lock in your choice</li>
      </ul>
      <p className="mt-2 text-ink-dim">Single-key shortcuts are off by default so they never collide with screen-reader or voice-control keys.</p>
    </section>
  );
}

export function App() {
  const state = useGameState();
  const { reducedMotion, setReducedMotion, keyboardMode, setKeyboardMode } = useSettings();
  const [help, setHelp] = useState(false);
  const screen = screenOf(state);
  const inviteCode = typeof window === 'undefined' ? '' : codeFromLocation(window.location.pathname);

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-void">
        Skip to main content
      </a>
      {screen === 'game' && (
        <a href="#action-panel" className="sr-only focus:not-sr-only focus:absolute focus:left-40 focus:top-2 focus:z-50 focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-void">
          Skip to action panel
        </a>
      )}

      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-2 px-3 pt-3" role="group" aria-label="Accessibility settings">
        <span className="bracket mr-auto text-xs text-ink-dim" data-testid="connection">
          SERVER: {state.connection === 'connected' ? '● ONLINE' : state.connection === 'connecting' ? '◌ CONNECTING' : '○ OFFLINE — reconnecting'}
        </span>
        <Toggle label="Reduced motion" checked={reducedMotion} onChange={setReducedMotion} />
        <Toggle label="Keyboard shortcuts" checked={keyboardMode} onChange={setKeyboardMode} hint="Enable single-key shortcuts (C, 1-7, L)" />
        <button type="button" aria-expanded={help} onClick={() => setHelp((h) => !h)} className="bracket rounded border border-edge px-3 py-1 text-xs text-ink-dim hover:text-ink">
          {help ? 'Hide' : 'Show'} keyboard help
        </button>
      </div>
      {help && (
        <div className="mx-auto mt-2 max-w-7xl px-3">
          <KeyboardHelp />
        </div>
      )}

      {screen === 'home' && <HomeScreen initialCode={inviteCode} />}
      {screen === 'lobby' && <LobbyScreen />}
      {screen === 'game' && <GameScreen />}
    </>
  );
}

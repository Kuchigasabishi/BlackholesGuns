import { useState } from 'react';
import { SiteToolbar } from './components/SiteToolbar';
import { TurnResolutionModal } from './components/TurnResolutionModal';
import { GameScreen } from './screens/Game';
import { codeFromLocation, HomeScreen } from './screens/Home';
import { LobbyScreen } from './screens/Lobby';
import { useAudioPreload, useBgm } from './audio/useAudio';
import { FxTimelineProvider, useFx } from './fx/FxTimeline';
import { useGameState } from './hooks';
import { screenOf } from './state/reducer';

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

function AppBody() {
  useAudioPreload();
  const state = useGameState();
  const [help, setHelp] = useState(false);
  const fx = useFx();
  // After the final blow of a series the server already reports the lobby; keep the arena up until its animation settles.
  const screen = screenOf(state) === 'lobby' && state.game !== null && state.seriesEnd !== null && fx.stage !== 'settled' ? 'game' : screenOf(state);
  useBgm(screen === 'game');
  const inviteCode = typeof window === 'undefined' ? '' : codeFromLocation(window.location.pathname);

  return (
    <div className={screen === 'home' ? 'min-h-screen bg-[#060a10]' : undefined} data-screen={screen}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-void">
        Skip to main content
      </a>
      {screen === 'game' && (
        <a href="#action-panel" className="sr-only focus:not-sr-only focus:absolute focus:left-40 focus:top-2 focus:z-50 focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-void">
          Skip to action panel
        </a>
      )}

      <SiteToolbar help={help} onToggleHelp={() => setHelp((h) => !h)} />
      {help && (
        <div className="mx-auto mt-2 max-w-7xl px-3">
          <KeyboardHelp />
        </div>
      )}

      <TurnResolutionModal />
      {screen === 'home' && <HomeScreen initialCode={inviteCode} />}
      {screen === 'lobby' && <LobbyScreen />}
      {screen === 'game' && <GameScreen />}
    </div>
  );
}

export function App() {
  return (
    <FxTimelineProvider>
      <AppBody />
    </FxTimelineProvider>
  );
}

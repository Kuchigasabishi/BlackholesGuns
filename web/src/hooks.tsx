import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { GameStore } from './net/store';
import type { ClientState } from './state/reducer';

// ---------------------------------------------------------------- store binding

const StoreContext = createContext<GameStore | null>(null);

export function StoreProvider({ store, children }: { store: GameStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): GameStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}

export function useGameState(): ClientState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

// ------------------------------------------------------------------- settings

export interface Settings {
  /** Reduced motion: effective value (user toggle OR the OS preference). */
  readonly reducedMotion: boolean;
  readonly setReducedMotion: (value: boolean) => void;
  /** Single-key shortcuts. Off by default so they cannot collide with assistive tech (WCAG 2.1.4). */
  readonly keyboardMode: boolean;
  readonly setKeyboardMode: (value: boolean) => void;
}

const SettingsContext = createContext<Settings | null>(null);

const readFlag = (key: string): boolean | null => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
};
const writeFlag = (key: string, value: boolean): void => {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
};

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState<boolean>(() => readFlag('bng.reducedMotion') ?? prefersReducedMotion());
  const [keyboardMode, setKeyboard] = useState<boolean>(() => readFlag('bng.keyboardMode') ?? false);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reduced ? 'true' : 'false';
  }, [reduced]);

  const value = useMemo<Settings>(
    () => ({
      reducedMotion: reduced,
      setReducedMotion: (v) => {
        writeFlag('bng.reducedMotion', v);
        setReduced(v);
      },
      keyboardMode,
      setKeyboardMode: (v) => {
        writeFlag('bng.keyboardMode', v);
        setKeyboard(v);
      },
    }),
    [reduced, keyboardMode],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const s = useContext(SettingsContext);
  if (!s) throw new Error('useSettings must be used inside <SettingsProvider>');
  return s;
}

// ------------------------------------------------------------------- countdown

/** Whole seconds left until a server deadline, corrected for client/server clock skew. Null if no deadline. */
export function useCountdown(deadlineAt: number | null, clockSkewMs: number, active: boolean): number | null {
  const compute = useCallback(
    () => (deadlineAt === null ? null : Math.max(0, Math.ceil((deadlineAt - (Date.now() + clockSkewMs)) / 1000))),
    [deadlineAt, clockSkewMs],
  );
  const [seconds, setSeconds] = useState<number | null>(compute);
  useEffect(() => {
    setSeconds(compute());
    if (!active || deadlineAt === null) return;
    const id = setInterval(() => setSeconds(compute()), 250);
    return () => clearInterval(id);
  }, [compute, active, deadlineAt]);
  return seconds;
}

export const formatClock = (seconds: number | null): string =>
  seconds === null ? '--:--' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

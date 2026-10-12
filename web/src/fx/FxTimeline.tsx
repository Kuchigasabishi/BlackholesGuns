import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FX_TIMING, planTurn, type FxPlan, type FxStage } from '../format/fxPlan';
import { useGameState, useSettings } from '../hooks';

export interface FxState {
  readonly stage: FxStage;
  readonly plan: FxPlan | null;
}

/** Without a provider (or with reduced motion) everything is simply "settled": the finished picture. */
const SETTLED: FxState = { stage: 'settled', plan: null };
const FxContext = createContext<FxState>(SETTLED);

export const useFx = (): FxState => useContext(FxContext);

/**
 * One shared clock for the in-line reveal / projectile / impact animations.
 * It starts when a NEW turn result arrives (never on a reload mid-pause), walks
 * reveal -> fly -> impact -> settled, and ends early if the next turn opens.
 * Everything that must wait for the animation (static charge / win / eliminated
 * text, round-over banners, the match results modal) reads `stage === 'settled'`.
 */
export function FxTimelineProvider({ children }: { children: ReactNode }) {
  const { lastResult, revealed } = useGameState();
  const { reducedMotion } = useSettings();
  const turnId = lastResult?.turnId ?? null;
  const live = turnId !== null && revealed !== null;
  const seen = useRef<string | null>(turnId);
  const [stage, setStage] = useState<FxStage>('settled');
  const [playing, setPlaying] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!live || reducedMotion || turnId === seen.current) {
      setStage('settled');
      setPlaying(null);
      return;
    }
    seen.current = turnId;
    setPlaying(turnId);
    setStage('reveal');
    const timers = [
      setTimeout(() => setStage('fly'), FX_TIMING.launch),
      setTimeout(() => setStage('impact'), FX_TIMING.impact),
      setTimeout(() => setStage('settled'), FX_TIMING.settle),
    ];
    return () => timers.forEach(clearTimeout);
  }, [turnId, live, reducedMotion]);

  const plan = useMemo(() => (lastResult && playing === lastResult.turnId ? planTurn(lastResult) : null), [lastResult, playing]);
  const value = useMemo<FxState>(() => (plan && stage !== 'settled' ? { stage, plan } : { stage: 'settled', plan: null }), [stage, plan]);
  return <FxContext.Provider value={value}>{children}</FxContext.Provider>;
}

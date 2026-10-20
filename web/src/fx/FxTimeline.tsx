import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildSchedule, planTurn, type FxPlan, type FxStage, type Schedule } from '../format/fxPlan';
import { useGameState, useSettings } from '../hooks';

export interface FxState {
  readonly stage: FxStage;
  readonly plan: FxPlan | null;
  readonly schedule: Schedule | null;
  /** Milliseconds into the sequence; jumps from event to event (reveals, shakes, impacts, settle). */
  readonly t: number;
}

/** Without a provider (or with reduced motion) everything is simply "settled": the finished picture. */
const SETTLED: FxState = { stage: 'settled', plan: null, schedule: null, t: 0 };
const FxContext = createContext<FxState>(SETTLED);

export const useFx = (): FxState => useContext(FxContext);

/**
 * One shared clock for the staggered reveal / projectile / impact / screen-shake
 * sequence. It starts when a NEW turn result arrives (never on a reload mid-pause),
 * then wakes only at the moments something changes, using one short timeout per
 * moment (a few per turn), so it never busy-loops or blocks the browser thread.
 * It ends early if the next turn opens. Everything that must wait for the sequence
 * (static results, the match / series dialogs) reads `stage === 'settled'`.
 */
export function FxTimelineProvider({ children }: { children: ReactNode }) {
  const { lastResult, revealed } = useGameState();
  const { reducedMotion } = useSettings();
  const turnId = lastResult?.turnId ?? null;
  const live = turnId !== null && revealed !== null;
  const seen = useRef<string | null>(turnId);
  const [playing, setPlaying] = useState<string | null>(null);
  const [t, setT] = useState(0);

  const plan = useMemo(() => (lastResult && playing === lastResult.turnId ? planTurn(lastResult) : null), [lastResult, playing]);
  const schedule = useMemo(() => (plan ? buildSchedule(plan) : null), [plan]);

  useLayoutEffect(() => {
    if (!live || reducedMotion || turnId === seen.current) {
      setPlaying(null);
      return;
    }
    seen.current = turnId;
    setT(0);
    setPlaying(turnId);
  }, [turnId, live, reducedMotion]);

  useLayoutEffect(() => {
    if (!schedule) return;
    const timers = schedule.times.filter((ms) => ms > 0).map((ms) => setTimeout(() => setT(ms), ms));
    return () => timers.forEach(clearTimeout);
  }, [schedule]);

  const value = useMemo<FxState>(() => {
    if (!plan || !schedule || t >= schedule.settleAt) return SETTLED;
    return { stage: 'playing', plan, schedule, t };
  }, [plan, schedule, t]);
  return <FxContext.Provider value={value}>{children}</FxContext.Provider>;
}

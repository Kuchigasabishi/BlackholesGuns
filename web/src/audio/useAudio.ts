import { useEffect, useRef, useSyncExternalStore } from 'react';
import { audio, type AudioSnapshot } from './AudioManager';
import { TICK_BELOW_SECONDS } from './sounds';

/** Mute / volume state plus setters, for the header control. */
export function useAudio(): AudioSnapshot & { setMuted: (m: boolean) => void; setVolume: (v: number) => void } {
  const snap = useSyncExternalStore(audio.subscribe, audio.getSnapshot, audio.getSnapshot);
  return { ...snap, setMuted: (m) => audio.setMuted(m), setVolume: (v) => audio.setVolume(v) };
}

/** Preloads every sound once when the app starts. */
export function useAudioPreload(): void {
  useEffect(() => {
    try {
      audio.preload();
    } catch {
      /* audio unsupported: the game stays silent */
    }
  }, []);
}

/**
 * Ticking-clock tension: while `active` (COMMIT open, this player not locked in) and fewer than 10 seconds
 * remain, loops a tick that speeds up toward 0. The loop is torn down in the effect cleanup, i.e. in the same
 * React commit in which `active` turns false (locked in, state change) or the component unmounts.
 */
export function useTickingClock(seconds: number | null, active: boolean): void {
  const latest = useRef(seconds);
  latest.current = seconds;
  const tense = active && seconds !== null && seconds < TICK_BELOW_SECONDS;
  useEffect(() => {
    if (!tense) return;
    audio.startTicking(() => latest.current);
    return () => audio.stopTicking();
  }, [tense]);
}

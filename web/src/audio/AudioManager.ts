import { Howl, Howler } from 'howler';
import { BGM_FADE_IN_MS, BGM_FADE_OUT_MS, BGM_FILE, BGM_VOLUME, SOUND_FILES, TICK_BELOW_SECONDS, surgeRate, tickGapMs, tickRate, type SoundId } from './sounds';

const VOLUME_KEY = 'bng.volume';
const MUTED_KEY = 'bng.muted';

export interface AudioSnapshot {
  readonly muted: boolean;
  /** Master volume, 0 to 1. */
  readonly volume: number;
}

const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStored = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the setting simply isn't remembered */
  }
};

/**
 * One central audio controller. All six sounds are created (and preloaded) once, so playing
 * one is only a `play()` on an already decoded buffer: no network, no allocation, no lag between
 * turns. Overlapping plays reuse the same Howl. The single ticking-clock timer is owned here and
 * is cleared by `stopTicking()` / `dispose()`, so nothing leaks across rapid turn changes.
 */
export class AudioManager {
  private sounds: Map<SoundId, Howl> | null = null;
  private bgm: Howl | null = null;
  private bgmStopTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: AudioSnapshot;

  constructor() {
    const stored = Number(readStored(VOLUME_KEY));
    this.snapshot = { muted: readStored(MUTED_KEY) === '1', volume: readStored(VOLUME_KEY) === null || Number.isNaN(stored) ? 0.7 : Math.min(1, Math.max(0, stored)) };
    this.applyMaster();
  }

  /** Creates every Howl up front (call once on app start). Safe to call repeatedly. */
  preload(): void {
    if (this.sounds) return;
    const map = new Map<SoundId, Howl>();
    for (const [id, f] of Object.entries(SOUND_FILES) as [SoundId, (typeof SOUND_FILES)[SoundId]][]) {
      map.set(id, new Howl({ src: [f.src], format: ['wav'], volume: f.volume, preload: true }));
    }
    this.sounds = map;
    this.bgm = new Howl({ src: [BGM_FILE], format: ['wav'], volume: 0, loop: true, preload: true });
  }

  play(id: SoundId, rate = 1): void {
    if (this.snapshot.muted || this.snapshot.volume === 0) return;
    this.preload();
    const howl = this.sounds!.get(id)!;
    const playId = howl.play();
    if (rate !== 1) howl.rate(rate, playId);
  }

  /** "Charge +1" pressed: the more Charge already held, the higher and more thrilling the surge. */
  chargeSurge(currentCharge: number): void {
    this.play('charge', surgeRate(currentCharge));
  }

  /**
   * Starts the commit-timer tension loop. `getSeconds` is read on every tick so the tempo follows the
   * live countdown. The loop ends on its own at 10 s or more / no timer, and `stopTicking()` ends it instantly.
   */
  startTicking(getSeconds: () => number | null): void {
    this.stopTicking();
    const loop = (): void => {
      const s = getSeconds();
      if (s === null || s >= TICK_BELOW_SECONDS) {
        this.tickTimer = null;
        return;
      }
      this.play('tick', tickRate(s));
      this.tickTimer = setTimeout(loop, tickGapMs(s));
    };
    loop();
  }

  stopTicking(): void {
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.sounds?.get('tick')?.stop();
  }

  get ticking(): boolean {
    return this.tickTimer !== null;
  }

  // ------------------------------------------------------------- background music

  /** Fades the looping BGM in to a quiet level (a match has started). The master mute / volume apply to it too. */
  startBgm(): void {
    this.preload();
    const bgm = this.bgm!;
    if (this.bgmStopTimer !== null) clearTimeout(this.bgmStopTimer);
    this.bgmStopTimer = null;
    if (!bgm.playing()) bgm.play();
    bgm.fade(bgm.volume(), BGM_VOLUME, BGM_FADE_IN_MS);
  }

  /** Fades the BGM out and then stops it (back to the lobby / menu). Starting again cancels the pending stop. */
  stopBgm(): void {
    const bgm = this.bgm;
    if (!bgm || !bgm.playing() || this.bgmStopTimer !== null) return;
    bgm.fade(bgm.volume(), 0, BGM_FADE_OUT_MS);
    this.bgmStopTimer = setTimeout(() => {
      this.bgmStopTimer = null;
      bgm.stop();
    }, BGM_FADE_OUT_MS);
  }

  get bgmActive(): boolean {
    return this.bgm?.playing() === true && this.bgmStopTimer === null;
  }

  // ------------------------------------------------------------- mute / volume (observable)

  getSnapshot = (): AudioSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  setMuted(muted: boolean): void {
    this.update({ ...this.snapshot, muted });
    writeStored(MUTED_KEY, muted ? '1' : '0');
    if (muted) this.stopTicking();
  }

  setVolume(volume: number): void {
    const v = Math.min(1, Math.max(0, volume));
    this.update({ ...this.snapshot, volume: v });
    writeStored(VOLUME_KEY, String(v));
  }

  private update(next: AudioSnapshot): void {
    this.snapshot = next;
    this.applyMaster();
    this.listeners.forEach((l) => l());
  }

  private applyMaster(): void {
    Howler.volume(this.snapshot.volume);
    Howler.mute(this.snapshot.muted);
  }

  /** Stops the timer and releases every decoded buffer (tests / hot reload). */
  dispose(): void {
    this.stopTicking();
    if (this.bgmStopTimer !== null) clearTimeout(this.bgmStopTimer);
    this.bgmStopTimer = null;
    this.bgm?.unload();
    this.bgm = null;
    this.sounds?.forEach((h) => h.unload());
    this.sounds = null;
  }
}

export const audio = new AudioManager();

import { vi } from 'vitest';

/**
 * Howler needs a real audio device. Every test gets a recording fake instead, so sound triggers can be
 * asserted: `globalThis.__plays` lists each play as { src, rate } in order.
 */
export interface PlayRecord {
  src: string;
  rate: number;
}

/** What the fake BGM Howl did: `globalThis.__bgm`. */
export interface BgmRecord {
  playing: boolean;
  loop: boolean;
  volume: number;
  fades: { from: number; to: number; ms: number }[];
}

vi.mock('howler', () => {
  const plays: PlayRecord[] = [];
  (globalThis as unknown as { __plays: PlayRecord[] }).__plays = plays;
  const bgm: BgmRecord = { playing: false, loop: false, volume: 0, fades: [] };
  (globalThis as unknown as { __bgm: BgmRecord }).__bgm = bgm;
  let nextId = 0;
  class Howl {
    private readonly src: string;
    private readonly byId = new Map<number, PlayRecord>();
    private readonly isBgm: boolean;
    constructor(options: { src: string[]; loop?: boolean; volume?: number }) {
      this.src = options.src[0]!;
      this.isBgm = this.src.endsWith('bgm.wav');
      if (this.isBgm) {
        bgm.loop = options.loop === true;
        bgm.volume = options.volume ?? 1;
      }
    }
    playing(): boolean {
      return this.isBgm ? bgm.playing : false;
    }
    volume(v?: number): number {
      if (this.isBgm && v !== undefined) bgm.volume = v;
      return this.isBgm ? bgm.volume : 1;
    }
    fade(from: number, to: number, ms: number): this {
      if (this.isBgm) {
        bgm.fades.push({ from, to, ms });
        bgm.volume = to;
      }
      return this;
    }
    play(): number {
      if (this.isBgm) {
        bgm.playing = true;
        return ++nextId;
      }
      const rec = { src: this.src, rate: 1 };
      plays.push(rec);
      const id = ++nextId;
      this.byId.set(id, rec);
      return id;
    }
    rate(rate?: number, id?: number): number {
      if (rate !== undefined && id !== undefined) {
        const rec = this.byId.get(id);
        if (rec) rec.rate = rate;
      }
      return rate ?? 1;
    }
    stop(): this {
      if (this.isBgm) bgm.playing = false;
      return this;
    }
    unload(): void {}
  }
  return { Howl, Howler: { volume: vi.fn(), mute: vi.fn() } };
});

/**
 * lottie-web needs a real SVG / canvas engine. Tests get a stand-in that mounts a marker element, reports ready, and records
 * every command: `globalThis.__lottie` lists { src, cmd } entries in order.
 */
export interface LottieCommand {
  src: string;
  cmd: string;
}

vi.mock('lottie-react', async () => {
  const { useEffect } = await import('react');
  const { createElement } = await import('react');
  const log: LottieCommand[] = [];
  (globalThis as unknown as { __lottie: LottieCommand[] }).__lottie = log;
  function LottieSvg(props: { src: string; loop?: boolean; autoplay?: boolean; className?: string; lottieRef?: { current: unknown }; subscriptions?: { ready?: () => void } }) {
    const { src, loop, autoplay, lottieRef, subscriptions } = props;
    useEffect(() => {
      const rec = (cmd: string) => log.push({ src, cmd });
      if (lottieRef) lottieRef.current = { play: () => rec('play'), pause: () => rec('pause'), stop: () => rec('stop'), seek: (t: unknown) => rec(`seek:${JSON.stringify(t)}`) };
      subscriptions?.ready?.();
    }, []);
    return createElement('div', { 'data-lottie-src': src, 'data-loop': String(!!loop), 'data-autoplay': String(!!autoplay), className: props.className });
  }
  return { LottieSvg };
});

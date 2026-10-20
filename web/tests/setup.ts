import { vi } from 'vitest';

/**
 * Howler needs a real audio device. Every test gets a recording fake instead, so sound triggers can be
 * asserted: `globalThis.__plays` lists each play as { src, rate } in order.
 */
export interface PlayRecord {
  src: string;
  rate: number;
}

vi.mock('howler', () => {
  const plays: PlayRecord[] = [];
  (globalThis as unknown as { __plays: PlayRecord[] }).__plays = plays;
  let nextId = 0;
  class Howl {
    private readonly src: string;
    private readonly byId = new Map<number, PlayRecord>();
    constructor(options: { src: string[] }) {
      this.src = options.src[0]!;
    }
    play(): number {
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
      return this;
    }
    unload(): void {}
  }
  return { Howl, Howler: { volume: vi.fn(), mute: vi.fn() } };
});

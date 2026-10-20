/**
 * Synthesises the game's sound effects as small mono 16-bit WAV files (22.05 kHz) into
 * web/public/sounds/. They are procedurally generated (no recordings, no licensing), tiny
 * (~150 KB in total) so they preload instantly, and can be swapped for studio assets later by
 * dropping files with the same names into that folder (and updating web/src/audio/sounds.ts if the
 * extension changes). Run with:  node ./node_modules/tsx/dist/cli.mjs ./scripts/generate-sounds.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 22_050;
const outDir = join(import.meta.dirname, '..', 'web', 'public', 'sounds');
mkdirSync(outDir, { recursive: true });

// Deterministic noise so regenerating gives identical files.
let seed = 0x9e3779b9;
const noise = (): number => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 0xffffffff) * 2 - 1;
};

const buffer = (seconds: number): Float32Array => new Float32Array(Math.floor(seconds * RATE));
const TAU = Math.PI * 2;

/** Normalises to a safe peak and writes a 16-bit PCM mono WAV. */
function save(name: string, data: Float32Array, peak = 0.9): void {
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  const gain = max > 0 ? peak / max : 1;
  const bytes = Buffer.alloc(44 + data.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + data.length * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767), 44 + i * 2));
  writeFileSync(join(outDir, name), bytes);
  console.info(`${name}: ${(bytes.length / 1024).toFixed(1)} KB`);
}

const fade = (i: number, n: number, ms = 6): number => Math.min(1, i / ((ms / 1000) * RATE), (n - i) / ((ms / 1000) * RATE));

// ---- charge: bass-boosted electric crackle --------------------------------------------
{
  const d = buffer(0.55);
  let phase = 0;
  let crackle = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / RATE;
    const env = Math.exp(-t * 3.2) * Math.min(1, t / 0.01);
    phase += (TAU * (48 + 70 * Math.min(1, t / 0.25))) / RATE; // rising bass sweep
    const bass = Math.sin(phase) * 1.1 + Math.sin(phase * 2) * 0.3;
    if (noise() > 0.93) crackle = noise() * 1.2; // sparse electric snaps
    crackle *= 0.86;
    const buzz = (Math.sin(TAU * 440 * t) > 0 ? 1 : -1) * 0.12 * (Math.sin(TAU * 35 * t) > 0 ? 1 : 0);
    d[i] = (bass * 0.8 + crackle * 0.9 + buzz) * env * fade(i, d.length);
  }
  save('charge.wav', d);
}

// ---- clang: metallic shield hit -------------------------------------------------------
{
  const d = buffer(0.7);
  const partials = [
    [520, 1],
    [1390, 0.8],
    [2430, 0.55],
    [3380, 0.4],
    [4710, 0.25],
  ] as const;
  for (let i = 0; i < d.length; i++) {
    const t = i / RATE;
    let v = 0;
    for (const [f, a] of partials) v += Math.sin(TAU * f * t) * a * Math.exp(-t * (5 + f / 700));
    v += noise() * Math.exp(-t * 90) * 1.2; // strike transient
    d[i] = v * Math.min(1, t / 0.001) * fade(i, d.length);
  }
  save('clang.wav', d);
}

// ---- whoosh: clean air gust ------------------------------------------------------------
{
  const d = buffer(0.5);
  let low = 0;
  let band = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / RATE;
    const x = t / 0.5;
    const env = Math.sin(Math.PI * Math.min(1, x)) ** 1.6;
    const cutoff = 0.04 + 0.5 * Math.sin(Math.PI * x * 0.9); // filter sweeps up, then down
    const n = noise();
    low += cutoff * (n - low);
    band += cutoff * (low - band);
    d[i] = (low - band) * 6 * env * fade(i, d.length, 12);
  }
  save('whoosh.wav', d);
}

// ---- ping: crystal mirror bounce -------------------------------------------------------
{
  const d = buffer(0.65);
  for (let i = 0; i < d.length; i++) {
    const t = i / RATE;
    let v = 0;
    for (const [f, a, k] of [
      [2637, 1, 6],
      [3951, 0.6, 8],
      [5274, 0.4, 11],
      [7040, 0.25, 15],
    ] as const) v += Math.sin(TAU * f * t + Math.sin(TAU * 7 * t) * 0.6) * a * Math.exp(-t * k);
    const shatter = noise() * Math.exp(-t * 60) * 0.9; // glassy tinkle at the front
    d[i] = (v + shatter) * Math.min(1, t / 0.0008) * fade(i, d.length);
  }
  save('ping.wav', d);
}

// ---- boom: bass-heavy arcade explosion -------------------------------------------------
{
  const d = buffer(1.1);
  let phase = 0;
  let low = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / RATE;
    phase += (TAU * (30 + 110 * Math.exp(-t * 9))) / RATE; // pitch drops fast to a sub-bass thump
    const thump = Math.sin(phase) * Math.exp(-t * 3.2);
    low += 0.12 * (noise() - low);
    const rumble = low * 5 * Math.exp(-t * 4.5);
    const burst = noise() * Math.exp(-t * 28) * 0.9;
    const raw = (thump * 1.5 + rumble + burst) * Math.min(1, t / 0.002);
    d[i] = Math.tanh(raw * 1.6) * fade(i, d.length, 20); // soft clip for crunch
  }
  save('boom.wav', d);
}

// ---- tick: one clock tick / heartbeat pulse --------------------------------------------
{
  const d = buffer(0.09);
  for (let i = 0; i < d.length; i++) {
    const t = i / RATE;
    d[i] = (Math.sin(TAU * 130 * t) * 1.1 + Math.sin(TAU * 1100 * t) * 0.35) * Math.exp(-t * 55) * Math.min(1, t / 0.0007);
  }
  save('tick.wav', d, 0.8);
}

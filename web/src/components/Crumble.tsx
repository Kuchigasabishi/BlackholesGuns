import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSettings } from '../hooks';

/** Length of the destruction animation. */
export const CRUMBLE_MS = 1000;

export type CrumblePhase = 'idle' | 'crumbling' | 'done';

/**
 * Drives one elimination: `idle` until `trigger` turns true, `crumbling` for
 * CRUMBLE_MS, then `done` (the permanent grayscale state). With reduced motion
 * it goes straight to `done`. A card that is already eliminated when it first
 * appears (a reload) is `done` at once, so nothing replays.
 */
export function useCrumble(trigger: boolean, alreadyOver: boolean): CrumblePhase {
  const { reducedMotion } = useSettings();
  const [phase, setPhase] = useState<CrumblePhase>(() => (alreadyOver ? 'done' : 'idle'));
  const started = useRef(false);

  useEffect(() => {
    if (!trigger) {
      if (!alreadyOver) {
        started.current = false;
        setPhase('idle');
      }
      return;
    }
    if (reducedMotion) {
      setPhase('done');
      return;
    }
    if (started.current) return;
    started.current = true;
    setPhase('crumbling');
    const id = setTimeout(() => setPhase('done'), CRUMBLE_MS);
    return () => clearTimeout(id);
  }, [trigger, alreadyOver, reducedMotion]);

  return phase;
}

const PARTICLES = Array.from({ length: 16 }, (_, i) => {
  const col = i % 4;
  const row = Math.floor(i / 4);
  return {
    left: `${col * 25}%`,
    top: `${row * 25}%`,
    dx: Math.round((col - 1.5) * 20 + (((i * 7) % 5) - 2) * 7),
    dy: -18 - ((i * 13) % 40) - (3 - row) * 4,
    delay: (i * 37) % 260,
    cyan: i % 3 === 0,
  };
});

/**
 * "Digital dust" wrapper. While `crumbling` the child fractures with a clip-path
 * mask and fades, 16 small squares drift up and outward, and a red glow bursts
 * and fades to darkness. Everything but the short clip-path mask animates
 * `transform` / `opacity` only, so it stays on the GPU. Purely presentational.
 */
export function Crumble({ crumbling, children, inline = false }: { crumbling: boolean; children: ReactNode; inline?: boolean }) {
  return (
    <div className={inline ? 'relative inline-block' : 'relative'}>
      <div className={crumbling ? 'anim-dissolve' : ''} data-crumbling={crumbling || undefined}>
        {children}
      </div>
      {crumbling && (
        <div aria-hidden="true" data-testid="digital-dust" className="pointer-events-none absolute inset-0">
          <span className="anim-dissolve-glow absolute -inset-1 rounded-full" />
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="dust-p absolute h-[25%] w-[25%] p-[7%]"
              style={{ left: p.left, top: p.top, ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, animationDelay: `${p.delay}ms` }}
            >
              <span className={`block h-full w-full ${p.cyan ? 'bg-neon' : 'bg-danger'}`} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

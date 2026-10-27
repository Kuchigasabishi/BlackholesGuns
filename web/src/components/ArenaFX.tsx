import { useLayoutEffect, useRef, type RefObject } from 'react';
import { FX_TIMING, type Projectile } from '../format/fxPlan';
import { useFx } from '../fx/FxTimeline';
import { ActionGlyph } from './ActionIcons';

interface Point {
  x: number;
  y: number;
}

/** Centre of a player's card, relative to the arena container. */
function centreOf(container: HTMLElement, playerId: string): Point | null {
  const card = container.querySelector<HTMLElement>(`[data-card-id="${playerId}"]`);
  if (!card) return null;
  const a = container.getBoundingClientRect();
  const b = card.getBoundingClientRect();
  return { x: b.left - a.left + b.width / 2, y: b.top - a.top + b.height / 2 };
}

/**
 * Keyframes (as offsets from the source card centre) for how a projectile ends.
 * `d` is the vector from the attacker's card to the target's card.
 */
function keyframesFor(p: Projectile, d: Point): { frames: Keyframe[]; duration: number } {
  const at = (k: number): Keyframe => ({ transform: `translate(-50%, -50%) translate(${d.x * k}px, ${d.y * k}px)` });
  switch (p.end) {
    case 'BLOCKED':
      // Fly in, smack into the defense and ricochet off it.
      return {
        duration: FX_TIMING.flight * 1.5,
        frames: [
          { ...at(0), opacity: 0, offset: 0 },
          { ...at(0.08), opacity: 1, offset: 0.08 },
          { ...at(0.84), opacity: 1, offset: 0.62 },
          { transform: `translate(-50%, -50%) translate(${d.x * 0.7 + 18}px, ${d.y * 0.7 - 46}px) rotate(220deg) scale(0.8)`, opacity: 0, offset: 1 },
        ],
      };
    case 'REFLECTED':
      // Fly in, bounce straight back at the attacker.
      return {
        duration: FX_TIMING.flight * 1.9,
        frames: [
          { ...at(0), opacity: 0, offset: 0 },
          { ...at(0.08), opacity: 1, offset: 0.06 },
          { ...at(0.9), opacity: 1, offset: 0.46 },
          { ...at(0.9), opacity: 1, offset: 0.54, filter: 'brightness(2)' },
          { ...at(0.05), opacity: 1, offset: 0.96 },
          { ...at(0), opacity: 0, offset: 1 },
        ],
      };
    case 'NEUTRALIZED':
    case 'CLASH_LOST':
      // Meet the opposing attack half-way and burst.
      return {
        duration: FX_TIMING.flight * 1.2,
        frames: [
          { ...at(0), opacity: 0, offset: 0 },
          { ...at(0.08), opacity: 1, offset: 0.1 },
          { ...at(0.5), opacity: 1, offset: 0.7 },
          { transform: `translate(-50%, -50%) translate(${d.x * 0.5}px, ${d.y * 0.5}px) scale(1.8)`, opacity: 0, offset: 1 },
        ],
      };
    default:
      // A hit: fly across and land on the victim's card.
      return {
        duration: FX_TIMING.flight * 1.15,
        frames: [
          { ...at(0), opacity: 0, offset: 0 },
          { ...at(0.08), opacity: 1, offset: 0.1 },
          { ...at(0.92), opacity: 1, offset: 0.85 },
          { transform: `translate(-50%, -50%) translate(${d.x}px, ${d.y}px) scale(1.5)`, opacity: 0, offset: 1 },
        ],
      };
  }
}

function Flyer({ p, container }: { p: Projectile; container: RefObject<HTMLElement | null> }) {
  const el = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const root = container.current;
    const node = el.current;
    if (!root || !node) return;
    const from = centreOf(root, p.from);
    const to = centreOf(root, p.to);
    if (!from || !to) return;
    node.style.left = `${from.x}px`;
    node.style.top = `${from.y}px`;
    if (typeof node.animate !== 'function') return;
    const { frames, duration } = keyframesFor(p, { x: to.x - from.x, y: to.y - from.y });
    const anim = node.animate(frames, { duration, easing: 'ease-in-out', fill: 'both' });
    return () => anim.cancel();
  }, [p, container]);
  return (
    <span ref={el} aria-hidden="true" data-testid="fx-projectile" data-end={p.end} className="absolute z-20 text-4xl text-[#50e3ed] opacity-0" style={{ transform: 'translate(-50%, -50%)' }}>
      <ActionGlyph emoji={p.emoji} className="size-9" />
    </span>
  );
}

/**
 * Projectile layer over the roster. Only mounted while a turn's animation is
 * playing; each projectile appears when its attacker is revealed and travels from the attacker's card bounding box to the
 * target's card bounding box. The static card reactions live on the cards.
 */
export function ArenaFX({ container }: { container: RefObject<HTMLElement | null> }) {
  const { stage, schedule, t } = useFx();
  if (!schedule || stage !== 'playing') return null;
  const launched = schedule.shots.filter((s) => s.launchAt <= t);
  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true" data-testid="arena-fx">
      {launched.map((s) => (
        <Flyer key={s.shot.key} p={s.shot} container={container} />
      ))}
    </div>
  );
}

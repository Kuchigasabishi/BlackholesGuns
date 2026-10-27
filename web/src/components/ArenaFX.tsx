import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react';
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
 * Which CSS keyframes (index.css) a projectile uses and how long they run. The durations are scaled so the impact
 * frame of each animation lands on the schedule's impact tick (launch + flight): a Knife is a melee dash-and-slash
 * (`meleeStrike`) that snaps back to the attacker, every other weapon flies as a bullet (`fireBullet*`).
 */
export function flyerMotion(p: Pick<Projectile, 'end' | 'emoji'>): { cls: string; duration: number } {
  const f = FX_TIMING.flight;
  if (p.emoji === '🔪' && (p.end === 'HIT' || p.end === 'BLOCKED')) return { cls: 'fx-melee', duration: Math.round(f / 0.6) };
  switch (p.end) {
    case 'BLOCKED':
      return { cls: 'fx-bullet-blocked', duration: f * 1.5 };
    case 'REFLECTED':
      return { cls: 'fx-bullet-reflected', duration: f * 1.9 };
    case 'NEUTRALIZED':
    case 'CLASH_LOST':
      return { cls: 'fx-bullet-clash', duration: f * 1.2 };
    default:
      return { cls: 'fx-bullet', duration: f * 1.15 };
  }
}

function Flyer({ p, container }: { p: Projectile; container: RefObject<HTMLElement | null> }) {
  const el = useRef<HTMLSpanElement>(null);
  const { cls, duration } = flyerMotion(p);
  useLayoutEffect(() => {
    const root = container.current;
    const node = el.current;
    if (!root || !node) return;
    const from = centreOf(root, p.from);
    const to = centreOf(root, p.to);
    if (!from || !to) return;
    node.style.left = `${from.x}px`;
    node.style.top = `${from.y}px`;
    node.style.setProperty('--dx', `${to.x - from.x}px`);
    node.style.setProperty('--dy', `${to.y - from.y}px`);
    node.style.setProperty('--flip', to.x < from.x ? '-1' : '1'); // a leftward shot mirrors the icon so it points at its target
  }, [p, container]);
  return (
    <span
      ref={el}
      aria-hidden="true"
      data-testid="fx-projectile"
      data-end={p.end}
      data-motion={cls}
      className={`fx-flyer absolute z-20 text-4xl text-[#50e3ed] opacity-0 ${cls}`}
      style={{ transform: 'translate3d(-50%, -50%, 0)', '--dx': '0px', '--dy': '0px', '--dur': `${duration}ms` } as CSSProperties}
    >
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

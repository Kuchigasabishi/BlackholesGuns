import type { PlayerId } from '../../../src/engine';

/** One avatar per seat, assigned by lobby order (Figure 1 uses a different character per seat). */
const AVATARS = ['🤖', '🦊', '🐼', '🥷', '🐯', '👻', '🦅', '👾'] as const;
const RINGS = ['#3ee6ff', '#ff9d3e', '#e6f0ff', '#b48cff', '#ffd54d', '#9db3d9', '#c98a4b', '#6dffa8'] as const;

export const avatarFor = (seat: number): string => AVATARS[seat % AVATARS.length]!;
export const ringFor = (seat: number): string => RINGS[seat % RINGS.length]!;

interface AvatarProps {
  readonly seat: number;
  readonly eliminated: boolean;
  readonly playerId: PlayerId;
  /** `sm` is the 42px roster-card avatar from the match design. */
  readonly size?: 'md' | 'sm';
}

/**
 * Eliminated avatars are greyscale AND carry a crossed-out mark; the explicit
 * "[ELIMINATED]" text label lives in the roster card (colour is never the only cue).
 */
export function Avatar({ seat, eliminated, size = 'md' }: AvatarProps) {
  const sm = size === 'sm';
  return (
    <div
      aria-hidden="true"
      className={`relative flex shrink-0 items-center justify-center rounded-full ${sm ? 'size-[42px] text-[25px]' : 'h-20 w-20 text-5xl'}`}
      style={{ border: `${sm ? 1 : 3}px solid ${eliminated ? '#6b7280' : ringFor(seat)}`, background: 'rgb(5 8 22 / 0.7)' }}
    >
      <span className={eliminated ? 'opacity-60 grayscale' : ''} style={eliminated ? { filter: 'grayscale(1)' } : undefined}>
        {avatarFor(seat)}
      </span>
      {eliminated && (
        <span className={`absolute inset-0 flex items-center justify-center ${sm ? 'text-2xl' : 'text-6xl'} font-black text-white/80`} style={{ textShadow: '0 0 6px #000' }}>
          ✖
        </span>
      )}
    </div>
  );
}

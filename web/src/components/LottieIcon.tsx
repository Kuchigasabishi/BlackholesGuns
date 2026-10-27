import { LottieSvg, type LottieHandle } from 'lottie-react';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../hooks';

export type LottieName = 'Charge' | 'Dodge' | 'Shield';

/** The three Jitter animations that replace the static ⚡ / 💨 / 🛡️ characters (files in web/public/animations). */
const LOTTIE_FOR_EMOJI: Readonly<Record<string, LottieName>> = { '⚡': 'Charge', '💨': 'Dodge', '🛡️': 'Shield' };
export const lottieForEmoji = (emoji: string): LottieName | null => LOTTIE_FOR_EMOJI[emoji] ?? null;

/**
 * One Lottie animation in a fixed box (it fills whatever size the caller gives, so it never shifts the layout).
 *  - `loop`: plays forever (action buttons, a charging card).
 *  - `once`: waits on its first frame until `trigger` turns true, then plays once. The Turn Resolution popup uses it so a
 *    Shield or Dodge starts at the exact moment the projectile lands.
 * `still` (unaffordable button, reduced motion) parks it on a mid frame instead of playing, which also stops its work.
 */
export function LottieIcon({ name, mode, trigger = true, still = false, className = '' }: { name: LottieName; mode: 'loop' | 'once'; trigger?: boolean; still?: boolean; className?: string }) {
  const { reducedMotion } = useSettings();
  const handle = useRef<LottieHandle>(null);
  const [ready, setReady] = useState(false);
  const parked = still || reducedMotion;

  useEffect(() => {
    const h = handle.current;
    if (!ready || !h) return;
    if (parked) {
      h.seek({ percent: 55 });
      h.pause();
    } else if (mode === 'loop') {
      h.play();
    } else if (trigger) {
      h.seek(0);
      h.play();
    } else {
      h.seek(0);
      h.pause();
    }
  }, [ready, parked, mode, trigger]);

  return (
    <span aria-hidden="true" data-lottie={name} data-mode={mode} data-playing={!parked && (mode === 'loop' || trigger) ? 'true' : 'false'} className={`inline-block shrink-0 ${className}`}>
      <LottieSvg src={`/animations/${name}.json`} loop={mode === 'loop'} autoplay={false} lottieRef={handle} subscriptions={{ ready: () => setReady(true) }} className="size-full" />
    </span>
  );
}

/**
 * An action's symbol: the Lottie animation for Charge / Dodge / Shield, the plain emoji for everything else (weapons).
 * Charge always loops; Dodge and Shield play once when `trigger` is true.
 */
export function ActionGlyph({ emoji, trigger = true, still = false, className = 'size-full' }: { emoji: string; trigger?: boolean; still?: boolean; className?: string }) {
  const name = lottieForEmoji(emoji);
  if (!name) return <>{emoji}</>;
  return <LottieIcon name={name} mode={name === 'Charge' ? 'loop' : 'once'} trigger={trigger} still={still} className={className} />;
}

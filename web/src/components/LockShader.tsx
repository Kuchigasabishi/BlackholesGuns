import { useEffect, useState } from 'react';

const FADE_MS = 250;

/**
 * "Locked and loaded" overlay for a player's card during COMMIT: a dark metallic
 * holographic panel with a sheen sweeping across it, framed by a rotating dashed
 * chain border. Purely presentational (pointer-events none, aria-hidden). Both
 * moving layers animate `transform` only, which browsers run on the GPU, so it stays
 * smooth on mid-range phones. When `active` turns false it fades out, then unmounts,
 * so the card face and the revealed action emoji are never clipped.
 */
export function LockShader({ active, playerId }: { active: boolean; playerId: string }) {
  const [leaving, setLeaving] = useState(false);
  const [mounted, setMounted] = useState(active);

  useEffect(() => {
    if (active) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const id = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, FADE_MS);
    return () => clearTimeout(id);
  }, [active, mounted]);

  if (!mounted && !active) return null;
  return (
    <div
      aria-hidden="true"
      data-testid={`lock-shader-${playerId}`}
      data-leaving={leaving || undefined}
      className={`lock-shader pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-xl ${leaving ? 'lock-shader-out' : 'lock-shader-in'}`}
    >
      {/* rotating chain: a dashed conic ring that spins behind the panel, leaving only the border visible */}
      <span className="lock-chain absolute -inset-[60%]" />
      <span className="absolute inset-[3px] overflow-hidden rounded-[9px] bg-[#070b18]/90">
        {/* iridescent sheen sweeping across (translate only) */}
        <span className="lock-sheen absolute inset-y-0 left-0 w-[300%]" />
        <span className="absolute inset-0 flex items-center justify-center text-3xl opacity-70">🔒</span>
      </span>
    </div>
  );
}

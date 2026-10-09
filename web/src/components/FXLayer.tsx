import { useEffect, useRef, useState } from 'react';
import { ATTACKS } from '../../../src/engine';
import { useGameState, useSettings } from '../hooks';

export function FXLayer() {
  const { lastResult, revealed } = useGameState();
  const { reducedMotion } = useSettings();
  const [fx, setFx] = useState<'shake' | 'vortex' | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (reducedMotion || !lastResult || !revealed) return;

    const hasBlackhole = revealed.some((a) => a.kind === 'ATTACK' && a.weapon === 'BLACKHOLE');
    const hasNuke = revealed.some((a) => a.kind === 'ATTACK' && a.weapon === 'NUKE');

    if (hasBlackhole) {
      setFx('vortex');
      timeoutRef.current = setTimeout(() => setFx(null), 800);
    } else if (hasNuke) {
      setFx('shake');
      timeoutRef.current = setTimeout(() => setFx(null), 600);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [lastResult?.turnId, reducedMotion]);

  if (!fx) return null;

  const fxClass = fx === 'shake' ? 'anim-screen-shake' : 'anim-vortex';

  return (
    <div
      className={`pointer-events-none fixed inset-0 flex items-center justify-center ${fxClass}`}
      aria-hidden="true"
    >
      {fx === 'vortex' && (
        <div className="anim-pulse-glow absolute h-96 w-96 rounded-full bg-gradient-to-r from-neon to-neon-pink opacity-20" />
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { LogBlock, Tone, TurnLog } from '../format/describeTurn';
import { useSettings } from '../hooks';

const TONE: Record<Tone, string> = {
  neutral: 'border-edge text-ink',
  action: 'border-neon text-ink',
  block: 'border-ok text-ink',
  danger: 'border-danger text-ink',
  phase: 'border-gold bg-gold/10 text-gold',
  system: 'border-neon-pink text-ink',
  win: 'border-gold bg-gold/10 text-gold font-bold',
};

/** Delay between log blocks while a turn is "played back". */
export const REVEAL_STEP_MS = 450;

/**
 * The right-hand scrolling log. The newest turn plays back block by block
 * (REVEAL first, then each attack's breakdown, then eliminations); with reduced
 * motion, or after "Show everything", it appears at once. The full text is always
 * in the DOM log for screen readers; nothing is conveyed only by animation or colour.
 */
export function EventLog({ entries }: { entries: readonly TurnLog[] }) {
  const { reducedMotion } = useSettings();
  const latest = entries.at(-1);
  const [revealed, setRevealed] = useState<{ turnId: string | null; count: number }>({ turnId: null, count: 0 });
  const seenFirst = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);

  // When a new turn lands, start (or skip) its playback. The very first render shows history as-is.
  useEffect(() => {
    if (!latest) return;
    if (seenFirst.current || reducedMotion) {
      seenFirst.current = false;
      setRevealed({ turnId: latest.turnId, count: latest.blocks.length });
      return;
    }
    setRevealed({ turnId: latest.turnId, count: 0 });
    let count = 0;
    const id = setInterval(() => {
      count += 1;
      setRevealed({ turnId: latest.turnId, count });
      if (count >= latest.blocks.length) clearInterval(id);
    }, REVEAL_STEP_MS);
    return () => clearInterval(id);
  }, [latest?.turnId, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the newest line in view.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, revealed.count]);

  const playing = latest !== undefined && revealed.turnId === latest.turnId && revealed.count < latest.blocks.length;

  return (
    <section aria-labelledby="log-h" className="neon-box flex h-full min-h-72 flex-col rounded-2xl p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="log-h" className="font-display text-sm text-neon">
          [ REAL-TIME CANONICAL EVENT LOG ]
        </h2>
        {playing && (
          <button
            type="button"
            onClick={() => latest && setRevealed({ turnId: latest.turnId, count: latest.blocks.length })}
            className="rounded border border-edge px-2 py-1 text-xs text-ink-dim hover:text-ink"
          >
            Show everything
          </button>
        )}
      </div>

      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Event log"
        tabIndex={0}
        data-testid="event-log"
        className="bracket mt-2 max-h-[28rem] flex-1 space-y-3 overflow-y-auto pr-1 text-sm lg:max-h-none"
      >
        {entries.length === 0 && <p className="text-ink-dim">Nothing has happened yet. Resolved turns will be written here.</p>}
        {entries.map((entry) => {
          const isLatest = entry === latest;
          const shown = isLatest && revealed.turnId === entry.turnId ? revealed.count : entry.blocks.length;
          return (
            <article key={entry.turnId} aria-label={entry.heading}>
              <h3 className="sticky top-0 bg-panel py-1 font-bold text-neon-pink">[ {entry.heading} ]</h3>
              <div className="space-y-2">
                {entry.blocks.slice(0, shown).map((block: LogBlock, i) => (
                  <p key={i} className={`anim-line whitespace-pre-wrap border-l-4 pl-3 ${TONE[block.tone]}`}>
                    {block.text}
                  </p>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

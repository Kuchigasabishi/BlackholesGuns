import { useEffect, useRef } from 'react';
import { trapTab } from '../a11y';
import { useFx } from '../fx/FxTimeline';
import { useGameState, useStore } from '../hooks';
import { nameLookup } from '../state/reducer';

/**
 * The one remaining popup: the final series result, shown once the last turn's
 * in-line animation has settled. Per-turn results are shown on the player cards
 * themselves (see ArenaFX); this only closes out the whole series.
 */
export function SeriesResultModal() {
  const store = useStore();
  const state = useGameState();
  const { stage } = useFx();
  const { seriesEnd, game, lastResult } = state;
  const dialog = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const visible = seriesEnd !== null && game !== null && stage === 'settled';

  useEffect(() => {
    if (visible) primary.current?.focus();
  }, [visible]);

  if (!visible || !seriesEnd || !game) return null;
  const nameOf = nameLookup(state);
  const wins = seriesEnd.matchWins;
  const ranked = [...game.series.lobby].sort((a, b) => (wins[b] ?? 0) - (wins[a] ?? 0));
  const finalWinner = lastResult?.outcome.matchWinnerId ?? null;
  const close = () => store.dispatch({ type: 'seriesAcknowledged' });
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    trapTab(e, dialog.current);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/85 p-2 sm:p-4" onKeyDown={onKeyDown}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="sr-title" data-testid="series-result" className="neon-box flex max-h-[95vh] w-full max-w-lg flex-col rounded-2xl border-2 border-gold">
        <div className="space-y-2 overflow-y-auto px-4 py-5 text-center sm:px-6">
          {finalWinner && <p className="font-bold text-gold">🏆 {nameOf(finalWinner)} wins the final match (+1 Match Win)</p>}
          <h2 id="sr-title" className="font-display text-2xl font-black text-gold">
            SERIES OVER
          </h2>
          <p className="text-lg font-bold text-neon" data-testid="sr-winner">
            {seriesEnd.winnerId ? nameOf(seriesEnd.winnerId) : 'Nobody'} wins the series!
          </p>
          <ol className="bracket mx-auto max-w-xs space-y-0.5 text-left text-sm" data-testid="sr-standings">
            {ranked.map((id) => (
              <li key={id} className="flex justify-between">
                <span>{nameOf(id)}</span>
                <span className="text-gold">{wins[id] ?? 0} match wins</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex justify-end border-t border-edge px-4 py-3 sm:px-6">
          <button ref={primary} type="button" onClick={close} className="rounded-lg bg-neon px-6 py-2 font-bold text-void hover:brightness-110" data-testid="sr-return">
            Return to lobby <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

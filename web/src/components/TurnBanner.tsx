import { useFx } from '../fx/FxTimeline';
import { useGameState } from '../hooks';
import { nameLookup } from '../state/reducer';

/**
 * Inline (non-modal) banner for a turn that ended a round or a match. It appears
 * once the card animations settle and clears itself when the next turn opens.
 * Series ends have their own dialog; the match standings are in MatchResultsModal.
 */
export function TurnBanner() {
  const state = useGameState();
  const { stage } = useFx();
  const { lastResult, revealed } = state;
  if (!lastResult || !revealed || stage !== 'settled') return null;
  const { outcome } = lastResult;
  const nameOf = nameLookup(state);

  if (outcome.transition === 'NEXT_ROUND') {
    return (
      <p role="status" data-testid="turn-banner" className="rounded-xl border-2 border-gold bg-gold/10 px-4 py-3 text-center text-ink">
        <strong className="font-display text-gold">🏁 ROUND OVER</strong> · <span className="font-bold text-danger">[ELIMINATED]</span> {outcome.eliminatedPlayerIds.map(nameOf).join(', ')} ·{' '}
        <span className="font-bold text-ok">Survivors:</span> {outcome.survivorIds.map(nameOf).join(', ')} · next round starts at 0⚡
      </p>
    );
  }
  if (outcome.transition === 'ROUND_RESTARTED_NO_SURVIVORS') {
    return (
      <p role="status" data-testid="turn-banner" className="rounded-xl border-2 border-gold bg-gold/10 px-4 py-3 text-center text-ink">
        <strong className="font-display text-gold">⚠ ROUND VOID</strong> · everyone was eliminated at once; the round restarts with the same players.
      </p>
    );
  }
  if (outcome.transition === 'MATCH_ENDED' && outcome.matchWinnerId) {
    return (
      <p role="status" data-testid="turn-banner" className="rounded-xl border-2 border-gold bg-gold/10 px-4 py-3 text-center text-ink">
        <strong className="font-display text-gold">🏆 MATCH OVER</strong> · <span className="font-bold text-neon">{nameOf(outcome.matchWinnerId)} wins the match! (+1 Match Win)</span>
      </p>
    );
  }
  return null;
}

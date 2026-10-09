import { useEffect, useRef, useState } from 'react';
import { trapTab } from '../a11y';
import { Battlefield } from './Battlefield';
import { MatchResultsModal } from './MatchResultsModal';
import { describeResolution, type OutcomeTag } from '../format/describeTurn';
import { useGameState, useSettings, useStore } from '../hooks';
import { nameLookup } from '../state/reducer';

// Every outcome has a text tag and a symbol, so meaning never depends on colour alone.
const TAG: Record<OutcomeTag, { symbol: string; style: string }> = {
  BLOCKED: { symbol: '✔', style: 'border-ok bg-ok/15 text-ok' },
  REFLECTED: { symbol: '↩', style: 'border-gold bg-gold/15 text-gold' },
  ELIMINATED: { symbol: '✖', style: 'border-danger bg-danger/15 text-danger' },
  NEUTRALIZED: { symbol: '＝', style: 'border-neon bg-neon/10 text-neon' },
};

const NEXT_LABEL = { NEXT_TURN: 'Next turn', NEXT_ROUND: 'Next round', ROUND_RESTARTED_NO_SURVIVORS: 'Next round', MATCH_ENDED: 'Next match', SERIES_ENDED: 'Back to start' } as const;

function Stage({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`tr-stage-${n}`} className="rounded-lg border border-edge bg-panel/50 p-3">
      <h3 id={`tr-stage-${n}`} className="font-display text-sm font-bold uppercase tracking-wide text-neon-pink">
        {n} · {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * One modal for every resolved turn: Stage 1 targeting, Stage 2 outcomes (§5/§6),
 * then, if the turn ended a round, match or series, that result. It closes with
 * "Next turn", Esc, or automatically when the next turn opens (so it never
 * blocks play). A series result stays until the player leaves.
 */
export function TurnResolutionModal() {
  const store = useStore();
  const state = useGameState();
  const { reducedMotion } = useSettings();
  const { lastResult, revealed, seriesEnd, game, log } = state;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  const showTurn = lastResult !== null && revealed !== null && game !== null;
  const transition = showTurn ? lastResult.outcome.transition : null;
  const seriesOver = transition === 'SERIES_ENDED' || seriesEnd !== null;
  const turnId = lastResult?.turnId ?? null;
  const visible = game !== null && ((showTurn && dismissed !== turnId) || seriesOver);

  useEffect(() => {
    if (!visible) return;
    primary.current?.focus();
    return () => document.getElementById('action-panel')?.focus();
  }, [visible, turnId]);

  // Once the turn breakdown is closed (or the next turn opened), a match end shows the series standings.
  if (!visible || !game) return <MatchResultsModal />;
  const nameOf = nameLookup(state);
  const outcome = showTurn ? lastResult.outcome : null;
  const breakdown = showTurn ? describeResolution(lastResult, nameOf) : null;
  const heading = log.find((l) => l.turnId === turnId)?.heading ?? 'Series complete';
  const wins = lastResult?.state.series.matchWins ?? seriesEnd?.matchWins ?? {};
  const ranked = [...game.series.lobby].sort((a, b) => (wins[b] ?? 0) - (wins[a] ?? 0));
  const seriesWinnerId = outcome?.seriesWinnerId ?? seriesEnd?.winnerId ?? null;
  const primaryLabel = seriesOver ? NEXT_LABEL.SERIES_ENDED : NEXT_LABEL[transition ?? 'NEXT_TURN'];
  const rowIndex = (i: number) => (breakdown ? breakdown.targeting.length + breakdown.others.length + i : i);
  const delay = (i: number) => (reducedMotion ? undefined : { animationDelay: `${i * 90}ms` });

  const onPrimary = () => (seriesOver ? void store.leaveRoom() : setDismissed(turnId));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !seriesOver) {
      e.stopPropagation();
      setDismissed(turnId);
      return;
    }
    trapTab(e, dialog.current);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/85 p-2 sm:p-4" onKeyDown={onKeyDown}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tr-title"
        data-testid="turn-resolution"
        className="neon-box flex max-h-[95vh] w-full max-w-2xl flex-col rounded-2xl border-2 border-neon"
      >
        <div className="border-b border-edge px-4 py-3 sm:px-6">
          <h2 id="tr-title" className="font-display text-xl font-black text-neon sm:text-2xl">
            TURN RESOLUTION
          </h2>
          <p className="bracket text-sm text-ink-dim">{heading}</p>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
          {breakdown && outcome && lastResult && (
            <>
              <Stage n={1} title="Battlefield">
                <div className="mt-2">
                  <Battlefield result={lastResult} nameOf={nameOf} viewerId={state.session?.playerId ?? null} animate={!reducedMotion} />
                </div>
              </Stage>

              <details className="rounded-lg border border-edge bg-panel/50 p-3" data-testid="tr-details">
                <summary className="cursor-pointer font-display text-sm font-bold uppercase tracking-wide text-neon-pink">Text breakdown</summary>
                <div className="mt-2 space-y-3">
              <Stage n={2} title="Targeting">
                <ul className="mt-2 space-y-1 text-base" data-testid="tr-targeting">
                  {breakdown.targeting.map((line, i) => (
                    <li key={line} className="anim-line font-bold text-ink" style={delay(i)}>
                      {line}
                    </li>
                  ))}
                  {breakdown.others.map((line, i) => (
                    <li key={line} className="anim-line text-sm text-ink-dim" style={delay(breakdown.targeting.length + i)}>
                      {line}
                    </li>
                  ))}
                </ul>
              </Stage>

              <Stage n={3} title="Outcome">
                <ul className="mt-2 space-y-2" data-testid="tr-outcomes">
                  {breakdown.outcomes.length === 0 && <li className="text-ink-dim">Nothing was hit, blocked or reflected.</li>}
                  {breakdown.outcomes.map((o, i) => (
                    <li key={o.text} className="anim-line flex items-start gap-2" style={delay(rowIndex(i))}>
                      <span className={`bracket mt-0.5 shrink-0 rounded border px-2 py-0.5 text-xs font-bold ${TAG[o.tag].style}`}>
                        <span aria-hidden="true" className={o.tag === 'BLOCKED' && !reducedMotion ? 'anim-block-icon' : undefined} style={o.tag === 'BLOCKED' ? delay(rowIndex(i)) : undefined} data-testid={o.tag === 'BLOCKED' ? 'block-icon' : undefined}>
                          {TAG[o.tag].symbol}
                        </span>{' '}
                        [{o.tag}]
                      </span>
                      <span className={`text-ink ${o.tag === 'BLOCKED' && !reducedMotion ? 'anim-block-text' : ''}`} style={o.tag === 'BLOCKED' ? delay(rowIndex(i)) : undefined}>
                        {o.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </Stage>

                </div>
              </details>

              {outcome.eliminatedPlayerIds.length > 0 && transition === 'NEXT_TURN' && (
                <p className="bracket text-sm text-ink" data-testid="tr-survivors">
                  <span className="font-bold text-danger">[ELIMINATED]</span> {outcome.eliminatedPlayerIds.map(nameOf).join(', ')} ·{' '}
                  <span className="font-bold text-ok">Still alive:</span> {outcome.survivorIds.map(nameOf).join(', ')}
                </p>
              )}
              {outcome.eliminatedPlayerIds.length === 0 && transition === 'NEXT_TURN' && (
                <p className="bracket text-sm text-ink-dim">No eliminations. No-elimination streak: {outcome.noEliminationStreak}.</p>
              )}
            </>
          )}

          {(transition === 'NEXT_ROUND' || transition === 'ROUND_RESTARTED_NO_SURVIVORS') && outcome && (
            <section role="status" data-testid="tr-end" className="rounded-lg border-2 border-gold bg-gold/10 p-3 text-center">
              <h3 className="font-display text-xl font-black text-gold">{transition === 'NEXT_ROUND' ? '🏁 ROUND OVER' : '⚠ ROUND VOID'}</h3>
              {transition === 'NEXT_ROUND' ? (
                <p className="mt-1 text-ink">
                  <span className="font-bold text-danger">[ELIMINATED]</span> {outcome.eliminatedPlayerIds.map(nameOf).join(', ')} ·{' '}
                  <span className="font-bold text-ok">Survivors:</span> {outcome.survivorIds.map(nameOf).join(', ')}
                </p>
              ) : (
                <p className="mt-1 text-ink">Everyone was eliminated at once. The round restarts with the same players.</p>
              )}
              <p className="mt-1 text-sm text-ink-dim">The next round starts at 0⚡.</p>
            </section>
          )}

          {(transition === 'MATCH_ENDED' || seriesOver) && (
            <section role="status" data-testid="tr-end" className="rounded-lg border-2 border-gold bg-gold/10 p-3 text-center">
              {transition === 'MATCH_ENDED' && outcome?.matchWinnerId && (
                <>
                  <h3 className="font-display text-xl font-black text-gold">🏆 MATCH OVER</h3>
                  <p className="mt-1 text-lg font-bold text-neon">{nameOf(outcome.matchWinnerId)} wins the match! (+1 Match Win)</p>
                </>
              )}
              {seriesOver && (
                <>
                  {outcome?.matchWinnerId && <p className="font-bold text-gold">🏆 {nameOf(outcome.matchWinnerId)} wins the final match (+1 Match Win)</p>}
                  <h3 className="mt-1 font-display text-2xl font-black text-gold">SERIES OVER</h3>
                  <p className="mt-1 text-lg font-bold text-neon">{seriesWinnerId ? nameOf(seriesWinnerId) : 'Nobody'} wins the series!</p>
                </>
              )}
              <ol className="bracket mx-auto mt-2 max-w-xs space-y-0.5 text-left text-sm">
                {ranked.map((id) => (
                  <li key={id} className="flex justify-between">
                    <span>{nameOf(id)}</span>
                    <span className="text-gold">{wins[id] ?? 0} match wins</span>
                  </li>
                ))}
              </ol>
              {!seriesOver && <p className="mt-2 text-sm text-ink-dim">A new match begins with the full lobby.</p>}
            </section>
          )}
        </div>

        <div className="flex justify-end border-t border-edge px-4 py-3 sm:px-6">
          <button
            ref={primary}
            type="button"
            onClick={onPrimary}
            className="rounded-lg bg-neon px-6 py-2 font-bold text-void hover:brightness-110"
            data-testid="tr-next"
          >
            {primaryLabel} <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

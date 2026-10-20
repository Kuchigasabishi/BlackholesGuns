import { useEffect, useMemo, useRef } from 'react';
import { trapTab } from '../a11y';
import { describeBattlefield, describeResolution, type BattleResult } from '../format/describeTurn';
import { RESULT_EMOJI } from '../format/emoji';
import { isAttackerRevealed, planTurn, reactionsAt, shakeTierAt } from '../format/fxPlan';
import { useFx } from '../fx/FxTimeline';
import { useGameState, useStore } from '../hooks';
import { nameLookup, turnModalOpen } from '../state/reducer';
import { avatarFor } from './Avatar';
import { Crumble } from './Crumble';
import { ArenaFX } from './ArenaFX';

const RESULT_STYLE: Record<BattleResult, string> = {
  BLOCKED: 'border-ok bg-ok/15 text-ok',
  REFLECTED: 'border-gold bg-gold/15 text-gold',
  ELIMINATED: 'border-danger bg-danger/15 text-danger',
  NEUTRALIZED: 'border-neon bg-neon/10 text-neon',
  CLASH_WON: 'border-gold bg-gold/15 text-gold',
};
const RESULT_TEXT: Record<BattleResult, string> = {
  BLOCKED: '[BLOCKED]',
  REFLECTED: '[REFLECTED]',
  ELIMINATED: '[ELIMINATED]',
  NEUTRALIZED: '[NEUTRALIZED]',
  CLASH_WON: '[CLASH WON]',
};

const NEXT_LABEL = {
  NEXT_TURN: 'Next turn',
  NEXT_ROUND: 'Next round',
  ROUND_RESTARTED_NO_SURVIVORS: 'Next round',
  MATCH_ENDED: 'Match results',
  SERIES_ENDED: 'Series results',
} as const;

/**
 * The Turn Resolution popup. It takes focus when a turn is revealed so nobody
 * misses the outcome (even zoomed into the controls on a phone), plays the emoji
 * clash on every acting player's card (action emojis pop in, weapons fly card to
 * card, shields clash and deflect, hits shake the victim) and ends with one clear
 * "Next turn" button. It also closes itself when the next turn opens, so it never
 * blocks play. Everything it shows comes from the server's resolution snapshot.
 */
export function TurnResolutionModal() {
  const store = useStore();
  const state = useGameState();
  const { stage, schedule, t } = useFx();
  const { lastResult, game, session } = state;
  const arena = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const visible = turnModalOpen(state);
  const turnId = lastResult?.turnId ?? null;

  useEffect(() => {
    if (!visible) return;
    primary.current?.focus();
    return () => document.getElementById('action-panel')?.focus();
  }, [visible, turnId]);

  const fxPlan = useMemo(() => (lastResult ? planTurn(lastResult) : null), [lastResult]);
  if (!visible || !lastResult || !game || !fxPlan) return null;

  const nameOf = nameLookup(state);
  const { outcome } = lastResult;
  const transition = outcome.transition;
  const cards = describeBattlefield(lastResult, nameOf);
  const breakdown = describeResolution(lastResult, nameOf);
  const playing = stage === 'playing' && schedule !== null; // the timed sequence is still running
  const settled = !playing;
  const animate = playing;
  const reactions = playing ? reactionsAt(schedule, t) : {};
  const shakeTier = playing ? shakeTierAt(schedule, t) : null;
  const dismiss = () => store.dispatch({ type: 'resolutionDismissed', turnId: lastResult.turnId });
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dismiss();
      return;
    }
    trapTab(e, dialog.current);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/85 p-2 sm:p-4" onKeyDown={onKeyDown}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="tr-title" data-testid="turn-resolution" data-shake={shakeTier ?? undefined} className={`${shakeTier ? `anim-shake-t${shakeTier}` : ''} neon-box flex max-h-[95dvh] w-full max-w-3xl flex-col rounded-2xl border-2 border-neon`}>
        <div className="border-b border-edge px-3 py-2 sm:px-6 sm:py-3">
          <h2 id="tr-title" className="font-display text-lg font-black text-neon sm:text-2xl">
            TURN RESOLUTION
          </h2>
        </div>

        <div className="space-y-3 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4">
          {/* The clash arena: every acting player's card, with projectiles flying between them. */}
          <div ref={arena} className="relative" data-testid="clash-arena">
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" data-testid="battlefield">
              {cards.map((c) => {
                const seat = game.series.lobby.indexOf(c.playerId);
                const faceUp = !playing || isAttackerRevealed(schedule, c.playerId, t);
                const react = reactions[c.playerId];
                const hitNow = faceUp && !!react?.hit;
                const clashNow = faceUp && !react?.hit && !!react?.clashEmoji;
                const isYou = c.playerId === session?.playerId;
                return (
                  <li
                    key={c.playerId}
                    data-testid={`bf-${c.playerId}`}
                    data-card-id={c.playerId}
                    data-eliminated={c.eliminated && settled}
                    data-revealed={faceUp}
                    data-fx={hitNow ? 'hit' : clashNow ? 'clash' : undefined}
                    aria-label={faceUp ? `${c.name}${isYou ? ' (you)' : ''}: ${c.label}${c.aimedAt.length ? ` aimed at ${c.aimedAt.join(', ')}` : ''}${c.eliminated ? ', eliminated' : ''}` : `${c.name}: revealing`}
                    className={`relative flex flex-col items-center rounded-xl border-2 bg-void/60 px-1 pb-2 pt-2 text-center ${c.eliminated && settled ? 'border-danger' : 'border-edge'} ${isYou ? 'ring-2 ring-neon' : ''} ${animate && hitNow ? 'anim-fx-hit' : ''} ${animate && clashNow ? 'anim-fx-clash-card' : ''}`}
                  >
                    <p className="w-full truncate text-sm font-bold text-ink">
                      <span aria-hidden="true">{avatarFor(seat)} </span>
                      {c.name}
                      {isYou && <span className="bracket ml-1 text-[10px] text-gold">[YOU]</span>}
                    </p>
                    <Crumble inline crumbling={playing && c.eliminated && faceUp && !!react?.hit}>
                      <span
                        data-testid="bf-action"
                        aria-hidden="true"
                        className={`my-1 inline-block text-5xl leading-none sm:text-6xl ${c.eliminated && settled ? 'grayscale' : ''} ${animate && faceUp ? (c.kind === 'CHARGE' ? 'anim-fx-charge' : 'anim-fx-action') : ''}`}
                      >
                        {faceUp ? c.emoji : '❔'}
                      </span>
                    </Crumble>
                    <p className="bracket text-xs font-bold text-ink">
                      {faceUp ? c.label : '???'}
                      {faceUp && c.timedOut && <span className="ml-1 text-ink-dim">(auto)</span>}
                    </p>
                    {faceUp && c.aimedAt.length > 0 && <p className="bracket text-[11px] text-ink-dim">→ {c.aimedAt.join(', ')}</p>}
                    {clashNow && (
                      <span data-testid={`clash-${c.playerId}`} aria-hidden="true" className="anim-fx-clash pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-6xl">
                        {react?.clashEmoji}
                      </span>
                    )}
                    {hitNow && (
                      <span data-testid={`damage-${c.playerId}`} aria-hidden="true" className="anim-fx-damage pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-danger/40 text-5xl">
                        💥
                      </span>
                    )}
                    {settled && (
                      <ul className="mt-1 w-full space-y-1" data-testid={`bf-results-${c.playerId}`}>
                        {c.incoming.map((h, i) => (
                          <li key={i} className={`bracket rounded border px-1 py-0.5 text-[11px] font-bold ${RESULT_STYLE[h.result]}`}>
                            <span aria-hidden="true">{RESULT_EMOJI[h.result]} </span>
                            {RESULT_TEXT[h.result]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            <ArenaFX container={arena} />
          </div>

          {settled && (
            <details className="rounded-lg border border-edge bg-panel/50 p-3" data-testid="tr-details">
              <summary className="cursor-pointer font-display text-sm font-bold uppercase tracking-wide text-neon-pink">Text breakdown</summary>
              <ul className="mt-2 space-y-1 text-sm" data-testid="tr-targeting">
                {breakdown.targeting.map((line) => (
                  <li key={line} className="font-bold text-ink">
                    {line}
                  </li>
                ))}
                {breakdown.others.map((line) => (
                  <li key={line} className="text-ink-dim">
                    {line}
                  </li>
                ))}
              </ul>
              <ul className="mt-2 space-y-1 text-sm" data-testid="tr-outcomes">
                {breakdown.outcomes.length === 0 && <li className="text-ink-dim">Nothing was hit, blocked or reflected.</li>}
                {breakdown.outcomes.map((o) => (
                  <li key={o.text} className="text-ink">
                    <span className="bracket font-bold">[{o.tag}]</span> {o.text}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {settled && outcome.eliminatedPlayerIds.length > 0 && transition === 'NEXT_TURN' && (
            <p className="bracket text-sm text-ink" data-testid="tr-survivors">
              <span className="font-bold text-danger">[ELIMINATED]</span> {outcome.eliminatedPlayerIds.map(nameOf).join(', ')} · <span className="font-bold text-ok">Still alive:</span>{' '}
              {outcome.survivorIds.map(nameOf).join(', ')}
            </p>
          )}
          {settled && outcome.eliminatedPlayerIds.length === 0 && transition === 'NEXT_TURN' && (
            <p className="bracket text-sm text-ink-dim">No eliminations. No-elimination streak: {outcome.noEliminationStreak}.</p>
          )}

          {settled && transition !== 'NEXT_TURN' && (
            <section role="status" data-testid="tr-end" className="rounded-lg border-2 border-gold bg-gold/10 p-3 text-center">
              {transition === 'NEXT_ROUND' && (
                <p className="text-ink">
                  <strong className="font-display text-gold">🏁 ROUND OVER</strong> · <span className="font-bold text-danger">[ELIMINATED]</span> {outcome.eliminatedPlayerIds.map(nameOf).join(', ')} ·{' '}
                  <span className="font-bold text-ok">Survivors:</span> {outcome.survivorIds.map(nameOf).join(', ')} · next round starts at 0⚡
                </p>
              )}
              {transition === 'ROUND_RESTARTED_NO_SURVIVORS' && (
                <p className="text-ink">
                  <strong className="font-display text-gold">⚠ ROUND VOID</strong> · everyone was eliminated at once; the round restarts with the same players.
                </p>
              )}
              {(transition === 'MATCH_ENDED' || transition === 'SERIES_ENDED') && outcome.matchWinnerId && (
                <p className="text-ink">
                  <strong className="font-display text-gold">🏆 {transition === 'SERIES_ENDED' ? 'FINAL MATCH' : 'MATCH OVER'}</strong> ·{' '}
                  <span className="font-bold text-neon">{nameOf(outcome.matchWinnerId)} wins the match! (+1 Match Win)</span>
                </p>
              )}
            </section>
          )}
        </div>

        <div className="flex justify-end border-t border-edge px-3 py-2 sm:px-6 sm:py-3">
          <button ref={primary} type="button" onClick={dismiss} className="w-full rounded-lg bg-neon px-6 py-3 font-bold text-void hover:brightness-110 sm:w-auto sm:py-2" data-testid="tr-next">
            {NEXT_LABEL[transition]} <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

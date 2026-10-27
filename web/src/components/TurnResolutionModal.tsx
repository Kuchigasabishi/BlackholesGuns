import { useEffect, useMemo, useRef } from 'react';
import { trapTab } from '../a11y';
import { describeBattlefield, describeResolution, type BattleResult } from '../format/describeTurn';
import { RESULT_EMOJI } from '../format/emoji';
import { isAttackerRevealed, planTurn, reactionsAt, shakeTierAt } from '../format/fxPlan';
import { useFx } from '../fx/FxTimeline';
import { useGameState, useStore } from '../hooks';
import { nameLookup, turnModalOpen } from '../state/reducer';
import arrowImpact from '../assets/modal/arrow-impact.svg';
import arrowSmall from '../assets/modal/arrow-small.svg';
import chevronRight from '../assets/modal/chevron-right.svg';
import trophyOutcome from '../assets/modal/trophy-outcome.svg';
import { avatarFor } from './Avatar';
import { ModalShell, PrimaryAction } from './ModalShell';
import { Crumble } from './Crumble';
import { ActionGlyph } from './LottieIcon';
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

  const impactLabel = !settled ? null : fxPlan.projectiles.some((x) => x.end === 'HIT') ? 'HIT' : fxPlan.projectiles.some((x) => x.end === 'BLOCKED') ? 'BLOCKED' : fxPlan.projectiles.some((x) => x.end === 'REFLECTED') ? 'REFLECT' : fxPlan.projectiles.length > 0 ? 'CLASH' : 'NO CONTACT';

  const renderCard = (c: (typeof cards)[number]) => {
    const seat = game.series.lobby.indexOf(c.playerId);
    const faceUp = !playing || isAttackerRevealed(schedule, c.playerId, t);
    const react = reactions[c.playerId];
    const hitNow = faceUp && !!react?.hit;
    const clashNow = faceUp && !react?.hit && !!react?.clashEmoji;
    const isYou = c.playerId === session?.playerId;
    const out = c.eliminated && settled;
    return (
      <li
        key={c.playerId}
        data-testid={`bf-${c.playerId}`}
        data-card-id={c.playerId}
        data-eliminated={out}
        data-revealed={faceUp}
        data-fx={hitNow ? 'hit' : clashNow ? 'clash' : undefined}
        aria-label={faceUp ? `${c.name}${isYou ? ' (you)' : ''}: ${c.label}${c.aimedAt.length ? ` aimed at ${c.aimedAt.join(', ')}` : ''}${c.eliminated ? ', eliminated' : ''}` : `${c.name}: revealing`}
        className={`relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[4px] border bg-[#070d16] ${out ? 'border-[#f18aa3]' : 'border-[#24515e]'} ${animate && hitNow ? 'anim-fx-hit' : ''} ${animate && clashNow ? 'anim-fx-clash-card' : ''}`}
      >
        <div className="flex items-center gap-[10px] border-b border-[#243747] p-[14px]">
          <span aria-hidden="true" className={`flex size-[34px] shrink-0 items-center justify-center rounded-full text-[21px] ${isYou ? 'bg-[#132e37]' : 'bg-[#281c32]'}`}>
            {avatarFor(seat)}
          </span>
          <span className="min-w-0 truncate font-grotesk text-[20px] font-bold text-[#eef6fa]">{c.name}</span>
          {isYou && <span className="rounded-[2px] bg-[#132e37] px-2 py-[5px] font-plex text-[10px] font-semibold text-[#50e3ed]">YOU</span>}
        </div>
        <div className="flex flex-col items-center gap-3 pb-5 pt-6">
          <span className={`flex size-[72px] items-center justify-center rounded-[4px] ${c.kind === 'CHARGE' || out ? 'bg-[#281c32]' : 'bg-[#132e37]'}`}>
            <Crumble inline crumbling={playing && c.eliminated && faceUp && !!react?.hit}>
              <span
                data-testid="bf-action"
                aria-hidden="true"
                className={`inline-flex items-center justify-center text-[38px] leading-none ${out ? 'grayscale' : ''} ${animate && faceUp ? (c.kind === 'CHARGE' ? 'anim-fx-charge' : 'anim-fx-action') : ''}`}
              >
                {faceUp ? <ActionGlyph emoji={c.emoji} trigger={!playing || !fxPlan.projectiles.some((x) => x.to === c.playerId && x.clashEmoji) || !!react?.clashEmoji} className="size-[60px]" /> : '❔'}
              </span>
            </Crumble>
          </span>
          <p className="max-w-full truncate px-2 font-grotesk text-[clamp(20px,4vw,28px)] font-bold leading-none text-[#eef6fa]">
            {faceUp ? c.label : '???'}
            {faceUp && c.timedOut && <span className="ml-1 font-plex text-[10px] font-normal text-[#91a5b6]">(auto)</span>}
          </p>
          <div className="flex min-h-7 flex-wrap items-center justify-center gap-2 px-2">
            {faceUp && c.aimedAt.length > 0 && (
              <span className="flex items-center gap-2 font-plex text-[12px] text-[#91a5b6]">
                <img src={arrowSmall} alt="" aria-hidden="true" className="size-[14px]" />
                {c.aimedAt.join(', ')}
              </span>
            )}
            {settled && (
              <ul className="flex flex-wrap justify-center gap-1" data-testid={`bf-results-${c.playerId}`}>
                {c.incoming.map((h, i) => (
                  <li key={i} className={`rounded-[2px] border px-2 py-[5px] font-plex text-[10px] font-semibold ${RESULT_STYLE[h.result]}`}>
                    <span aria-hidden="true">{RESULT_EMOJI[h.result]} </span>
                    {RESULT_TEXT[h.result]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {clashNow && (
          <span data-testid={`clash-${c.playerId}`} aria-hidden="true" className="anim-fx-clash pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-6xl">
            <ActionGlyph emoji={react?.clashEmoji ?? ''} trigger className="size-20" />
          </span>
        )}
        {hitNow && (
          <span data-testid={`damage-${c.playerId}`} aria-hidden="true" className="anim-fx-damage pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-danger/40 text-5xl">
            💥
          </span>
        )}
      </li>
    );
  };

  return (
    <ModalShell
      dialogRef={dialog}
      testId="turn-resolution"
      titleId="tr-title"
      tag="[ REVEAL_ ]"
      title="Turn Resolution"
      onKeyDown={onKeyDown}
      panelClassName={shakeTier ? `anim-shake-t${shakeTier}` : ''}
      panelData={{ 'data-shake': shakeTier ? String(shakeTier) : undefined }}
      footer={<PrimaryAction buttonRef={primary} label={NEXT_LABEL[transition]} onClick={dismiss} testId="tr-next" />}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 font-plex text-[11px] leading-[1.4]">
        <p className="text-[#50e3ed]">{playing ? 'REVEALING ACTIONS' : 'ALL ACTIONS REVEALED'}</p>
        <p className="text-[#91a5b6]">SIMULTANEOUS RESOLVE</p>
      </div>

      {/* The clash arena: every acting player's card side by side, with projectiles flying between them. */}
      <div ref={arena} className="relative" data-testid="clash-arena">
        <ul className={cards.length === 2 ? 'flex flex-col items-stretch gap-4 sm:flex-row sm:items-center' : 'grid gap-4 sm:grid-cols-2'} data-testid="battlefield">
          {cards.length === 2 ? (
            <>
              {renderCard(cards[0]!)}
              <li aria-hidden="true" className="flex shrink-0 flex-row items-center justify-center gap-2 sm:w-10 sm:flex-col" data-testid="impact-connector">
                <img src={arrowImpact} alt="" className="size-[26px] rotate-90 sm:rotate-0" />
                <span className="font-plex text-[9px] text-[#f18aa3]">{impactLabel ?? '···'}</span>
              </li>
              {renderCard(cards[1]!)}
            </>
          ) : (
            cards.map(renderCard)
          )}
        </ul>
        <ArenaFX container={arena} />
      </div>

      {settled && (
        <details className="group rounded-[4px] border border-[#243747]" data-testid="tr-details">
          <summary className="flex h-[52px] cursor-pointer list-none items-center gap-3 px-4 font-plex text-[12px] text-[#d37bc6] [&::-webkit-details-marker]:hidden">
            <img src={chevronRight} alt="" aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" />
            Text Breakdown
          </summary>
          <div className="space-y-3 border-t border-[#243747] p-4">
            <ul className="space-y-1 text-sm" data-testid="tr-targeting">
              {breakdown.targeting.map((line) => (
                <li key={line} className="font-bold text-[#eef6fa]">
                  {line}
                </li>
              ))}
              {breakdown.others.map((line) => (
                <li key={line} className="text-[#91a5b6]">
                  {line}
                </li>
              ))}
            </ul>
            <ul className="space-y-1 text-sm" data-testid="tr-outcomes">
              {breakdown.outcomes.length === 0 && <li className="text-[#91a5b6]">Nothing was hit, blocked or reflected.</li>}
              {breakdown.outcomes.map((o) => (
                <li key={o.text} className="text-[#eef6fa]">
                  <span className="font-plex font-bold">[{o.tag}]</span> {o.text}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {settled && outcome.eliminatedPlayerIds.length > 0 && transition === 'NEXT_TURN' && (
        <p className="font-plex text-[12px] text-[#eef6fa]" data-testid="tr-survivors">
          <span className="font-bold text-[#f18aa3]">[ELIMINATED]</span> {outcome.eliminatedPlayerIds.map(nameOf).join(', ')} · <span className="font-bold text-[#8ce5b4]">Still alive:</span>{' '}
          {outcome.survivorIds.map(nameOf).join(', ')}
        </p>
      )}
      {settled && outcome.eliminatedPlayerIds.length === 0 && transition === 'NEXT_TURN' && (
        <p className="font-plex text-[12px] text-[#91a5b6]">No eliminations. No-elimination streak: {outcome.noEliminationStreak}.</p>
      )}

      {settled && transition !== 'NEXT_TURN' && (
        <section role="status" data-testid="tr-end" className="flex items-center gap-4 rounded-[4px] border border-[#24515e] bg-[#132e37] p-5">
          <img src={trophyOutcome} alt="" aria-hidden="true" className="size-7 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
            {transition === 'NEXT_ROUND' && (
              <>
                <p className="font-plex text-[11px] leading-[1.4] text-[#50e3ed]">ROUND OVER</p>
                <p className="font-inter text-[14px] leading-[1.5] text-[#eef6fa]">
                  <span className="font-bold text-[#f18aa3]">[ELIMINATED]</span> {outcome.eliminatedPlayerIds.map(nameOf).join(', ')} · <span className="font-bold text-[#8ce5b4]">Survivors:</span>{' '}
                  {outcome.survivorIds.map(nameOf).join(', ')} · next round starts at 0⚡
                </p>
              </>
            )}
            {transition === 'ROUND_RESTARTED_NO_SURVIVORS' && (
              <>
                <p className="font-plex text-[11px] leading-[1.4] text-[#50e3ed]">ROUND VOID</p>
                <p className="font-inter text-[14px] text-[#eef6fa]">Everyone was eliminated at once; the round restarts with the same players.</p>
              </>
            )}
            {(transition === 'MATCH_ENDED' || transition === 'SERIES_ENDED') && outcome.matchWinnerId && (
              <>
                <p className="font-plex text-[11px] leading-[1.4] text-[#50e3ed]">{transition === 'SERIES_ENDED' ? 'FINAL MATCH' : 'MATCH OVER'}</p>
                <p className="font-grotesk text-[clamp(20px,4vw,24px)] font-bold leading-tight text-[#eef6fa]">{nameOf(outcome.matchWinnerId)} wins the match!</p>
              </>
            )}
          </div>
          {(transition === 'MATCH_ENDED' || transition === 'SERIES_ENDED') && outcome.matchWinnerId && <p className="shrink-0 font-plex text-[12px] text-[#50e3ed]">+1 Match Win</p>}
        </section>
      )}
    </ModalShell>
  );
}

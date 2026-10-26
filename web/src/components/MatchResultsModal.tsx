import { useEffect, useRef, useState } from 'react';
import { trapTab } from '../a11y';
import timer from '../assets/modal/timer.svg';
import trophy from '../assets/modal/trophy-match.svg';
import { ModalShell, PrimaryAction, StandingRow } from './ModalShell';
import { useFx } from '../fx/FxTimeline';
import { useGameState } from '../hooks';
import { nameLookup, turnModalOpen } from '../state/reducer';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * "Match Results & Series Standings" (§2, §15). Shown after the turn-resolution
 * modal whenever a turn ended a match (not the whole series, which has its own
 * result). Standings are read from the server-authoritative snapshot
 * (`game.series.matchWins`). The server has already opened the next match, so
 * "Start Next Match" only acknowledges the results and returns to play.
 */
export function MatchResultsModal() {
  const state = useGameState();
  const { lastResult, game, session } = state;
  const { stage } = useFx();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  const outcome = lastResult?.outcome ?? null;
  const turnId = outcome?.turnId ?? null;
  const visible = game !== null && outcome?.transition === 'MATCH_ENDED' && !!outcome.matchWinnerId && dismissed !== turnId && stage === 'settled' && !turnModalOpen(state);

  useEffect(() => {
    if (!visible) return;
    primary.current?.focus();
    return () => document.getElementById('action-panel')?.focus();
  }, [visible, turnId]);

  if (!visible || !game || !outcome) return null;
  const nameOf = nameLookup(state);
  const wins = game.series.matchWins;
  const winnerId = outcome.matchWinnerId!;
  const ranked = [...game.series.lobby].sort((a, b) => (wins[b] ?? 0) - (wins[a] ?? 0));

  // Competition ranking: players on equal wins share a place.
  const places: number[] = [];
  ranked.forEach((id, i) => places.push(i > 0 && wins[id] === wins[ranked[i - 1]!] ? places[i - 1]! : i + 1));

  const topWins = wins[ranked[0]!] ?? 0;
  const leaders = ranked.filter((id) => (wins[id] ?? 0) === topWins);
  const target = game.series.seriesWinTarget;
  const needed = Math.max(0, target - topWins);
  const leaderLine =
    leaders.length === 1
      ? `${nameOf(leaders[0]!)} is leading the series and needs ${plural(needed, 'more win')} to win the series!`
      : `${leaders.map(nameOf).join(' and ')} are tied for the lead and each need ${plural(needed, 'more win')} to win the series!`;
  const eligible = session !== null && game.series.lobby.includes(session.playerId);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setDismissed(turnId);
      return;
    }
    trapTab(e, dialog.current);
  };

  return (
    <ModalShell
      dialogRef={dialog}
      testId="match-results"
      titleId="mr-title"
      tag="[ RESULTS_ ]"
      title="Match Results & Series Standings"
      onKeyDown={onKeyDown}
      footer={<PrimaryAction buttonRef={primary} label="Start Next Match" onClick={() => setDismissed(turnId)} testId="mr-start" disabled={!eligible} />}
    >
      <div className="flex flex-wrap items-center gap-[18px]">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-[4px] border border-[#24515e] bg-[#132e37]">
          <img src={trophy} alt="" aria-hidden="true" className="size-[30px]" />
        </span>
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-[7px]">
          <p className="font-plex text-[11px] leading-[1.4] text-[#50e3ed]">MATCH COMPLETE</p>
          <p className="font-grotesk text-[clamp(24px,5vw,32px)] font-bold leading-tight text-[#eef6fa]" data-testid="mr-winner">
            {nameOf(winnerId)} won the match!
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1 bg-[#132e37] px-[14px] py-3 text-[#50e3ed]">
          <span className="font-grotesk text-[28px] font-bold leading-none">+1</span>
          <span className="font-plex text-[11px]">MATCH WIN</span>
        </div>
      </div>

      <hr className="border-0 border-t border-[#243747]" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-grotesk text-[21px] font-bold text-[#eef6fa]">Series standings</h3>
        <p className="font-plex text-[11px] uppercase text-[#91a5b6]">First to {target} Match Wins</p>
      </div>
      <ol className="flex flex-col gap-[10px]" data-testid="mr-standings" aria-label={`Series standings, first to ${target} Match Wins`}>
        {ranked.map((id, i) => {
          const justWon = id === winnerId;
          const isLeader = (wins[id] ?? 0) === topWins;
          return (
            <StandingRow
              key={id}
              testId={`mr-row-${id}`}
              data={{ 'data-match-winner': justWon, 'data-leader': isLeader }}
              rank={places[i]!}
              name={nameOf(id)}
              tag={justWon && isLeader ? 'MATCH WINNER / LEADER' : justWon ? 'MATCH WINNER' : isLeader ? 'LEADER' : undefined}
              you={id === session?.playerId}
              wins={wins[id] ?? 0}
              target={target}
              highlight={justWon || isLeader}
              scoreLabel={(wins[id] ?? 0) === 1 ? 'WIN' : 'WINS'}
            />
          );
        })}
      </ol>

      <div className="flex items-center gap-3">
        <span className="h-[38px] w-[3px] shrink-0 bg-[#50e3ed]" aria-hidden="true" />
        <p role="status" className="font-inter text-[14px] leading-[1.6] text-[#50e3ed]" data-testid="mr-leader-line">
          {leaderLine}
        </p>
      </div>

      <div className="flex gap-3 rounded-[4px] border border-[#243747] bg-[#070d16] p-4">
        <img src={timer} alt="" aria-hidden="true" className="size-5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-[6px]">
          <p className="font-plex text-[11px] leading-[1.4] text-[#d37bc6]">COMMIT TIMER ALREADY RUNNING</p>
          <p className="font-inter text-[13px] leading-[1.6] text-[#91a5b6]">The next match has a full lobby and starts at 0 ⚡. Its commit timer is already running.</p>
        </div>
      </div>
    </ModalShell>
  );
}

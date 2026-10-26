import { useEffect, useRef } from 'react';
import { trapTab } from '../a11y';
import celebrationGrid from '../assets/modal/celebration-grid.svg';
import championEmblem from '../assets/modal/champion-emblem.svg';
import checkCircle from '../assets/modal/check-circle.svg';
import { useFx } from '../fx/FxTimeline';
import { rankStandings } from '../format/standings';
import { useGameState, useStore } from '../hooks';
import { nameLookup, turnModalOpen } from '../state/reducer';
import { ModalShell, PrimaryAction, StandingRow } from './ModalShell';

/**
 * "Series Over", the grand finale (from the Figma modal frame): the series champion up top, the final standings with one
 * progress segment per win of the host's target, and a single "Return to lobby" action. It waits for the last turn's
 * animation and popup, and everyone is routed back to the waiting lobby (scores are discarded with the finished game).
 */
export function SeriesResultModal() {
  const store = useStore();
  const state = useGameState();
  const { stage } = useFx();
  const { seriesEnd, game, lastResult, session } = state;
  const dialog = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const visible = seriesEnd !== null && game !== null && stage === 'settled' && !turnModalOpen(state);

  useEffect(() => {
    if (visible) primary.current?.focus();
  }, [visible]);

  if (!visible || !seriesEnd || !game) return null;
  const nameOf = nameLookup(state);
  const wins = seriesEnd.matchWins;
  const rows = rankStandings(game.series.lobby, wins);
  const target = game.series.seriesWinTarget;
  const finalWinner = lastResult?.outcome.matchWinnerId ?? null;
  const champion = seriesEnd.winnerId;
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
    <ModalShell
      dialogRef={dialog}
      testId="series-result"
      titleId="sr-title"
      tag="[ COMPLETE_ ]"
      title="Series Over"
      onKeyDown={onKeyDown}
      footer={<PrimaryAction buttonRef={primary} label="Return to lobby" onClick={close} testId="sr-return" />}
    >
      {finalWinner && (
        <div className="flex items-center gap-3 rounded-[4px] border border-[#243747] bg-[#070d16] px-4 py-[13px]">
          <img src={checkCircle} alt="" aria-hidden="true" className="size-[18px] shrink-0" />
          <p className="min-w-0 flex-1 font-inter text-[14px] text-[#eef6fa]">{nameOf(finalWinner)} wins the final match</p>
          <p className="shrink-0 font-plex text-[12px] text-[#50e3ed]">+1 Match Win</p>
        </div>
      )}

      <div className="relative flex flex-col items-center gap-3 overflow-hidden py-2 text-center">
        <img src={celebrationGrid} alt="" aria-hidden="true" className="pointer-events-none absolute inset-x-[16%] top-[22%] w-[68%] max-w-none opacity-80" />
        <span className="relative flex size-28 items-center justify-center" aria-hidden="true">
          <img src={championEmblem} alt="" className="absolute -inset-[12.5%] size-[125%] max-w-none" />
        </span>
        <p className="relative font-plex text-[11px] leading-[1.4] text-[#50e3ed]">SERIES CHAMPION</p>
        <p className="relative font-grotesk text-[clamp(28px,6vw,40px)] font-bold leading-tight text-[#eef6fa]" data-testid="sr-winner">
          {champion ? nameOf(champion) : 'Nobody'} wins the series!
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-grotesk text-[21px] font-bold text-[#eef6fa]">Final standings</h3>
        <p className="font-plex text-[11px] text-[#91a5b6]">SERIES TARGET REACHED</p>
      </div>
      <ol className="flex flex-col gap-[10px]" data-testid="sr-standings" aria-label={`Final standings, first to ${target} Match Wins`}>
        {rows.map((r) => (
          <StandingRow
            key={r.playerId}
            testId={`sr-row-${r.playerId}`}
            rank={r.place}
            name={nameOf(r.playerId)}
            tag={r.playerId === champion ? 'SERIES WINNER' : undefined}
            you={r.playerId === session?.playerId}
            wins={r.wins}
            target={target}
            highlight={r.playerId === champion}
            scoreLabel={r.wins === 1 ? 'MATCH WIN' : 'MATCH WINS'}
          />
        ))}
      </ol>
    </ModalShell>
  );
}

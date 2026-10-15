import { useEffect, useRef, useState } from 'react';
import { trapTab } from '../a11y';
import { useFx } from '../fx/FxTimeline';
import { useGameState } from '../hooks';
import { nameLookup, turnModalOpen } from '../state/reducer';

const ORDINAL = ['1st', '2nd', '3rd'];
const ordinal = (n: number) => ORDINAL[n - 1] ?? `${n}th`;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/85 p-2 sm:p-4" onKeyDown={onKeyDown}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mr-title"
        data-testid="match-results"
        className="neon-box flex max-h-[95vh] w-full max-w-xl flex-col rounded-2xl border-2 border-gold"
      >
        <div className="border-b border-edge px-4 py-3 text-center sm:px-6">
          <h2 id="mr-title" className="font-display text-xl font-black text-gold sm:text-2xl">
            🏆 MATCH RESULTS &amp; SERIES STANDINGS
          </h2>
          <p className="mt-1 text-lg font-bold text-neon" data-testid="mr-winner">
            {nameOf(winnerId)} won the match! (+1 Match Win)
          </p>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
          <ol className="space-y-2" data-testid="mr-standings" aria-label={`Series standings, first to ${target} Match Wins`}>
            {ranked.map((id, i) => {
              const justWon = id === winnerId;
              const isLeader = (wins[id] ?? 0) === topWins;
              return (
                <li
                  key={id}
                  data-testid={`mr-row-${id}`}
                  data-match-winner={justWon}
                  data-leader={isLeader}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                    justWon ? 'border-gold bg-gold/15 font-bold' : 'border-edge bg-panel/50'
                  }`}
                >
                  <span className="truncate">
                    {ordinal(places[i]!)}: {nameOf(id)}
                    {id === session?.playerId && <span className="bracket ml-1 text-xs text-gold">[YOU]</span>}
                    {justWon && <span className="bracket ml-2 text-xs text-gold">🏆 [MATCH WINNER]</span>}
                    {isLeader && <span className="bracket ml-2 text-xs text-neon">👑 [LEADER]</span>}
                  </span>
                  <span className="bracket shrink-0 text-gold"> — {plural(wins[id] ?? 0, 'Win')}</span>
                </li>
              );
            })}
          </ol>
          <p role="status" className="rounded-lg border border-neon bg-neon/10 p-3 text-center font-bold text-neon" data-testid="mr-leader-line">
            {leaderLine}
          </p>
          <p className="text-center text-sm text-ink-dim">The next match has a full lobby and starts at 0⚡. Its commit timer is already running.</p>
        </div>

        <div className="flex justify-end border-t border-edge px-4 py-3 sm:px-6">
          <button
            ref={primary}
            type="button"
            disabled={!eligible}
            onClick={() => setDismissed(turnId)}
            className="rounded-lg bg-neon px-6 py-2 font-bold text-void hover:brightness-110 disabled:opacity-50"
            data-testid="mr-start"
          >
            Start Next Match <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

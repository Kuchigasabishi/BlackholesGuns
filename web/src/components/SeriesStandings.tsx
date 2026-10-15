import { rankStandings } from '../format/standings';
import { useGameState } from '../hooks';
import { nameLookup } from '../state/reducer';

/**
 * Live "Series Standings" leaderboard. It reads `game.series.matchWins` from the
 * server-authoritative snapshot, so it re-sorts the moment a match result arrives.
 */
export function SeriesStandings() {
  const state = useGameState();
  const { game, session } = state;
  if (!game) return null;
  const nameOf = nameLookup(state);
  const rows = rankStandings(game.series.lobby, game.series.matchWins);
  const target = game.series.seriesWinTarget;

  return (
    <aside className="neon-box h-fit rounded-2xl p-4" aria-labelledby="standings-h" data-testid="series-standings">
      <h2 id="standings-h" className="font-display text-neon">
        [ SERIES STANDINGS ]
      </h2>
      <p className="bracket mt-1 text-xs text-ink-dim">First to {target} Match Wins</p>
      <ol className="mt-3 space-y-2" aria-label="Players ranked by Match Wins">
        {rows.map((r) => (
          <li
            key={r.playerId}
            data-testid={`standing-${r.playerId}`}
            data-place={r.place}
            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${r.place === 1 && r.wins > 0 ? 'border-gold bg-gold/10 font-bold' : 'border-edge bg-panel/50'}`}
          >
            <span className="truncate">
              {r.place === 1 && r.wins > 0 && <span aria-hidden="true">👑 </span>}
              {r.label}: {nameOf(r.playerId)}
              {r.playerId === session?.playerId && <span className="bracket ml-1 text-xs text-gold">[YOU]</span>}
            </span>
            <span className="bracket shrink-0 text-gold">
              ({r.wins} {r.wins === 1 ? 'Win' : 'Wins'})
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

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
        {rows.map((r) => {
          // "On Fire": the server's own streak counter. 2 = glowing orange aura, 3+ = burning flames.
          const streak = game.players[r.playerId]?.currentMatchStreak ?? 0;
          const fire = streak >= 3 ? 'fire-3' : streak === 2 ? 'fire-2' : '';
          return (
          <li
            key={r.playerId}
            data-testid={`standing-${r.playerId}`}
            data-place={r.place}
            data-streak={streak}
            data-fire={fire || undefined}
            className={`relative flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${fire ? `fire-row ${fire}` : ''} ${r.place === 1 && r.wins > 0 ? 'border-gold bg-gold/10 font-bold' : 'border-edge bg-panel/50'}`}
          >
            {streak >= 3 && (
              <>
                <span aria-hidden="true" data-testid={`flames-${r.playerId}`} className="flame flame-a" />
                <span aria-hidden="true" className="flame flame-b" />
              </>
            )}
            <span className="truncate">
              {r.place === 1 && r.wins > 0 && <span aria-hidden="true">👑 </span>}
              {r.label}: {nameOf(r.playerId)}
              {r.playerId === session?.playerId && <span className="bracket ml-1 text-xs text-gold">[YOU]</span>}
              {streak >= 2 && (
                <span className="bracket ml-2 text-xs text-[#ff9a3c]" data-testid={`streak-${r.playerId}`}>
                  <span aria-hidden="true">🔥 </span>
                  {streak >= 3 ? 'ON FIRE' : 'HEATING UP'} · {streak}-win streak
                </span>
              )}
            </span>
            <span className="bracket shrink-0 text-gold">
              ({r.wins} {r.wins === 1 ? 'Win' : 'Wins'})
            </span>
          </li>
          );
        })}
      </ol>
    </aside>
  );
}

import trophy from '../assets/ui/trophy.svg';
import { rankStandings } from '../format/standings';
import { useGameState } from '../hooks';
import { nameLookup } from '../state/reducer';

/**
 * Live "Series standings" card (from the match design). It reads `game.series.matchWins` from the
 * server-authoritative snapshot, so it re-sorts the moment a match result arrives. Each row also shows a
 * progress strip with one segment per win needed; segments fill as wins are earned. A streak of 2 / 3+ wins
 * lights the "On Fire" aura on the row.
 */
export function SeriesStandings() {
  const state = useGameState();
  const { game, session } = state;
  if (!game) return null;
  const nameOf = nameLookup(state);
  const rows = rankStandings(game.series.lobby, game.series.matchWins);
  const target = game.series.seriesWinTarget;

  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-[#243747] bg-[#0c1420] p-5" aria-labelledby="standings-h" data-testid="series-standings">
      <div className="flex items-center justify-between">
        <h2 id="standings-h" className="font-grotesk text-[22px] font-bold leading-none text-[#eef6fa]">
          Series standings
        </h2>
        <img src={trophy} alt="" aria-hidden="true" className="size-[18px]" />
      </div>
      <p className="font-plex text-[10px] uppercase text-[#91a5b6]">First to {target} Match Wins</p>
      <ol className="flex flex-col gap-[14px]" aria-label="Players ranked by Match Wins">
        {rows.map((r) => {
          // "On Fire": the server's own streak counter. 2 = glowing orange aura, 3+ = burning flames.
          const streak = game.players[r.playerId]?.currentMatchStreak ?? 0;
          const fire = streak >= 3 ? 'fire-3' : streak === 2 ? 'fire-2' : '';
          const leading = r.place === 1 && r.wins > 0;
          return (
            <li
              key={r.playerId}
              data-testid={`standing-${r.playerId}`}
              data-place={r.place}
              data-streak={streak}
              data-fire={fire || undefined}
              className={`relative flex flex-col gap-[10px] rounded-[4px] ${fire ? `fire-row ${fire} px-2 py-1.5` : ''}`}
            >
              {streak >= 3 && (
                <>
                  <span aria-hidden="true" data-testid={`flames-${r.playerId}`} className="flame flame-a" />
                  <span aria-hidden="true" className="flame flame-b" />
                </>
              )}
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate font-inter text-[13px] text-[#eef6fa]">
                  {leading && <span aria-hidden="true">👑 </span>}
                  <span className="font-plex text-[10px] text-[#91a5b6]">{r.label}: </span>
                  {nameOf(r.playerId)}
                  {r.playerId === session?.playerId && <span className="ml-1 font-plex text-[10px] text-[#50e3ed]">[YOU]</span>}
                  {streak >= 2 && (
                    <span className="ml-2 font-plex text-[10px] text-[#ff9a3c]" data-testid={`streak-${r.playerId}`}>
                      <span aria-hidden="true">🔥 </span>
                      {streak >= 3 ? 'ON FIRE' : 'HEATING UP'} · {streak}-win streak
                    </span>
                  )}
                </p>
                <p className="shrink-0 font-plex text-[12px] text-[#91a5b6]">
                  {r.wins} {r.wins === 1 ? 'Win' : 'Wins'}
                </p>
              </div>
              <div className="flex gap-1" aria-hidden="true" data-testid={`progress-${r.playerId}`}>
                {Array.from({ length: target }, (_, i) => (
                  <span key={i} data-filled={i < r.wins || undefined} className={`h-1 min-w-px flex-1 ${i < r.wins ? 'bg-[#50e3ed]' : 'bg-[#243747]'}`} />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

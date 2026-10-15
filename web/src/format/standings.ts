import type { PlayerId } from '../../../src/engine';

export interface StandingRow {
  readonly playerId: PlayerId;
  readonly wins: number;
  /** Competition ranking: players on equal wins share a place. */
  readonly place: number;
  /** "1st", "2nd", ... */
  readonly label: string;
}

const ORDINAL = ['1st', '2nd', '3rd'];
export const ordinal = (n: number): string => ORDINAL[n - 1] ?? `${n}th`;

/** Sorts the lobby from most to fewest Match Wins (ties keep seat order) and assigns places. */
export function rankStandings(lobby: readonly PlayerId[], matchWins: Readonly<Record<PlayerId, number>>): StandingRow[] {
  const sorted = lobby.map((playerId, seat) => ({ playerId, seat, wins: matchWins[playerId] ?? 0 })).sort((a, b) => b.wins - a.wins || a.seat - b.seat);
  const rows: StandingRow[] = [];
  sorted.forEach((p, i) => {
    const place = i > 0 && p.wins === sorted[i - 1]!.wins ? rows[i - 1]!.place : i + 1;
    rows.push({ playerId: p.playerId, wins: p.wins, place, label: ordinal(place) });
  });
  return rows;
}

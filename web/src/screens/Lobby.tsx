import { useEffect, useRef, useState } from 'react';
import { SERIES_WIN_TARGET, SERIES_WIN_TARGET_OPTIONS } from '../../../src/engine';
import { Avatar } from '../components/Avatar';
import { useGameState, useStore } from '../hooks';

const SLOTS = 8;

export function LobbyScreen() {
  const store = useStore();
  const { lobby, session, error } = useGameState();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!lobby || !session) return null;

  const isHost = lobby.hostId === session.playerId;
  const count = lobby.players.length;
  const canStart = isHost && count >= lobby.minPlayers;

  const copy = async (what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'code' ? lobby.roomCode : lobby.inviteUrl);
      setCopied(what);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null); // clipboard blocked: the text is still selectable on screen
    }
  };

  return (
    <main id="main" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-display text-3xl font-black text-neon">Lobby</h1>

      <section className="neon-box mt-6 rounded-2xl p-6" aria-labelledby="invite-h">
        <h2 id="invite-h" className="text-sm uppercase tracking-widest text-ink-dim">
          Room code
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <p data-testid="room-code" className="bracket text-5xl font-black tracking-[0.3em] text-gold" aria-label={`Room code ${lobby.roomCode.split('').join(' ')}`}>
            {lobby.roomCode}
          </p>
          <button type="button" onClick={() => copy('code')} className="rounded-lg border border-neon px-4 py-2 text-neon hover:bg-neon/10">
            {copied === 'code' ? 'Copied!' : 'Copy code'}
          </button>
        </div>

        <h3 className="mt-6 text-sm uppercase tracking-widest text-ink-dim">Invite link</h3>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            readOnly
            aria-label="Invite link"
            value={lobby.inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="bracket min-w-0 flex-1 rounded-lg border border-edge bg-void px-3 py-2 text-ink"
          />
          <button type="button" onClick={() => copy('link')} className="rounded-lg border border-neon px-4 py-2 text-neon hover:bg-neon/10">
            {copied === 'link' ? 'Copied!' : 'Copy link'}
          </button>
        </div>
        <p role="status" className="sr-only">
          {copied ? `${copied === 'code' ? 'Room code' : 'Invite link'} copied to clipboard` : ''}
        </p>
      </section>

      <section className="mt-8" aria-labelledby="roster-h">
        <div className="flex items-baseline justify-between">
          <h2 id="roster-h" className="font-display text-xl text-neon-pink">
            Players
          </h2>
          <p data-testid="player-count" className="bracket text-ink-dim">
            {count} / {SLOTS} players · minimum {lobby.minPlayers}
          </p>
        </div>

        <ul className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Waiting roster">
          {Array.from({ length: SLOTS }, (_, seat) => {
            const player = lobby.players[seat];
            return (
              <li
                key={seat}
                className={`neon-box flex items-center gap-4 rounded-xl p-3 ${player ? '' : 'opacity-50'}`}
                style={player ? undefined : { borderStyle: 'dashed' }}
              >
                {player ? <Avatar seat={seat} playerId={player.playerId} eliminated={false} /> : <div className="h-20 w-20 rounded-full border-2 border-dashed border-edge" aria-hidden="true" />}
                <div className="min-w-0">
                  {player ? (
                    <>
                      <p className="truncate text-lg font-bold">
                        {player.displayName}
                        {player.playerId === session.playerId && <span className="bracket ml-2 text-gold">[YOU]</span>}
                      </p>
                      <p className="bracket text-sm">
                        {player.playerId === lobby.hostId && <span className="mr-2 text-gold">[HOST]</span>}
                        {player.connected ? <span className="text-ok">● CONNECTED</span> : <span className="text-danger">○ OFFLINE</span>}
                      </p>
                    </>
                  ) : (
                    <p className="text-ink-dim">Waiting for player {seat + 1}…</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {error && (
        <p role="alert" className="mt-6 rounded-lg border border-danger bg-danger/10 px-4 py-3 text-danger">
          <span className="bracket font-bold">[ERROR]</span> {error}
        </p>
      )}

      <section className="mt-8" aria-labelledby="target-h">
        <label id="target-h" htmlFor="series-target" className="font-display text-xl text-neon-pink">
          Series Win Target
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <select
            id="series-target"
            data-testid="series-target"
            value={lobby.seriesWinTarget}
            disabled={!isHost}
            onChange={(e) => void store.setSeriesTarget(Number(e.target.value))}
            className="rounded-lg border border-edge bg-void px-3 py-2 text-ink disabled:opacity-60"
          >
            {SERIES_WIN_TARGET_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} Wins{n === SERIES_WIN_TARGET ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <p className="text-sm text-ink-dim">{isHost ? 'First player to this many Match Wins wins the series. Locked once you start.' : `The host set this to ${lobby.seriesWinTarget} Match Wins.`}</p>
        </div>
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        {isHost ? (
          <button
            type="button"
            onClick={() => {
              if (canStart) void store.startGame();
            }}
            aria-disabled={!canStart}
            aria-describedby="start-hint"
            className={`rounded-lg px-8 py-3 text-lg font-black ${canStart ? 'bg-ok text-void hover:brightness-110' : 'cursor-not-allowed bg-ok/30 text-ink-dim'}`}
          >
            Start game
          </button>
        ) : (
          <p className="text-ink-dim">Waiting for the host to start…</p>
        )}
        <button type="button" onClick={() => void store.leaveRoom()} className="rounded-lg border border-edge px-6 py-3 text-ink-dim hover:text-ink">
          Leave room
        </button>
        <p id="start-hint" className="text-sm text-ink-dim">
          {isHost ? (canStart ? 'Everyone here will play. Joining closes once you start.' : `Need ${lobby.minPlayers - count} more player${lobby.minPlayers - count === 1 ? '' : 's'} to start.`) : ''}
        </p>
      </div>
    </main>
  );
}

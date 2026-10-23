import { useEffect, useRef, useState } from 'react';
import { SERIES_WIN_TARGET, SERIES_WIN_TARGET_OPTIONS } from '../../../src/engine';
import chevronDown from '../assets/ui/chevron-down.svg';
import copyIcon from '../assets/ui/copy.svg';
import info from '../assets/ui/info.svg';
import linkIcon from '../assets/ui/link.svg';
import lockSmall from '../assets/ui/lock-small.svg';
import lockStart from '../assets/ui/lock-start.svg';
import logOut from '../assets/ui/log-out.svg';
import statusDot from '../assets/ui/status-dot.svg';
import trophy from '../assets/ui/trophy.svg';
import userRound from '../assets/ui/user-round.svg';
import onlineIndicator from '../assets/landing/online-indicator.svg';
import { avatarFor, ringFor } from '../components/Avatar';
import { ArenaScene, SystemFooter } from '../components/ArenaScene';
import { SeriesResultModal } from '../components/SeriesResultModal';
import { NoticeBar } from './Game';
import { useGameState, useStore } from '../hooks';

const SLOTS = 8;

/**
 * The waiting room, from the Figma "Waiting room" frame: room code + invite link on the left, the 8-slot roster,
 * Series Win Target and Start / Leave on the right. All data is the server's lobby snapshot; the host-only controls
 * (series target, start, kick) are unchanged.
 */
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

  const control = 'flex h-11 items-center justify-center gap-[10px] rounded-[4px] border px-4 font-inter text-[13px] font-semibold';

  return (
    <>
      <main id="main" className="mx-auto flex max-w-[1440px] flex-col gap-7 px-4 py-9 sm:px-8 lg:px-14">
        <SeriesResultModal />
        <NoticeBar />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-[10px]">
            <p className="font-plex text-[11px] text-[#50e3ed]">BLACKHOLES &amp; GUNS / PRIVATE ROOM</p>
            <h1 className="font-grotesk text-[clamp(32px,6vw,46px)] font-bold leading-none text-[#eef6fa]">
              Lobby <span className="text-[#546b7d]">/ Stand by.</span>
            </h1>
          </div>
          <p className="flex items-start gap-2 rounded-[4px] border border-[#153744] bg-[#132e37] px-[14px] py-[10px] font-plex text-[10px] text-[#50e3ed]" role="status">
            <img src={statusDot} alt="" aria-hidden="true" className="mt-[3px] size-[6px]" />
            {count >= lobby.minPlayers ? 'READY TO START' : 'WAITING FOR PLAYERS'}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[416px_minmax(0,1fr)]">
          {/* ------------------------------------------------------------ invite console */}
          <div className="flex min-w-0 flex-col gap-6">
            <section className="relative flex flex-col gap-5 rounded-lg border border-[#243747] bg-[#0c1420] p-6" aria-labelledby="invite-h">
              <span className="absolute -left-px -top-px h-[2px] w-[88px] bg-[#50e3ed]" aria-hidden="true" />
              <h2 id="invite-h" className="font-plex text-[11px] font-normal text-[#91a5b6]">
                ROOM CODE
              </h2>
              <p data-testid="room-code" className="font-grotesk text-[clamp(44px,9vw,60px)] font-bold leading-none tracking-wide text-[#50e3ed]" aria-label={`Room code ${lobby.roomCode.split('').join(' ')}`}>
                {lobby.roomCode}
              </p>
              <button type="button" onClick={() => copy('code')} className={`${control} w-full border-[#153744] bg-[#132e37] text-[#50e3ed] hover:brightness-125`}>
                <img src={copyIcon} alt="" aria-hidden="true" className="size-[18px]" />
                {copied === 'code' ? 'Copied!' : 'Copy code'}
              </button>
              <hr className="border-0 border-t border-[#243747]" />
              <div className="flex flex-col gap-[10px]">
                <h3 className="font-plex text-[11px] font-normal text-[#91a5b6]">INVITE LINK</h3>
                <input
                  readOnly
                  aria-label="Invite link"
                  value={lobby.inviteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-[4px] border border-[#243747] bg-[#070d16] p-[14px] font-plex text-[11px] leading-[1.7] text-[#91a5b6]"
                />
              </div>
              <button type="button" onClick={() => copy('link')} className={`${control} w-full border-[#243747] bg-[#0c1420] text-[#91a5b6] hover:text-[#eef6fa]`}>
                <img src={linkIcon} alt="" aria-hidden="true" className="size-[18px]" />
                {copied === 'link' ? 'Copied!' : 'Copy link'}
              </button>
              <p role="status" className="sr-only">
                {copied ? `${copied === 'code' ? 'Room code' : 'Invite link'} copied to clipboard` : ''}
              </p>
            </section>

            <ArenaScene scene="lobby" />

            <p className="flex items-center gap-[10px] font-plex text-[10px] text-[#91a5b6]">
              <img src={lockSmall} alt="" aria-hidden="true" className="size-[15px]" />
              PRIVATE ROOMS. NO ACCOUNT REQUIRED.
            </p>
          </div>

          {/* ------------------------------------------------------------ players and match setup */}
          <div className="flex min-w-0 flex-col gap-5">
            <section aria-labelledby="roster-h" className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="roster-h" className="font-grotesk text-[25px] font-bold text-[#eef6fa]">
                  Players
                </h2>
                <p data-testid="player-count" className="font-plex text-[11px] uppercase text-[#91a5b6]">
                  {count} / {SLOTS} players<span className="text-[#546b7d]"> · minimum {lobby.minPlayers}</span>
                </p>
              </div>

              <ul className="grid gap-3 sm:grid-cols-2" aria-label="Waiting roster">
                {Array.from({ length: SLOTS }, (_, seat) => {
                  const player = lobby.players[seat];
                  const you = player?.playerId === session.playerId;
                  return (
                    <li
                      key={seat}
                      className={`relative flex h-[94px] min-w-0 items-center gap-[14px] rounded-[4px] border p-[18px] ${
                        player ? (you ? 'border-[#153744] bg-[#101e2b]' : 'border-[#243747] bg-[#0c1420]') : 'border-[#243747] bg-[#070d16]'
                      }`}
                    >
                      {player ? (
                        <span
                          aria-hidden="true"
                          className="flex size-12 shrink-0 items-center justify-center rounded-full border bg-[#132e37] text-[26px]"
                          style={{ borderColor: you ? '#50e3ed' : ringFor(seat) }}
                        >
                          {avatarFor(seat)}
                        </span>
                      ) : (
                        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full border border-[#243747] bg-[#0c1420]">
                          <img src={userRound} alt="" className="size-6" />
                        </span>
                      )}
                      <div className="min-w-0">
                        {player ? (
                          <>
                            <p className="flex flex-wrap items-center gap-x-[9px] truncate font-grotesk text-[21px] font-bold leading-tight text-[#eef6fa]">
                              <span className="truncate">{player.displayName}</span>
                              {you && <span className="font-plex text-[10px] font-normal text-[#50e3ed]">[YOU]</span>}
                              {player.playerId === lobby.hostId && <span className="font-plex text-[10px] font-normal text-[#d37bc6]">[HOST]</span>}
                            </p>
                            <p className="mt-2 flex items-center gap-[6px] font-plex text-[10px]">
                              {player.connected ? (
                                <>
                                  <img src={onlineIndicator} alt="" aria-hidden="true" className="size-[5px]" />
                                  <span className="text-[#8ce5b4]">CONNECTED</span>
                                </>
                              ) : (
                                <span className="text-[#ff7b7b]">○ OFFLINE</span>
                              )}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="font-inter text-[13px] text-[#91a5b6]">Waiting for player {seat + 1}…</p>
                            <p className="mt-[7px] font-plex text-[10px] text-[#546b7d]">OPEN SLOT</p>
                          </>
                        )}
                      </div>
                      {player && isHost && !you && (
                        <button
                          type="button"
                          data-testid={`kick-${player.playerId}`}
                          aria-label={`Kick ${player.displayName}`}
                          title={`Remove ${player.displayName} from the room`}
                          onClick={() => void store.kickPlayer(player.playerId)}
                          className="absolute right-2 top-2 rounded border border-[#ff7b7b]/70 px-2 py-1 font-plex text-[10px] font-bold text-[#ff7b7b] hover:bg-[#ff7b7b]/15"
                        >
                          <span aria-hidden="true">❌ </span>Kick
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {error && (
              <p role="alert" className="rounded-[4px] border border-danger bg-danger/10 px-4 py-3 text-danger">
                <span className="bracket font-bold">[ERROR]</span> {error}
              </p>
            )}

            <section className="flex flex-col gap-4 rounded-lg border border-[#243747] bg-[#0c1420] p-6" aria-labelledby="target-h">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label id="target-h" htmlFor="series-target" className="flex items-center gap-[10px] font-grotesk text-[20px] font-bold text-[#eef6fa]">
                  <img src={trophy} alt="" aria-hidden="true" className="size-[18px]" />
                  Series Win Target
                </label>
                <div className="relative">
                  <select
                    id="series-target"
                    data-testid="series-target"
                    value={lobby.seriesWinTarget}
                    disabled={!isHost}
                    onChange={(e) => void store.setSeriesTarget(Number(e.target.value))}
                    className="h-[42px] min-w-[11rem] appearance-none rounded-[4px] border border-[#243747] bg-[#070d16] pl-[14px] pr-10 font-plex text-[12px] text-[#eef6fa] disabled:opacity-60"
                  >
                    {SERIES_WIN_TARGET_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n} Wins{n === SERIES_WIN_TARGET ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown} alt="" aria-hidden="true" className="pointer-events-none absolute right-[14px] top-1/2 size-[14px] -translate-y-1/2" />
                </div>
              </div>
              <p className="font-inter text-[12px] leading-[1.6] text-[#91a5b6]">
                {isHost ? 'First player to this many Match Wins wins the series. Locked once you start.' : `The host set this to ${lobby.seriesWinTarget} Match Wins.`}
              </p>
            </section>

            <div className="flex flex-wrap items-start gap-3">
              {isHost ? (
                <button
                  type="button"
                  onClick={() => {
                    if (canStart) void store.startGame();
                  }}
                  aria-disabled={!canStart}
                  aria-describedby="start-hint"
                  className={`${control} min-w-[12rem] flex-1 ${canStart ? 'border-[#50e3ed] bg-[#50e3ed] font-bold text-[#02050a] hover:brightness-110' : 'cursor-not-allowed border-[#243747] bg-[#0c1420] text-[#546b7d]'}`}
                >
                  {!canStart && <img src={lockStart} alt="" aria-hidden="true" className="size-[18px]" />}
                  Start game
                </button>
              ) : (
                <p className="flex min-h-11 flex-1 items-center font-inter text-[13px] text-[#91a5b6]">Waiting for the host to start…</p>
              )}
              <button type="button" onClick={() => void store.leaveRoom()} className={`${control} border-[#243747] bg-[#0c1420] text-[#91a5b6] hover:text-[#eef6fa]`}>
                <img src={logOut} alt="" aria-hidden="true" className="size-[18px]" />
                Leave room
              </button>
            </div>
            <p id="start-hint" className="flex items-center gap-2 font-inter text-[12px] text-[#91a5b6]">
              {isHost && (
                <>
                  <img src={info} alt="" aria-hidden="true" className="size-[14px]" />
                  {canStart ? 'Everyone here will play. Joining closes once you start.' : `Need ${lobby.minPlayers - count} more player${lobby.minPlayers - count === 1 ? '' : 's'} to start.`}
                </>
              )}
            </p>
          </div>
        </div>
      </main>
      <SystemFooter detail="LOBBY STANDBY" />
    </>
  );
}

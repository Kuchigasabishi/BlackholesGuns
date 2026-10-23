import { useState, type FormEvent } from 'react';
import arrowRight from '../assets/landing/arrow-right.svg';
import arrowUpRight from '../assets/landing/arrow-up-right.svg';
import connectionIndicator from '../assets/landing/connection-indicator.svg';
import hash from '../assets/landing/hash.svg';
import logIn from '../assets/landing/log-in.svg';
import lockKeyhole from '../assets/landing/lock-keyhole.svg';
import plus from '../assets/landing/plus.svg';
import trophy from '../assets/landing/trophy.svg';
import userRound from '../assets/landing/user-round.svg';
import { EventHorizonArena } from '../components/EventHorizonArena';
import { HowToPlay } from '../components/HowToPlay';
import { useGameState, useStore } from '../hooks';

/** Pulls a room code out of the current URL when someone opens an invite link (/join/CODE). */
export const codeFromLocation = (pathname: string): string => /^\/join\/([A-Za-z0-9]+)\/?$/.exec(pathname)?.[1]?.toUpperCase() ?? '';

/**
 * The landing page, built from the Figma "Blackholes & guns lobby" prototype: a dark cyber-grid layout with the
 * event-horizon graphic on the left and the room console (name, host, join) on the right. All behaviour is the
 * original: the same store calls, validation (the Join button needs a code, both need a connection) and ids.
 */
export function HomeScreen({ initialCode = '' }: { initialCode?: string }) {
  const store = useStore();
  const { error, notice, connection } = useGameState();
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const online = connection === 'connected';

  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    void run(() => store.createRoom(name));
  };
  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    void run(() => store.joinRoom(code, name));
  };

  const input = 'w-full border border-[#243747] bg-[#070d16] text-[#eef6fa] placeholder:text-[#91a5b6]/70 rounded-[4px] focus:border-[#50e3ed]';

  return (
    <>
      <main id="main" className="mx-auto grid max-w-[1440px] gap-12 px-4 py-10 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:px-14 lg:pb-9 lg:pt-[52px]">
        {/* ------------------------------------------------------------ game overview */}
        <section aria-labelledby="game-title" className="flex min-w-0 flex-col justify-between gap-10">
          <div className="flex flex-col gap-4">
            <p className="font-plex text-[11px] text-[#50e3ed]">MULTIPLAYER TACTICAL ARCADE / 2–8 PLAYERS</p>
            <h1 id="game-title" className="font-grotesk text-[clamp(44px,9vw,75px)] font-bold leading-[0.96] text-[#eef6fa]">
              BLACKHOLES
              <br />
              <span className="text-[#50e3ed]">&amp; GUNS</span>
            </h1>
            <p className="font-inter text-[15px] leading-[1.6] text-[#91a5b6]">Secretly pick. Reveal together. Last one standing wins.</p>
          </div>

          <EventHorizonArena />

          <div className="flex flex-wrap items-center justify-between gap-4 border-y border-[#243747] py-[18px]">
            <div className="flex items-center gap-3">
              <img src={trophy} alt="" aria-hidden="true" className="size-[21px] shrink-0" />
              <div className="flex flex-col gap-[5px]">
                <p className="font-plex text-[10px] text-[#546b7d]">THE WIN CONDITION</p>
                <p className="font-inter text-[13px] text-[#eef6fa]">First to 10 match wins takes the series.</p>
              </div>
            </div>
            <HowToPlay landing />
          </div>
        </section>

        {/* ------------------------------------------------------------ room console */}
        <section aria-labelledby="lobby-title" className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-col gap-[9px]">
              <p className="font-plex text-[11px] text-[#91a5b6]">YOUR NEXT MATCH STARTS HERE</p>
              <h2 id="lobby-title" className="font-grotesk text-[32px] font-bold leading-none text-[#eef6fa]">
                Enter the lobby
              </h2>
            </div>
            <p className="font-plex text-[10px] text-[#546b7d]" aria-hidden="true">
              [ CONNECT_ ]
            </p>
          </div>

          {notice && (
            <p role="status" className="rounded-[4px] border border-[#ffd54d]/60 bg-[#ffd54d]/10 px-4 py-3 text-[#ffd54d]">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-[4px] border border-danger bg-danger/10 px-4 py-3 text-danger">
              <span className="bracket font-bold">[ERROR]</span> {error}
            </p>
          )}
          {!online && (
            <p role="status" className="font-plex text-[12px] text-[#91a5b6]">
              Connecting to the server…
            </p>
          )}

          <div className="relative overflow-hidden rounded-lg border border-[#243747] bg-[#0c1420]" data-testid="connection-panel">
            <span className="absolute left-0 top-0 h-[2px] w-[88px] bg-[#50e3ed]" aria-hidden="true" />

            {/* player identity */}
            <div className="flex flex-col gap-[11px] p-6">
              <div className="flex items-start justify-between">
                <label htmlFor="display-name" className="font-inter text-[13px] font-semibold text-[#eef6fa]">
                  Your name
                </label>
                <span className="font-plex text-[10px] text-[#546b7d]" aria-hidden="true">
                  PLAYER ID
                </span>
              </div>
              <div className="relative">
                <img src={userRound} alt="" aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-[17px] -translate-y-1/2" />
                <input
                  id="display-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  autoComplete="nickname"
                  placeholder="e.g. NovaSlayer"
                  className={`${input} h-[50px] pl-[45px] pr-4 font-plex text-[13px]`}
                />
              </div>
              <p className="font-inter text-[11px] text-[#91a5b6]">This is how other players will see you.</p>
            </div>

            <hr className="border-0 border-t border-[#243747]" />

            {/* host a game */}
            <form onSubmit={onCreate} className="flex flex-col gap-3 px-6 py-5" aria-labelledby="host-title">
              <div className="flex items-center gap-[13px]">
                <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[4px] bg-[#132e37]">
                  <img src={plus} alt="" aria-hidden="true" className="size-5" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                  <h3 id="host-title" className="font-grotesk text-[21px] font-bold leading-none text-[#eef6fa]">
                    Host a game
                  </h3>
                  <p className="font-inter text-[12px] text-[#91a5b6]">Create a private room. Share the code or link. 2–8 players.</p>
                </div>
              </div>
              <button
                type="submit"
                disabled={!online || busy}
                className="flex h-[52px] w-full items-center justify-between rounded-[4px] border border-[#50e3ed] bg-[#50e3ed] px-5 font-inter text-[15px] font-bold text-[#02050a] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Create room
                <img src={arrowUpRight} alt="" aria-hidden="true" className="size-[18px]" />
              </button>
            </form>

            <hr className="border-0 border-t border-[#243747]" />

            {/* join a game */}
            <form onSubmit={onJoin} className="flex flex-col gap-[13px] px-6 py-[21px]" aria-labelledby="join-title">
              <div className="flex items-center gap-[13px]">
                <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[4px] bg-[#281c32]">
                  <img src={logIn} alt="" aria-hidden="true" className="size-5" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                  <h3 id="join-title" className="font-grotesk text-[21px] font-bold leading-none text-[#eef6fa]">
                    Join a game
                  </h3>
                  <p className="font-inter text-[12px] text-[#91a5b6]">Already have an invite? Your arena is waiting.</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="room-code" className="font-inter text-[12px] text-[#91a5b6]">
                  Room code or invite link
                </label>
                <div className="relative">
                  <img src={hash} alt="" aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2" />
                  <input
                    id="room-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="H7K2QP"
                    className={`${input} h-11 pl-11 pr-28 font-plex text-[13px] uppercase`}
                  />
                  {code.length === 0 && (
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-plex text-[10px] text-[#546b7d]" aria-hidden="true">
                      / PASTE LINK
                    </span>
                  )}
                </div>
              </div>
              <button
                type="submit"
                disabled={!online || busy || code.trim().length === 0}
                className="flex h-[52px] w-full items-center justify-between rounded-[4px] border border-[#243747] bg-[#101e2b] px-5 font-inter text-[15px] font-bold text-[#eef6fa] hover:border-[#50e3ed]/70 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Join room
                <img src={arrowRight} alt="" aria-hidden="true" className="size-[18px]" />
              </button>
            </form>

            <div className="flex h-[52px] items-center gap-[9px] border-t border-[#243747] bg-[#070d16] px-6">
              <img src={lockKeyhole} alt="" aria-hidden="true" className="size-[14px]" />
              <p className="font-plex text-[10px] text-[#91a5b6]">PRIVATE ROOMS. NO ACCOUNT REQUIRED.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#243747]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-8 sm:px-8 lg:px-14">
          <p className="flex items-center gap-[10px] font-plex text-[10px] text-[#91a5b6]">
            <img src={connectionIndicator} alt="" aria-hidden="true" className="size-[6px]" />
            ALL SYSTEMS OPERATIONAL
            <span className="text-[11px] text-[#546b7d]">/</span>
            <span className="text-[#546b7d]">LOBBY STANDBY</span>
          </p>
          <p className="font-plex text-[10px] text-[#546b7d]">A LITTLE STRATEGY. A LOT OF CHAOS.</p>
        </div>
      </footer>
    </>
  );
}

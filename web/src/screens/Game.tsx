import { ATTACKS } from '../../../src/engine';
import { actionEmoji } from '../format/emoji';
import { useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Crumble, useCrumble } from '../components/Crumble';
import { LockShader } from '../components/LockShader';
import { ControlPanel } from '../components/ControlPanel';
import { SeriesStandings } from '../components/SeriesStandings';
import { FXLayer } from '../components/FXLayer';
import { SeriesResultModal } from '../components/SeriesResultModal';
import { MatchResultsModal } from '../components/MatchResultsModal';
import { actionTag } from '../format/describeTurn';
import { useAudio, useTickingClock } from '../audio/useAudio';
import { formatClock, useCountdown, useGameState, useSettings, useStore } from '../hooks';
import { badgeOf, nameLookup, turnModalOpen, type Badge, type ClientState } from '../state/reducer';

const BADGE_TEXT: Record<Badge, string> = { ELIMINATED: '[ELIMINATED]', READY: 'READY', HIDDEN: 'HIDDEN ?' };
const BADGE_STYLE: Record<Badge, string> = {
  ELIMINATED: 'border-danger bg-danger/15 text-danger',
  READY: 'border-ok bg-ok/15 text-ok',
  HIDDEN: 'border-gold bg-gold/10 text-gold',
};
const BADGE_ICON: Record<Badge, string> = { ELIMINATED: '✖', READY: '✔', HIDDEN: '…' };

const PHASE_HELP: Record<string, string> = {
  SUDDEN_DEATH: 'SUDDEN DEATH — all six defenses are disabled. If you can afford any attack you must attack; Charge only when you cannot.',
  OVERTIME: 'OVERTIME — normal combat rules (defenses are back). Neutralized attacks simply start another turn; there is no draw.',
};

// ---------------------------------------------------------------- top status bar

function VolumeControl() {
  const { muted, volume, setMuted, setVolume } = useAudio();
  return (
    <span className="flex items-center gap-2" data-testid="volume-control">
      <button type="button" aria-pressed={muted} aria-label={muted ? 'Unmute audio' : 'Mute audio'} data-testid="mute-toggle" onClick={() => setMuted(!muted)} className="text-lg leading-none">
        <span aria-hidden="true">{muted || volume === 0 ? '🔇' : '🔊'}</span>
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(volume * 100)}
        aria-label="Volume"
        data-testid="volume-slider"
        disabled={muted}
        onChange={(e) => setVolume(Number(e.target.value) / 100)}
        className="h-1 w-20 accent-[#3ee6ff] disabled:opacity-40"
      />
    </span>
  );
}

/** In-game exit controls: the host can send everyone back to the lobby; everyone can quit. Both ask first. */
export function MatchMenu() {
  const store = useStore();
  const { lobby, session } = useGameState();
  const [ask, setAsk] = useState<'lobby' | 'quit' | null>(null);
  if (!session) return null;
  const isHost = lobby?.hostId === session.playerId;
  const btn = 'bracket rounded border px-3 py-1 text-xs font-bold';
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="match-menu">
      {ask === null ? (
        <>
          {isHost && (
            <button type="button" data-testid="return-lobby" onClick={() => setAsk('lobby')} className={`${btn} border-gold text-gold hover:bg-gold/10`}>
              🏠 Return to Lobby
            </button>
          )}
          <button type="button" data-testid="quit-match" onClick={() => setAsk('quit')} className={`${btn} border-danger text-danger hover:bg-danger/10`}>
            🚪 Quit / Leave Match
          </button>
        </>
      ) : (
        <span role="alertdialog" aria-label="Confirm" data-testid="menu-confirm" className="flex flex-wrap items-center gap-2 text-sm text-ink">
          {ask === 'lobby' ? 'End the match for everyone and return to the lobby?' : 'Leave now? You will be eliminated and cannot rejoin this series.'}
          <button
            type="button"
            data-testid="menu-yes"
            autoFocus
            onClick={() => {
              if (ask === 'lobby') void store.abortSeries();
              else void store.leaveRoom();
              setAsk(null);
            }}
            className={`${btn} border-danger bg-danger/20 text-danger`}
          >
            Yes
          </button>
          <button type="button" data-testid="menu-no" onClick={() => setAsk(null)} className={`${btn} border-edge text-ink-dim`}>
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}

/** A dismissible one-line message from the server (a player left, the host ended the match...). */
export function NoticeBar() {
  const store = useStore();
  const { notice } = useGameState();
  if (!notice) return null;
  return (
    <p role="status" data-testid="notice-bar" className="flex items-center justify-between gap-3 rounded-lg border border-gold bg-gold/10 px-3 py-2 text-sm text-gold">
      {notice}
      <button type="button" onClick={() => store.dispatch({ type: 'notice', message: null })} className="rounded border border-gold px-2 py-0.5 text-xs hover:bg-gold/20">
        Dismiss
      </button>
    </p>
  );
}

export function TopBar() {
  const state = useGameState();
  const { game, turn, session, stage } = state;
  const seconds = useCountdown(turn?.deadlineAt ?? null, turn?.clockSkewMs ?? 0, stage === 'COMMIT');
  const me = game && session ? game.players[session.playerId] : undefined;
  const lockedIn = session ? state.ownCommit !== null || state.lockedPlayerIds.includes(session.playerId) : false;
  useTickingClock(seconds, stage === 'COMMIT' && !lockedIn && !!me?.alive);
  if (!game || !session) return null;

  const phase = turn?.phase ?? game.round.phase;
  const streak = game.round.noEliminationStreak;
  const alive = game.round.survivorIds.length;
  const toSuddenDeath = alive === 2 && phase === 'NORMAL' ? Math.max(0, 10 - streak) : null;

  const chip = 'bracket whitespace-nowrap rounded border border-edge bg-void/60 px-3 py-1';
  return (
    <header className="neon-box rounded-2xl p-3" aria-label="Game status">
      <ul className="flex flex-wrap items-center gap-2 text-sm">
        <li className={`${chip} text-neon-pink`} data-testid="timer" aria-label={`Commit timer ${seconds ?? 'not running'} seconds`}>
          [ COMMIT TIMER: {stage === 'COMMIT' ? formatClock(seconds) : '--:--'} ]
        </li>
        <li className={chip}>[ ALIVE: {alive} ]</li>
        <li className={chip}>
          <VolumeControl />
        </li>
        <li className="ml-auto">
          <MatchMenu />
        </li>
        <li className={chip} data-testid="series-target-chip">[ FIRST TO: {game.series.seriesWinTarget} WINS ]</li>
      </ul>
      {toSuddenDeath !== null && (
        <p className="mt-2 text-sm text-ink-dim" data-testid="sd-countdown">
          Two players left. Sudden Death begins after {toSuddenDeath} more turn{toSuddenDeath === 1 ? '' : 's'} without an elimination.
        </p>
      )}
      {phase !== 'NORMAL' && (
        <p className="mt-2 rounded border border-gold bg-gold/10 px-3 py-2 text-gold" data-testid="phase-help">
          {PHASE_HELP[phase]}
        </p>
      )}
    </header>
  );
}

/** One-time warning when Sudden Death / Overtime begins (§13). */
export function PhaseNotice() {
  const store = useStore();
  const { phaseNotice } = useGameState();
  if (!phaseNotice) return null;
  return (
    <div role="alert" className="anim-pulse flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-gold bg-gold/15 px-4 py-3 text-gold" data-testid="phase-notice">
      <p className="font-bold">⚠ {PHASE_HELP[phaseNotice]}</p>
      <button type="button" onClick={() => store.dispatch({ type: 'dismissPhaseNotice' })} className="rounded border border-gold px-3 py-1 hover:bg-gold/20">
        Got it
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------- roster

function actionLine(state: ClientState, playerId: string, nameOf: (id: string) => string): string | null {
  const a = state.revealed?.find((r) => r.playerId === playerId);
  if (!a) return null;
  const target =
    a.kind === 'ATTACK'
      ? ATTACKS[a.weapon!].targetMode === 'ALL_OPPONENTS'
        ? ' → ALL'
        : a.targets && a.targets.length > 0
          ? ` → ${a.targets.map(nameOf).join(', ')}`
          : ''
      : '';
  return `${actionTag(a)}${target}`;
}

export function Roster() {
  const state = useGameState();
  const { game, session } = state;
  if (!game || !session) return null;

  return (
    <section aria-labelledby="roster-h">
      <h2 id="roster-h" className="sr-only">
        Players
      </h2>
      <div className="relative" data-testid="arena">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="roster">
          {game.series.lobby.map((id, seat) => (
            <RosterCard key={id} id={id} seat={seat} state={state} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function RosterCard({ id, seat, state }: { id: string; seat: number; state: ClientState }) {
  const { game, session } = state;
  const { reducedMotion } = useSettings();
  const nameOf = nameLookup(state);
  const p = game!.players[id]!;
  const animate = !reducedMotion;
  // A player eliminated by the turn that was just revealed keeps their "alive" face until the Turn Resolution
  // popup is closed, then crumbles to digital dust (1 s) and only then snaps to the permanent grayscale state.
  const diedThisTurn = state.revealed !== null && (state.lastResult?.outcome.eliminatedPlayerIds ?? []).includes(id);
  const phase = useCrumble(diedThisTurn && !turnModalOpen(state), !p.alive && !diedThisTurn);
  const held = animate && !p.alive && diedThisTurn && phase !== 'done';
  const alive = p.alive || held;
  const badge = held ? 'READY' : badgeOf(state, id);
  // Locked and loaded: this player has committed and the COMMIT window is still open.
  const locked = state.stage === 'COMMIT' && alive && state.lockedPlayerIds.includes(id);
  const line = actionLine(state, id, nameOf);
  const isOwn = id === session!.playerId;
  // Card-click targeting: while the local player is choosing a target for an attack, living opponents' cards are the buttons.
  const store = useStore();
  const me = game!.players[session!.playerId];
  const youCanAct = state.stage === 'COMMIT' && !!me?.alive && state.ownCommit === null && !state.lockedPlayerIds.includes(session!.playerId);
  const sel = youCanAct && state.selection?.kind === 'ATTACK' ? state.selection : null;
  const aimsAtAll = sel !== null && ATTACKS[sel.weapon].targetMode === 'ALL_OPPONENTS';
  const isFoe = !isOwn && p.alive;
  const targetable = sel !== null && !aimsAtAll && isFoe;
  const targeted = sel !== null && isFoe && (aimsAtAll || sel.targets.includes(id));
  const wins = p.matchWins;
  // §12 fog of war: only your own Charge is ever shown.
  const chargeDisplay = !alive ? '—' : isOwn ? String(held ? (state.lastResult?.outcome.playerResults.find((r) => r.playerId === id)?.chargeBefore ?? p.charge) : p.charge) : '?';
  // The big action emoji sits on the card from the reveal on.
  const emoji = state.revealed !== null ? revealedEmoji(state, id) : null;
  return (
    <li
      data-testid={`player-${id}`}
      data-card-id={id}
      data-eliminated={!alive}
      data-targetable={targetable || undefined}
      data-targeted={targeted || undefined}
      onClick={targetable ? () => store.dispatch({ type: 'toggleTarget', playerId: id }) : undefined}
      data-crumble={phase === 'crumbling' || undefined}
      aria-label={`${nameOf(id)}${isOwn ? ' (you)' : ''}, ${alive ? 'alive' : 'eliminated'}, ${isOwn ? `${chargeDisplay} charge` : 'charge hidden'}, ${wins} match wins`}
      className={`neon-box relative isolate flex flex-col items-center rounded-xl px-2 pb-3 pt-6 text-center ${alive ? '' : 'opacity-80'} ${isOwn ? 'ring-2 ring-neon' : ''} ${targetable && !targeted ? 'target-pulse cursor-pointer' : ''} ${targeted ? 'target-lock' : ''}`}
    >
      {targetable && (
        <button type="button" data-testid={`target-${id}`} aria-pressed={targeted} aria-label={`Target ${nameOf(id)}`} className="absolute inset-0 z-30 cursor-pointer rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon" />
      )}
      {targeted && (
        <span data-testid={`reticle-${id}`} className="bracket pointer-events-none absolute -left-1 -top-2 z-20 rounded border-2 border-danger bg-void px-2 py-0.5 text-xs font-black text-danger shadow-[0_0_12px_rgba(255,59,92,0.9)]">
          <span aria-hidden="true" className="text-base">🎯 </span>TARGET
        </span>
      )}
      {line && (
        <span data-testid={`reveal-${id}`} className={`bracket absolute -top-3 left-1/2 w-max max-w-[96%] -translate-x-1/2 rounded border border-neon bg-void px-2 py-0.5 text-center text-xs leading-tight break-words text-neon ${animate ? 'anim-pop' : ''}`}>
          {line}
        </span>
      )}
      {emoji && (
        <span data-testid={`action-emoji-${id}`} aria-hidden="true" className="pointer-events-none absolute right-1 top-1 z-10 text-4xl leading-none drop-shadow-[0_0_8px_rgba(0,255,255,0.7)]">
          {emoji}
        </span>
      )}
      <LockShader active={locked} playerId={id} />
      <Crumble crumbling={phase === 'crumbling'}>
        <Avatar seat={seat} playerId={id} eliminated={!alive} />
      </Crumble>
      <p className="mt-2 w-full truncate font-bold">
        {nameOf(id)}
        {isOwn && <span className="bracket ml-1 text-xs text-gold">[YOU]</span>}
      </p>
      <p className={`bracket text-sm ${isOwn ? 'text-gold' : 'text-ink-dim'}`} title={isOwn ? undefined : "Opponents' Charge is hidden"}>
        ⚡ {chargeDisplay} · 🏆 {wins}/{game!.series.seriesWinTarget}
      </p>
      <p className={`bracket relative z-20 mt-1 rounded border px-2 py-0.5 text-xs font-bold ${BADGE_STYLE[badge]}`} data-testid={`badge-${id}`} data-locked={locked || undefined}>
        <span aria-hidden="true">{locked ? '🔒' : BADGE_ICON[badge]} </span>
        {locked ? 'LOCKED' : BADGE_TEXT[badge]}
      </p>
      {p.connectionStatus === 'DISCONNECTED' && alive && <p className="bracket mt-1 text-xs text-danger">[OFFLINE]</p>}
    </li>
  );
}

function revealedEmoji(state: ClientState, playerId: string): string | null {
  const a = state.revealed?.find((r) => r.playerId === playerId);
  return a ? actionEmoji(a) : null;
}

// ------------------------------------------------------------------ the screen

export function GameScreen() {
  const { seriesEnd } = useGameState();
  return (
    <main id="main" className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4">
      <FXLayer />
      <SeriesResultModal />
      <MatchResultsModal />
      <TopBar />
      <NoticeBar />
      <PhaseNotice />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="space-y-4">
          <Roster />
          {seriesEnd ? null : <div id="action-panel" tabIndex={-1}><ControlPanel /></div>}
        </div>
        <SeriesStandings />
      </div>
    </main>
  );
}

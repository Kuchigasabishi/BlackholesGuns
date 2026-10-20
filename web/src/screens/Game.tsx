import { ATTACKS } from '../../../src/engine';
import { actionEmoji } from '../format/emoji';
import { Avatar } from '../components/Avatar';
import { LockShader } from '../components/LockShader';
import { ControlPanel } from '../components/ControlPanel';
import { SeriesStandings } from '../components/SeriesStandings';
import { FXLayer } from '../components/FXLayer';
import { SeriesResultModal } from '../components/SeriesResultModal';
import { MatchResultsModal } from '../components/MatchResultsModal';
import { actionTag } from '../format/describeTurn';
import { formatClock, useCountdown, useGameState, useSettings, useStore } from '../hooks';
import { badgeOf, nameLookup, type Badge, type ClientState } from '../state/reducer';

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

export function TopBar() {
  const state = useGameState();
  const { game, turn, session, stage } = state;
  const seconds = useCountdown(turn?.deadlineAt ?? null, turn?.clockSkewMs ?? 0, stage === 'COMMIT');
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
  const { reducedMotion } = useSettings();
  if (!game || !session) return null;
  const nameOf = nameLookup(state);
  const eliminatedNow = new Set(state.lastResult?.outcome.eliminatedPlayerIds ?? []);
  const animate = !reducedMotion;

  return (
    <section aria-labelledby="roster-h">
      <h2 id="roster-h" className="sr-only">
        Players
      </h2>
      <div className="relative" data-testid="arena">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="roster">
          {game.series.lobby.map((id, seat) => {
            const p = game.players[id]!;
            const alive = p.alive;
            const badge = badgeOf(state, id);
            // Locked and loaded: this player has committed and the COMMIT window is still open.
            const locked = state.stage === 'COMMIT' && alive && state.lockedPlayerIds.includes(id);
            const line = actionLine(state, id, nameOf);
            const justDied = state.revealed !== null && eliminatedNow.has(id);
            const isOwn = id === session.playerId;
            const wins = p.matchWins;
            // §12 fog of war: only your own Charge is ever shown.
            const ownCharge = p.charge;
            const chargeDisplay = !alive ? '—' : isOwn ? String(ownCharge) : '?';
            // The big action emoji sits on the card from the reveal on (static once the animation is over).
            const emoji = state.revealed !== null ? revealedEmoji(state, id) : null;
            return (
              <li
                key={id}
                data-testid={`player-${id}`}
                data-card-id={id}
                data-eliminated={!alive}
                aria-label={`${nameOf(id)}${isOwn ? ' (you)' : ''}, ${alive ? 'alive' : 'eliminated'}, ${isOwn ? `${ownCharge} charge` : 'charge hidden'}, ${wins} match wins`}
                className={`neon-box relative flex flex-col items-center rounded-xl px-2 pb-3 pt-6 text-center ${alive ? '' : 'opacity-80'} ${isOwn ? 'ring-2 ring-neon' : ''}`}
              >
                {line && (
                  <span data-testid={`reveal-${id}`} className={`bracket absolute -top-3 left-1/2 w-max max-w-[96%] -translate-x-1/2 rounded border border-neon bg-void px-2 py-0.5 text-center text-xs leading-tight break-words text-neon ${animate ? 'anim-pop' : ''}`}>
                    {line}
                  </span>
                )}
                {emoji && (
                  <span
                    data-testid={`action-emoji-${id}`}
                    aria-hidden="true"
                    className={`pointer-events-none absolute right-1 top-1 z-10 text-4xl leading-none drop-shadow-[0_0_8px_rgba(0,255,255,0.7)]`}
                  >
                    {emoji}
                  </span>
                )}
                <LockShader active={locked} playerId={id} />
                <div className={justDied && animate ? 'anim-ko' : ''}>
                  <Avatar seat={seat} playerId={id} eliminated={!alive} />
                </div>
                <p className="mt-2 w-full truncate font-bold">
                  {nameOf(id)}
                  {isOwn && <span className="bracket ml-1 text-xs text-gold">[YOU]</span>}
                </p>
                <p className={`bracket text-sm ${isOwn ? 'text-gold' : 'text-ink-dim'}`} title={isOwn ? undefined : "Opponents' Charge is hidden"}>
                  ⚡ {chargeDisplay} · 🏆 {wins}/{game.series.seriesWinTarget}
                </p>
                <p className={`bracket relative z-20 mt-1 rounded border px-2 py-0.5 text-xs font-bold ${BADGE_STYLE[badge]}`} data-testid={`badge-${id}`} data-locked={locked || undefined}>
                  <span aria-hidden="true">{locked ? '🔒' : BADGE_ICON[badge]} </span>
                  {locked ? 'LOCKED' : BADGE_TEXT[badge]}
                </p>
                {p.connectionStatus === 'DISCONNECTED' && alive && <p className="bracket mt-1 text-xs text-danger">[OFFLINE]</p>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
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

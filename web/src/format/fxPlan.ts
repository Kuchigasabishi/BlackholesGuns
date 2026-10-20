/**
 * Turns the server's canonical resolution snapshot into a pure animation plan
 * and a timed schedule for the Turn Resolution popup: which projectiles fly
 * from card to card, how each ends, when each attacker is revealed, and how hard
 * the screen shakes. Nothing here is computed from client guesses; every entry
 * comes from `result.events` / `result.actions` / `result.outcome`.
 */
import { ATTACKS, type PlayerId } from '../../../src/engine';
import type { TurnResultPayload } from '../../../src/server/protocol';
import { actionEmoji } from './emoji';

/**
 * Timeline constants (ms). The whole sequence has to finish inside the server's
 * inter-turn pause (4 s by default) so it never delays the next COMMIT window;
 * the step between attackers shrinks (never below `minStep`) when many attack.
 */
export const FX_TIMING = {
  /** Non-attack cards (defenses, Charge) show at 0; the first attacker is revealed after this lead-in. */
  lead: 400,
  /** Gap between one attacker's reveal and the next (600-800 ms feel, compressed for big lobbies). */
  maxStep: 700,
  minStep: 350,
  /** How long a projectile takes to cross the arena. */
  flight: 650,
  /** After the last impact: static text (eliminated, results) appears once this has passed. */
  tail: 700,
  /** An eliminated card's digital-dust destruction; the sequence waits for it before settling. */
  dissolve: 1000,
  /** Length of one screen shake. */
  shake: 300,
  /** Total budget the schedule tries to stay inside. */
  budget: 3850,
} as const;

export type FxStage = 'playing' | 'settled';

/** How a projectile ends. */
export type ProjectileEnd =
  /** Lands: the target card shakes and shows a damage overlay. */
  | 'HIT'
  /** Stopped by a defense (Shield, Dodge): deflects off the target card with a bright pop. */
  | 'BLOCKED'
  /** Bounces off a reflecting defense and flies back at the attacker. */
  | 'REFLECTED'
  /** Meets an opposing attack in mid-air and both cancel. */
  | 'NEUTRALIZED'
  /** Loses an attack-vs-attack collision: breaks apart mid-way. */
  | 'CLASH_LOST';

export interface Projectile {
  readonly key: string;
  readonly from: PlayerId;
  readonly to: PlayerId;
  readonly emoji: string;
  readonly end: ProjectileEnd;
  /** The attacker's weapon tier (1-5), which scales the screen shake. */
  readonly tier: number;
  /** The defense emoji that meets this projectile on the target's card, if any. */
  readonly clashEmoji: string | null;
}

export type CardReaction = 'HIT' | 'CLASH';

export interface CardFx {
  /** Shown big over the card from the REVEAL on, e.g. ⚡, 🔫, 🛡️. */
  readonly actionEmoji: string;
  readonly kind: 'CHARGE' | 'ATTACK' | 'DEFENSE';
  /** What happens to this card when projectiles arrive. */
  readonly reaction: CardReaction | null;
  /** The defense emoji that pops over this card to meet an incoming projectile. */
  readonly clashEmoji: string | null;
  readonly eliminated: boolean;
}

export interface FxPlan {
  readonly turnId: string;
  readonly projectiles: readonly Projectile[];
  readonly cards: Readonly<Record<PlayerId, CardFx>>;
  /** Players who earn the damage overlay at impact time (includes reflected attackers). */
  readonly damaged: readonly PlayerId[];
  readonly matchWinnerId: PlayerId | null;
}

export function planTurn(result: TurnResultPayload): FxPlan {
  const eliminated = new Set(result.outcome.eliminatedPlayerIds);
  const projectiles: Projectile[] = [];
  const reaction = new Map<PlayerId, CardReaction>();
  const clashEmoji = new Map<PlayerId, string>();

  result.events.forEach((e, i) => {
    const ta = e.targetAction;
    const emoji = actionEmoji({ kind: 'ATTACK', weapon: e.sourceWeapon });
    let end: ProjectileEnd;
    if (ta.kind === 'ATTACK') {
      end = e.outcome === 'NEUTRALIZED' ? 'NEUTRALIZED' : e.outcome === 'ATTACKER_ELIMINATED' ? 'CLASH_LOST' : 'HIT';
    } else if (ta.kind === 'DEFENSE') {
      end = e.outcome === 'BLOCKED' ? 'BLOCKED' : e.outcome === 'ATTACKER_ELIMINATED' ? 'REFLECTED' : 'HIT';
    } else {
      end = 'HIT';
    }
    const clash = (end === 'BLOCKED' || end === 'REFLECTED') && ta.kind === 'DEFENSE' ? actionEmoji(ta) : null;
    projectiles.push({ key: `${e.turnId}:${i}`, from: e.sourcePlayerId, to: e.selectedTargetId, emoji, end, tier: ATTACKS[e.sourceWeapon].cost, clashEmoji: clash });

    if (end === 'HIT') reaction.set(e.selectedTargetId, 'HIT');
    if (clash) {
      if (reaction.get(e.selectedTargetId) !== 'HIT') reaction.set(e.selectedTargetId, 'CLASH');
      clashEmoji.set(e.selectedTargetId, clash);
    }
    if (end === 'REFLECTED') reaction.set(e.sourcePlayerId, 'HIT');
  });

  const cards: Record<PlayerId, CardFx> = {};
  for (const a of result.actions) {
    cards[a.playerId] = {
      actionEmoji: actionEmoji(a),
      kind: a.kind,
      reaction: reaction.get(a.playerId) ?? null,
      clashEmoji: clashEmoji.get(a.playerId) ?? null,
      eliminated: eliminated.has(a.playerId),
    };
  }
  return {
    turnId: result.turnId,
    projectiles,
    cards,
    damaged: [...reaction.entries()].filter(([, r]) => r === 'HIT').map(([id]) => id),
    matchWinnerId: result.outcome.matchWinnerId,
  };
}

// ------------------------------------------------------------------ the timed schedule

export interface ScheduledShot {
  readonly shot: Projectile;
  /** When it leaves the attacker's card (= when that attacker is revealed). */
  readonly launchAt: number;
  /** When it arrives and its reaction starts on the target (and, for a Reflect, the attacker). */
  readonly impactAt: number;
}

export interface ScheduledAttacker {
  readonly playerId: PlayerId;
  readonly revealAt: number;
  readonly tier: number;
}

export interface Schedule {
  readonly attackers: readonly ScheduledAttacker[];
  readonly shots: readonly ScheduledShot[];
  /** Everything has played; the static text results appear. */
  readonly settleAt: number;
  /** Every moment at which the visible state changes (for the timer loop). */
  readonly times: readonly number[];
}

/** A Reflect's projectile bounces back, so its reaction on the attacker lands later. */
const flightOf = (end: ProjectileEnd): number => (end === 'REFLECTED' ? FX_TIMING.flight * 1.7 : FX_TIMING.flight);

/**
 * Defenders and chargers are face-up from t=0. Attackers are then revealed one at
 * a time in turn order, each launching its projectiles and triggering a shake sized
 * by its weapon tier.
 */
export function buildSchedule(plan: FxPlan): Schedule {
  const attackerIds = Object.entries(plan.cards)
    .filter(([, c]) => c.kind === 'ATTACK')
    .map(([id]) => id);
  const n = attackerIds.length;
  const room = FX_TIMING.budget - FX_TIMING.lead - FX_TIMING.flight - FX_TIMING.tail;
  const step = n > 1 ? Math.max(FX_TIMING.minStep, Math.min(FX_TIMING.maxStep, Math.floor(room / (n - 1)))) : FX_TIMING.maxStep;

  const attackers: ScheduledAttacker[] = [];
  const shots: ScheduledShot[] = [];
  attackerIds.forEach((id, i) => {
    const revealAt = FX_TIMING.lead + i * step;
    const mine = plan.projectiles.filter((p) => p.from === id);
    attackers.push({ playerId: id, revealAt, tier: mine[0]?.tier ?? 1 });
    for (const shot of mine) shots.push({ shot, launchAt: revealAt, impactAt: revealAt + flightOf(shot.end) });
  });
  const lastImpact = shots.reduce<number>((m, s) => Math.max(m, s.impactAt), FX_TIMING.lead);
  const anyElimination = Object.values(plan.cards).some((c) => c.eliminated);
  const settleAt = lastImpact + (anyElimination ? FX_TIMING.dissolve : FX_TIMING.tail);
  const times = [...new Set([0, settleAt, ...attackers.flatMap((a) => [a.revealAt, a.revealAt + FX_TIMING.shake]), ...shots.map((s) => s.impactAt)])].sort((a, b) => a - b);
  return { attackers, shots, settleAt, times };
}

export const isAttackerRevealed = (s: Schedule, id: PlayerId, t: number): boolean => {
  const a = s.attackers.find((x) => x.playerId === id);
  return a === undefined || a.revealAt <= t;
};

/** The screen-shake tier running at time `t` (the strongest active one), or null. */
export function shakeTierAt(s: Schedule, t: number): number | null {
  let tier: number | null = null;
  for (const a of s.attackers) if (t >= a.revealAt && t < a.revealAt + FX_TIMING.shake) tier = Math.max(tier ?? 0, a.tier);
  return tier;
}

export interface CardState {
  readonly hit: boolean;
  readonly clashEmoji: string | null;
}

/** Which cards are reacting to a landed projectile at time `t`. */
export function reactionsAt(s: Schedule, t: number): Record<PlayerId, CardState> {
  const out: Record<PlayerId, { hit: boolean; clashEmoji: string | null }> = {};
  const get = (id: PlayerId) => (out[id] ??= { hit: false, clashEmoji: null });
  for (const { shot, impactAt } of s.shots) {
    if (impactAt > t) continue;
    if (shot.end === 'HIT') get(shot.to).hit = true;
    if (shot.clashEmoji) get(shot.to).clashEmoji = shot.clashEmoji;
    if (shot.end === 'REFLECTED') get(shot.from).hit = true;
  }
  return out;
}

/**
 * Turns the server's canonical resolution snapshot into a small, pure animation
 * plan for the arena: which projectiles fly from card to card, how each ends,
 * and which cards react. Nothing here is computed from client guesses; every
 * entry comes from `result.events` / `result.outcome`.
 */
import type { PlayerId } from '../../../src/engine';
import type { TurnResultPayload } from '../../../src/server/protocol';
import { actionEmoji } from './emoji';

/**
 * One shared clock (ms after the turn result arrives). The whole sequence has to
 * finish well inside the server's inter-turn pause (4 s by default) so it never
 * delays the next COMMIT window.
 */
export const FX_TIMING = {
  /** Chosen-action emojis pop onto every card. */
  reveal: 0,
  /** Projectiles leave their source card. */
  launch: 800,
  /** How long a projectile takes to cross the arena. */
  flight: 650,
  /** Impact / clash / deflect reactions on the target cards. */
  impact: 1450,
  /** Impact reactions finish; static text (charge, wins, eliminated badge) updates. */
  settle: 2300,
} as const;

export type FxStage = 'idle' | 'reveal' | 'fly' | 'impact' | 'settled';

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
    projectiles.push({ key: `${e.turnId}:${i}`, from: e.sourcePlayerId, to: e.selectedTargetId, emoji, end });

    if (end === 'HIT') reaction.set(e.selectedTargetId, 'HIT');
    if ((end === 'BLOCKED' || end === 'REFLECTED') && ta.kind === 'DEFENSE') {
      if (reaction.get(e.selectedTargetId) !== 'HIT') reaction.set(e.selectedTargetId, 'CLASH');
      clashEmoji.set(e.selectedTargetId, actionEmoji(ta));
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

/** Where in the shared clock a plan currently is. */
export function stageAt(elapsedMs: number): FxStage {
  if (elapsedMs >= FX_TIMING.settle) return 'settled';
  if (elapsedMs >= FX_TIMING.impact) return 'impact';
  if (elapsedMs >= FX_TIMING.launch) return 'fly';
  return 'reveal';
}

/** Action availability and validation (§3, §4, §7, §9, §10 COMMIT). */
import {
  ATTACKS,
  ATTACK_IDS,
  DEFENSES,
  DEFENSE_IDS,
  isAttackId,
  isDefenseId,
  type AttackDef,
  type AttackId,
  type DefenseId,
} from './catalog';
import { MULTI_TARGET_LIMIT } from './constants';
import type { Action, ActionRef, GameState, PlayerId, RejectionCode, ValidationResult } from './types';

export type UnavailableReason = Extract<
  RejectionCode,
  'NOT_ALIVE' | 'PHASE_RESTRICTED' | 'UNAFFORDABLE' | 'ATTACK_MANDATORY'
>;

export interface Availability {
  readonly available: boolean;
  /** Why the action is disabled (for §13 "communicate why an action is disabled"). */
  readonly reason: UnavailableReason | null;
}

export interface ActionAvailability {
  readonly charge: Availability;
  readonly attacks: Readonly<Record<AttackId, Availability>>;
  readonly defenses: Readonly<Record<DefenseId, Availability>>;
}

const OK: Availability = { available: true, reason: null };
const no = (reason: UnavailableReason): Availability => ({ available: false, reason });

const uniform = <K extends string>(ids: readonly K[], value: Availability): Record<K, Availability> =>
  Object.fromEntries(ids.map((id) => [id, value])) as Record<K, Availability>;

export const affordableAttacks = (charge: number): AttackId[] =>
  ATTACK_IDS.filter((id) => ATTACKS[id].cost <= charge);

/**
 * What a player may do this turn.
 *
 * - Normal Phase and Overtime: Charge always; attacks and Reflects when
 *   affordable; Dodge and Shield free.
 * - Sudden Death: all six defenses are disabled; Charge is legal only when no
 *   attack is affordable, otherwise attacking is mandatory (§9).
 */
export function getActionAvailability(state: GameState, playerId: PlayerId): ActionAvailability {
  const turn = state.turn;
  const player = state.players[playerId];
  if (!turn || !player || !player.alive || !turn.eligiblePlayerIds.includes(playerId)) {
    const dead = no('NOT_ALIVE');
    return { charge: dead, attacks: uniform(ATTACK_IDS, dead), defenses: uniform(DEFENSE_IDS, dead) };
  }

  const suddenDeath = turn.phase === 'SUDDEN_DEATH';
  const canAffordAttack = affordableAttacks(player.charge).length > 0;

  const attacks = Object.fromEntries(
    ATTACK_IDS.map((id) => [id, ATTACKS[id].cost <= player.charge ? OK : no('UNAFFORDABLE')]),
  ) as Record<AttackId, Availability>;
  const defenses = Object.fromEntries(
    DEFENSE_IDS.map((id) => [
      id,
      suddenDeath ? no('PHASE_RESTRICTED') : DEFENSES[id].cost <= player.charge ? OK : no('UNAFFORDABLE'),
    ]),
  ) as Record<DefenseId, Availability>;

  return {
    charge: suddenDeath && canAffordAttack ? no('ATTACK_MANDATORY') : OK,
    attacks,
    defenses,
  };
}

const livingIds = (state: GameState): PlayerId[] => state.series.lobby.filter((id) => state.players[id]?.alive);

/** §7 effect target set. For all-opponent weapons this is every other living player. */
export function resolveEffectTargets(
  weapon: AttackDef,
  attackerId: PlayerId,
  selected: readonly PlayerId[],
  living: readonly PlayerId[],
): PlayerId[] {
  if (weapon.targetMode === 'ALL_OPPONENTS') return living.filter((id) => id !== attackerId);
  return [...selected];
}

/** Returns an error message, or null if the selection is valid for the weapon. */
export function targetSelectionError(
  weapon: AttackDef,
  attackerId: PlayerId,
  selected: readonly PlayerId[],
  living: readonly PlayerId[],
): string | null {
  const opponents = living.filter((id) => id !== attackerId);
  if (new Set(selected).size !== selected.length) return 'Targets must be distinct';
  for (const id of selected) {
    if (id === attackerId) return 'An attack cannot target its user';
    if (!opponents.includes(id)) return `Target ${id} is not a living opponent`;
  }
  switch (weapon.targetMode) {
    case 'SINGLE':
      return selected.length === 1 ? null : `${weapon.name} requires exactly 1 target`;
    case 'UP_TO_THREE': {
      const max = Math.min(MULTI_TARGET_LIMIT, opponents.length);
      return selected.length >= 1 && selected.length <= max
        ? null
        : `${weapon.name} requires 1 to ${max} targets`;
    }
    case 'ALL_OPPONENTS':
      // Targets are implied; accept none, or exactly the full opponent set.
      return selected.length === 0 || selected.length === opponents.length
        ? null
        : `${weapon.name} hits every opponent; omit targets or list them all`;
  }
}

export const actionCost = (action: Action | ActionRef): number => {
  switch (action.kind) {
    case 'CHARGE':
      return 0;
    case 'ATTACK':
      return ATTACKS[action.weapon].cost;
    case 'DEFENSE':
      return DEFENSES[action.defense].cost;
  }
};

const reject = (code: RejectionCode, message: string): ValidationResult => ({ ok: false, code, message });

/**
 * §10 COMMIT validation: the turn is current, the player is alive and
 * eligible, the action exists, is affordable and allowed in this phase, and
 * its targets are valid against the living roster snapshot.
 */
export function validateAction(state: GameState, action: Action): ValidationResult {
  const { turn, round, match, series } = state;
  if (!turn || series.status !== 'IN_PROGRESS') return reject('TURN_NOT_OPEN', 'No turn is open');
  if (
    action.seriesId !== series.seriesId ||
    action.matchId !== match.matchId ||
    action.roundId !== round.roundId ||
    action.turnId !== turn.turnId
  ) {
    return reject('STALE_TURN', 'Action does not belong to the open turn');
  }

  const player = state.players[action.playerId];
  if (!player || !player.alive) return reject('NOT_ALIVE', 'Player is not alive');
  if (!turn.eligiblePlayerIds.includes(action.playerId)) return reject('NOT_ELIGIBLE', 'Player is not eligible this turn');

  const availability = getActionAvailability(state, action.playerId);
  const fromAvailability = (a: Availability, label: string): ValidationResult =>
    a.available ? { ok: true } : reject(a.reason ?? 'UNKNOWN_ACTION', `${label} is unavailable (${a.reason})`);

  switch (action.kind) {
    case 'CHARGE':
      return fromAvailability(availability.charge, 'Charge');
    case 'DEFENSE':
      if (!isDefenseId(action.defense)) return reject('UNKNOWN_ACTION', `Unknown defense ${String(action.defense)}`);
      return fromAvailability(availability.defenses[action.defense], DEFENSES[action.defense].name);
    case 'ATTACK': {
      if (!isAttackId(action.weapon)) return reject('UNKNOWN_ACTION', `Unknown attack ${String(action.weapon)}`);
      const weapon = ATTACKS[action.weapon];
      const result = fromAvailability(availability.attacks[action.weapon], weapon.name);
      if (!result.ok) return result;
      const error = targetSelectionError(weapon, action.playerId, action.targets, livingIds(state));
      return error === null ? { ok: true } : reject('INVALID_TARGETS', error);
    }
    default:
      return reject('UNKNOWN_ACTION', 'Unknown action kind');
  }
}

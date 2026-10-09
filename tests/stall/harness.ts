/**
 * Deterministic round runner for stall scenarios.
 *
 * A strategy states a *preference* each turn. If the preference is illegal in
 * the current phase (e.g. Dodge in Sudden Death), the engine's own timeout rule
 * (`lockTurn`) substitutes the action, exactly as a server would when a player
 * has no valid committed action. The only randomness is that rule's seeded
 * Sudden Death attack pick.
 */
import {
  ATTACKS,
  createSeededRng,
  createSeries,
  lockTurn,
  resolveTurn,
  type AttackId,
  type DefenseId,
  type GameState,
  type Phase,
  type PlayerId,
  type TurnTransition,
} from '../../src/engine';
import { makeAction, type Choice } from '../helpers';

export interface StrategyView {
  readonly turnIndex: number;
  readonly phase: Phase;
  readonly charge: number;
  readonly opponentCharge: number;
}
export type Strategy = (view: StrategyView) => Choice;

// ---- strategy building blocks ---------------------------------------------

export const always = (defense: DefenseId): Strategy => () => ({ kind: 'DEFENSE', defense });
export const chargeGreedy: Strategy = () => ({ kind: 'CHARGE' });

/** Dodge on odd turns, Shield on even turns (or the reverse). */
export const alternating = (first: DefenseId, second: DefenseId): Strategy => ({ turnIndex }) => ({
  kind: 'DEFENSE',
  defense: turnIndex % 2 === 1 ? first : second,
});

/** Charge up to `n`, then spend it all on the matching Reflect tier, and repeat. */
export const reflectLoop = (n: 1 | 2 | 3 | 4): Strategy => {
  const defense = (['REFLECT', 'DOUBLE_REFLECT', 'TRIPLE_REFLECT', 'QUAD_REFLECT'] as const)[n - 1]!;
  return ({ charge }) => (charge >= n ? { kind: 'DEFENSE', defense } : { kind: 'CHARGE' });
};

/** Charge until the weapon is affordable, fire it, repeat. */
export const cashOut = (weapon: AttackId): Strategy => ({ charge }) =>
  charge >= ATTACKS[weapon].cost ? { kind: 'ATTACK', weapon } : { kind: 'CHARGE' };

/** Charge on odd turns, Dodge on even turns: baits an attack onto a Charge. */
export const bait: Strategy = ({ turnIndex }) =>
  turnIndex % 2 === 1 ? { kind: 'CHARGE' } : { kind: 'DEFENSE', defense: 'DODGE' };

// ---- runner ----------------------------------------------------------------

export interface RoundRun {
  readonly terminated: boolean;
  /** Turns played in the round (including the final, eliminating one). */
  readonly turns: number;
  readonly finalTransition: TurnTransition | null;
  readonly phasesSeen: readonly Phase[];
  readonly neutralizations: number;
  readonly timeouts: number;
  readonly state: GameState;
}

export function runRound(
  seed: string,
  strategies: readonly Strategy[],
  maxTurns: number,
  playerCount = 2,
): RoundRun {
  const ids: PlayerId[] = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
  let state = createSeries({ seriesId: `stall-${seed}`, playerIds: ids });
  const rng = createSeededRng(seed);
  const phases = new Set<Phase>();
  let neutralizations = 0;
  let timeouts = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    phases.add(state.turn!.phase);
    const submitted: Record<PlayerId, ReturnType<typeof makeAction>> = {};
    ids.forEach((id, seat) => {
      const strategy = strategies[seat] ?? strategies[0]!;
      const opponent = state.players[ids[(seat + 1) % ids.length]!]!;
      let choice = strategy({
        turnIndex: state.round.turnIndex,
        phase: state.turn!.phase,
        charge: state.players[id]!.charge,
        opponentCharge: opponent.charge,
      });
      if (choice.kind === 'ATTACK' && ATTACKS[choice.weapon].targetMode !== 'ALL_OPPONENTS') {
        choice = { ...choice, targets: [ids[(seat + 1) % ids.length]!] };
      }
      submitted[id] = makeAction(state, id, choice);
    });

    const locked = lockTurn(state, submitted, rng, turn);
    timeouts += locked.timedOutPlayerIds.length;
    const result = resolveTurn(state, locked.actions);
    neutralizations += result.events.filter((e) => e.outcome === 'NEUTRALIZED').length;
    state = result.nextState;

    if (result.outcome.transition !== 'NEXT_TURN') {
      return {
        terminated: true,
        turns: turn,
        finalTransition: result.outcome.transition,
        phasesSeen: [...phases],
        neutralizations,
        timeouts,
        state,
      };
    }
  }
  return { terminated: false, turns: maxTurns, finalTransition: null, phasesSeen: [...phases], neutralizations, timeouts, state };
}

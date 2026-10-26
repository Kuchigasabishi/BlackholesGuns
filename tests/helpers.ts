import {
  ATTACKS,
  createSeries,
  deepFreeze,
  phaseFor,
  resolveTurn,
  type Action,
  type AttackId,
  type DefenseId,
  type GameState,
  type PlayerId,
  type ResolveTurnResult,
} from '../src/engine';

/** A player's intended action, before turn/series ids are stamped on. */
export type Choice =
  | { readonly kind: 'CHARGE' }
  | { readonly kind: 'ATTACK'; readonly weapon: AttackId; readonly targets?: readonly PlayerId[] }
  | { readonly kind: 'DEFENSE'; readonly defense: DefenseId };

export interface Spec {
  readonly player: PlayerId;
  readonly choice: Choice;
}

export const charge = (player: PlayerId): Spec => ({ player, choice: { kind: 'CHARGE' } });
export const attack = (player: PlayerId, weapon: AttackId, ...targets: PlayerId[]): Spec => ({
  player,
  choice: { kind: 'ATTACK', weapon, targets },
});
export const defend = (player: PlayerId, defense: DefenseId): Spec => ({
  player,
  choice: { kind: 'DEFENSE', defense },
});

/** Seat ids p1..pN. */
export const ids = (n: number): PlayerId[] => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** Engine scenarios run in STANDARD mode explicitly (the original resource rules); SNOWBALL has its own tests. */
export const newGame = (n = 2, seriesId = 's1', gameMode: 'STANDARD' | 'SNOWBALL' = 'STANDARD'): GameState => createSeries({ seriesId, playerIds: ids(n), gameMode });

/** Stamps the open turn's ids onto a choice, producing an engine Action. */
export function makeAction(state: GameState, player: PlayerId, choice: Choice, acceptedAt = 0): Action {
  const turn = state.turn!;
  const base = {
    seriesId: state.series.seriesId,
    matchId: state.match.matchId,
    roundId: state.round.roundId,
    turnId: turn.turnId,
    playerId: player,
    idempotencyKey: `${turn.turnId}:${player}`,
    acceptedAt,
    validation: { ok: true } as const,
  };
  switch (choice.kind) {
    case 'CHARGE':
      return { ...base, kind: 'CHARGE' };
    case 'DEFENSE':
      return { ...base, kind: 'DEFENSE', defense: choice.defense };
    case 'ATTACK':
      return { ...base, kind: 'ATTACK', weapon: choice.weapon, targets: choice.targets ?? [] };
  }
}

export function lockedFor(state: GameState, specs: readonly Spec[]): Record<PlayerId, Action> {
  const locked: Record<PlayerId, Action> = {};
  for (const spec of specs) locked[spec.player] = makeAction(state, spec.player, spec.choice);
  return locked;
}

export const play = (state: GameState, ...specs: Spec[]): ResolveTurnResult =>
  resolveTurn(state, lockedFor(state, specs));

/** Returns a copy of `state` with the given Charge balances (players not listed keep theirs). */
export function withCharges(state: GameState, charges: Readonly<Record<PlayerId, number>>): GameState {
  const players = { ...state.players };
  for (const [id, value] of Object.entries(charges)) players[id] = { ...players[id]!, charge: value };
  return deepFreeze({ ...state, players });
}

/** Returns a copy of `state` as if `streak` no-elimination turns had already happened this round. */
export function withStreak(state: GameState, streak: number): GameState {
  const alive = state.round.survivorIds.length;
  const phase = phaseFor(alive, streak);
  return deepFreeze({
    ...state,
    round: { ...state.round, noEliminationStreak: streak, phase },
    turn: { ...state.turn!, phase },
  });
}

/** Every living player takes the same safe action (Dodge) so nothing happens. */
export const everyoneDodges = (state: GameState): Spec[] =>
  state.round.survivorIds.map((id) => defend(id, 'DODGE'));

/** The lowest Charge a player needs for an attack. */
export const costOf = (weapon: AttackId): number => ATTACKS[weapon].cost;

/** Runs a 2-player duel in a fresh game with exactly the Charge each action needs. */
export function duel(a: Spec['choice'], b: Spec['choice']): ResolveTurnResult {
  const need = (c: Spec['choice']): number => {
    if (c.kind === 'ATTACK') return ATTACKS[c.weapon].cost;
    if (c.kind === 'DEFENSE') return { DODGE: 0, SHIELD: 0, REFLECT: 1, DOUBLE_REFLECT: 2, TRIPLE_REFLECT: 3, QUAD_REFLECT: 4 }[c.defense];
    return 0;
  };
  const state = withCharges(newGame(2), { p1: need(a), p2: need(b) });
  const withTargets = (player: PlayerId, other: PlayerId, c: Spec['choice']): Spec['choice'] =>
    c.kind === 'ATTACK' && (c.targets === undefined || c.targets.length === 0) && ATTACKS[c.weapon].targetMode !== 'ALL_OPPONENTS'
      ? { ...c, targets: [other] }
      : c;
  return play(state, { player: 'p1', choice: withTargets('p1', 'p2', a) }, { player: 'p2', choice: withTargets('p2', 'p1', b) });
}

/**
 * §5 Complete Interaction Matrix v2. Authoritative for attack-versus-defense.
 *
 * Each cell is the result for the *defending target* hit by the row attack
 * while using the column defense. Labels (including the "3" / "All"
 * cardinality) are preserved exactly; per-target meaning is given by
 * `matrixCellEffect`.
 */
import type { AttackId, DefenseId } from './catalog';

export type MatrixResult = 'BLOCK' | 'ELIMINATE' | 'ELIMINATE_3' | 'ELIMINATE_ALL' | 'REFLECT';

const B: MatrixResult = 'BLOCK';
const E: MatrixResult = 'ELIMINATE';
const E3: MatrixResult = 'ELIMINATE_3';
const EA: MatrixResult = 'ELIMINATE_ALL';
const R: MatrixResult = 'REFLECT';

type Row = readonly [
  dodge: MatrixResult,
  shield: MatrixResult,
  reflect: MatrixResult,
  doubleReflect: MatrixResult,
  tripleReflect: MatrixResult,
  quadReflect: MatrixResult,
];

const row = ([dodge, shield, reflect, doubleReflect, tripleReflect, quadReflect]: Row): Readonly<
  Record<DefenseId, MatrixResult>
> => ({
  DODGE: dodge,
  SHIELD: shield,
  REFLECT: reflect,
  DOUBLE_REFLECT: doubleReflect,
  TRIPLE_REFLECT: tripleReflect,
  QUAD_REFLECT: quadReflect,
});

export const INTERACTION_MATRIX_V2: Readonly<Record<AttackId, Readonly<Record<DefenseId, MatrixResult>>>> = {
  //                        Dodge Shield Reflect Double Triple Quad
  GUN: row([B, B, R, R, R, R]),
  KNIFE: row([B, B, E, B, B, B]),
  GATLING_GUN: row([E, B, B, R, R, R]),
  FLAMETHROWER: row([B, E, B, R, R, R]),
  AXE: row([B, B, E, E, B, B]),
  THREE_HIT_COMBO: row([E3, B, E3, E3, R, R]),
  GRENADE: row([B, E3, E3, E3, R, R]),
  KATANA: row([B, B, E3, E3, E3, B]),
  BOMB: row([EA, B, EA, EA, EA, R]),
  NUKE: row([B, EA, EA, EA, EA, R]),
  MJOLNIR: row([B, B, EA, EA, EA, EA]),
  BLACKHOLE: row([EA, EA, EA, EA, EA, EA]),
};

export const lookupMatrix = (attack: AttackId, defense: DefenseId): MatrixResult =>
  INTERACTION_MATRIX_V2[attack][defense];

/**
 * What a cell means for one resolved (attacker, target) interaction.
 *
 * GDD §4/§5/§7 require every selected target to be resolved independently, so
 * an "Eliminate", "Eliminate 3 Players" or "Eliminate All Players" cell
 * eliminates *that target only*; the "3"/"All" part is already expressed by
 * which targets the weapon selects (§7). REFLECT eliminates the attacker.
 */
export type MatrixEffect = 'TARGET_ELIMINATED' | 'ATTACKER_ELIMINATED' | 'BLOCKED';

export const matrixCellEffect = (result: MatrixResult): MatrixEffect => {
  switch (result) {
    case 'BLOCK':
      return 'BLOCKED';
    case 'REFLECT':
      return 'ATTACKER_ELIMINATED';
    case 'ELIMINATE':
    case 'ELIMINATE_3':
    case 'ELIMINATE_ALL':
      return 'TARGET_ELIMINATED';
  }
};

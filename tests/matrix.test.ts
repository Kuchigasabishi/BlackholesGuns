import { describe, expect, it } from 'vitest';
import {
  ATTACKS,
  ATTACK_IDS,
  DEFENSES,
  DEFENSE_IDS,
  INTERACTION_MATRIX_V2,
  lookupMatrix,
  matrixCellEffect,
  type AttackId,
  type DefenseId,
  type MatrixResult,
} from '../src/engine';
import { duel } from './helpers';

/**
 * Independent transcription of GDD §5, typed as the document prints it
 * (display names, printed labels) and deliberately NOT sharing code with
 * src/engine/matrix.ts. Columns: Dodge | Shield | Reflect | Double Reflect |
 * Triple Reflect | Quad Reflect.
 */
const GDD_MATRIX_TEXT = `
Gun (1)          | Block          | Block          | Reflect        | Reflect        | Reflect        | Reflect
Knife (1)        | Block          | Block          | Eliminate      | Block          | Block          | Block
Gatling Gun (2)  | Eliminate      | Block          | Block          | Reflect        | Reflect        | Reflect
Flamethrower (2) | Block          | Eliminate      | Block          | Reflect        | Reflect        | Reflect
Axe (2)          | Block          | Block          | Eliminate      | Eliminate      | Block          | Block
3-hit Combo (3)  | Eliminate 3 Players | Block     | Eliminate 3 Players | Eliminate 3 Players | Reflect | Reflect
Grenade (3)      | Block          | Eliminate 3 Players | Eliminate 3 Players | Eliminate 3 Players | Reflect | Reflect
Katana (3)       | Block          | Block          | Eliminate 3 Players | Eliminate 3 Players | Eliminate 3 Players | Block
Bomb (4)         | Eliminate All Players | Block   | Eliminate All Players | Eliminate All Players | Eliminate All Players | Reflect
Nuke (4)         | Block          | Eliminate All Players | Eliminate All Players | Eliminate All Players | Eliminate All Players | Reflect
Mjolnir (4)      | Block          | Block          | Eliminate All Players | Eliminate All Players | Eliminate All Players | Eliminate All Players
Blackhole (5)    | Eliminate All Players | Eliminate All Players | Eliminate All Players | Eliminate All Players | Eliminate All Players | Eliminate All Players
`;

const DEFENSE_COLUMNS: readonly DefenseId[] = [
  'DODGE',
  'SHIELD',
  'REFLECT',
  'DOUBLE_REFLECT',
  'TRIPLE_REFLECT',
  'QUAD_REFLECT',
];

const ATTACK_BY_PRINTED_NAME: Record<string, AttackId> = {
  Gun: 'GUN',
  Knife: 'KNIFE',
  'Gatling Gun': 'GATLING_GUN',
  Flamethrower: 'FLAMETHROWER',
  Axe: 'AXE',
  '3-hit Combo': 'THREE_HIT_COMBO',
  Grenade: 'GRENADE',
  Katana: 'KATANA',
  Bomb: 'BOMB',
  Nuke: 'NUKE',
  Mjolnir: 'MJOLNIR',
  Blackhole: 'BLACKHOLE',
};

const LABEL: Record<string, MatrixResult> = {
  Block: 'BLOCK',
  Eliminate: 'ELIMINATE',
  'Eliminate 3 Players': 'ELIMINATE_3',
  'Eliminate All Players': 'ELIMINATE_ALL',
  Reflect: 'REFLECT',
};

interface Cell {
  attack: AttackId;
  printedCost: number;
  defense: DefenseId;
  expected: MatrixResult;
}

const gddCells: Cell[] = GDD_MATRIX_TEXT.trim()
  .split('\n')
  .flatMap((line) => {
    const [head, ...labels] = line.split('|').map((part) => part.trim());
    const match = /^(.*) \((\d)\)$/.exec(head!)!;
    const attack = ATTACK_BY_PRINTED_NAME[match[1]!]!;
    expect(labels, `row ${head}`).toHaveLength(6);
    return labels.map((label, i) => ({
      attack,
      printedCost: Number(match[2]),
      defense: DEFENSE_COLUMNS[i]!,
      expected: LABEL[label]!,
    }));
  });

describe('GDD §3 catalog', () => {
  it('has exactly 12 attacks and 6 defenses', () => {
    expect(ATTACK_IDS).toHaveLength(12);
    expect(DEFENSE_IDS).toHaveLength(6);
    expect(Object.keys(ATTACKS)).toHaveLength(12);
  });

  it('matches the printed attack costs (which also define tiers)', () => {
    for (const cell of gddCells) {
      expect(ATTACKS[cell.attack].cost, cell.attack).toBe(cell.printedCost);
      expect(ATTACKS[cell.attack].tier, cell.attack).toBe(cell.printedCost);
    }
  });

  it('matches the printed defense costs', () => {
    expect(
      Object.fromEntries(DEFENSE_IDS.map((id) => [DEFENSES[id].name, DEFENSES[id].cost])),
    ).toEqual({
      Dodge: 0,
      Shield: 0,
      Reflect: 1,
      'Double Reflect': 2,
      'Triple Reflect': 3,
      'Quad Reflect': 4,
    });
  });

  it('classifies attacks as locked in the §3 table (3-hit Combo and Grenade are Ranged)', () => {
    const ranged = ['GUN', 'GATLING_GUN', 'FLAMETHROWER', 'THREE_HIT_COMBO', 'GRENADE', 'BOMB', 'NUKE'];
    const melee = ['KNIFE', 'AXE', 'KATANA', 'MJOLNIR'];
    for (const id of ATTACK_IDS) {
      const expected = ranged.includes(id) ? 'RANGED' : melee.includes(id) ? 'MELEE' : 'SPECIAL';
      expect(ATTACKS[id].attackClass, id).toBe(expected);
    }
    expect(ATTACKS.BLACKHOLE.attackClass).toBe('SPECIAL');
  });

  it('uses the §7 target modes', () => {
    for (const id of ['GUN', 'KNIFE', 'GATLING_GUN', 'FLAMETHROWER', 'AXE'] as const) {
      expect(ATTACKS[id].targetMode, id).toBe('SINGLE');
    }
    for (const id of ['THREE_HIT_COMBO', 'GRENADE', 'KATANA'] as const) {
      expect(ATTACKS[id].targetMode, id).toBe('UP_TO_THREE');
    }
    for (const id of ['BOMB', 'NUKE', 'MJOLNIR', 'BLACKHOLE'] as const) {
      expect(ATTACKS[id].targetMode, id).toBe('ALL_OPPONENTS');
    }
  });
});

describe('GDD §5 interaction matrix v2', () => {
  it('transcribes 72 cells', () => {
    expect(gddCells).toHaveLength(72);
  });

  it.each(gddCells)('$attack vs $defense = $expected', ({ attack, defense, expected }) => {
    expect(lookupMatrix(attack, defense)).toBe(expected);
    expect(INTERACTION_MATRIX_V2[attack][defense]).toBe(expected);
  });

  it('has no cells beyond the 12x6 grid', () => {
    expect(Object.keys(INTERACTION_MATRIX_V2).sort()).toEqual([...ATTACK_IDS].sort());
    for (const id of ATTACK_IDS) {
      expect(Object.keys(INTERACTION_MATRIX_V2[id]).sort()).toEqual([...DEFENSE_IDS].sort());
    }
  });

  it('maps cell labels to per-target effects', () => {
    expect(matrixCellEffect('BLOCK')).toBe('BLOCKED');
    expect(matrixCellEffect('REFLECT')).toBe('ATTACKER_ELIMINATED');
    expect(matrixCellEffect('ELIMINATE')).toBe('TARGET_ELIMINATED');
    expect(matrixCellEffect('ELIMINATE_3')).toBe('TARGET_ELIMINATED');
    expect(matrixCellEffect('ELIMINATE_ALL')).toBe('TARGET_ELIMINATED');
  });
});

describe('matrix applied through resolveTurn (2 players, Normal Phase)', () => {
  // The defender is eliminated unless the cell is Block or Reflect; Reflect eliminates the attacker.
  it.each(gddCells)('$attack vs $defense resolves per its cell', ({ attack, defense, expected }) => {
    const result = duel({ kind: 'ATTACK', weapon: attack }, { kind: 'DEFENSE', defense });
    const eliminated = [...result.outcome.eliminatedPlayerIds];
    const expectedEliminated = expected === 'BLOCK' ? [] : expected === 'REFLECT' ? ['p1'] : ['p2'];
    expect(eliminated).toEqual(expectedEliminated);

    // Exactly one event: p1 attacking p2, citing the matrix cell.
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      sourcePlayerId: 'p1',
      selectedTargetId: 'p2',
      ruleType: 'MATRIX',
      ruleId: `MATRIX_V2:${attack}:${defense}`,
      matrixResult: expected,
    });
  });
});

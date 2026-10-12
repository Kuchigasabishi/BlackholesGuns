/**
 * Tooltip text for the Control Panel, read straight from the frozen §5 matrix v2
 * (`INTERACTION_MATRIX_V2`) so it can never drift from what the server resolves.
 */
import { ATTACK_IDS, ATTACKS, DEFENSE_IDS, DEFENSES, INTERACTION_MATRIX_V2, type AttackId, type DefenseId, type MatrixResult } from '../../../src/engine';

export interface TipLine {
  readonly label: string;
  readonly items: readonly string[];
  readonly tone: 'good' | 'bad' | 'gold' | 'dim';
}

export interface MatrixTip {
  readonly title: string;
  readonly lines: readonly TipLine[];
}

const BASIC: readonly DefenseId[] = ['DODGE', 'SHIELD'];
const REFLECTS: readonly DefenseId[] = DEFENSE_IDS.filter((d) => d.endsWith('REFLECT'));
const up = (id: string): string => (id in ATTACKS ? ATTACKS[id as AttackId].name : DEFENSES[id as DefenseId].name).toUpperCase();

/** The matrix cell label, preserved as written in §5 ("3" / "All" cardinality included). */
const ELIMINATES: Record<Exclude<MatrixResult, 'BLOCK' | 'REFLECT'>, string> = {
  ELIMINATE: 'Eliminates Target',
  ELIMINATE_3: 'Eliminates 3 Players',
  ELIMINATE_ALL: 'Eliminates All Players',
};

const none = (items: readonly string[]): readonly string[] => (items.length ? items : ['none']);

export function attackTip(attack: AttackId): MatrixTip {
  const cell = INTERACTION_MATRIX_V2[attack];
  const effective = (ds: readonly DefenseId[]) =>
    ds.filter((d) => cell[d] !== 'BLOCK' && cell[d] !== 'REFLECT').map((d) => `${up(d)} (${ELIMINATES[cell[d] as keyof typeof ELIMINATES]})`);
  const blocked = (ds: readonly DefenseId[]) => ds.filter((d) => cell[d] === 'BLOCK').map(up);
  return {
    title: `${ATTACKS[attack].name} · ${ATTACKS[attack].cost}⚡`,
    lines: [
      { label: 'Effective against', items: none(effective(BASIC)), tone: 'good' },
      { label: 'Blocked by', items: none(blocked(BASIC)), tone: 'bad' },
      { label: 'Reflected back by', items: none(REFLECTS.filter((d) => cell[d] === 'REFLECT').map(up)), tone: 'gold' },
      { label: 'Also blocked by', items: none(blocked(REFLECTS)), tone: 'dim' },
      { label: 'Gets through', items: none(effective(REFLECTS)), tone: 'good' },
    ],
  };
}

export function reflectTip(defense: DefenseId): MatrixTip {
  const by = (r: (cell: MatrixResult) => boolean) => ATTACK_IDS.filter((a) => r(INTERACTION_MATRIX_V2[a][defense])).map(up);
  return {
    title: `${DEFENSES[defense].name} · ${DEFENSES[defense].cost}⚡`,
    lines: [
      { label: 'Reflects (attacker is eliminated)', items: none(by((c) => c === 'REFLECT')), tone: 'gold' },
      { label: 'Blocks', items: none(by((c) => c === 'BLOCK')), tone: 'good' },
      { label: 'Eliminated by', items: none(by((c) => c !== 'BLOCK' && c !== 'REFLECT')), tone: 'bad' },
    ],
  };
}

import { describe, expect, it } from 'vitest';
import { ATTACK_IDS, DEFENSE_IDS, INTERACTION_MATRIX_V2 } from '../../src/engine';
import { attackTip, reflectTip } from '../src/format/matrixTip';

const line = (t: ReturnType<typeof attackTip>, label: string) => t.lines.find((l) => l.label === label)!.items;

describe('matrix tooltips are generated from the frozen v2 matrix', () => {
  it('Flamethrower and Gatling Gun match the spec examples', () => {
    expect(line(attackTip('FLAMETHROWER'), 'Effective against')).toEqual(['SHIELD (Eliminates Target)']);
    expect(line(attackTip('FLAMETHROWER'), 'Blocked by')).toEqual(['DODGE']);
    expect(line(attackTip('GATLING_GUN'), 'Effective against')).toEqual(['DODGE (Eliminates Target)']);
    expect(line(attackTip('GATLING_GUN'), 'Blocked by')).toEqual(['SHIELD']);
  });

  it('covers all 12 attacks and 4 Reflects, consistent with every matrix cell', () => {
    for (const a of ATTACK_IDS) {
      const t = attackTip(a);
      for (const d of ['DODGE', 'SHIELD'] as const) {
        const cell = INTERACTION_MATRIX_V2[a][d];
        const inEffective = line(t, 'Effective against').some((x) => x.startsWith(d));
        expect(inEffective).toBe(cell !== 'BLOCK' && cell !== 'REFLECT');
        expect(line(t, 'Blocked by').includes(d)).toBe(cell === 'BLOCK');
      }
    }
    for (const d of DEFENSE_IDS.filter((x) => x.endsWith('REFLECT'))) {
      const t = reflectTip(d);
      const all = [...line(t, 'Reflects (attacker is eliminated)'), ...line(t, 'Blocks'), ...line(t, 'Eliminated by')].filter((x) => x !== 'none');
      expect(all).toHaveLength(12);
    }
  });

  it('keeps the 3 / All cardinality labels', () => {
    expect(line(attackTip('GRENADE'), 'Effective against')).toEqual(['SHIELD (Eliminates 3 Players)']);
    expect(line(attackTip('BLACKHOLE'), 'Effective against')).toEqual(['DODGE (Eliminates All Players)', 'SHIELD (Eliminates All Players)']);
  });
});

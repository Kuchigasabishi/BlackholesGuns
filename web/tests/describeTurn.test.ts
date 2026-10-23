import { describe, expect, it } from 'vitest';
import { describeTurn } from '../src/format/describeTurn';
import { CHARGE, NAMES, attack, defend, newGame, resultFor, withCharges, withStreak } from './fixtures';

const nameOf = (id: string): string => NAMES[Number(id.slice(1)) - 1] ?? id;
const text = (log: ReturnType<typeof describeTurn>): string => log.blocks.map((b) => b.text).join('\n');

describe('describeTurn: heading and reveal', () => {
  it('titles the turn with its number and phase', () => {
    const log = describeTurn(resultFor(newGame(2), { p1: CHARGE, p2: defend('DODGE') }), nameOf);
    expect(log.heading).toBe('Turn 1 · NORMAL PHASE');
    expect(log.turnNumber).toBe(1);
  });

  it('opens with a single REVEAL block listing every action together', () => {
    const state = withCharges(newGame(3), { p1: 3 });
    const log = describeTurn(resultFor(state, { p1: attack('KATANA', 'p2', 'p3'), p2: defend('DODGE'), p3: CHARGE }), nameOf);
    expect(log.blocks[0]!.text).toBe(
      ['REVEAL — all actions at once:', '  Ada cast [KATANA] → Bo, Cy', '  Bo cast [DODGE]', '  Cy cast [CHARGE]'].join('\n'),
    );
  });

  it('marks server-chosen (timed out) actions', () => {
    const log = describeTurn(resultFor(newGame(2), { p1: { ...CHARGE, timedOut: true }, p2: CHARGE }), nameOf);
    expect(log.blocks[0]!.text).toContain('Ada cast [CHARGE] (timed out: chosen by the server)');
    expect(log.blocks[0]!.text).not.toContain('Bo cast [CHARGE] (timed');
  });

  it('shows all-opponent attacks as hitting everyone', () => {
    const state = withCharges(newGame(3), { p1: 4 });
    const log = describeTurn(resultFor(state, { p1: attack('BOMB'), p2: defend('SHIELD'), p3: defend('SHIELD') }), nameOf);
    expect(log.blocks[0]!.text).toContain('Ada cast [BOMB] → all opponents');
  });
});

describe('describeTurn: who targeted whom and what blocked what', () => {
  it('Gun into a Dodge: targeted line plus a [BLOCKED] breakdown', () => {
    const state = withCharges(newGame(2), { p1: 1 });
    const log = describeTurn(resultFor(state, { p1: attack('GUN', 'p2'), p2: defend('DODGE') }), nameOf);
    expect(log.blocks[1]).toEqual({
      text: 'Ada targeted Bo with Gun:\n  → Bo [BLOCKED] Dodge blocked Gun.',
      tone: 'block',
    });
  });

  it('a multi-target attack yields one multi-line block with a line per target, each independent', () => {
    const state = withCharges(newGame(4), { p1: 3 });
    const log = describeTurn(
      resultFor(state, { p1: attack('KATANA', 'p2', 'p3', 'p4'), p2: defend('DODGE'), p3: defend('SHIELD'), p4: CHARGE }),
      nameOf,
    );
    expect(log.blocks[1]!.text.split('\n')).toEqual([
      'Ada targeted Bo, Cy, Di with Katana:',
      '  → Bo [BLOCKED] Dodge blocked Katana.',
      '  → Cy [BLOCKED] Shield blocked Katana.',
      '  → Di [ELIMINATED] was Charging and was hit by Katana.',
    ]);
    expect(log.blocks[1]!.tone).toBe('danger');
  });

  it('a defense that fails to stop the attack is called out', () => {
    const state = withCharges(newGame(2), { p1: 2 });
    const log = describeTurn(resultFor(state, { p1: attack('GATLING_GUN', 'p2'), p2: defend('DODGE') }), nameOf);
    expect(text(log)).toContain('→ Bo [ELIMINATED] Dodge did not stop Gatling Gun.');
  });

  it('Reflect sends the attack back and eliminates the attacker', () => {
    const state = withCharges(newGame(2), { p1: 1, p2: 1 });
    const log = describeTurn(resultFor(state, { p1: attack('GUN', 'p2'), p2: defend('REFLECT') }), nameOf);
    expect(text(log)).toContain('→ Bo [REFLECTED] Reflect sent Gun back: Ada is [ELIMINATED].');
  });

  it('an all-opponent attack lists every opponent it hit', () => {
    const state = withCharges(newGame(4), { p1: 4, p4: 4 });
    const log = describeTurn(
      resultFor(state, { p1: attack('BOMB'), p2: defend('DODGE'), p3: defend('SHIELD'), p4: defend('QUAD_REFLECT') }),
      nameOf,
    );
    const block = log.blocks[1]!.text;
    expect(block).toContain('Ada targeted every opponent (Bo, Cy, Di) with Bomb:');
    expect(block).toContain('→ Bo [ELIMINATED] Dodge did not stop Bomb.');
    expect(block).toContain('→ Cy [BLOCKED] Shield blocked Bomb.');
    expect(block).toContain('→ Di [REFLECTED] Quad Reflect sent Bomb back: Ada is [ELIMINATED].');
  });
});

describe('describeTurn: attack-versus-attack collisions', () => {
  it('higher tier wins', () => {
    const state = withCharges(newGame(2), { p1: 1, p2: 2 });
    const log = describeTurn(resultFor(state, { p1: attack('GUN', 'p2'), p2: attack('AXE', 'p1') }), nameOf);
    expect(text(log)).toContain("→ Bo [CLASH LOST] Bo's Axe beat Gun (Tier 2 outranks Tier 1): Ada is [ELIMINATED].");
    expect(text(log)).toContain("→ Ada [CLASH WON] Axe beat Ada's Gun (Tier 2 outranks Tier 1): Ada is [ELIMINATED].");
  });

  it('same tier: ranged beats melee', () => {
    const state = withCharges(newGame(2), { p1: 1, p2: 1 });
    const log = describeTurn(resultFor(state, { p1: attack('GUN', 'p2'), p2: attack('KNIFE', 'p1') }), nameOf);
    expect(text(log)).toContain('(same tier: ranged beats melee)');
    expect(log.blocks.some((b) => b.text.includes('Bo is [ELIMINATED]'))).toBe(true);
  });

  it('same tier and class neutralize: both survive and the round goes on', () => {
    const state = withCharges(newGame(2), { p1: 1, p2: 1 });
    const log = describeTurn(resultFor(state, { p1: attack('GUN', 'p2'), p2: attack('GUN', 'p1') }), nameOf);
    expect(text(log)).toContain("→ Bo [NEUTRALIZED] Gun met Bo's Gun (same tier and class cancel out): both survive.");
    expect(text(log)).toContain('No eliminations. No-elimination streak: 1.');
  });

  it('Blackhole mirror neutralizes, Blackhole beats anything else', () => {
    const mirror = describeTurn(resultFor(withCharges(newGame(2), { p1: 5, p2: 5 }), { p1: attack('BLACKHOLE', 'p2'), p2: attack('BLACKHOLE', 'p1') }), nameOf);
    expect(text(mirror)).toContain('[NEUTRALIZED]');
    expect(text(mirror)).toContain('Blackhole only neutralizes another Blackhole');
    const wins = describeTurn(resultFor(withCharges(newGame(2), { p1: 5, p2: 4 }), { p1: attack('BLACKHOLE', 'p2'), p2: attack('NUKE', 'p1') }), nameOf);
    expect(text(wins)).toContain('Blackhole beats every attack except another Blackhole');
  });
});

describe('describeTurn: outcomes and lifecycle', () => {
  it('explicitly labels eliminations with [ELIMINATED] and lists survivors', () => {
    const state = withCharges(newGame(3), { p1: 1 });
    const log = describeTurn(resultFor(state, { p1: attack('GUN', 'p2'), p2: CHARGE, p3: defend('DODGE') }), nameOf);
    const last = log.blocks.find((b) => b.text.startsWith('Bo [ELIMINATED]'))!;
    expect(last.text).toBe('Bo [ELIMINATED]\nSurvivors: Ada, Cy');
    expect(last.tone).toBe('danger');
    expect(text(log)).toContain('ROUND OVER — survivors (Ada, Cy) start a new round at 0⚡.');
  });

  it('reports Charge changes for survivors', () => {
    const log = describeTurn(resultFor(withCharges(newGame(2), { p2: 3 }), { p1: CHARGE, p2: defend('SHIELD') }), nameOf);
    expect(text(log)).toContain('⚡ Charge: Ada +1 (now 1)');
  });

  it('announces the match winner and updated Match Wins', () => {
    const state = withCharges(newGame(2), { p1: 1 });
    const log = describeTurn(resultFor(state, { p1: attack('GUN', 'p2'), p2: CHARGE }), nameOf);
    const banner = log.blocks.at(-1)!;
    expect(banner.tone).toBe('win');
    expect(banner.text).toBe('MATCH OVER — Ada wins the match!\nMatch Wins: Ada 1 · Bo 0\nA new match begins with the full lobby.');
  });

  it('announces the series winner', () => {
    let state = newGame(2);
    // Give Ada nine match wins, then let her take the tenth.
    state = {
      ...state,
      series: { ...state.series, matchWins: { p1: 9, p2: 0 } },
      players: { ...state.players, p1: { ...state.players.p1!, matchWins: 9, charge: 1 } },
    };
    const log = describeTurn(resultFor(state, { p1: attack('GUN', 'p2'), p2: CHARGE }), nameOf);
    expect(log.blocks.at(-1)!.text).toBe('SERIES OVER — Ada wins the series!\nMatch Wins: Ada 10 · Bo 0');
  });

  it('describes the void round when everyone is eliminated', () => {
    const state = withCharges(newGame(3), { p1: 4, p2: 4, p3: 4 });
    const log = describeTurn(resultFor(state, { p1: attack('BOMB'), p2: defend('QUAD_REFLECT'), p3: attack('MJOLNIR') }), nameOf);
    expect(text(log)).toContain('EVERYONE WAS ELIMINATED — the round is void');
  });
});

describe('describeTurn: phase warnings (§13)', () => {
  it('warns when Sudden Death begins and explains its rules', () => {
    const state = withStreak(newGame(2), 9, 'NORMAL');
    const log = describeTurn(resultFor(state, { p1: defend('DODGE'), p2: defend('DODGE') }), nameOf);
    const warning = log.blocks.at(-1)!;
    expect(warning.tone).toBe('phase');
    expect(warning.text).toContain('SUDDEN DEATH begins');
    expect(warning.text).toContain('All six defenses are disabled');
    expect(warning.text).toContain('MUST attack');
  });

  it('warns when Overtime begins and explains that normal rules return', () => {
    const state = withCharges(withStreak(newGame(2), 14, 'SUDDEN_DEATH'), { p1: 1, p2: 1 });
    const log = describeTurn(resultFor(state, { p1: attack('GUN', 'p2'), p2: attack('GUN', 'p1') }), nameOf);
    expect(log.heading).toBe('Turn 1 · SUDDEN DEATH');
    expect(log.blocks.at(-1)!.text).toContain('OVERTIME begins');
    expect(log.blocks.at(-1)!.text).toContain('defenses are back');
  });

  it('does not warn in an ordinary turn', () => {
    const log = describeTurn(resultFor(newGame(2), { p1: CHARGE, p2: CHARGE }), nameOf);
    expect(log.blocks.some((b) => b.tone === 'phase')).toBe(false);
  });
});

describe('describeTurn: color independence', () => {
  it('every elimination, block, reflect and neutralize line carries a bracketed text tag', () => {
    const cases = [
      [withCharges(newGame(2), { p1: 1 }), { p1: attack('GUN', 'p2'), p2: CHARGE }, '[ELIMINATED]'],
      [withCharges(newGame(2), { p1: 1 }), { p1: attack('GUN', 'p2'), p2: defend('SHIELD') }, '[BLOCKED]'],
      [withCharges(newGame(2), { p1: 1, p2: 1 }), { p1: attack('GUN', 'p2'), p2: defend('REFLECT') }, '[REFLECTED]'],
      [withCharges(newGame(2), { p1: 1, p2: 1 }), { p1: attack('GUN', 'p2'), p2: attack('GUN', 'p1') }, '[NEUTRALIZED]'],
    ] as const;
    for (const [state, specs, tag] of cases) {
      expect(text(describeTurn(resultFor(state, specs as never), nameOf))).toContain(tag);
    }
  });
});

import { describeResolution } from '../src/format/describeTurn';

describe('describeTurn: Charge fog of war (§12)', () => {
  const state = withCharges(newGame(3), { p1: 0 });
  const r = resultFor(state, { p1: CHARGE, p2: CHARGE, p3: CHARGE });
  const chargeLine = (log: ReturnType<typeof describeTurn>) => log.blocks.find((b) => b.text.startsWith('⚡ Charge'))?.text;

  it('with a viewer, only that player\'s Charge change is written', () => {
    expect(chargeLine(describeTurn(r, nameOf, 'p2'))).toBe('⚡ Charge: Bo +1 (now 1)');
  });
  it('with no viewer identity (null) no Charge change is written', () => {
    expect(chargeLine(describeTurn(r, nameOf, null))).toBeUndefined();
  });
});

describe('describeResolution: Turn Resolution modal content', () => {
  const two = () => withCharges(newGame(2), { p1: 4, p2: 4 });
  const three = () => withCharges(newGame(3), { p1: 1, p3: 1 });

  it('Stage 1 lists who targeted whom with what, then the other revealed actions', () => {
    const r = resultFor(three(), { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: attack('KNIFE', 'p2') });
    const d = describeResolution(r, nameOf);
    expect(d.targeting).toEqual(['Ada targeted Bo with Gun', 'Cy targeted Bo with Knife']);
    expect(d.others).toEqual(['Bo cast SHIELD']);
  });

  it('Stage 2: a SHIELD block says who blocked what and with which defense', () => {
    const r = resultFor(three(), { p1: attack('GUN', 'p2'), p2: defend('SHIELD'), p3: CHARGE });
    expect(describeResolution(r, nameOf).outcomes).toEqual([{ tag: 'BLOCKED', text: "Bo successfully blocked Ada's Gun using SHIELD!" }]);
  });

  it('Stage 2: DODGE reads as avoiding the attack', () => {
    const r = resultFor(three(), { p1: attack('GUN', 'p2'), p2: defend('DODGE'), p3: CHARGE });
    expect(describeResolution(r, nameOf).outcomes).toEqual([{ tag: 'BLOCKED', text: "Bo avoided Ada's Gun via DODGE!" }]);
  });

  it('Stage 2: REFLECT sends the attack back and eliminates the attacker', () => {
    const r = resultFor(withCharges(three(), { p2: 1 }), { p1: attack('GUN', 'p2'), p2: defend('REFLECT'), p3: CHARGE });
    expect(describeResolution(r, nameOf).outcomes).toEqual([{ tag: 'REFLECTED', text: "Bo's REFLECT sent Ada's Gun back: Ada is eliminated" }]);
  });

  it('Stage 2: hitting a Charging player, and an attack that gets through a defense', () => {
    const hit = resultFor(three(), { p1: attack('GUN', 'p2'), p2: CHARGE, p3: CHARGE });
    expect(describeResolution(hit, nameOf).outcomes).toEqual([{ tag: 'ELIMINATED', text: "Bo was Charging: Ada's Gun hit them" }]);
    const through = resultFor(withCharges(newGame(2), { p1: 2 }), { p1: attack('GATLING_GUN', 'p2'), p2: defend('DODGE') });
    expect(describeResolution(through, nameOf).outcomes).toEqual([{ tag: 'ELIMINATED', text: "Bo: Ada's Gatling Gun got through DODGE" }]);
  });

  it('collisions: GUN vs KNIFE is one line naming Ranged-over-Melee (the same either seat order)', () => {
    const a = resultFor(two(), { p1: attack('GUN', 'p2'), p2: attack('KNIFE', 'p1') });
    expect(describeResolution(a, nameOf).outcomes).toEqual([{ tag: 'ELIMINATED', text: "Bo: Ada's Gun defeated Bo's Knife via Ranged-over-Melee tier priority" }]);
    const b = resultFor(two(), { p1: attack('KNIFE', 'p2'), p2: attack('GUN', 'p1') });
    expect(describeResolution(b, nameOf).outcomes).toEqual([{ tag: 'ELIMINATED', text: "Ada: Bo's Gun defeated Ada's Knife via Ranged-over-Melee tier priority" }]);
  });

  it('collisions: higher tier names both tiers; same tier and class neutralize once', () => {
    const tier = resultFor(two(), { p1: attack('GUN', 'p2'), p2: attack('AXE', 'p1') });
    expect(describeResolution(tier, nameOf).outcomes[0]!.text).toBe("Ada: Bo's Axe defeated Ada's Gun via higher-tier priority (Tier 2 over Tier 1)");
    const tie = resultFor(two(), { p1: attack('GUN', 'p2'), p2: attack('GUN', 'p1') });
    expect(describeResolution(tie, nameOf).outcomes).toEqual([{ tag: 'NEUTRALIZED', text: "Ada's Gun and Bo's Gun cancelled out (same tier and class): both survive" }]);
  });

  it('says so when nobody attacked', () => {
    const r = resultFor(newGame(2), { p1: CHARGE, p2: defend('DODGE') });
    const d = describeResolution(r, nameOf);
    expect(d.targeting).toEqual(['Nobody attacked this turn.']);
    expect(d.outcomes).toEqual([]);
  });
});

describe('rules v1.1: an attacker hit by a third party', () => {
  it('is described as having no defense, and the projectile is a HIT', async () => {
    const { describeBattlefield, describeResolution } = await import('../src/format/describeTurn');
    const { planTurn } = await import('../src/format/fxPlan');
    const { NAMES, attack, defend, newGame, resultFor, withCharges } = await import('./fixtures');
    const nameOf = (id: string) => NAMES[Number(id.slice(1)) - 1] ?? id;
    const r = resultFor(withCharges(newGame(3), { p1: 2, p3: 1 }), { p1: attack('FLAMETHROWER', 'p2'), p2: defend('DODGE'), p3: attack('KNIFE', 'p1') });
    expect(describeResolution(r, nameOf).outcomes.map((o) => o.text)).toContain("Ada: Cy's Knife hit Ada, who was attacking someone else and had no defense");
    const ada = describeBattlefield(r, nameOf).find((c) => c.playerId === 'p1')!;
    expect(ada.eliminated).toBe(true);
    expect(ada.incoming[0]).toMatchObject({ result: 'ELIMINATED', note: "Cy's Knife hit Ada, who was attacking someone else (no defense)" });
    expect(planTurn(r).projectiles.find((p) => p.from === 'p3')).toMatchObject({ to: 'p1', end: 'HIT' });
  });
});

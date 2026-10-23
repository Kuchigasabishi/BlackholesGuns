/**
 * Turns a resolved turn into the readable, multi-line event log text (GDD §13:
 * "Present each attack, defense response, matrix outcome, targeted players,
 * eliminations, and survivors in a readable event log").
 *
 * Every outcome carries a bracketed TEXT tag ([ELIMINATED], [BLOCKED], ...) so
 * meaning never depends on colour alone.
 */
import { ATTACKS, DEFENSES, type ActionRef, type Phase, type PlayerId, type ResolutionEvent } from '../../../src/engine';
import type { PublicAction, TurnResultPayload } from '../../../src/server/protocol';
import { actionEmoji } from './emoji';

export type Tone = 'neutral' | 'action' | 'block' | 'danger' | 'phase' | 'system' | 'win';

export interface LogBlock {
  /** May contain newlines; rendered with preserved whitespace. */
  readonly text: string;
  readonly tone: Tone;
}

export interface TurnLog {
  readonly turnId: string;
  readonly turnNumber: number;
  readonly phase: Phase;
  readonly heading: string;
  readonly blocks: readonly LogBlock[];
}

export type NameOf = (playerId: PlayerId) => string;

export const PHASE_LABEL: Record<Phase, string> = {
  NORMAL: 'NORMAL PHASE',
  SUDDEN_DEATH: 'SUDDEN DEATH',
  OVERTIME: 'OVERTIME',
};

const weaponName = (id: keyof typeof ATTACKS): string => ATTACKS[id].name;

const list = (names: readonly string[]): string => (names.length === 0 ? 'nobody' : names.join(', '));

/** Short label for an action, e.g. "[GUN]" or "[DODGE]". */
export function actionTag(action: ActionRef | PublicAction): string {
  switch (action.kind) {
    case 'CHARGE':
      return '[CHARGE]';
    case 'ATTACK':
      return `[${ATTACKS[action.weapon!].name.toUpperCase()}]`;
    case 'DEFENSE':
      return `[${DEFENSES[action.defense!].name.toUpperCase()}]`;
  }
}

function describeReveal(actions: readonly PublicAction[], nameOf: NameOf): LogBlock {
  const lines = actions.map((a) => {
    const target =
      a.kind === 'ATTACK' && a.targets && a.targets.length > 0
        ? ` → ${list(a.targets.map(nameOf))}`
        : a.kind === 'ATTACK' && ATTACKS[a.weapon!].targetMode === 'ALL_OPPONENTS'
          ? ' → all opponents'
          : '';
    const auto = a.timedOut ? ' (timed out: chosen by the server)' : '';
    return `  ${nameOf(a.playerId)} cast ${actionTag(a)}${target}${auto}`;
  });
  return { text: ['REVEAL — all actions at once:', ...lines].join('\n'), tone: 'action' };
}

function collisionReason(event: ResolutionEvent, targetWeapon: keyof typeof ATTACKS): string {
  const a = ATTACKS[event.sourceWeapon];
  const b = ATTACKS[targetWeapon];
  switch (event.ruleId.replace('COLLISION:', '')) {
    case 'HIGHER_TIER':
      return `Tier ${Math.max(a.tier, b.tier)} outranks Tier ${Math.min(a.tier, b.tier)}`;
    case 'RANGED_BEATS_MELEE':
      return 'same tier: ranged beats melee';
    case 'BLACKHOLE_OVERRIDE':
      return 'Blackhole beats every attack except another Blackhole';
    case 'BLACKHOLE_MIRROR':
      return 'Blackhole only neutralizes another Blackhole';
    default:
      return 'same tier and class cancel out';
  }
}

function describeEventLine(e: ResolutionEvent, nameOf: NameOf): { text: string; tone: Tone } {
  const attacker = nameOf(e.sourcePlayerId);
  const target = nameOf(e.selectedTargetId);
  const weapon = weaponName(e.sourceWeapon);

  switch (e.targetAction.kind) {
    case 'CHARGE':
      return { text: `  → ${target} [ELIMINATED] was Charging and was hit by ${weapon}.`, tone: 'danger' };

    case 'DEFENSE': {
      const defense = DEFENSES[e.targetAction.defense].name;
      if (e.outcome === 'BLOCKED') return { text: `  → ${target} [BLOCKED] ${defense} blocked ${weapon}.`, tone: 'block' };
      if (e.outcome === 'ATTACKER_ELIMINATED') {
        return { text: `  → ${target} [REFLECTED] ${defense} sent ${weapon} back: ${attacker} is [ELIMINATED].`, tone: 'danger' };
      }
      return { text: `  → ${target} [ELIMINATED] ${defense} did not stop ${weapon}.`, tone: 'danger' };
    }

    case 'ATTACK': {
      const theirs = weaponName(e.targetAction.weapon);
      const why = collisionReason(e, e.targetAction.weapon);
      if (e.outcome === 'NEUTRALIZED') {
        return { text: `  → ${target} [NEUTRALIZED] ${weapon} met ${target}'s ${theirs} (${why}): both survive.`, tone: 'block' };
      }
      if (e.outcome === 'ATTACKER_ELIMINATED') {
        return { text: `  → ${target} [CLASH LOST] ${target}'s ${theirs} beat ${weapon} (${why}): ${attacker} is [ELIMINATED].`, tone: 'danger' };
      }
      return { text: `  → ${target} [CLASH WON] ${weapon} beat ${target}'s ${theirs} (${why}): ${target} is [ELIMINATED].`, tone: 'danger' };
    }
  }
}

function describeAttacks(events: readonly ResolutionEvent[], nameOf: NameOf): LogBlock[] {
  const blocks: LogBlock[] = [];
  const attackers = [...new Set(events.map((e) => e.sourcePlayerId))];
  for (const attackerId of attackers) {
    const mine = events.filter((e) => e.sourcePlayerId === attackerId);
    const first = mine[0]!;
    const weapon = weaponName(first.sourceWeapon);
    const targets = list(first.effectTargetSet.map(nameOf));
    const scope = ATTACKS[first.sourceWeapon].targetMode === 'ALL_OPPONENTS' ? `every opponent (${targets})` : targets;
    const lines = mine.map((e) => describeEventLine(e, nameOf));
    const dangerous = lines.some((l) => l.tone === 'danger');
    blocks.push({
      text: [`${nameOf(attackerId)} targeted ${scope} with ${weapon}:`, ...lines.map((l) => l.text)].join('\n'),
      tone: dangerous ? 'danger' : 'block',
    });
  }
  return blocks;
}

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

/** The §6/§8 rule that decided an attack-vs-attack collision, in player-facing words. */
function collisionWhy(a: keyof typeof ATTACKS, b: keyof typeof ATTACKS, ruleId: string): string {
  switch (ruleId.replace('COLLISION:', '')) {
    case 'HIGHER_TIER':
      return `higher-tier priority (Tier ${Math.max(ATTACKS[a].tier, ATTACKS[b].tier)} over Tier ${Math.min(ATTACKS[a].tier, ATTACKS[b].tier)})`;
    case 'RANGED_BEATS_MELEE':
      return 'Ranged-over-Melee tier priority';
    case 'BLACKHOLE_OVERRIDE':
      return 'Blackhole overriding every other attack';
    case 'BLACKHOLE_MIRROR':
      return 'two Blackholes';
    default:
      return 'same tier and class';
  }
}

export type OutcomeTag = 'BLOCKED' | 'REFLECTED' | 'ELIMINATED' | 'NEUTRALIZED';

export interface ResolutionBreakdown {
  /** Stage 1: who targeted whom with what. */
  readonly targeting: readonly string[];
  /** Non-attackers' revealed actions ("Cy cast SHIELD", "Bo is Charging"). */
  readonly others: readonly string[];
  /** Stage 2: the §5/§6 outcome of every (attacker, target) interaction. */
  readonly outcomes: readonly { readonly tag: OutcomeTag; readonly text: string }[];
}

/**
 * The Turn Resolution modal's content, read straight from the turn's canonical
 * resolution events. Weapons are Title Case ("Gun"); defenses are UPPER CASE ("SHIELD").
 */
export function describeResolution(result: TurnResultPayload, nameOf: NameOf): ResolutionBreakdown {
  const targeting: string[] = [];
  const others: string[] = [];
  for (const a of result.actions) {
    const who = nameOf(a.playerId);
    if (a.kind === 'ATTACK') {
      const first = result.events.find((e) => e.sourcePlayerId === a.playerId);
      const targets = first ? first.effectTargetSet : (a.targets ?? []);
      targeting.push(`${who} targeted ${list(targets.map(nameOf))} with ${weaponName(a.weapon!)}`);
    } else if (a.kind === 'DEFENSE') {
      others.push(`${who} cast ${DEFENSES[a.defense!].name.toUpperCase()}`);
    } else {
      others.push(`${who} is Charging`);
    }
  }
  if (targeting.length === 0) targeting.push('Nobody attacked this turn.');

  const outcomes: { tag: OutcomeTag; text: string }[] = [];
  const add = (tag: OutcomeTag, text: string) => {
    if (!outcomes.some((o) => o.text === text)) outcomes.push({ tag, text });
  };
  for (const e of result.events) {
    const src = nameOf(e.sourcePlayerId);
    const tgt = nameOf(e.selectedTargetId);
    const weapon = weaponName(e.sourceWeapon);
    const ta = e.targetAction;
    if (ta.kind === 'CHARGE') {
      add('ELIMINATED', `${tgt} was Charging: ${src}'s ${weapon} hit them`);
    } else if (ta.kind === 'DEFENSE') {
      const defense = DEFENSES[ta.defense].name.toUpperCase();
      if (e.outcome === 'BLOCKED') {
        add('BLOCKED', ta.defense === 'DODGE' ? `${tgt} avoided ${src}'s ${weapon} via DODGE!` : `${tgt} successfully blocked ${src}'s ${weapon} using ${defense}!`);
      } else if (e.outcome === 'ATTACKER_ELIMINATED') {
        add('REFLECTED', `${tgt}'s ${defense} sent ${src}'s ${weapon} back: ${src} is eliminated`);
      } else {
        add('ELIMINATED', `${tgt}: ${src}'s ${weapon} got through ${defense}`);
      }
    } else if (e.ruleType === 'UNGUARDED') {
      add('ELIMINATED', `${tgt}: ${src}'s ${weapon} hit ${tgt}, who was attacking someone else and had no defense`);
    } else {
      const theirs = weaponName(ta.weapon);
      const why = collisionWhy(e.sourceWeapon, ta.weapon, e.ruleId);
      if (e.outcome === 'NEUTRALIZED') {
        // Both directions of a collision pair produce the same sentence (ordered by player id) so it is listed once.
        const [p1, w1, p2, w2] = e.sourcePlayerId < e.selectedTargetId ? [src, weapon, tgt, theirs] : [tgt, theirs, src, weapon];
        add('NEUTRALIZED', `${p1}'s ${w1} and ${p2}'s ${w2} cancelled out (${why}): both survive`);
      } else if (e.outcome === 'TARGET_ELIMINATED') {
        add('ELIMINATED', `${tgt}: ${src}'s ${weapon} defeated ${tgt}'s ${theirs} via ${why}`);
      } else {
        add('ELIMINATED', `${src}: ${tgt}'s ${theirs} defeated ${src}'s ${weapon} via ${why}`);
      }
    }
  }
  return { targeting, others, outcomes };
}

/**
 * `viewerId` implements the Charge fog of war (§12): only the viewer's own
 * Charge change is written to the log. `undefined` keeps every player's line
 * (tests / spectator tooling); the client always passes the viewer, or `null`.
 */
export function describeTurn(result: TurnResultPayload, nameOf: NameOf, viewerId?: PlayerId | null): TurnLog {
  const { outcome, events, actions } = result;
  const turnNumber = Number(/:t(\d+)$/.exec(result.turnId)?.[1] ?? 0);
  const blocks: LogBlock[] = [describeReveal(actions, nameOf), ...describeAttacks(events, nameOf)];

  const moved = outcome.playerResults.filter(
    (r) => r.chargeAfter !== r.chargeBefore && !r.eliminated && (viewerId === undefined || r.playerId === viewerId),
  );
  if (moved.length > 0) {
    blocks.push({
      text: `⚡ Charge: ${moved.map((r) => `${nameOf(r.playerId)} ${signed(r.chargeAfter - r.chargeBefore)} (now ${r.chargeAfter})`).join(' · ')}`,
      tone: 'neutral',
    });
  }

  if (outcome.eliminatedPlayerIds.length > 0) {
    blocks.push({
      text: `${outcome.eliminatedPlayerIds.map((id) => `${nameOf(id)} [ELIMINATED]`).join('\n')}\nSurvivors: ${list(outcome.survivorIds.map(nameOf))}`,
      tone: 'danger',
    });
  } else {
    blocks.push({ text: `No eliminations. No-elimination streak: ${outcome.noEliminationStreak}.`, tone: 'neutral' });
  }

  const wins = Object.entries(result.state.series.matchWins).map(([id, n]) => `${nameOf(id)} ${n}`).join(' · ');
  switch (outcome.transition) {
    case 'NEXT_ROUND':
      blocks.push({ text: `ROUND OVER — survivors (${list(outcome.survivorIds.map(nameOf))}) start a new round at 0⚡.`, tone: 'system' });
      break;
    case 'ROUND_RESTARTED_NO_SURVIVORS':
      blocks.push({ text: 'EVERYONE WAS ELIMINATED — the round is void and restarts with the same players at 0⚡.', tone: 'system' });
      break;
    case 'MATCH_ENDED':
      blocks.push({
        text: `MATCH OVER — ${nameOf(outcome.matchWinnerId!)} wins the match!\nMatch Wins: ${wins}\nA new match begins with the full lobby.`,
        tone: 'win',
      });
      break;
    case 'SERIES_ENDED':
      blocks.push({
        text: `SERIES OVER — ${nameOf(outcome.seriesWinnerId!)} wins the series!\nMatch Wins: ${wins}`,
        tone: 'win',
      });
      break;
    case 'NEXT_TURN':
      break;
  }

  if (outcome.phaseChange?.to === 'SUDDEN_DEATH') {
    blocks.push({
      text: '⚠ SUDDEN DEATH begins — 10 turns without an elimination.\nAll six defenses are disabled. If you can afford any attack you MUST attack; Charge only when you cannot.',
      tone: 'phase',
    });
  } else if (outcome.phaseChange?.to === 'OVERTIME') {
    blocks.push({
      text: '⚠ OVERTIME begins — 15 turns without an elimination.\nNormal combat rules return (defenses are back). Neutralized attacks just start another turn.',
      tone: 'phase',
    });
  }

  return {
    turnId: result.turnId,
    turnNumber,
    phase: result.phase,
    heading: `Turn ${turnNumber} · ${PHASE_LABEL[result.phase]}`,
    blocks,
  };
}

// --------------------------------------------------------- emoji battlefield

export type BattleResult = OutcomeTag | 'CLASH_WON';

export interface BattleHit {
  readonly fromName: string;
  readonly weaponName: string;
  readonly weaponEmoji: string;
  readonly result: BattleResult;
  /** Short plain-text reason, e.g. "blocked Ada's Gun". Shown next to the result tag. */
  readonly note: string;
}

export interface BattleCard {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly emoji: string;
  /** e.g. "Gun", "SHIELD", "Charge". */
  readonly label: string;
  readonly kind: 'ATTACK' | 'DEFENSE' | 'CHARGE';
  /** Names this player's attack was aimed at. */
  readonly aimedAt: readonly string[];
  /** Every attack that landed on this player, with its result for THIS player. */
  readonly incoming: readonly BattleHit[];
  readonly eliminated: boolean;
  readonly timedOut: boolean;
}

/** Everyone who acted this turn, with what they did and what happened to them. All from the canonical events. */
export function describeBattlefield(result: TurnResultPayload, nameOf: NameOf): BattleCard[] {
  const eliminated = new Set(result.outcome.eliminatedPlayerIds);
  return result.actions.map((a) => {
    const incoming: BattleHit[] = [];
    for (const e of result.events) {
      if (e.selectedTargetId !== a.playerId) continue;
      const src = nameOf(e.sourcePlayerId);
      const weapon = weaponName(e.sourceWeapon);
      const ta = e.targetAction;
      let res: BattleResult;
      let note: string;
      if (ta.kind === 'CHARGE') {
        res = 'ELIMINATED';
        note = `caught Charging by ${src}'s ${weapon}`;
      } else if (ta.kind === 'DEFENSE') {
        const defense = DEFENSES[ta.defense].name.toUpperCase();
        if (e.outcome === 'BLOCKED') {
          res = 'BLOCKED';
          note = ta.defense === 'DODGE' ? `dodged ${src}'s ${weapon}` : `blocked ${src}'s ${weapon} with ${defense}`;
        } else if (e.outcome === 'ATTACKER_ELIMINATED') {
          res = 'REFLECTED';
          note = `reflected ${src}'s ${weapon} back with ${defense}`;
        } else {
          res = 'ELIMINATED';
          note = `${src}'s ${weapon} got through ${defense}`;
        }
      } else if (e.ruleType === 'UNGUARDED') {
        res = 'ELIMINATED';
        note = `${src}'s ${weapon} hit ${nameOf(a.playerId)}, who was attacking someone else (no defense)`;
      } else {
        const why = collisionWhy(e.sourceWeapon, ta.weapon, e.ruleId);
        res = e.outcome === 'NEUTRALIZED' ? 'NEUTRALIZED' : e.outcome === 'ATTACKER_ELIMINATED' ? 'CLASH_WON' : 'ELIMINATED';
        note = e.outcome === 'NEUTRALIZED' ? `clashed with ${src}'s ${weapon}: cancelled (${why})` : `${src}'s ${weapon} clash: ${why}`;
      }
      incoming.push({ fromName: src, weaponName: weapon, weaponEmoji: actionEmoji({ kind: 'ATTACK', weapon: e.sourceWeapon }), result: res, note });
    }

    const first = a.kind === 'ATTACK' ? result.events.find((e) => e.sourcePlayerId === a.playerId) : undefined;
    const aimedAt = a.kind === 'ATTACK' ? (first ? first.effectTargetSet : (a.targets ?? [])).map(nameOf) : [];
    const label = a.kind === 'ATTACK' ? weaponName(a.weapon!) : a.kind === 'DEFENSE' ? DEFENSES[a.defense!].name.toUpperCase() : 'Charge';
    return {
      playerId: a.playerId,
      name: nameOf(a.playerId),
      emoji: actionEmoji(a),
      label,
      kind: a.kind,
      aimedAt,
      incoming,
      eliminated: eliminated.has(a.playerId),
      timedOut: a.timedOut,
    };
  });
}

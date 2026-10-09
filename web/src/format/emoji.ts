import type { ActionRef, AttackId, DefenseId } from '../../../src/engine';
import type { PublicAction } from '../../../src/server/protocol';

export const CHARGE_EMOJI = '⚡';

export const ATTACK_EMOJI: Readonly<Record<AttackId, string>> = {
  GUN: '🔫',
  KNIFE: '🔪',
  GATLING_GUN: '🔫🔫',
  FLAMETHROWER: '🔥',
  AXE: '🪓',
  THREE_HIT_COMBO: '🥊',
  GRENADE: '🍍',
  KATANA: '⚔️',
  BOMB: '💣',
  NUKE: '☢️',
  MJOLNIR: '🔨',
  BLACKHOLE: '🕳️',
};

export const DEFENSE_EMOJI: Readonly<Record<DefenseId, string>> = {
  DODGE: '💨',
  SHIELD: '🛡️',
  REFLECT: '🪞',
  DOUBLE_REFLECT: '🪞×2',
  TRIPLE_REFLECT: '🪞×3',
  QUAD_REFLECT: '🪞×4',
};

/** Result glyphs shown when an interaction lands (always paired with a text tag). */
export const RESULT_EMOJI = { BLOCKED: '✔', REFLECTED: '↩', ELIMINATED: '💥', NEUTRALIZED: '＝', CLASH_WON: '🏆' } as const;

export function actionEmoji(action: ActionRef | PublicAction): string {
  switch (action.kind) {
    case 'CHARGE':
      return CHARGE_EMOJI;
    case 'ATTACK':
      return ATTACK_EMOJI[action.weapon!];
    case 'DEFENSE':
      return DEFENSE_EMOJI[action.defense!];
  }
}

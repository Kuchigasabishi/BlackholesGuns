import type { CSSProperties } from 'react';
import { describeBattlefield, type BattleCard, type BattleResult, type NameOf } from '../format/describeTurn';
import { RESULT_EMOJI } from '../format/emoji';
import type { TurnResultPayload } from '../../../src/server/protocol';

// One shared clock (ms after the modal opens). Every card uses the same values, so all actions play in parallel.
export const BF_TIMING = { lunge: 250, fly: 300, hit: 700, result: 750, charge: 150 } as const;

const RESULT_STYLE: Record<BattleResult, string> = {
  BLOCKED: 'border-ok bg-ok/15 text-ok',
  REFLECTED: 'border-gold bg-gold/15 text-gold',
  ELIMINATED: 'border-danger bg-danger/15 text-danger',
  NEUTRALIZED: 'border-neon bg-neon/10 text-neon',
  CLASH_WON: 'border-gold bg-gold/15 text-gold',
};
const RESULT_TEXT: Record<BattleResult, string> = {
  BLOCKED: '[BLOCKED]',
  REFLECTED: '[REFLECTED]',
  ELIMINATED: '[ELIMINATED]',
  NEUTRALIZED: '[NEUTRALIZED]',
  CLASH_WON: '[CLASH WON]',
};

const at = (ms: number, on: boolean): CSSProperties | undefined => (on ? { animationDelay: `${ms}ms` } : undefined);

function Card({ card, isYou, animate }: { card: BattleCard; isYou: boolean; animate: boolean }) {
  const attacking = card.kind === 'ATTACK';
  const gathered = card.kind === 'CHARGE' && !card.eliminated;
  const hit = card.incoming.length > 0;
  const cls = (name: string, on = true) => (animate && on ? name : '');

  return (
    <li
      data-testid={`bf-${card.playerId}`}
      data-eliminated={card.eliminated}
      aria-label={`${card.name}${isYou ? ' (you)' : ''}: ${card.label}${card.aimedAt.length ? ` aimed at ${card.aimedAt.join(', ')}` : ''}${card.eliminated ? ', eliminated' : ''}`}
      className={`rounded-xl border-2 bg-void/50 p-3 ${card.eliminated ? 'border-danger' : 'border-edge'} ${cls('anim-ko', card.eliminated)}`}
      style={at(BF_TIMING.result + 150, animate && card.eliminated)}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-bold text-ink">
          {card.name}
          {isYou && <span className="bracket ml-1 text-xs text-gold">[YOU]</span>}
        </p>
        {card.eliminated && (
          <span className={`bracket shrink-0 rounded border px-2 py-0.5 text-xs font-bold ${RESULT_STYLE.ELIMINATED} ${cls('anim-bf-result')}`} style={at(BF_TIMING.result + 150, animate)}>
            <span aria-hidden="true">✖ </span>[ELIMINATED]
          </span>
        )}
      </div>

      <div className={`mt-2 flex items-center gap-2 ${card.eliminated ? `grayscale ${cls('anim-bf-grey')}` : ''}`} style={at(BF_TIMING.result + 150, animate && card.eliminated)}>
        {/* incoming attacks fly in from the left toward this player's own action */}
        <div className="flex min-w-[3rem] items-center justify-end gap-1" aria-hidden="true">
          {card.incoming.map((h, i) => (
            <span key={i} className={`text-3xl ${cls('anim-bf-fly')}`} style={at(BF_TIMING.fly, animate)} data-testid="bf-projectile">
              {h.weaponEmoji}
            </span>
          ))}
          {hit && <span className="text-xl text-ink-dim">→</span>}
        </div>

        <div className="text-center">
          <span className={`block ${cls('anim-bf-lunge', attacking)} ${cls('anim-bf-charge', gathered)}`} style={at(attacking ? BF_TIMING.lunge : BF_TIMING.charge, animate)}>
            <span className={`inline-block text-5xl leading-none ${cls('anim-bf-impact', hit)}`} style={at(BF_TIMING.hit, animate)} data-testid="bf-action" aria-hidden="true">
              {card.emoji}
            </span>
          </span>
          <p className="bracket mt-1 text-sm font-bold text-ink">
            {card.label}
            {card.timedOut && <span className="ml-1 text-xs text-ink-dim">(auto)</span>}
          </p>
          {card.aimedAt.length > 0 && <p className="bracket text-xs text-ink-dim">→ {card.aimedAt.join(', ')}</p>}
        </div>
      </div>

      <ul className="mt-2 space-y-1" data-testid={`bf-results-${card.playerId}`}>
        {card.incoming.map((h, i) => (
          <li key={i} className={`flex origin-left items-start gap-2 text-sm ${cls("anim-bf-result")}`} style={at(BF_TIMING.result, animate)}>
            <span className={`bracket shrink-0 rounded border px-1.5 py-0.5 text-xs font-bold ${RESULT_STYLE[h.result]}`}>
              <span aria-hidden="true">{RESULT_EMOJI[h.result]} </span>
              {RESULT_TEXT[h.result]}
            </span>
            <span className="text-ink">{h.note}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * The "emoji battlefield": one card per player who acted, every card animating
 * at once. Without animation (reduced motion) it is the same finished picture.
 */
export function Battlefield({ result, nameOf, viewerId, animate }: { result: TurnResultPayload; nameOf: NameOf; viewerId: string | null; animate: boolean }) {
  const cards = describeBattlefield(result, nameOf);
  return (
    <ul className="grid gap-3 sm:grid-cols-2" data-testid="battlefield">
      {cards.map((c) => (
        <Card key={c.playerId} card={c} isYou={c.playerId === viewerId} animate={animate} />
      ))}
    </ul>
  );
}

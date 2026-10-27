/**
 * The interactive control panel (Figure 1, bottom): defense row, then attacks
 * grouped by tier. Unaffordable / restricted actions are dimmed AND explain
 * why; the server's availability is the source of truth.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ATTACKS,
  ATTACK_IDS,
  DEFENSES,
  DEFENSE_IDS,
  MULTI_TARGET_LIMIT,
  getActionAvailability,
  type ActionAvailability,
  type AttackId,
  type DefenseId,
  type PlayerId,
} from '../../../src/engine';
import { useGameState, useSettings, useStore } from '../hooks';
import type { Choice } from '../net/store';
import { attackTip, reflectTip, type MatrixTip } from '../format/matrixTip';
import { audio } from '../audio/AudioManager';
import { ActionGlyph, ActionIcon, type ActionIconName } from './ActionIcons';
import { INLINE_WEAPON_ICON } from './WeaponIcons';
import axe from '../assets/ui/axe.svg';
import battery from '../assets/ui/battery.svg';
import bomb from '../assets/ui/bomb.svg';
import crosshair from '../assets/ui/crosshair.svg';
import flame from '../assets/ui/flame.svg';
import hammer from '../assets/ui/hammer.svg';
import lockIcon from '../assets/ui/lock.svg';
import orbit from '../assets/ui/orbit.svg';
import pointer from '../assets/ui/pointer.svg';
import radiation from '../assets/ui/radiation.svg';
import scanLine from '../assets/ui/scan-line.svg';
import shield from '../assets/ui/shield.svg';
import shieldCheck from '../assets/ui/shield-check.svg';
import sword from '../assets/ui/sword.svg';
import swords from '../assets/ui/swords.svg';
import wind from '../assets/ui/wind.svg';
import { nameLookup } from '../state/reducer';

const ATTACK_ICON: Record<AttackId, string> = {
  GUN: '🔫',
  KNIFE: '🔪',
  GATLING_GUN: '⚙️',
  FLAMETHROWER: '🔥',
  AXE: '🪓',
  THREE_HIT_COMBO: '👊',
  GRENADE: '💣',
  KATANA: '🗡️',
  BOMB: '💥',
  NUKE: '☢️',
  MJOLNIR: '🔨',
  BLACKHOLE: '🌀',
};
const DEFENSE_ICON: Record<DefenseId, string> = {
  DODGE: '💨',
  SHIELD: '🛡️',
  REFLECT: '🪞',
  DOUBLE_REFLECT: '🪞',
  TRIPLE_REFLECT: '🪞',
  QUAD_REFLECT: '🪞',
};

/** The design's line icons for each action (the emoji maps above stay for tooltips and the animation). */
const ICON_SVG: Record<string, string> = {
  DODGE: wind,
  SHIELD: shield,
  CHARGE: battery,
  GUN: crosshair,
  KNIFE: sword,
  GATLING_GUN: scanLine,
  FLAMETHROWER: flame,
  AXE: axe,
  THREE_HIT_COMBO: swords,
  GRENADE: crosshair,
  KATANA: sword,
  BOMB: bomb,
  NUKE: radiation,
  MJOLNIR: hammer,
  BLACKHOLE: orbit,
  REFLECT: shieldCheck,
  DOUBLE_REFLECT: shieldCheck,
  TRIPLE_REFLECT: shieldCheck,
  QUAD_REFLECT: shieldCheck,
};

/** Below the `lg` breakpoint the roster sits above the control panel (single column): the phone / small-tablet layout. */
export const isStackedLayout = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches;

/** Actions drawn with the Figma cyberpunk vector icons (every Reflect tier shares the Reflect icon). */
const FIGMA_ICON: Readonly<Record<string, ActionIconName>> = {
  CHARGE: 'CHARGE',
  DODGE: 'DODGE',
  SHIELD: 'SHIELD',
  GUN: 'GUN',
  KNIFE: 'KNIFE',
  REFLECT: 'REFLECT',
  DOUBLE_REFLECT: 'REFLECT',
  TRIPLE_REFLECT: 'REFLECT',
  QUAD_REFLECT: 'REFLECT',
};

const TIERS: readonly { readonly label: string; readonly cost: number; readonly ids: readonly AttackId[]; readonly reflect?: DefenseId }[] = [
  { label: 'TIER 1', cost: 1, ids: ['GUN', 'KNIFE'], reflect: 'REFLECT' },
  { label: 'TIER 2', cost: 2, ids: ['GATLING_GUN', 'FLAMETHROWER', 'AXE'], reflect: 'DOUBLE_REFLECT' },
  { label: 'TIER 3', cost: 3, ids: ['THREE_HIT_COMBO', 'GRENADE', 'KATANA'], reflect: 'TRIPLE_REFLECT' },
  { label: 'TIER 4', cost: 4, ids: ['BOMB', 'NUKE', 'MJOLNIR'], reflect: 'QUAD_REFLECT' },
  { label: 'TIER 5', cost: 5, ids: ['BLACKHOLE'] },
];

export function reasonText(reason: string | null, cost: number, charge: number): string {
  switch (reason) {
    case 'UNAFFORDABLE':
      return `Needs ${cost}⚡ — you have ${charge}⚡`;
    case 'PHASE_RESTRICTED':
      return 'Disabled: all defenses are off in Sudden Death';
    case 'ATTACK_MANDATORY':
      return 'Disabled: in Sudden Death you must attack when you can afford an attack';
    case 'NOT_ALIVE':
      return 'You are eliminated';
    default:
      return 'Unavailable';
  }
}

type Selection = { readonly choice: Choice } | null;
type Availability = { readonly available: boolean; readonly reason: string | null };

interface ActionButtonProps {
  readonly id: string;
  readonly kind: string;
  readonly row: number;
  readonly label: string;
  readonly cost: number;
  readonly icon: string;
  readonly enabled: boolean;
  readonly selected: boolean;
  /** Why the action is unavailable; empty when it is available. */
  readonly why: string;
  readonly onHint: (text: string) => void;
  readonly onPick: () => void;
  /** Matrix rules shown on hover / focus / tap. */
  readonly tip?: MatrixTip | undefined;
}

/**
 * Stable top-level component: defining this inside ControlPanel would remount
 * every button on each render and drop keyboard focus.
 * Disabled actions use aria-disabled (not `disabled`) so keyboard and screen-reader
 * users can still focus them and hear why they are unavailable.
 */
const TIP_TONE = { good: 'text-ok', bad: 'text-danger', gold: 'text-gold', dim: 'text-ink-dim' } as const;
const TIP_ICON = { good: '✔', bad: '❌', gold: '↩', dim: '·' } as const;

/** Small dark overlay above a button. Purely informational: the button's own label stays the accessible name. */
function MatrixTooltip({ id, icon, tip }: { id: string; icon: string; tip: MatrixTip }) {
  return (
    <span
      id={`tip-${id}`}
      role="tooltip"
      data-testid={`tip-${id}`}
      className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 w-max max-w-[min(18rem,80vw)] rounded-lg border border-edge bg-void/95 px-3 py-2 text-left text-xs normal-case shadow-lg backdrop-blur"
    >
      <span className="block font-bold text-ink">
        <span aria-hidden="true" className="mr-1 inline-flex size-4 items-center justify-center align-[-3px]">
          <ActionGlyph emoji={icon} className="size-4" />
        </span>
        {tip.title}
      </span>
      {tip.lines.map((l) => (
        <span key={l.label} className="mt-1 block text-ink-dim">
          <span aria-hidden="true">{TIP_ICON[l.tone]} </span>
          {l.label}: <span className={`font-bold ${TIP_TONE[l.tone]}`}>{l.items.join(', ')}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Stable top-level component: defining this inside ControlPanel would remount
 * every button on each render and drop keyboard focus.
 * Disabled actions use aria-disabled (not `disabled`) so keyboard and screen-reader
 * users can still focus them and hear why they are unavailable.
 * The tooltip opens on hover and on focus (which is what a tap gives on a phone) and
 * closes the instant the pointer leaves or focus moves away.
 */
function ActionButton({ id, kind, row, label, cost, icon, enabled, selected, why, onHint, onPick, tip }: ActionButtonProps) {
  const [tipOpen, setTipOpen] = useState(false);
  // Affordable weapons / Reflects (cost 1-5) get a pulsing neon glow that escalates with the tier.
  const power = enabled && cost >= 1 && cost <= 5 ? cost : 0;
  const free = cost === 0;
  return (
    <span className="relative flex min-w-0" onMouseLeave={() => setTipOpen(false)}>
      <button
        type="button"
        data-action={id}
        data-kind={kind}
        data-power={power || undefined}
        data-row={row}
        aria-disabled={!enabled}
        aria-pressed={selected}
        aria-describedby={[why ? `why-${id}` : '', tip && tipOpen ? `tip-${id}` : ''].filter(Boolean).join(' ') || undefined}
        onFocus={() => {
          onHint(why);
          setTipOpen(true);
        }}
        onBlur={() => setTipOpen(false)}
        onMouseEnter={() => {
          onHint(why);
          setTipOpen(true);
        }}
        onClick={() => {
          if (enabled) {
            onPick();
            onHint('');
          } else onHint(why);
        }}
        className={[
          power ? `power-up power-t${power}` : '',
          'group flex h-[54px] w-full min-w-0 items-center gap-[9px] rounded-[4px] border px-3 text-left transition',
          free
            ? enabled
              ? 'border-[#153744] bg-[#132e37] hover:brightness-125'
              : 'cursor-not-allowed border-[#243747] bg-[#070d16] opacity-60'
            : enabled
              ? 'border-[#243747] bg-[#070d16] hover:bg-[#0c1420]'
              : 'cursor-not-allowed border-[#243747] bg-[#070d16]',
          selected ? 'bg-gold/15 ring-2 ring-gold' : '',
        ].join(' ')}
      >
        {FIGMA_ICON[id] ? (
          // Figma vector icon: every stroke is currentColor, so the text colour below recolours it and the dimming fades it when unaffordable.
          <span aria-hidden="true" data-action-glyph={id} className={`flex size-7 shrink-0 items-center justify-center transition-[filter] sm:size-8 ${enabled ? 'text-[#50e3ed] group-hover:drop-shadow-[0_0_5px_currentColor] group-focus-visible:drop-shadow-[0_0_5px_currentColor]' : 'text-[#546b7d] opacity-50'}`}>
            <ActionIcon name={FIGMA_ICON[id]!} />
          </span>
        ) : INLINE_WEAPON_ICON[id] ? (
          // Custom inline glyph: draws in currentColor so it follows the button text colour and the dimming below.
          <span aria-hidden="true" className={`size-[18px] shrink-0 transition-[filter] ${enabled ? 'text-[#eef6fa] group-hover:text-[#50e3ed] group-hover:drop-shadow-[0_0_4px_currentColor] group-focus-visible:drop-shadow-[0_0_4px_currentColor]' : 'text-[#91a5b6] opacity-50'}`}>
            {INLINE_WEAPON_ICON[id]()}
          </span>
        ) : (
          <img src={ICON_SVG[id] ?? crosshair} alt="" aria-hidden="true" className={`size-[18px] shrink-0 ${enabled ? '' : 'opacity-50'}`} />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={`truncate font-inter text-[12px] font-semibold leading-tight ${enabled ? 'text-[#eef6fa]' : 'text-[#91a5b6]'}`}>{label}</span>
          <span className={`font-plex text-[9px] leading-none ${enabled ? 'text-[#50e3ed]' : 'text-[#546b7d]'}`}>
            {cost} CHARGE<span className="sr-only"> ({cost}⚡)</span>
          </span>
        </span>
        {!enabled && !free && <img src={lockIcon} alt="" aria-hidden="true" data-lock-icon className="size-3 shrink-0" />}
        {selected && <span aria-hidden="true" className="text-gold">✔</span>}
        {why && (
          <span id={`why-${id}`} className="sr-only">
            {why}
          </span>
        )}
      </button>
      {tip && tipOpen && <MatrixTooltip id={id} icon={icon} tip={tip} />}
    </span>
  );
}

function targetsReady(choice: Choice, opponents: readonly PlayerId[]): boolean {
  if (choice.kind !== 'ATTACK') return true;
  const mode = ATTACKS[choice.weapon].targetMode;
  if (mode === 'ALL_OPPONENTS') return true;
  if (mode === 'SINGLE') return choice.targets.length === 1;
  return choice.targets.length >= 1 && choice.targets.length <= Math.min(MULTI_TARGET_LIMIT, opponents.length);
}

export function ControlPanel() {
  const state = useGameState();
  const store = useStore();
  const { keyboardMode, reducedMotion } = useSettings();
  const { game, session, stage, ownCommit, lockedPlayerIds, turn } = state;
  const nameOf = nameLookup(state);
  const me = session && game ? game.players[session.playerId] : undefined;

  // The pick lives in the shared client state so the player cards in the arena can show and set the targets.
  const selection: Selection = state.selection ? { choice: state.selection } : null;
  const clearSelection = useCallback(() => store.dispatch({ type: 'clearSelection' }), [store]);
  const [hint, setHint] = useState<string>('');
  const [sending, setSending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const opponents = useMemo(
    () => (game ? game.series.lobby.filter((id) => id !== session?.playerId && game.players[id]?.alive) : []),
    [game, session?.playerId],
  );

  // Server availability is authoritative; compute locally only until it arrives.
  const availability: ActionAvailability | null = useMemo(() => {
    if (state.availability) return state.availability;
    if (game && game.turn && session && stage === 'COMMIT') return getActionAvailability(game, session.playerId);
    return null;
  }, [state.availability, game, session, stage]);

  const locked = ownCommit !== null || (session ? lockedPlayerIds.includes(session.playerId) : false);
  const open = stage === 'COMMIT' && !locked && !!me?.alive;

  // A new turn starts with a clean slate.
  useEffect(() => {
    setHint('');
  }, [turn?.turnId]);

  const select = useCallback(
    (choice: Choice) => {
      store.dispatch({ type: 'selectChoice', choice });
      // On a phone the player cards are above the panel: after picking a weapon that needs a target, glide up to them
      // (one scroll per pick, triggered by the tap itself, never by an effect, so it cannot loop).
      if (choice.kind === 'ATTACK' && ATTACKS[choice.weapon].targetMode !== 'ALL_OPPONENTS' && opponents.length > 1 && isStackedLayout()) {
        document.querySelector('[data-testid="roster"]')?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      }
    },
    [store, opponents.length, reducedMotion],
  );
  const toggleTarget = useCallback((playerId: PlayerId) => store.dispatch({ type: 'toggleTarget', playerId }), [store]);

  const ready = selection !== null && targetsReady(selection.choice, opponents);

  const lockIn = useCallback(async () => {
    if (!selection || !targetsReady(selection.choice, opponents) || sending) return;
    audio.stopTicking(); // silence the tension loop the instant Lock In is pressed
    setSending(true);
    try {
      await store.commit(selection.choice);
    } finally {
      setSending(false);
    }
  }, [selection, opponents, sending, store]);

  // Esc always resets the pick (and with it the highlighted player cards), whatever the keyboard mode.
  useEffect(() => {
    if (!selection) return;
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [selection, clearSelection]);

  // ---- keyboard: single-key shortcuts (only when the user turned Keyboard mode on)
  useEffect(() => {
    if (!keyboardMode) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!open) return;
      const key = e.key.toLowerCase();
      if (key === 'c' && availability?.charge.available) return select({ kind: 'CHARGE' });
      if (key === 'l') {
        e.preventDefault();
        return void lockIn();
      }
      if (/^[1-8]$/.test(key)) {
        const target = opponents[Number(key) - 1];
        if (target) toggleTarget(target);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardMode, open, availability, select, lockIn, opponents, toggleTarget]);

  // ---- arrow-key navigation across the whole action grid (a single composite widget)
  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const buttons = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('button[data-action]') ?? [])];
    const index = buttons.findIndex((b) => b === document.activeElement);
    if (index < 0) return;
    e.preventDefault();
    const rowOf = (b: HTMLElement) => Number(b.dataset.row);
    const row = rowOf(buttons[index]!);
    const inRow = buttons.filter((b) => rowOf(b) === row);
    const col = inRow.indexOf(buttons[index]!);
    let next: HTMLButtonElement | undefined;
    if (e.key === 'ArrowRight') next = buttons[Math.min(buttons.length - 1, index + 1)];
    else if (e.key === 'ArrowLeft') next = buttons[Math.max(0, index - 1)];
    else if (e.key === 'Home') next = buttons[0];
    else if (e.key === 'End') next = buttons[buttons.length - 1];
    else {
      const targetRow = row + (e.key === 'ArrowDown' ? 1 : -1);
      const candidates = buttons.filter((b) => rowOf(b) === targetRow);
      next = candidates[Math.min(col, candidates.length - 1)];
    }
    next?.focus();
  };

  // ---------------------------------------------------------------- rendering

  if (!me?.alive) {
    return (
      <section aria-labelledby="panel-h" className="neon-box rounded-2xl p-5">
        <h2 id="panel-h" className="font-display text-neon">Your actions</h2>
        <p className="mt-3 text-lg">
          <span className="bracket font-bold text-danger">[ELIMINATED]</span> You are out for the rest of this round. You will return at the start of the next match — watch the log.
        </p>
      </section>
    );
  }

  const charge = me.charge;
  const selectedId = selection?.choice.kind === 'ATTACK' ? selection.choice.weapon : selection?.choice.kind === 'DEFENSE' ? selection.choice.defense : selection?.choice.kind;

  const describe = (cost: number, a: Availability | undefined): string =>
    !open ? (locked ? 'You are locked in for this turn' : 'Waiting for the next turn') : a && !a.available ? reasonText(a.reason, cost, charge) : '';

  /** Props shared by every action button; identity-stable component below keeps focus across re-renders. */
  const btn = (id: string, kind: string, row: number, label: string, cost: number, icon: string, a: Availability | undefined, onPick: () => void) => (
    <ActionButton
      key={id}
      id={id}
      kind={kind}
      row={row}
      label={label}
      cost={cost}
      icon={icon}
      enabled={open && !!a?.available}
      selected={selectedId === id && open}
      why={describe(cost, a)}
      onHint={setHint}
      onPick={onPick}
      tip={kind === 'attack' ? attackTip(id as AttackId) : kind === 'defense' && cost > 0 ? reflectTip(id as DefenseId) : undefined}
    />
  );

  const gridCls = 'grid grid-cols-[repeat(auto-fit,minmax(8.25rem,1fr))] gap-2';
  return (
    <section aria-labelledby="panel-h" className="flex flex-col overflow-hidden rounded-lg border border-[#243747] bg-[#0c1420]" data-testid="control-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 p-6">
        <div className="flex flex-col gap-[6px]">
          <p className="font-plex text-[10px] text-[#50e3ed]">INTERACTIVE CONTROL PANEL</p>
          <h2 id="panel-h" className="font-grotesk text-[26px] font-bold leading-none text-[#eef6fa]">
            Your action selection
          </h2>
        </div>
        <div className="flex flex-col items-end gap-1" data-testid="my-charge">
          <p className="font-plex text-[10px] text-[#91a5b6]">YOUR CHARGE</p>
          <p className="font-grotesk font-bold leading-none text-[#50e3ed]">
            <span className="text-[28px]">{charge} </span>
            <span className="text-[15px]">⚡</span>
          </p>
        </div>
      </div>

      <div ref={panelRef} onKeyDown={onGridKeyDown} className="flex flex-col gap-[14px] px-6 pb-5" role="group" aria-label="Action grid. Use arrow keys to move between actions.">
        <div className={gridCls} role="group" aria-label="Defensive actions and Charge">
          {DEFENSE_IDS.filter((id) => DEFENSES[id].cost === 0).map((id) =>
            btn(id, 'defense', 0, DEFENSES[id].name, DEFENSES[id].cost, DEFENSE_ICON[id], availability?.defenses[id], () => select({ kind: 'DEFENSE', defense: id })),
          )}
          {btn('CHARGE', 'charge', 0, 'Charge +1', 0, '🔋', availability?.charge, () => {
            audio.chargeSurge(me?.charge ?? 0); // pitch rises with the Charge already held
            select({ kind: 'CHARGE' });
          })}
        </div>

        {charge < 5 && (
          <p className="flex items-center gap-[7px] font-plex text-[10px] text-[#91a5b6]">
            <img src={lockIcon} alt="" aria-hidden="true" className="size-3" />
            CHARGE TO UNLOCK HIGHER TIERS
          </p>
        )}

        {TIERS.map((tier, i) => (
          <div key={tier.label} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3" role="group" aria-label={`${tier.label}, ${tier.cost} charge`}>
            <div className="flex shrink-0 flex-row gap-2 font-plex sm:w-[76px] sm:flex-col sm:gap-[6px]">
              <span className="text-[11px] text-[#91a5b6]">{tier.label}</span>
              <span className="text-[10px] text-[#546b7d]">{tier.cost} CHARGE</span>
            </div>
            <div className={`${gridCls} min-w-0 flex-1`}>
              {tier.ids.map((id) =>
                btn(id, 'attack', i + 1, ATTACKS[id].name, ATTACKS[id].cost, ATTACK_ICON[id], availability?.attacks[id], () => select({ kind: 'ATTACK', weapon: id, targets: [] })),
              )}
              {tier.reflect &&
                btn(tier.reflect, 'defense', i + 1, DEFENSES[tier.reflect].name, DEFENSES[tier.reflect].cost, DEFENSE_ICON[tier.reflect], availability?.defenses[tier.reflect], () => select({ kind: 'DEFENSE', defense: tier.reflect! }))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-[#243747] bg-[#070d16] px-6 py-[18px]">
        <p role="status" aria-live="polite" data-testid="why-line" className="min-h-4 font-inter text-[12px] text-gold">
          {hint}
        </p>
        {/* Locked / waiting status (the Lock In control itself floats next to the decision). */}
        {!open ? (
          locked ? (
            <p data-testid="locked-indicator" role="status" className="bracket rounded-[4px] border border-ok bg-ok/10 px-4 py-3 text-ok">
              🔒 LOCKED{ownCommit ? `: ${choiceLabel(payloadToChoice(ownCommit), nameOf)}` : ''} — waiting for {Math.max(0, (turn?.eligiblePlayerIds.length ?? 0) - lockedPlayerIds.length)} more…
            </p>
          ) : (
            <p className="font-inter text-[12px] text-[#91a5b6]">{stage === 'BETWEEN_TURNS' ? 'Reveal in progress — the next turn opens shortly.' : 'Waiting for the next turn…'}</p>
          )
        ) : !selection ? (
          <p className="flex items-center gap-[10px] font-inter text-[12px] text-[#91a5b6]">
            <img src={pointer} alt="" aria-hidden="true" className="size-4" />
            Tap an action to choose it; lock in happens right next to it.
          </p>
        ) : null}
      </div>

      {/* Lock In lives right next to the decision: by the chosen target's card, or by the action button. */}
      {open && selection && (
        <FloatingLockIn
          choice={selection.choice}
          ready={ready}
          sending={sending}
          nameOf={nameOf}
          opponentCount={opponents.length}
          onLockIn={() => void lockIn()}
          onCancel={clearSelection}
        />
      )}
    </section>
  );
}

/** Where the popup attaches: the last chosen target's card (targeted attacks) or the action's own button. */
function anchorFor(choice: Choice): { selector: string; label: string } {
  // Multi-target weapons: the prompt sits under the whole card row so no single card is covered and every opponent stays tappable.
  if (choice.kind === 'ATTACK' && ATTACKS[choice.weapon].targetMode === 'UP_TO_THREE' && choice.targets.length > 0) {
    return { selector: '[data-testid="roster"]', label: 'roster' };
  }
  if (choice.kind === 'ATTACK' && ATTACKS[choice.weapon].targetMode !== 'ALL_OPPONENTS' && choice.targets.length > 0) {
    const id = choice.targets[choice.targets.length - 1]!;
    return { selector: `[data-card-id="${id}"]`, label: `card:${id}` };
  }
  const id = choice.kind === 'ATTACK' ? choice.weapon : choice.kind === 'DEFENSE' ? choice.defense : 'CHARGE';
  return { selector: `button[data-action="${id}"]`, label: `button:${id}` };
}

/**
 * The context-bound Lock In popup. It is `position: fixed` and placed from the anchor's bounding box: below it when
 * there is room, otherwise above, centred on the anchor and clamped to stay fully inside the viewport (so it never
 * clips off a phone screen). It follows resize and scroll. Clicking outside it, Cancel or Esc dismisses it.
 */
function FloatingLockIn({
  choice,
  ready,
  sending,
  nameOf,
  opponentCount,
  onLockIn,
  onCancel,
}: {
  choice: Choice;
  ready: boolean;
  sending: boolean;
  nameOf: (id: PlayerId) => string;
  opponentCount: number;
  onLockIn: () => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchor = anchorFor(choice);
  // Choosing a target on a phone: the cards are scrolled into view, so this prompt rides along pinned to the bottom edge
  // (the weapon button it normally hugs has scrolled away) and the weapon button must not be scrolled back into view.
  const pickOnPhone = choice.kind === 'ATTACK' && ATTACKS[choice.weapon].targetMode !== 'ALL_OPPONENTS' && choice.targets.length === 0 && isStackedLayout();

  const place = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const target = pickOnPhone ? null : document.querySelector(anchor.selector);
    let top: number;
    let left: number;
    if (target) {
      const r = target.getBoundingClientRect();
      top = r.bottom + margin;
      // No room below: a card-row prompt pins to the bottom edge (never over the cards); others float above their anchor.
      if (top + h > vh - margin) top = anchor.label === 'roster' ? vh - h - margin : r.top - h - margin;
      left = r.left + r.width / 2 - w / 2;
    } else {
      top = vh - h - margin; // anchor missing: fall back to the bottom edge
      left = (vw - w) / 2;
    }
    top = Math.max(margin, Math.min(top, vh - h - margin));
    left = Math.max(margin, Math.min(left, vw - w - margin));
    setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
  }, [anchor.selector, pickOnPhone]);

  // Bring the anchor into view first (phones scroll), then place; re-place after every render, on resize and on scroll.
  useLayoutEffect(() => {
    if (pickOnPhone) return;
    const target = document.querySelector(anchor.selector) as (Element & { scrollIntoView?: (o?: ScrollIntoViewOptions) => void }) | null;
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [anchor.selector, pickOnPhone]);
  useLayoutEffect(() => {
    place();
  });
  useEffect(() => {
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [place]);

  // Clicking anywhere that is not this popup, an action button or a target card dismisses it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest('[data-lockin-popup], [data-action], [data-targetable]')) onCancel();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [onCancel]);

  const aimed = choice.kind === 'ATTACK' && ATTACKS[choice.weapon].targetMode !== 'ALL_OPPONENTS';
  const multi = choice.kind === 'ATTACK' && ATTACKS[choice.weapon].targetMode === 'UP_TO_THREE';
  // Multi-target weapons say how many targets are chosen so far; the plain label returns once the allowance is full.
  const maxTargets = Math.min(MULTI_TARGET_LIMIT, opponentCount);
  const picked = choice.kind === 'ATTACK' ? choice.targets.length : 0;
  const lockLabel = multi && picked > 0 ? (picked >= maxTargets ? `Lock In (all ${picked} Targets)` : `Lock In (${picked} of ${maxTargets} Targets)`) : 'Lock In';
  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Lock in your action"
      data-testid="lockin-popup"
      data-lockin-popup
      data-anchor={anchor.label}
      style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      className="z-40 w-[min(20rem,calc(100vw-1rem))] space-y-2 rounded-xl border-2 border-neon bg-void/95 p-3 shadow-[0_0_24px_rgba(62,230,255,0.45)] backdrop-blur"
    >
      <p className="bracket text-center text-sm font-bold text-ink" data-testid="confirm-choice">
        {choiceLabel(choice, nameOf)}
      </p>
      {aimed && choice.kind === 'ATTACK' && (
        <p data-testid="target-hint" role="status" className="text-center text-xs text-gold">
          <span aria-hidden="true">🎯 </span>
          {choice.targets.length === 0
            ? 'Tap an opponent’s card to choose your target.'
            : multi
              ? `Tap up to ${Math.min(MULTI_TARGET_LIMIT, opponentCount)} cards (tap again to remove).`
              : 'Tap another card to change the target.'}
        </p>
      )}
      {choice.kind === 'ATTACK' && !aimed && <p className="text-center text-xs text-ink-dim">Hits every opponent.</p>}
      <div className="flex gap-2">
        {(!aimed || ready) && (
          <button
            type="button"
            data-testid="lock-in"
            aria-disabled={!ready || sending}
            onClick={onLockIn}
            className={`flex-1 rounded-lg px-3 py-2.5 font-black ${ready ? 'bg-ok text-void hover:brightness-110' : 'cursor-not-allowed bg-ok/25 text-ink-dim'}`}
          >
            {lockLabel}
          </button>
        )}
        <button type="button" data-testid="cancel-action" onClick={onCancel} className="rounded-lg border border-edge px-3 py-2.5 text-sm text-ink-dim hover:text-ink">
          Cancel / Go Back
        </button>
      </div>
      {(!aimed || ready) && <p className="text-center text-[11px] text-ink-dim">Nobody sees your choice until everyone locks in.</p>}
    </div>
  );
}

function payloadToChoice(p: NonNullable<ReturnType<typeof useGameState>['ownCommit']>): Choice {
  if (p.kind === 'CHARGE') return { kind: 'CHARGE' };
  if (p.kind === 'DEFENSE') return { kind: 'DEFENSE', defense: p.defense! };
  return { kind: 'ATTACK', weapon: p.weapon!, targets: p.targets ?? [] };
}

export function choiceLabel(choice: Choice, nameOf: (id: PlayerId) => string): string {
  if (choice.kind === 'CHARGE') return 'Charge';
  if (choice.kind === 'DEFENSE') return DEFENSES[choice.defense].name;
  const name = ATTACKS[choice.weapon].name;
  if (ATTACKS[choice.weapon].targetMode === 'ALL_OPPONENTS') return `${name} → all opponents`;
  return choice.targets.length > 0 ? `${name} → ${choice.targets.map(nameOf).join(', ')}` : name;
}

/** Re-exported for tests. */
export { ATTACK_IDS };

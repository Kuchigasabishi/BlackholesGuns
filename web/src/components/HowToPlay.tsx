import { useEffect, useRef, useState } from 'react';
import bookOpen from '../assets/landing/book-open.svg';
import { trapTab } from '../a11y';
import {
  ATTACK_IDS,
  ATTACKS,
  DEFENSES,
  DEFENSE_IDS,
  INTERACTION_MATRIX_V2,
  MAX_CHARGE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  OVERTIME_AFTER,
  SERIES_WIN_TARGET,
  SERIES_WIN_TARGET_OPTIONS,
  SUDDEN_DEATH_AFTER,
  matrixCellEffect,
  type MatrixEffect,
} from '../../../src/engine';

// Colour is never the only signal: every cell has a symbol AND a word.
const CELL: Record<MatrixEffect, { symbol: string; word: string; style: string }> = {
  BLOCKED: { symbol: '✔', word: 'BLOCK', style: 'text-ok' },
  TARGET_ELIMINATED: { symbol: '✖', word: 'ELIM', style: 'bg-danger/10 text-danger' },
  ATTACKER_ELIMINATED: { symbol: '↩', word: 'REFLECT', style: 'bg-gold/10 text-gold' },
};

const CLASS_LABEL = { RANGED: 'ranged', MELEE: 'melee', SPECIAL: 'special' } as const;
const TARGETS_LABEL = { SINGLE: '1 target', UP_TO_THREE: 'up to 3 targets', ALL_OPPONENTS: 'all opponents' } as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h3 id={id} className="font-display text-lg text-neon">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function InteractionMatrix() {
  return (
    <div
      role="region"
      aria-label="Attack versus defense matrix (scrolls sideways on small screens)"
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-edge"
    >
      <table className="bracket w-full min-w-[40rem] border-collapse text-center text-xs sm:text-sm" data-testid="interaction-matrix">
        <caption className="sr-only">
          What happens to the defender who uses each defense (columns) when hit by each attack (rows).
        </caption>
        <thead>
          <tr className="bg-panel-2">
            <th scope="col" className="sticky left-0 z-10 bg-panel-2 px-2 py-2 text-left">
              Attack ↓ / Defense →
            </th>
            {DEFENSE_IDS.map((d) => (
              <th key={d} scope="col" className="px-2 py-2">
                {DEFENSES[d].name}
                <span className="block font-normal text-ink-dim">{DEFENSES[d].cost}⚡</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ATTACK_IDS.map((a) => (
            <tr key={a} className="border-t border-edge">
              <th scope="row" className="sticky left-0 z-10 bg-panel px-2 py-1.5 text-left font-bold">
                {ATTACKS[a].name}
                <span className="block font-normal text-ink-dim">
                  Tier {ATTACKS[a].tier} · {CLASS_LABEL[ATTACKS[a].attackClass]}
                </span>
              </th>
              {DEFENSE_IDS.map((d) => {
                const cell = CELL[matrixCellEffect(INTERACTION_MATRIX_V2[a][d])];
                return (
                  <td key={d} className={`px-1 py-1.5 font-bold ${cell.style}`} data-cell={`${a}:${d}`}>
                    <span aria-hidden="true">{cell.symbol} </span>
                    {cell.word}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Content() {
  return (
    <div className="space-y-6 text-ink">
      <Section id="htp-goal" title="The goal">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            {MIN_PLAYERS}–{MAX_PLAYERS} players. Be the <strong>last player standing</strong> to win a match (+1 Match Win).
          </li>
          <li>
            First to the lobby's <strong>Series Win Target</strong> ({SERIES_WIN_TARGET_OPTIONS.join(', ')} Match Wins; the host picks, default {SERIES_WIN_TARGET}) wins the series.
          </li>
        </ul>
      </Section>

      <Section id="htp-turn" title="How a turn works">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Everyone secretly picks one action: <strong>Charge</strong>, a <strong>defense</strong>, or an <strong>attack</strong> (with targets).</li>
          <li>Press <strong>Lock in</strong>. You can see who has locked in (READY), never what they chose (HIDDEN ?).</li>
          <li>When everyone has locked in or time runs out, all actions are revealed at once and resolved together.</li>
          <li>Anyone eliminated is out for the round. Last one alive wins the match.</li>
        </ol>
      </Section>

      <Section id="htp-charge" title="Charge">
        <ul className="list-disc space-y-1 pl-5">
          <li>Charge gives you +1⚡ (up to {MAX_CHARGE}). Attacks and Reflects cost Charge.</li>
          <li>
            <strong>You only ever see your own Charge.</strong> Opponents' balances are hidden, so you have to guess what they can afford.
          </li>
          <li>If you Charge and an attack is aimed at you, you are eliminated: you left yourself undefended.</li>
        </ul>
      </Section>

      <Section id="htp-attacks" title="Attacks (cost = tier)">
        <ul className="grid gap-1 sm:grid-cols-2">
          {ATTACK_IDS.map((a) => (
            <li key={a} className="bracket rounded border border-edge px-2 py-1 text-sm">
              <strong>{ATTACKS[a].name}</strong> · {ATTACKS[a].cost}⚡ · {CLASS_LABEL[ATTACKS[a].attackClass]} · {TARGETS_LABEL[ATTACKS[a].targetMode]}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="htp-defenses" title="Defenses">
        <ul className="grid gap-1 sm:grid-cols-2">
          {DEFENSE_IDS.map((d) => (
            <li key={d} className="bracket rounded border border-edge px-2 py-1 text-sm">
              <strong>{DEFENSES[d].name}</strong> · {DEFENSES[d].cost === 0 ? 'free' : `${DEFENSES[d].cost}⚡`}
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-dim">
          Dodge and Shield are free but each stops only some attacks. Reflects cost Charge: against some attacks they send the attack back and eliminate the attacker, against others they only block, and some attacks get through. The matrix below shows exactly which defense answers which attack.
        </p>
      </Section>

      <Section id="htp-matrix" title="Attack vs. defense matrix">
        <p className="text-sm text-ink-dim">
          Read across: pick an attack (row), then find what happens to a defender using each defense (column).
        </p>
        <ul className="bracket flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legend">
          <li className="text-ok">✔ BLOCK — defender survives</li>
          <li className="text-danger">✖ ELIM — defender is eliminated</li>
          <li className="text-gold">↩ REFLECT — attacker is eliminated</li>
        </ul>
        <p className="text-sm text-gold sm:hidden">← Scroll the table sideways to see every defense →</p>
        <InteractionMatrix />
        <p className="text-sm text-ink-dim">
          Multi-target attacks are resolved separately for each target they hit. Blackhole eliminates its targets whatever defense they use.
        </p>
      </Section>

      <Section id="htp-collide" title="When two attacks collide">
        <p className="text-sm text-ink-dim">
          Attacks only fight each other when two players are attacking <strong>each other</strong>. If you attack someone who is attacking a third player, they have no defense against you and are eliminated, and the same goes for you if
          someone you are not attacking hits you. When you are attacking each other:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Higher tier wins</strong> — the lower-tier attacker is eliminated.</li>
          <li><strong>Same tier, ranged vs. melee</strong> — ranged wins; the melee attacker is eliminated.</li>
          <li><strong>Same tier and same class</strong> — they cancel; nobody is eliminated.</li>
          <li><strong>Blackhole</strong> beats every attack. Two Blackholes cancel each other.</li>
        </ul>
      </Section>

      <Section id="htp-phases" title="Stalemates: Sudden Death and Overtime">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            After <strong>{SUDDEN_DEATH_AFTER} turns</strong> in a row with no elimination (two players left): <strong>Sudden Death</strong>. All defenses are disabled and you must attack whenever you can afford to.
          </li>
          <li>
            After <strong>{OVERTIME_AFTER} turns</strong> without an elimination: <strong>Overtime</strong>. Normal rules return. There is no draw; play continues until someone wins.
          </li>
          <li>If every remaining player is eliminated on the same turn, the round is void and restarts.</li>
        </ul>
      </Section>
    </div>
  );
}

/** "How to play" button + modal dialog (focus-trapped, Esc / backdrop / Close to dismiss, focus returns to the button). */
export function HowToPlay({ landing = false }: { landing?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();
    const opener = trigger.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      return;
    }
    trapTab(e, dialog.current);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={landing ? 'flex items-start gap-[10px] rounded-[4px] border border-[#153744] bg-[#132e37] px-4 py-[13px] font-inter text-[13px] font-semibold text-[#50e3ed] hover:bg-[#17394a]' : 'mx-auto rounded-lg border-2 border-gold bg-gold/10 px-6 py-3 font-display font-bold text-gold hover:bg-gold/20'}
        data-testid="how-to-play-button"
      >
        {landing ? (
          <>
            <img src={bookOpen} alt="" aria-hidden="true" className="size-[17px] shrink-0" />
            <span>How to play</span>
          </>
        ) : (
          '📖 How to play'
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-void/90 p-2 sm:p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          onKeyDown={onKeyDown}
        >
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="htp-title"
            data-testid="how-to-play-dialog"
            className="neon-box flex max-h-[95vh] w-full max-w-4xl flex-col rounded-2xl border-2 border-neon"
          >
            <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3 sm:px-6">
              <h2 id="htp-title" className="font-display text-xl font-black text-neon sm:text-2xl">
                How to play
              </h2>
              <button
                ref={closeBtn}
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-edge px-3 py-1 font-bold hover:bg-panel-2"
              >
                Close <span aria-hidden="true">✕</span>
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-4 sm:px-6" tabIndex={-1}>
              <Content />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

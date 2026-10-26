import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import arrowRight from '../assets/modal/arrow-right.svg';

/**
 * The shared frame of the three overlay screens (Match Results, Turn Resolution, Series Over) from the Figma modal
 * frames: a dimmed scrim, an 800px dark panel with cyan / magenta accent bars, a heading, a body and a footer with one
 * primary action. It is a real modal dialog; each modal supplies its own focus handling through `onKeyDown`.
 */
export function ModalShell({
  dialogRef,
  testId,
  titleId,
  kicker = 'BLACKHOLES & GUNS / AFTER ACTION',
  tag,
  title,
  onKeyDown,
  panelClassName = '',
  panelData,
  footer,
  children,
}: {
  dialogRef: RefObject<HTMLDivElement | null>;
  testId: string;
  titleId: string;
  kicker?: string;
  tag: string;
  title: string;
  onKeyDown: (e: KeyboardEvent) => void;
  panelClassName?: string;
  /** Extra data-* attributes on the panel (the Turn Resolution shake tier). */
  panelData?: Record<string, string | undefined>;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,5,10,0.78)] p-2 sm:p-4" onKeyDown={onKeyDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        {...panelData}
        className={`relative flex max-h-[95dvh] w-full max-w-[800px] flex-col overflow-hidden rounded-lg border border-[#24515e] bg-[#0c1420] shadow-[0_24px_80px_rgba(0,0,0,0.7)] ${panelClassName}`}
      >
        <span className="absolute -left-px -top-px h-[2px] w-28 bg-[#50e3ed]" aria-hidden="true" />
        <span className="absolute right-[23px] -top-px h-[2px] w-9 bg-[#d37bc6]" aria-hidden="true" />
        <div className="flex flex-col gap-3 border-b border-[#243747] px-5 pb-5 pt-6 sm:px-8 sm:pb-6">
          <div className="flex items-center justify-between gap-3 font-plex text-[11px] leading-[1.4]">
            <p className="text-[#50e3ed]">{kicker}</p>
            <p className="text-[#546b7d]" aria-hidden="true">
              {tag}
            </p>
          </div>
          <h2 id={titleId} className="font-grotesk text-[clamp(22px,4.5vw,30px)] font-bold leading-tight text-[#eef6fa]">
            {title}
          </h2>
        </div>
        <div className="flex flex-col gap-6 overflow-y-auto p-5 sm:p-8">{children}</div>
        <div className="border-t border-[#243747] bg-[#070d16] px-5 pb-6 pt-[22px] sm:px-8">{footer}</div>
      </div>
    </div>
  );
}

/** The wide cyan primary action at the base of every modal. */
export function PrimaryAction({ buttonRef, label, onClick, testId, disabled }: { buttonRef: RefObject<HTMLButtonElement | null>; label: string; onClick: () => void; testId: string; disabled?: boolean }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[54px] w-full items-center justify-between rounded-[4px] bg-[#50e3ed] px-5 font-inter text-[15px] font-bold text-[#02050a] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
      <img src={arrowRight} alt="" aria-hidden="true" className="size-5" />
    </button>
  );
}

/**
 * One ranked player row (Match Results and Series Over): rank, name with its tag, one progress segment per win
 * needed (filled for each win earned) and the big win count on the right.
 */
export function StandingRow({
  testId,
  rank,
  name,
  tag,
  you,
  wins,
  target,
  highlight,
  scoreLabel,
  data,
}: {
  testId: string;
  rank: number;
  name: string;
  tag?: string | undefined;
  you?: boolean;
  wins: number;
  target: number;
  highlight: boolean;
  scoreLabel: string;
  data?: Record<string, string | boolean | undefined>;
}) {
  return (
    <li
      data-testid={testId}
      {...data}
      className={`flex items-center gap-4 rounded-[4px] border p-[18px] ${highlight ? 'border-[#24515e] bg-[#132e37]' : 'border-[#243747] bg-[#070d16]'}`}
    >
      <span className={`font-plex text-[13px] ${highlight ? 'text-[#50e3ed]' : 'text-[#546b7d]'}`}>{String(rank).padStart(2, '0')}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-[10px]">
        <p className="flex flex-wrap items-center gap-x-[10px] gap-y-1 leading-none">
          <span className="truncate font-grotesk text-[22px] font-bold text-[#eef6fa]">{name}</span>
          {tag && <span className="font-plex text-[10px] text-[#50e3ed]">{tag}</span>}
          {you && <span className="rounded-[2px] bg-[#132e37] px-2 py-[5px] font-plex text-[10px] font-semibold text-[#50e3ed]">YOU</span>}
        </p>
        <div className="flex gap-[5px]" aria-hidden="true">
          {Array.from({ length: target }, (_, i) => (
            <span key={i} data-filled={i < wins || undefined} className={`h-1 min-w-px flex-1 ${i < wins ? 'bg-[#50e3ed]' : 'bg-[#243747]'}`} />
          ))}
        </div>
      </div>
      <div className="flex w-[84px] shrink-0 flex-col items-end gap-[3px] sm:w-[110px]">
        <span className={`font-grotesk text-[32px] font-bold leading-none ${highlight ? 'text-[#50e3ed]' : 'text-[#eef6fa]'}`}>{wins}</span>
        <span className="font-plex text-[10px] text-[#91a5b6]">{scoreLabel}</span>
      </div>
    </li>
  );
}

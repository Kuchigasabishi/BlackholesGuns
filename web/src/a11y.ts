import type { KeyboardEvent } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"]),input,select,textarea';

/** Keeps Tab / Shift+Tab inside a modal dialog. Call from the dialog's onKeyDown. */
export function trapTab(e: KeyboardEvent, container: HTMLElement | null): void {
  if (e.key !== 'Tab' || !container) return;
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

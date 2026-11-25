import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]';

export function useDialogFocus(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const previousFocus = document.activeElement;
    const background = document.getElementById('root');
    const wasInert = background?.inert ?? false;
    if (background && !background.contains(dialog)) background.inert = true;

    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => element.getClientRects().length > 0);
    const initialFocus = () => dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]:not([disabled])')
      ?? focusable()[0] ?? dialog;
    initialFocus().focus();

    const handleFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) initialFocus().focus();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const boundary = event.shiftKey ? items[0] : items[items.length - 1];
      if (!dialog.contains(document.activeElement) || document.activeElement === dialog || document.activeElement === boundary) {
        event.preventDefault();
        (event.shiftKey ? items.at(-1) : items[0])?.focus();
      }
    };
    document.addEventListener('focusin', handleFocus);
    window.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('focusin', handleFocus);
      window.removeEventListener('keydown', handleKey, true);
      if (background && !background.contains(dialog)) background.inert = wasInert;
      const restoreTarget = previousFocus instanceof HTMLElement && previousFocus !== document.body && previousFocus.isConnected
        ? previousFocus : background?.querySelector<HTMLElement>('[data-auth-dialog-trigger]');
      restoreTarget?.focus();
    };
  }, [open]);

  return dialogRef;
}

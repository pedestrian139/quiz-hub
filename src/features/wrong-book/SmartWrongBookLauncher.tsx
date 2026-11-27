import { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../../components/Auth/useDialogFocus';
import { EnsureBankLibraryProvider, SmartWrongBook } from './SmartWrongBook';
import { useWrongBook } from './useWrongBook';
import './WrongBook.css';

function SmartWrongBookLauncherInner() {
  const { items, refresh } = useWrongBook();
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const handleClose = useCallback(() => {
    setOpen(false);
    refresh();
  }, [refresh]);

  const dialogRef = useDialogFocus(open, handleClose);

  // Isolate QuizSession window bubble shortcuts from keystrokes both inside and outside the modal
  // (e.g. when a focused control unmounts/disables and activeElement drops to document.body),
  // while preserving modal-internal handlers, form typing, and useDialogFocus Tab/Escape behavior.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    let disposed = false;
    let recoveryScheduled = false;

    const recoverDroppedFocus = () => {
      if (recoveryScheduled || disposed) return;
      recoveryScheduled = true;
      queueMicrotask(() => {
        recoveryScheduled = false;
        if (disposed || !dialog.isConnected) return;
        const active = document.activeElement;
        if (
          active === null ||
          active === document.body ||
          active === document.documentElement
        ) {
          dialog.focus({ preventScroll: true });
        }
      });
    };

    const onWindowKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') return;
      const target = e.target;
      if (target instanceof Node && dialog.contains(target)) {
        return;
      }
      e.stopImmediatePropagation();
    };

    const onDialogKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') return;
      e.stopPropagation();
    };

    const onDialogFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && dialog.contains(e.relatedTarget)) {
        return;
      }
      recoverDroppedFocus();
    };

    const observer =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            const active = document.activeElement;
            if (
              active === null ||
              active === document.body ||
              active === document.documentElement
            ) {
              recoverDroppedFocus();
            }
          })
        : null;

    observer?.observe(dialog, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });

    window.addEventListener('keydown', onWindowKeyDownCapture, true);
    dialog.addEventListener('keydown', onDialogKeyDown);
    dialog.addEventListener('focusout', onDialogFocusOut);

    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('keydown', onWindowKeyDownCapture, true);
      dialog.removeEventListener('keydown', onDialogKeyDown);
      dialog.removeEventListener('focusout', onDialogFocusOut);
    };
  }, [dialogRef, open]);

  const handleOpen = () => {
    refresh();
    setOpen(true);
  };

  return (
    <>
      <section
        className="wb-launcher-bar"
        aria-label="智能错题本入口"
        data-testid="wb-launcher-bar"
      >
        <div className="wb-launcher-bar__inner">
          <div className="wb-launcher-bar__info">
            <span className="wb-launcher-bar__badge" data-testid="wb-launcher-count">
              {items.length > 0 ? `待巩固 ${items.length} 题` : '暂无错题'}
            </span>
            <span className="wb-launcher-bar__text">
              跨题库自动聚合错题、专项重练并导出 Markdown 复习文档
            </span>
          </div>
          <div className="wb-launcher-bar__actions">
            <button
              type="button"
              className="wb-launcher-btn"
              data-testid="wb-open-btn"
              onClick={handleOpen}
            >
              智能错题本
            </button>
          </div>
        </div>
      </section>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="wb-modal-backdrop"
            data-testid="wb-modal-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                handleClose();
              }
            }}
          >
            <div
              ref={dialogRef}
              className="wb-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              data-testid="wb-modal"
            >
              <SmartWrongBook titleId={titleId} onClose={handleClose} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function SmartWrongBookLauncher() {
  return (
    <EnsureBankLibraryProvider>
      <SmartWrongBookLauncherInner />
    </EnsureBankLibraryProvider>
  );
}

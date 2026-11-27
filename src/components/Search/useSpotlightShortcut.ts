import { useEffect } from 'react';

const EDITABLE = 'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])';

export function useSpotlightShortcut(open: boolean, onOpen: () => void, onClose: () => void) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (open && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (
        event.repeat || event.shiftKey || event.altKey ||
        !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k'
      ) return;
      if (!open) {
        if (event.target instanceof Element && event.target.closest(EDITABLE)) return;
        if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
        onOpen();
      }
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [open, onOpen, onClose]);
}

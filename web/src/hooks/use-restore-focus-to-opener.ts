import { useCallback, useRef } from "react";

/**
 * Focus goes back to whatever had it when a dialog opened, as the Expo app's overlays did
 * (lib/overlay-root.ts). Radix only returns focus to a Dialog.Trigger, and most of our dialogs are
 * opened from state without one, so on close focus fell to the body.
 *
 * Call it in the dialog content's render: the content mounts on open, before focus moves into it.
 */
export function useRestoreFocusToOpener(onCloseAutoFocus?: (event: Event) => void) {
  const openerRef = useRef<Element | null>(
    typeof document === "undefined" ? null : document.activeElement,
  );
  return useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const opener = openerRef.current;
      if (!(opener instanceof HTMLElement) || !opener.isConnected || opener === document.body) {
        return;
      }
      event.preventDefault();
      opener.focus();
    },
    [onCloseAutoFocus],
  );
}

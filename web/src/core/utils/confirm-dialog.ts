// Port of archive/expo-app:packages/app/src/utils/confirm-dialog.ts. Same contract and the same native Wails
// dialog on desktop; in a browser it opens shadcn's AlertDialog (ConfirmDialogHost) instead of
// window.confirm.
export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PendingConfirmDialog {
  input: ConfirmDialogInput;
  settle: (confirmed: boolean) => void;
}

let pending: PendingConfirmDialog | null = null;
const listeners = new Set<() => void>();

function publish(next: PendingConfirmDialog | null) {
  pending = next;
  for (const listener of listeners) listener();
}

export function subscribeConfirmDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingConfirmDialog(): PendingConfirmDialog | null {
  return pending;
}

function isWailsNativeContainer(): boolean {
  return (
    window.location.protocol === "wails:" ||
    window.location.hostname === "wails.localhost" ||
    "wails" in window
  );
}

function blurActiveElement(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

async function showWailsConfirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  blurActiveElement();
  const res = await fetch("/_byspace/desktop/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      message: input.message,
      confirmLabel: input.confirmLabel ?? "OK",
      cancelLabel: input.cancelLabel ?? "Cancel",
    }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { confirmed?: boolean };
  return Boolean(data.confirmed);
}

export async function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  if (isWailsNativeContainer()) {
    try {
      return await showWailsConfirmDialog(input);
    } catch {
      // The desktop endpoint is unreachable; fall through to the in-page dialog.
    }
  }
  blurActiveElement();
  // A second request while one is open answers the first with "cancel".
  pending?.settle(false);
  return await new Promise<boolean>((resolve) => {
    const entry: PendingConfirmDialog = {
      input,
      settle: (confirmed) => {
        if (pending === entry) publish(null);
        resolve(confirmed);
      },
    };
    publish(entry);
  });
}

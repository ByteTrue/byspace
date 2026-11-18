// Port of archive/expo-app:packages/app/src/utils/confirm-dialog.ts. Same contract; everywhere, the desktop
// app included, it opens shadcn's AlertDialog (ConfirmDialogHost), never a native dialog.
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

function blurActiveElement(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

export async function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
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

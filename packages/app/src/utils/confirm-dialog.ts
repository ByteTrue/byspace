export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export async function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  const confirm = globalThis.confirm;
  if (typeof confirm !== "function") {
    throw new Error("[ConfirmDialog] Browser confirmation is unavailable.");
  }
  if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  const message = input.title ? `${input.title}\n\n${input.message}` : input.message;
  return confirm(message);
}

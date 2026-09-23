export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

function showWebConfirmDialog(input: ConfirmDialogInput): boolean {
  const browserConfirm = (globalThis as { confirm?: (message?: string) => boolean }).confirm;
  if (typeof browserConfirm !== "function") {
    throw new Error("[ConfirmDialog] No web confirmation backend is available.");
  }

  blurActiveWebElement();
  const promptMessage = `${input.title}\n\n${input.message}`;
  return browserConfirm(promptMessage);
}

export async function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  return showWebConfirmDialog(input);
}

function blurActiveWebElement(): void {
  const activeElement = (globalThis as { document?: Document }).document?.activeElement;
  (activeElement as HTMLElement | null)?.blur?.();
}

export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

function isWailsNativeContainer(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.location?.protocol === "wails:" ||
    window.location?.hostname === "wails.localhost" ||
    "wails" in window
  );
}

async function showWailsConfirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  blurActiveWebElement();
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
  if (!res.ok) {
    return false;
  }
  const data = (await res.json()) as { confirmed?: boolean };
  return Boolean(data.confirmed);
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
  if (isWailsNativeContainer() && typeof fetch === "function") {
    try {
      return await showWailsConfirmDialog(input);
    } catch {
      // Fall back to browser confirm if the desktop endpoint is unreachable
    }
  }
  return showWebConfirmDialog(input);
}

function blurActiveWebElement(): void {
  const activeElement = (globalThis as { document?: Document }).document?.activeElement;
  (activeElement as HTMLElement | null)?.blur?.();
}

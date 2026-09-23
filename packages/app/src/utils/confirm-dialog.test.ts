import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmDialog } from "./confirm-dialog";

function clearDialogGlobals(): void {
  delete (globalThis as { confirm?: unknown }).confirm;
}

describe("confirmDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearDialogGlobals();
  });

  it("blurs the active element and delegates to the browser confirm", async () => {
    const browserConfirm = vi.fn(() => true);
    const blurMock = vi.fn();
    (globalThis as { document?: unknown }).document = {
      activeElement: { blur: blurMock },
    } as unknown as Document;
    (globalThis as { confirm?: unknown }).confirm = browserConfirm;

    const confirmed = await confirmDialog({
      title: "Restart host",
      message: "This will restart the daemon.",
      confirmLabel: "Restart",
      cancelLabel: "Cancel",
      destructive: true,
    });

    expect(confirmed).toBe(true);
    expect(blurMock).toHaveBeenCalledTimes(1);
    expect(browserConfirm).toHaveBeenCalledWith("Restart host\n\nThis will restart the daemon.");
  });

  it("throws when no confirm backend exists", async () => {
    await expect(
      confirmDialog({
        title: "Restart host",
        message: "This will restart the daemon.",
      }),
    ).rejects.toThrow("[ConfirmDialog] No web confirmation backend is available.");
  });
});

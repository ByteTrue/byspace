import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmDialog } from "./confirm-dialog";

function clearDialogGlobals(): void {
  delete (globalThis as { confirm?: unknown }).confirm;
  delete (globalThis as { window?: unknown }).window;
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

  it("uses the native Wails /_byspace/desktop/confirm endpoint inside Wails containers", async () => {
    (globalThis as { window?: unknown }).window = {
      location: { protocol: "wails:", hostname: "localhost" },
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ confirmed: true }),
    } as Response);

    const confirmed = await confirmDialog({
      title: "Uninstall BySpace skills?",
      message: "Removes all BySpace orchestration skills.",
      confirmLabel: "Uninstall",
      destructive: true,
    });

    expect(confirmed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/_byspace/desktop/confirm",
      expect.objectContaining({ method: "POST" }),
    );
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

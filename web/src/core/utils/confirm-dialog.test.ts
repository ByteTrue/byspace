// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmDialog, getPendingConfirmDialog } from "./confirm-dialog";

describe("confirmDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { wails?: unknown }).wails;
    getPendingConfirmDialog()?.settle(false);
  });

  it("uses the native Wails /_byspace/desktop/confirm endpoint inside Wails containers", async () => {
    (window as { wails?: unknown }).wails = {};
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
    expect(getPendingConfirmDialog()).toBeNull();
  });

  it("blurs the focused element and answers with the in-page dialog's choice", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    const answer = confirmDialog({
      title: "Restart host",
      message: "This will restart the daemon.",
    });

    expect(document.activeElement).not.toBe(button);
    const pending = getPendingConfirmDialog();
    expect(pending?.input.title).toBe("Restart host");
    pending?.settle(true);
    await expect(answer).resolves.toBe(true);
    expect(getPendingConfirmDialog()).toBeNull();
  });

  it("answers an open request with cancel when a second one arrives", async () => {
    const first = confirmDialog({ title: "First", message: "" });
    const second = confirmDialog({ title: "Second", message: "" });

    await expect(first).resolves.toBe(false);
    expect(getPendingConfirmDialog()?.input.title).toBe("Second");
    getPendingConfirmDialog()?.settle(true);
    await expect(second).resolves.toBe(true);
  });
});

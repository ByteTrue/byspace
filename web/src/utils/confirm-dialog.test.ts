// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmDialog, getPendingConfirmDialog } from "./confirm-dialog";

describe("confirmDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { wails?: unknown }).wails;
    getPendingConfirmDialog()?.settle(false);
  });

  it("opens the in-page dialog in the desktop app too, never a native one", async () => {
    (window as { wails?: unknown }).wails = {};
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const answer = confirmDialog({ title: "Close terminal?", message: "" });

    expect(getPendingConfirmDialog()?.input.title).toBe("Close terminal?");
    getPendingConfirmDialog()?.settle(true);
    await expect(answer).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
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

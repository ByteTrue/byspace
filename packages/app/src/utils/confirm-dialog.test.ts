import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmDialog } from "./confirm-dialog";

describe("confirmDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the browser confirmation dialog", async () => {
    const browserConfirm = vi.fn(() => true);
    vi.stubGlobal("confirm", browserConfirm);

    await expect(
      confirmDialog({ title: "Restart host", message: "This will restart the daemon." }),
    ).resolves.toBe(true);
    expect(browserConfirm).toHaveBeenCalledWith("Restart host\n\nThis will restart the daemon.");
  });

  it("fails clearly when confirmation is unavailable", async () => {
    vi.stubGlobal("confirm", undefined);
    await expect(confirmDialog({ title: "Confirm", message: "Continue?" })).rejects.toThrow(
      "Browser confirmation is unavailable",
    );
  });
});

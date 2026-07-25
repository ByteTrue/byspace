import { describe, expect, it, vi } from "vitest";
import type { ToastApi } from "@/components/toast-host";
import { showProviderNoticeToast } from "./provider-notice-toast";

function createToast(): ToastApi {
  return {
    show: vi.fn(),
    copied: vi.fn(),
    error: vi.fn(),
  };
}

describe("showProviderNoticeToast", () => {
  it("preserves warning severity and keeps it visible longer", () => {
    const toast = createToast();

    showProviderNoticeToast(toast, { type: "warning", message: "Applies next turn" });

    expect(toast.show).toHaveBeenCalledWith("Applies next turn", {
      variant: "warning",
      durationMs: 5000,
    });
  });

  it("preserves info severity", () => {
    const toast = createToast();

    showProviderNoticeToast(toast, { type: "info", message: "Updated" });

    expect(toast.show).toHaveBeenCalledWith("Updated", {
      variant: "info",
      durationMs: undefined,
    });
  });

  it("uses the error helper for errors", () => {
    const toast = createToast();

    showProviderNoticeToast(toast, { type: "error", message: "Failed" });

    expect(toast.error).toHaveBeenCalledWith("Failed");
    expect(toast.show).not.toHaveBeenCalled();
  });
});

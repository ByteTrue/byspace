import { describe, expect, it, vi } from "vitest";
import type { ToastApi } from "@/widgets/toast-host";
import { runAgentReloadWithToast } from "./agent-reload-toast";

const labels = { loading: "Reloading", success: "Reloaded", failure: "Failed to reload" };

function toastDouble() {
  const show = vi.fn<ToastApi["show"]>();
  return { toast: { show }, show };
}

describe("agent reload toast", () => {
  it("replaces pending feedback with success under the same id", async () => {
    const { toast, show } = toastDouble();
    const reload = vi.fn().mockResolvedValue(undefined);

    await runAgentReloadWithToast(toast, "agent-1", labels, reload);

    expect(reload).toHaveBeenCalledOnce();
    expect(show.mock.calls).toEqual([
      ["Reloading", { id: "agent-reload:agent-1", durationMs: null }],
      ["Reloaded", { id: "agent-reload:agent-1", variant: "success" }],
    ]);
  });

  it("falls back to the failure label for a blank error", async () => {
    const { toast, show } = toastDouble();

    await runAgentReloadWithToast(toast, "agent-1", labels, async () => {
      throw new Error(" ");
    });

    expect(show).toHaveBeenLastCalledWith("Failed to reload", {
      id: "agent-reload:agent-1",
      variant: "error",
    });
  });

  it("replaces pending feedback with the failure under the same id", async () => {
    const { toast, show } = toastDouble();

    await runAgentReloadWithToast(toast, "agent-1", labels, async () => {
      throw new Error("daemon unavailable");
    });

    expect(show.mock.calls).toEqual([
      ["Reloading", { id: "agent-reload:agent-1", durationMs: null }],
      ["daemon unavailable", { id: "agent-reload:agent-1", variant: "error" }],
    ]);
  });
});

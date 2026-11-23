// @vitest-environment jsdom

import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@/i18n/i18next";
import { PiBackgroundTerminalTrack } from "./pi-background-terminal";

const { managePiBackgroundTerminal } = vi.hoisted(() => ({
  managePiBackgroundTerminal: vi.fn(),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({ managePiBackgroundTerminal }),
  useHostRuntimeIsConnected: () => true,
}));

vi.mock("@/widgets/status-ring", () => ({ StatusRing: () => null }));

const first = { id: "first", command: "npm run dev", status: "running" };
const second = { ...first, id: "second", command: "npm run watch" };

function renderTrack() {
  notifyManager.setScheduler((callback) => queueMicrotask(callback));
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <PiBackgroundTerminalTrack serverId="host" agentId="agent" />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => {
  cleanup();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  managePiBackgroundTerminal.mockReset();
});

describe("Pi background terminal track", () => {
  it("uses semantic titles and hides completed native work", async () => {
    managePiBackgroundTerminal.mockResolvedValueOnce({
      requestId: "list",
      tasks: [
        {
          ...first,
          description: "Development server",
          kind: "shell",
          canStop: true,
          startedAt: new Date(Date.now() - 65_000).toISOString(),
        },
        { ...second, status: "completed" },
      ],
      error: null,
    });
    const client = renderTrack();
    try {
      const pill = await screen.findByRole("button", { name: "Background Terminal: 1 running" });
      fireEvent.click(pill);
      const panel = within(await screen.findByTestId("pi-background-terminal-track-panel"));
      expect(panel.getByText("Development server")).toBeTruthy();
      expect(panel.getByText("npm run dev")).toBeTruthy();
      expect(
        panel.getByText(
          (_content, element) =>
            element?.children.length === 0 &&
            (element.textContent?.replace(/\s+/g, " ").includes("Shell · Running · 1m") ?? false),
        ),
      ).toBeTruthy();
      expect(panel.queryByText("npm run watch")).toBeNull();
    } finally {
      client.clear();
    }
  });

  it("does not show a track when the extension is unavailable", async () => {
    managePiBackgroundTerminal.mockResolvedValueOnce({
      requestId: "list",
      tasks: null,
      error: null,
    });
    const client = renderTrack();
    try {
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(managePiBackgroundTerminal.mock.calls).toEqual([["agent"]]);
      expect(screen.queryByTestId("pi-background-terminal-track")).toBeNull();
    } finally {
      client.clear();
    }
  });

  it("retains a stale roster with retry after list failures", async () => {
    managePiBackgroundTerminal
      .mockResolvedValueOnce({ requestId: "list", tasks: [first], error: null })
      .mockRejectedValue(new Error("agent gone"));
    const client = renderTrack();
    try {
      await screen.findByRole("button", { name: "Background Terminal: 1 running" });
      const key = ["pi-background-terminal", "host", "agent"];
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await client.refetchQueries({ queryKey: key });
        });
      }
      const pill = screen.getByRole("button", { name: "Background Terminal: 1 running" });
      fireEvent.click(pill);
      const panel = within(await screen.findByTestId("pi-background-terminal-track-panel"));
      expect(
        panel.getByText("Could not refresh background activity. Showing the last known state."),
      ).toBeTruthy();
      expect(panel.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(panel.getByText("npm run dev")).toBeTruthy();
    } finally {
      client.clear();
    }
  });

  it("lists the roster and stops only the selected command, with an in-place retry on failure", async () => {
    const roster = { requestId: "list", tasks: [first, second], error: null };
    const list = Promise.withResolvers<typeof roster>();
    managePiBackgroundTerminal
      .mockReturnValueOnce(list.promise)
      .mockResolvedValueOnce({ requestId: "error", tasks: null, error: "Still running" })
      .mockResolvedValueOnce({
        requestId: "stop",
        tasks: [{ ...first, status: "killed" }, second],
        error: null,
      });
    const client = renderTrack();
    try {
      await act(async () => list.resolve(roster));
      const pill = await screen.findByRole("button", { name: "Background Terminal: 2 running" });
      fireEvent.click(pill);
      const panel = within(await screen.findByTestId("pi-background-terminal-track-panel"));
      expect(panel.getByText("npm run dev").textContent).toBe("npm run dev");
      expect(panel.getByText("npm run watch").textContent).toBe("npm run watch");
      const stop = panel.getByRole("button", { name: "Stop npm run dev" });
      fireEvent.click(stop);
      expect((await panel.findByRole("alert")).textContent).toContain("Could not stop the command");
      fireEvent.click(stop);
      await waitFor(() => expect(panel.queryByText("npm run dev")).toBeNull());
      expect(panel.queryByRole("button", { name: "Stop npm run dev" })).toBeNull();
      expect(panel.getByRole("button", { name: "Stop npm run watch" }).textContent).toBe("Stop");
      expect(screen.getByRole("button", { name: "Background Terminal: 1 running" })).toBe(pill);
      expect(managePiBackgroundTerminal.mock.calls).toEqual([
        ["agent"],
        ["agent", "first"],
        ["agent", "first"],
      ]);
    } finally {
      client.clear();
    }
  });
});

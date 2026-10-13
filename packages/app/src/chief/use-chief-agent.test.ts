import { describe, expect, it } from "vitest";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { findChiefAgent, isHomeWorkspace, resolveChiefProvider } from "./use-chief-agent";

/** Minimal shape of a fetchAgents entry agent. */
interface AgentLike {
  id: string;
  workspaceId?: string;
  cwd: string;
}

function makeAgent(overrides: Partial<AgentLike>): AgentLike {
  return {
    id: "agent",
    workspaceId: "wks_home",
    cwd: "/home",
    ...overrides,
  };
}

describe("isHomeWorkspace", () => {
  it("matches the reserved byspace.home-workspace label", () => {
    expect(
      isHomeWorkspace({
        id: "w",
        title: "My repo",
        workspaceDirectory: "/repo",
        labels: ["byspace.home-workspace"],
      }),
    ).toBe(true);
  });

  it("leaves a user workspace titled Home alone", () => {
    expect(isHomeWorkspace({ id: "w", title: "Home", workspaceDirectory: "/custom/home" })).toBe(
      false,
    );
  });

  it("leaves a user workspace on a .byspace directory alone", () => {
    // The daemon's own Home directory is .byspace, so a path suffix is exactly
    // the signal that would claim a workspace the user opened there.
    expect(isHomeWorkspace({ id: "w", title: null, workspaceDirectory: "/home/z/.byspace" })).toBe(
      false,
    );
  });

  it("does not match a workspace with neither the label nor a Home-shaped name", () => {
    expect(isHomeWorkspace({ id: "w", title: "Work", workspaceDirectory: "/repo" })).toBe(false);
  });
});

describe("resolveChiefProvider", () => {
  it("picks the first enabled ready provider", async () => {
    const client = {
      getProvidersSnapshot: async () => ({
        entries: [
          { provider: "claude", status: "error", enabled: true },
          { provider: "codex", status: "ready", enabled: true },
          { provider: "pi", status: "ready", enabled: true },
        ],
      }),
    } as unknown as DaemonClient;
    expect(await resolveChiefProvider(client)).toBe("codex");
  });

  it("skips disabled providers", async () => {
    const client = {
      getProvidersSnapshot: async () => ({
        entries: [
          { provider: "claude", status: "ready", enabled: false },
          { provider: "pi", status: "ready", enabled: true },
        ],
      }),
    } as unknown as DaemonClient;
    expect(await resolveChiefProvider(client)).toBe("pi");
  });

  it("returns null when nothing is ready", async () => {
    const client = {
      getProvidersSnapshot: async () => ({ entries: [] }),
    } as unknown as DaemonClient;
    expect(await resolveChiefProvider(client)).toBeNull();
  });
});

describe("findChiefAgent", () => {
  function makeClient(agents: AgentLike[]): Pick<DaemonClient, "fetchAgents"> {
    return {
      fetchAgents: async () => ({
        entries: agents.map((agent) => ({ agent })),
      }),
    } as unknown as Pick<DaemonClient, "fetchAgents">;
  }

  it("only accepts a chief agent inside the Home workspace", async () => {
    const client = makeClient([
      makeAgent({ id: "cli-chief", workspaceId: "wks_other_repo" }),
      makeAgent({ id: "home-chief", workspaceId: "wks_home" }),
    ]);
    const found = await findChiefAgent(client, "wks_home");
    expect(found?.agentId).toBe("home-chief");
    expect(found?.workspaceId).toBe("wks_home");
  });

  it("ignores a chief session started elsewhere via the CLI", async () => {
    const client = makeClient([makeAgent({ id: "cli-chief", workspaceId: "wks_other_repo" })]);
    expect(await findChiefAgent(client, "wks_home")).toBeNull();
  });
});

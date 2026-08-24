import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";
import type { BySpaceApi } from "@bytetrue/byspace-client";
import { BySpaceApiProvider } from "@bytetrue/byspace-plugin/host";
import { useBySpace } from "@bytetrue/byspace-plugin";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createPluginSurfaceRuntime } from "./surface-runtime";

function clientWithWorkspace(id: string) {
  const createWorkspace = vi.fn(async () => ({
    error: null,
    workspace: {
      id,
      projectId: `project-${id}`,
      workspaceDirectory: `/tmp/${id}`,
      name: id,
      status: "active",
    },
  }));
  const createAgent = vi.fn(async () => ({
    id: `agent-${id}`,
    provider: "codex",
    cwd: `/tmp/${id}`,
    workspaceId: id,
    status: "idle",
  }));
  const invokePluginRpc = vi.fn(async () => id);
  return {
    client: { createWorkspace, createAgent, invokePluginRpc } as unknown as DaemonClient,
    createWorkspace,
    createAgent,
    invokePluginRpc,
  };
}

function borrowFromAppProvider(byspace: BySpaceApi): BySpaceApi {
  let borrowed: BySpaceApi | null = null;
  function PluginSurface() {
    borrowed = useBySpace();
    return null;
  }
  renderToStaticMarkup(
    <BySpaceApiProvider byspace={byspace}>
      <PluginSurface />
    </BySpaceApiProvider>,
  );
  if (!borrowed) throw new Error("Plugin surface did not receive BySpace API");
  return borrowed;
}

describe("plugin surface host runtime", () => {
  it("creates a PR worktree and agent through useBySpace on the selected app host", async () => {
    const selected = clientWithWorkspace("workspace-a");
    const runtime = createPluginSurfaceRuntime(selected.client, "workspace-plugin");
    if (!runtime) throw new Error("Expected selected host runtime");

    const byspace = borrowFromAppProvider(runtime.byspace);
    const workspace = await byspace.workspaces.create({
      source: {
        kind: "worktree",
        cwd: "/tmp/repository",
        action: "checkout",
        checkoutSource: { kind: "change_request", forge: "github", number: 42 },
      },
    });
    const agent = await workspace.agents.create({
      config: { provider: "codex/gpt-5" },
      prompt: "Review PR #42",
    });

    expect(workspace.id).toBe("workspace-a");
    expect(agent.id).toBe("agent-workspace-a");
    expect(selected.createWorkspace).toHaveBeenCalledOnce();
    expect(selected.createAgent).toHaveBeenCalledOnce();
  });

  it("switches all plugin calls when the selected host changes", async () => {
    const hostA = clientWithWorkspace("workspace-a");
    const hostB = clientWithWorkspace("workspace-b");
    const first = createPluginSurfaceRuntime(hostA.client, "same-plugin");
    const second = createPluginSurfaceRuntime(hostB.client, "same-plugin");
    if (!first || !second) throw new Error("Expected online host runtimes");

    await first.invoke("host", {});
    await borrowFromAppProvider(second.byspace).workspaces.create({
      source: { kind: "directory", path: "/tmp/workspace-b" },
    });

    expect(hostA.invokePluginRpc).toHaveBeenCalledWith("same-plugin", "host", {});
    expect(hostA.createWorkspace).not.toHaveBeenCalled();
    expect(hostB.createWorkspace).toHaveBeenCalledOnce();
  });

  it("keeps an offline selected host unavailable instead of borrowing another host", () => {
    const otherHost = clientWithWorkspace("workspace-online");

    expect(createPluginSurfaceRuntime(null, "same-plugin")).toBeNull();
    expect(otherHost.createWorkspace).not.toHaveBeenCalled();
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, describe, expect, test } from "vitest";
import type { SessionOutboundMessage, StartWorkspaceScriptRequest } from "../../messages.js";
import { createServiceProxySubsystem, type ServiceProxySubsystem } from "../../service-proxy.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type {
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../../workspace-registry.js";
import { WorkspaceScriptRuntimeStore } from "../../workspace-script-runtime-store.js";
import type {
  SpawnWorkspaceScriptOptions,
  WorktreeScriptResult,
} from "../../worktree-bootstrap.js";
import { createWorkspaceScriptsService } from "./workspace-scripts-service.js";

// The production module reads only WorkspaceGitService.peekSnapshot and the two registries' get
// methods, then forwards the launcher and opaque managers to the injected spawn port.

const logger = pino({ level: "silent" });

function fakeWorkspaceRegistry(
  record: PersistedWorkspaceRecord | null,
): Pick<WorkspaceRegistry, "get"> {
  return {
    async get() {
      return record;
    },
  };
}

function fakeProjectRegistry(): Pick<ProjectRegistry, "get"> {
  return {
    async get() {
      return null;
    },
  };
}

function fakeGitService() {
  return {
    peekSnapshot() {
      return {
        git: {
          isGit: true,
          remoteUrl: "git@github.com:bytetrue/byspace.git",
          currentBranch: "feature/scripts",
        },
      };
    },
  };
}

// The service only truthiness-checks terminalManager in its availability guard and then forwards it
// opaquely to the injected spawnWorkspaceScript fake, which ignores it — an empty stand-in is enough.
const availableTerminalManager = {} as unknown as TerminalManager;

interface BuildOptions {
  serviceProxy?: ServiceProxySubsystem | null;
  scriptRuntimeStore?: WorkspaceScriptRuntimeStore | null;
  terminalManager?: TerminalManager | null;
  workspace?: PersistedWorkspaceRecord | null;
  spawnThrows?: string;
}

function buildService(options: BuildOptions = {}) {
  const emitted: SessionOutboundMessage[] = [];
  const spawnCalls: SpawnWorkspaceScriptOptions[] = [];
  const workspace =
    options.workspace === undefined
      ? ({
          workspaceId: "ws-1",
          projectId: "project-1",
          cwd: "/tmp/repo",
          branch: "feature/scripts",
        } as PersistedWorkspaceRecord)
      : options.workspace;

  const service = createWorkspaceScriptsService({
    serviceProxy:
      options.serviceProxy === undefined
        ? createServiceProxySubsystem({ logger })
        : options.serviceProxy,
    scriptRuntimeStore:
      options.scriptRuntimeStore === undefined
        ? new WorkspaceScriptRuntimeStore()
        : options.scriptRuntimeStore,
    terminalManager:
      options.terminalManager === undefined ? availableTerminalManager : options.terminalManager,
    workspaceRegistry: fakeWorkspaceRegistry(workspace),
    projectRegistry: fakeProjectRegistry(),
    workspaceGitService: fakeGitService(),
    getDaemonTcpPort: () => 6777,
    getDaemonTcpHost: () => "127.0.0.1",
    serviceProxyPublicBaseUrl: null,
    resolveScriptHealth: null,
    logger,
    emit: (message) => emitted.push(message),
    async spawnWorkspaceScript(spawnOptions): Promise<WorktreeScriptResult> {
      spawnCalls.push(spawnOptions);
      if (options.spawnThrows) {
        throw new Error(options.spawnThrows);
      }
      spawnOptions.onLifecycleChanged?.();
      return {
        scriptName: spawnOptions.scriptName,
        hostname: null,
        port: null,
        terminalId: "terminal-1",
      };
    },
  });

  return { service, emitted, spawnCalls, workspace };
}

const request: StartWorkspaceScriptRequest = {
  type: "start_workspace_script_request",
  workspaceId: "ws-1",
  scriptName: "app",
  requestId: "req-1",
};

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("buildSnapshot", () => {
  test("returns no scripts when the service proxy is unavailable", () => {
    const { service, workspace } = buildService({ serviceProxy: null });
    expect(service.buildSnapshot(workspace as PersistedWorkspaceRecord)).toEqual([]);
  });

  test("returns no scripts when the runtime store is unavailable", () => {
    const { service, workspace } = buildService({ scriptRuntimeStore: null });
    expect(service.buildSnapshot(workspace as PersistedWorkspaceRecord)).toEqual([]);
  });

  test("projects service URLs from the workspace git snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "workspace-scripts-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "byspace.json"),
      JSON.stringify({ scripts: { web: { type: "service", command: "npm run web", port: 3000 } } }),
    );
    const workspace = {
      workspaceId: "ws-1",
      projectId: "project-1",
      cwd: dir,
      branch: null,
    } as PersistedWorkspaceRecord;
    const { service } = buildService({ workspace });

    expect(service.buildSnapshot(workspace)).toEqual([
      expect.objectContaining({
        scriptName: "web",
        hostname: "web--feature-scripts--byspace.localhost",
        localProxyUrl: "http://web--feature-scripts--byspace.localhost:6777",
        publicProxyUrl: null,
        proxyUrl: "http://web--feature-scripts--byspace.localhost:6777",
      }),
    ]);
  });

  test("returns no scripts for a workspace without a byspace.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "workspace-scripts-"));
    tempDirs.push(dir);
    const workspace = {
      workspaceId: "ws-1",
      projectId: "project-1",
      cwd: dir,
      branch: null,
    } as PersistedWorkspaceRecord;
    const { service } = buildService({ workspace });
    expect(service.buildSnapshot(workspace)).toEqual([]);
  });
});

describe("emitStatusUpdate", () => {
  test("emits one script_status_update carrying the snapshot", async () => {
    const { service, emitted } = buildService();
    await service.emitStatusUpdate("ws-1", "/tmp/repo");
    expect(emitted).toEqual([
      { type: "script_status_update", payload: { workspaceId: "ws-1", scripts: [] } },
    ]);
  });
});

describe("stop", () => {
  test("kills the supervised terminal and returns the stopped service metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "workspace-scripts-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "byspace.json"),
      JSON.stringify({ scripts: { web: { type: "service", command: "npm run web", port: 3000 } } }),
    );
    const runtimeStore = new WorkspaceScriptRuntimeStore();
    runtimeStore.set({
      workspaceId: "ws-1",
      scriptName: "web",
      type: "service",
      lifecycle: "running",
      terminalId: "terminal-1",
      exitCode: null,
    });
    const terminalManager = {
      getTerminal: (terminalId: string) => (terminalId === "terminal-1" ? {} : undefined),
      async killTerminalAndWait(terminalId: string) {
        expect(terminalId).toBe("terminal-1");
        runtimeStore.set({
          workspaceId: "ws-1",
          scriptName: "web",
          type: "service",
          lifecycle: "stopped",
          terminalId,
          exitCode: 143,
        });
      },
    } as unknown as TerminalManager;
    const { service } = buildService({
      workspace: {
        workspaceId: "ws-1",
        projectId: "project-1",
        cwd: dir,
        branch: null,
      } as PersistedWorkspaceRecord,
      scriptRuntimeStore: runtimeStore,
      terminalManager,
    });

    await expect(service.stop({ workspaceId: "ws-1", scriptName: "web" })).resolves.toMatchObject({
      scriptName: "web",
      type: "service",
      port: 3000,
      lifecycle: "stopped",
      exitCode: 143,
      terminalId: "terminal-1",
    });
  });
});

describe("start", () => {
  test("reports an error when workspace scripts are unavailable", async () => {
    const { service, emitted, spawnCalls } = buildService({ terminalManager: null });
    await service.start(request);
    expect(spawnCalls).toEqual([]);
    expect(emitted).toEqual([
      {
        type: "start_workspace_script_response",
        payload: {
          requestId: "req-1",
          workspaceId: "ws-1",
          scriptName: "app",
          terminalId: null,
          error: "Workspace scripts are not available on this daemon",
        },
      },
    ]);
  });

  test("reports an error when the workspace is not found", async () => {
    const { service, emitted, spawnCalls } = buildService({ workspace: null });
    await service.start(request);
    expect(spawnCalls).toEqual([]);
    expect(emitted).toEqual([
      {
        type: "start_workspace_script_response",
        payload: {
          requestId: "req-1",
          workspaceId: "ws-1",
          scriptName: "app",
          terminalId: null,
          error: "Workspace not found: ws-1",
        },
      },
    ]);
  });

  test("reports an error when the workspace is archived", async () => {
    const { service, emitted, spawnCalls } = buildService({
      workspace: {
        workspaceId: "ws-1",
        projectId: "project-1",
        cwd: "/tmp/repo",
        branch: "feature/scripts",
        archivedAt: "2026-07-29T00:00:00.000Z",
      } as PersistedWorkspaceRecord,
    });
    await service.start(request);
    expect(spawnCalls).toEqual([]);
    expect(emitted).toEqual([
      {
        type: "start_workspace_script_response",
        payload: {
          requestId: "req-1",
          workspaceId: "ws-1",
          scriptName: "app",
          terminalId: null,
          error: "Workspace is archived: ws-1",
        },
      },
    ]);
  });

  test("spawns the script with resolved git metadata and reports success", async () => {
    const { service, emitted, spawnCalls } = buildService();
    await service.start(request);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      repoRoot: "/tmp/repo",
      workspaceId: "ws-1",
      projectSlug: "byspace",
      branchName: "feature/scripts",
      scriptName: "app",
      daemonPort: 6777,
      daemonListenHost: "127.0.0.1",
    });
    expect(emitted).toContainEqual({
      type: "script_status_update",
      payload: { workspaceId: "ws-1", scripts: [] },
    });
    expect(emitted).toContainEqual({
      type: "start_workspace_script_response",
      payload: {
        requestId: "req-1",
        workspaceId: "ws-1",
        scriptName: "app",
        terminalId: "terminal-1",
        error: null,
      },
    });
  });

  test("reports the launcher error when spawning fails", async () => {
    const { service, emitted } = buildService({ spawnThrows: "boom" });
    await service.start(request);
    expect(emitted).toEqual([
      {
        type: "start_workspace_script_response",
        payload: {
          requestId: "req-1",
          workspaceId: "ws-1",
          scriptName: "app",
          terminalId: null,
          error: "boom",
        },
      },
    ]);
  });
});

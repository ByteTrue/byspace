import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { expect, test, type Page } from "../support/fixtures";
import { connectSeedClient, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

const OPENCODE_REAL_MODEL =
  process.env.E2E_OPENCODE_MODEL ?? "openrouter/google/gemini-2.5-flash-lite";
const OPENCODE_SEED_TIMEOUT_MS = 45_000;
const BYSPACE_REPO_PATH = path.resolve(import.meta.dirname, "../../..");

interface OpenCodeSeedResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

interface ImportableOpenCodeSession {
  providerHandleId: string;
}

interface OpenCodeImportScenario {
  workspace: SeededWorkspace;
  prompt: string;
  response: string;
  providerHandleId: string;
}

let workspace: SeededWorkspace | null = null;

test.setTimeout(150_000);

test.afterEach(async () => {
  await workspace?.cleanup().catch(() => undefined);
  workspace = null;
});

test("imports a real OpenCode session from the workspace import sheet", async ({ page }) => {
  const scenario = await seedBySpaceWorkspaceWithOpenCodeSession();
  workspace = scenario.workspace;
  const importableSession = await waitForImportableOpenCodeSession(scenario);
  await openWorkspace(page, scenario.workspace);

  await importOpenCodeSession(page, importableSession);

  await expectImportSheetClosed(page);
  await expectImportedSessionOpen(page, scenario);
});

async function seedBySpaceWorkspaceWithOpenCodeSession(): Promise<OpenCodeImportScenario> {
  const response = `BYSPACE_OPENCODE_IMPORT_E2E_OK_${randomUUID().slice(0, 8)}`;
  const prompt = `Do not use tools. Reply with exactly: ${response}`;
  const providerHandleId = await launchOpenCodeSessionInWorkspace(BYSPACE_REPO_PATH, prompt);
  const client = await connectSeedClient();
  try {
    const createdWorkspace = await client.createWorkspace({
      source: { kind: "directory", path: BYSPACE_REPO_PATH },
    });
    if (!createdWorkspace.workspace) {
      throw new Error(createdWorkspace.error ?? `Failed to create workspace ${BYSPACE_REPO_PATH}`);
    }
    const descriptor = (await client.listProjects()).projects.find(
      (project) => project.projectId === createdWorkspace.workspace?.projectId,
    );
    const projectKey = descriptor?.projectKey;
    if (!projectKey) {
      throw new Error(`Created workspace ${createdWorkspace.workspace.id} has no project key`);
    }
    return {
      prompt,
      response,
      providerHandleId,
      workspace: {
        client,
        repoPath: BYSPACE_REPO_PATH,
        workspaceId: createdWorkspace.workspace.id,
        workspaceName: createdWorkspace.workspace.name,
        workspaceDirectory: createdWorkspace.workspace.workspaceDirectory,
        projectId: createdWorkspace.workspace.projectId,
        projectKey,
        projectDisplayName: createdWorkspace.workspace.projectDisplayName,
        cleanup: async () => {
          await client.close().catch(() => undefined);
        },
      },
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

async function launchOpenCodeSessionInWorkspace(repoPath: string, prompt: string): Promise<string> {
  const result = await runOpenCodeSeed(repoPath, prompt);
  if (result.code !== 0 || result.timedOut) {
    throw new Error(formatOpenCodeLaunchError(result, prompt));
  }
  for (const line of result.stdout.split(/\r?\n/u)) {
    try {
      const event = JSON.parse(line) as { sessionID?: unknown };
      if (typeof event.sessionID === "string" && event.sessionID) {
        return event.sessionID;
      }
    } catch {
      // --print-logs may interleave non-JSON diagnostics with the JSON event stream.
    }
  }
  throw new Error(`OpenCode launch did not report a session id:\n${result.stdout}`);
}

function openCodeSeedArgs(prompt: string): string[] {
  return [
    "run",
    "--print-logs",
    "--log-level",
    "info",
    "--model",
    OPENCODE_REAL_MODEL,
    "--format",
    "json",
    prompt,
  ];
}

function runOpenCodeSeed(repoPath: string, prompt: string): Promise<OpenCodeSeedResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "opencode.cmd" : "opencode",
      openCodeSeedArgs(prompt),
      {
        cwd: repoPath,
        shell: process.platform === "win32",
        // OpenCode reads PWD on Windows; spawn cwd alone leaves the Playwright web/ directory.
        env: { ...process.env, PWD: repoPath },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, OPENCODE_SEED_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code, signal, timedOut });
    });
  });
}

function formatOpenCodeLaunchError(result: OpenCodeSeedResult, prompt: string): string {
  return [
    "OpenCode launch failed",
    `command: ${["opencode", ...openCodeSeedArgs(prompt)].join(" ")}`,
    `exit: ${result.code ?? "null"}`,
    result.signal ? `signal: ${result.signal}` : null,
    result.timedOut ? `timed out after ${OPENCODE_SEED_TIMEOUT_MS}ms` : null,
    result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : null,
    result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

async function openWorkspace(page: Page, seed: SeededWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), seed.workspaceId));
  await waitForWorkspaceTabsVisible(page);
}

async function waitForImportableOpenCodeSession(
  scenario: OpenCodeImportScenario,
): Promise<ImportableOpenCodeSession> {
  let importableSession: ImportableOpenCodeSession | null = null;
  await expect
    .poll(
      async () => {
        importableSession = await findImportableOpenCodeSession(scenario);
        return importableSession?.providerHandleId ?? "";
      },
      {
        timeout: 15_000,
        intervals: [500, 1_000],
      },
    )
    .not.toBe("");
  return importableSession!;
}

async function findImportableOpenCodeSession(
  scenario: OpenCodeImportScenario,
): Promise<ImportableOpenCodeSession | null> {
  const sessions = await scenario.workspace.client.fetchRecentProviderSessions({
    cwd: scenario.workspace.repoPath,
    providers: ["opencode"],
    limit: 5,
  });
  const entry = sessions.entries.find(
    (session) =>
      session.providerId === "opencode" && session.providerHandleId === scenario.providerHandleId,
  );
  if (!entry) {
    return null;
  }
  return { providerHandleId: entry.providerHandleId };
}

async function importOpenCodeSession(
  page: Page,
  session: ImportableOpenCodeSession,
): Promise<void> {
  await page.getByTestId("workspace-header-menu-trigger").click();
  await page.getByTestId("workspace-header-import-agent").click();
  await expect(page.getByTestId("import-session-sheet")).toBeVisible({ timeout: 15_000 });

  const importSheet = page.getByTestId("import-session-sheet");
  const sessionRow = importSheet.getByTestId(
    `import-session-session-opencode-${session.providerHandleId}`,
  );
  await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  await sessionRow.click();
}

async function expectImportSheetClosed(page: Page): Promise<void> {
  await expect(page.getByTestId("import-session-sheet")).toHaveCount(0, { timeout: 15_000 });
}

async function expectImportedSessionOpen(
  page: Page,
  scenario: OpenCodeImportScenario,
): Promise<void> {
  await expect(
    page.locator('[data-testid="user-message"]', { hasText: scenario.prompt }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('[data-testid="assistant-message"]', { hasText: scenario.response }),
  ).toBeVisible({ timeout: 30_000 });
}

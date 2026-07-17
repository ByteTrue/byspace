import { readFile } from "node:fs/promises";
import path from "node:path";
import { createGitHubService, type GitHubCommandRunner } from "../../services/github-service.js";
import { createTestBySpaceDaemon } from "./byspace-daemon.js";

const SEARCH_RESULT = JSON.stringify([
  {
    number: 22,
    title: "Capability gate PR",
    url: "https://github.com/acme/repo/pull/22",
    state: "OPEN",
    body: null,
    baseRefName: "main",
    headRefName: "feature/forge",
    labels: [],
    updatedAt: "2026-07-17T00:00:00Z",
  },
]);

const runner: GitHubCommandRunner = async (args) => ({
  stdout: args[0] === "pr" && args[1] === "list" ? SEARCH_RESULT : "[]",
  stderr: "",
});

async function main(): Promise<void> {
  const metroPort = process.env.E2E_METRO_PORT;
  if (!metroPort) throw new Error("E2E_METRO_PORT is not set");

  const github = createGitHubService({
    runner,
    resolveGhPath: async () => "/test/gh",
    resolveRepoHost: async () => null,
  });
  const daemon = await createTestBySpaceDaemon({
    corsAllowedOrigins: [`http://localhost:${metroPort}`],
    github,
  });
  const serverId = (await readFile(path.join(daemon.byspaceHome, "server-id"), "utf8")).trim();
  process.send?.({ type: "ready", endpoint: `127.0.0.1:${daemon.port}`, serverId });

  const shutdown = async () => {
    await daemon.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  process.send?.({
    type: "error",
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exit(1);
});

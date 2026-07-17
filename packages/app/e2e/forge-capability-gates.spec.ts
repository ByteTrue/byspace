import { expect, test } from "./fixtures";
import { buildSeededHost } from "./helpers/daemon-registry";
import {
  archiveWorkspaceFromDaemon,
  connectNewWorkspaceDaemonClient,
  openNewWorkspaceComposer,
  openProjectViaDaemon,
  openStartingRefPicker,
  selectWorkspaceIsolation,
} from "./helpers/new-workspace";
import { createTempGitRepo } from "./helpers/workspace";

const EXTRA_HOSTS_KEY = "@byspace:e2e-extra-hosts";

test("capable host uses dotted forge search", async ({ page, forgeCapableDaemon }) => {
  const repo = await createTempGitRepo("forge-capable-host-", {
    withRemote: true,
    originUrl: "https://github.com/acme/repo.git",
  });
  const client = await connectNewWorkspaceDaemonClient({
    url: `ws://${forgeCapableDaemon.endpoint}/ws`,
  });
  const project = await openProjectViaDaemon(client, repo.path);
  const host = buildSeededHost({
    endpoint: forgeCapableDaemon.endpoint,
    serverId: forgeCapableDaemon.serverId,
    label: "forge-capable host",
    nowIso: "2026-07-17T00:00:00.000Z",
  });

  try {
    await page.goto("/");
    await page.evaluate(
      ({ host: seededHost, storageKey }) => {
        localStorage.setItem(storageKey, JSON.stringify([seededHost]));
      },
      { host, storageKey: EXTRA_HOSTS_KEY },
    );
    await page.goto(`/h/${forgeCapableDaemon.serverId}`);
    await openNewWorkspaceComposer(page, project);
    await selectWorkspaceIsolation(page, "worktree");
    await openStartingRefPicker(page);

    const row = page.getByTestId("new-workspace-ref-picker-pr-22");
    await expect(row).toContainText("#22 Capability gate PR");
    await row.click();
    await expect(page.getByText("PR #22")).toBeVisible();
  } finally {
    await archiveWorkspaceFromDaemon(client, project.workspaceDirectory).catch(() => undefined);
    await client.close().catch(() => undefined);
    await repo.cleanup();
  }
});

import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// The daemon learns about checkout changes from file observation; the head poll it replaced is
// gone and no diff pane is open here, so nothing else can refresh the stat. With
// BYSPACE_DISABLE_FILE_OBSERVATION set, this spec fails — that is the check that it exercises the
// event path and not a fallback.
test("a file written in the checkout reaches the composer diff stat on its own", async ({
  page,
}) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "checkout-observation-",
    title: "Observation",
    repo: { withRemote: true },
  });
  try {
    // The seeded remote lives inside the checkout; left there it is an untracked directory and the
    // pill would already read nonzero before the test writes anything.
    await rm(path.join(workspace.cwd, "remote.git"), { recursive: true });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });
    const pill = page.getByTestId("composer-diff-stat-pill");
    await expect(pill).toHaveCount(0);

    await writeFile(path.join(workspace.cwd, "observed.txt"), "one\ntwo\n");

    await expect(pill).toBeVisible({ timeout: 30_000 });
    await expect(pill).toContainText("+2");
    await expect(pill).toContainText("-0");
  } finally {
    await workspace.cleanup();
  }
});

import { randomUUID } from "node:crypto";
import { metroTest as test } from "../support/fixtures";
import { buildCreateAgentPreferences, buildSeededHost } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import type { MockAgentWorkspace } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  expectTimelinePromptVisible,
  holdOlderHistoryPages,
  openAgentTimeline,
  scrollThroughOlderHistoryPages,
} from "../support/helpers/timeline-pagination";

// The app must still parse a *published* daemon's messages. Every daemon
// released so far speaks the pre-rename wire names (`isPaseoOwnedWorktree`,
// `paseo_worktree_*`); this app now speaks the renamed ones, so no existing
// release is compatible and there is nothing to pin.
//
// Set this to the first daemon version published after the identity
// migration. The test then runs for real and fails if that contract breaks.
const PINNED_DAEMON_VERSION: string | null = null;

const SKIP_REASON =
  "No published daemon speaks the renamed wire protocol yet. Set PINNED_DAEMON_VERSION " +
  "to the first release published after the identity migration so this guards the " +
  "cross-version protocol contract for real.";

test("does not repeat an assistant block when the current app paginates a published daemon", async ({
  page,
}) => {
  test.skip(PINNED_DAEMON_VERSION === null, SKIP_REASON);
  const publishedVersion = PINNED_DAEMON_VERSION;
  if (publishedVersion === null) {
    return;
  }
  test.setTimeout(120_000);
  const serverId = `srv_old_pagination_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const daemon = await startIsolatedHostDaemon(serverId, { publishedVersion });
  const workspace = await seedWorkspace({
    repoPrefix: "timeline-old-daemon-pagination-",
    port: daemon.port,
  });
  const createdAgent = await workspace.client.createAgent({
    provider: "mock",
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    title: "Published daemon pagination regression",
    modeId: "load-test",
    model: "ten-second-stream",
  });
  const agent: MockAgentWorkspace = {
    agentId: createdAgent.id,
    workspaceId: workspace.workspaceId,
    cwd: workspace.repoPath,
    client: workspace.client,
    cleanup: workspace.cleanup,
  };

  try {
    for (let index = 0; index < 40; index += 1) {
      await agent.client.sendAgentMessage(
        agent.agentId,
        `timeline-pagination-older-turn-${index}: emit 1 coalesced agent stream updates`,
      );
      await agent.client.waitForFinish(agent.agentId, 15_000);
    }
    await agent.client.sendAgentMessage(agent.agentId, "build a realistic long mock timeline");
    await agent.client.waitForFinish(agent.agentId, 20_000);
    for (let index = 0; index < 20; index += 1) {
      await agent.client.sendAgentMessage(
        agent.agentId,
        `timeline-pagination-turn-${index}: emit 1 coalesced agent stream updates`,
      );
      await agent.client.waitForFinish(agent.agentId, 15_000);
    }

    const host = buildSeededHost({
      serverId,
      endpoint: `127.0.0.1:${daemon.port}`,
      nowIso: new Date().toISOString(),
    });
    await page.addInitScript(
      ({ seededHost, preferences }) => {
        localStorage.setItem("@byspace:e2e", "1");
        localStorage.setItem("@byspace:daemon-registry", JSON.stringify([seededHost]));
        localStorage.setItem("@byspace:create-agent-preferences", JSON.stringify(preferences));
      },
      { seededHost: host, preferences: buildCreateAgentPreferences() },
    );

    const history = await holdOlderHistoryPages(page, agent, daemon.port);
    await openAgentTimeline(page, agent, serverId);
    await expectTimelinePromptVisible(
      page,
      "timeline-pagination-turn-19: emit 1 coalesced agent stream updates",
    );
    await scrollThroughOlderHistoryPages(page, 3, history);

    history.expectRepeatedEntries();
    await history.expectOwnedTextRendered("Now I have a clearer picture.");
  } finally {
    await agent.cleanup();
    await daemon.close();
  }
});

import { expect, test } from "vitest";

import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestBySpaceDaemon } from "../test-utils/byspace-daemon.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";

test("orchestration tool RPC exposes and executes the shared catalog", async () => {
  const daemon = await createTestBySpaceDaemon({ agentClients: createTestAgentClients() });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });

  try {
    await client.connect();

    const listed = await client.listOrchestrationTools({});
    expect(listed.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "list_agents" })]),
    );

    await expect(
      client.callOrchestrationTool({ toolName: "list_agents", input: {} }),
    ).resolves.toMatchObject({
      success: true,
      result: { agents: [] },
    });
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
});

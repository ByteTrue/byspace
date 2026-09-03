import { describe, expect, it } from "vitest";
import {
  type AgentCommandsClient,
  type DraftCommandConfig,
  fetchAgentCommands,
  resolveAgentCommandsQueryEnabled,
} from "./use-agent-commands-query";

type ListCommands = AgentCommandsClient["listCommands"];
type ListCommandsResult = Awaited<ReturnType<ListCommands>>;

interface ListCommandsCall {
  agentId: string;
  draftConfig: DraftCommandConfig | undefined;
}

interface FakeAgentCommandsClient extends AgentCommandsClient {
  calls: ListCommandsCall[];
}

function createClient(response: ListCommandsResult): FakeAgentCommandsClient {
  const calls: ListCommandsCall[] = [];
  return {
    calls,
    listCommands: (async (options: Parameters<ListCommands>[0]) => {
      calls.push({ agentId: options.agentId, draftConfig: options.draftConfig });
      return response;
    }) as ListCommands,
  };
}

function commandsPayload(commands: ListCommandsResult["commands"]): ListCommandsResult {
  return {
    requestId: "req_commands",
    agentId: "",
    error: null,
    commands,
  };
}

function errorPayload(error: string): ListCommandsResult {
  return {
    requestId: "req_commands",
    agentId: "",
    error,
    commands: [],
  };
}

describe("fetchAgentCommands", () => {
  it("loads commands for a draft composer without an agent id", async () => {
    const client = createClient(
      commandsPayload([{ name: "compact", description: "Compact context", argumentHint: "" }]),
    );

    const draftConfig: DraftCommandConfig = {
      provider: "opencode",
      cwd: "/repo",
      modeId: "build",
    };

    const commands = await fetchAgentCommands({ client, agentId: "", draftConfig });

    expect(commands).toEqual([
      { name: "compact", description: "Compact context", argumentHint: "" },
    ]);
    expect(client.calls).toEqual([{ agentId: "", draftConfig }]);
  });

  it("passes the agent id when fetching commands for a running agent", async () => {
    const client = createClient(commandsPayload([]));

    await fetchAgentCommands({ client, agentId: "agent-1" });

    expect(client.calls).toEqual([{ agentId: "agent-1", draftConfig: undefined }]);
  });

  it("returns an empty list instead of throwing when the provider has no command list", async () => {
    const client = createClient(errorPayload("Agent does not support listing commands"));

    await expect(fetchAgentCommands({ client, agentId: "agent-1" })).resolves.toEqual([]);
  });

  it("throws instead of returning the empty command list when the daemon reports an error", async () => {
    const client = createClient(errorPayload("Agent not found: agent-1"));

    await expect(fetchAgentCommands({ client, agentId: "agent-1" })).rejects.toThrow(
      "Agent not found: agent-1",
    );
  });

  it("throws when the daemon reports a provider error alongside commands", async () => {
    const client = createClient({
      requestId: "req_commands",
      agentId: "",
      error: "Provider 'pi' is not available",
      commands: [{ name: "compact", description: "Compact", argumentHint: "" }],
    });

    await expect(fetchAgentCommands({ client, agentId: "agent-1" })).rejects.toThrow(
      "Provider 'pi' is not available",
    );
  });
});

describe("resolveAgentCommandsQueryEnabled", () => {
  const base = {
    enabled: true,
    hasClient: true,
    isConnected: true,
    agentId: "",
  };

  it("keeps draft queries pending while the draft has no model", () => {
    const draftConfig: DraftCommandConfig = { provider: "pi", cwd: "/repo" };

    expect(resolveAgentCommandsQueryEnabled({ ...base, draftConfig })).toBe(false);
  });

  it("enables draft queries once a model resolves", () => {
    const draftConfig: DraftCommandConfig = {
      provider: "pi",
      cwd: "/repo",
      model: "bytetrueapi/claude-haiku-4-5",
    };

    expect(resolveAgentCommandsQueryEnabled({ ...base, draftConfig })).toBe(true);
  });

  it("does not require a model for running agent sessions", () => {
    expect(resolveAgentCommandsQueryEnabled({ ...base, agentId: "agent-1" })).toBe(true);
  });

  it("stays disabled without a client, connection, or explicit enable", () => {
    expect(resolveAgentCommandsQueryEnabled({ ...base, hasClient: false })).toBe(false);
    expect(resolveAgentCommandsQueryEnabled({ ...base, isConnected: false })).toBe(false);
    expect(resolveAgentCommandsQueryEnabled({ ...base, enabled: false })).toBe(false);
  });
});

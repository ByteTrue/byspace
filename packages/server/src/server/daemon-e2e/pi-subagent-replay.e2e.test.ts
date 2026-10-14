import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";

import { PiRpcAgentClient } from "../agent/providers/pi/agent.js";
import type { PiAgentMessage } from "../agent/providers/pi/rpc-types.js";
import type { PiRuntimeLaunch, PiStartSessionInput } from "../agent/providers/pi/runtime.js";
import { FakePi, FakePiSession } from "../agent/providers/pi/test-utils/fake-pi.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestBySpaceDaemon, type TestBySpaceDaemon } from "../test-utils/byspace-daemon.js";

process.env.BYSPACE_SUPERVISED = "0";

/**
 * The pi subagents track is rebuilt from the persisted transcript by `replayPiSubagentSession`,
 * and the transcript shape that matters cannot be produced by talking to a model: pi runs a
 * codemode script's nested `tools.subagent(...)` through `ctx.executeTool()` and persists it
 * only as an arguments snapshot on the parent's result — the nested call's own tool result is
 * never written, so those children have no launch record to be named from.
 *
 * The scripted transcript reproduces that shape and still exercises the real path: the real
 * replay, the real AgentManager provider-subagent store, and the real protocol responses. Only
 * the model and the child processes are absent. `providers/pi/agent-subagents.test.ts` pins the
 * observation list; this pins what a connected client actually receives.
 *
 * The parent result's nested-call snapshot is in the fixtures because a real transcript has it
 * there — not because anything reads it. The replay deliberately ignores it: an arguments
 * snapshot is not a result, so the exit record is the only origin that can name these children,
 * and a test that leaned on the snapshot would prove nothing.
 */

/**
 * The daemon gates a provider on `client.isAvailable()`, and the real client answers that by
 * probing for the pi binary. This test never runs one — the session comes from `FakePi` — and CI
 * has no pi installed, so the probe would mark the provider unavailable and fail `createAgent`
 * on exactly the machine the regression most needs catching on.
 */
class AlwaysAvailablePiRpcAgentClient extends PiRpcAgentClient {
  override async isAvailable(): Promise<boolean> {
    return true;
  }
}

/** A fake runtime whose every session starts with the transcript already "on disk". */
class TranscriptPi extends FakePi {
  constructor(private readonly transcript: readonly PiAgentMessage[]) {
    super();
  }

  override async startSession(input: PiStartSessionInput): Promise<FakePiSession> {
    const session = await super.startSession(input);
    session.messages = [...this.transcript];
    return session;
  }
}

/**
 * A child the model launched from inside a codemode script. Its exit record is the only origin
 * that names it *and* the only one carrying its session pointer. `cwd` points at the test's temp
 * directory so the pointer resolves to a real child-session jsonl.
 */
function codemodeNestedExit(id: string, description: string, cwd: string) {
  return {
    id,
    agent: "reviewer",
    description,
    status: "succeeded",
    sessionId: `${id}_child`,
    cwd,
    sessionFile: path.join(cwd, `${id}_child.jsonl`),
  };
}

/** The child session jsonl the daemon reads to rebuild a subagent's timeline. */
function writeChildSession(file: string, text: string): void {
  writeFileSync(
    file,
    `${JSON.stringify({
      type: "message",
      timestamp: "2026-10-14T00:00:05.000Z",
      message: { role: "assistant", content: [{ type: "text", text }] },
    })}\n`,
    "utf8",
  );
}

/**
 * One codemode call that launched two children, then their exit records. The parent's snapshot
 * says a nested call happened and with what arguments — nothing more, and nothing the replay
 * consumes; the exits are the first and only place each child is named.
 */
function codemodeNestedTranscript(cwd: string): PiAgentMessage[] {
  return [
    { role: "user", content: "review the diff twice" },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_p", name: "codemode", arguments: { code: "..." } }],
    },
    {
      role: "toolResult",
      toolCallId: "call_p",
      toolName: "codemode",
      content: "both children done",
      details: {
        calls: [
          {
            id: "call_p/1",
            name: "subagent",
            args: '{"agent":"reviewer","task":"first"}',
            status: "ok",
          },
          {
            id: "call_p/2",
            name: "subagent",
            args: '{"agent":"reviewer","task":"second"}',
            status: "ok",
          },
        ],
      },
    },
    {
      role: "custom",
      customType: "subagent-exit",
      content: "done",
      details: codemodeNestedExit("sub_nested_a", "reviewer: 审查第一份 diff", cwd),
    },
    {
      role: "custom",
      customType: "subagent-exit",
      content: "done",
      details: codemodeNestedExit("sub_nested_b", "reviewer: 审查第二份 diff", cwd),
    },
  ];
}

/** The control: a child launched at the top level by the model, so it does have a launch result. */
const TOP_LEVEL_TRANSCRIPT: PiAgentMessage[] = [
  { role: "user", content: "review the diff" },
  {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "call_t",
        name: "subagent",
        arguments: { agent: "reviewer", task: "the full task text" },
      },
    ],
  },
  {
    role: "toolResult",
    toolCallId: "call_t",
    toolName: "subagent",
    content: "Subagent started",
    details: { id: "sub_top", status: "running", sessionId: "sub_top_child", cwd: "/tmp/w" },
  },
  {
    role: "custom",
    customType: "subagent-exit",
    content: "done",
    details: {
      id: "sub_top",
      agent: "reviewer",
      description: "reviewer: the full ta…",
      status: "succeeded",
    },
  },
];

describe("daemon E2E - pi subagent descriptors rebuilt from the persisted transcript", () => {
  let cwd: string;
  let daemon: TestBySpaceDaemon | undefined;
  let client: DaemonClient | undefined;
  let launches: PiRuntimeLaunch[] = [];

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "pi-subagent-replay-"));
  });

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await daemon?.close().catch(() => undefined);
    client = undefined;
    daemon = undefined;
    rmSync(cwd, { recursive: true, force: true });
  }, 60_000);

  /**
   * Create an agent, then refresh it: refresh re-reads provider history from the "disk" session
   * and rebuilds provider subagents from it, which is the path a daemon restart or a reload
   * takes.
   */
  async function createAndRefresh(transcript: PiAgentMessage[]): Promise<string> {
    const logger = pino({ level: "silent" });
    const pi = new TranscriptPi(transcript);
    launches = pi.recordedLaunches;
    daemon = await createTestBySpaceDaemon({
      agentClients: { pi: new AlwaysAvailablePiRpcAgentClient({ logger, runtime: pi }) },
      logger,
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "pi-subagent-replay" } });

    const agent = await client.createAgent({ provider: "pi", cwd, title: "pi-subagent-replay" });
    await client.refreshAgent(agent.id);
    return agent.id;
  }

  test("names codemode-nested children from their exit records", async () => {
    const agentId = await createAndRefresh(codemodeNestedTranscript(cwd));
    expect(launches.length).toBeGreaterThan(0);

    const { subagents } = await client!.listProviderSubagents(agentId);
    // The regression: these rows reached the app with no title and no description, and the track
    // rendered every one of them as a spinner labelled "Loading...".
    expect(subagents).toHaveLength(2);
    expect(subagents.map((subagent) => subagent.id).sort()).toEqual([
      "sub_nested_a",
      "sub_nested_b",
    ]);
    for (const subagent of subagents) {
      expect(subagent.status).toBe("completed");
      expect(subagent.title).toBe("reviewer");
      expect(subagent.description).toContain("reviewer:");
    }
  });

  test("rebuilds a codemode-nested child's timeline from its exit-record pointer", async () => {
    // The exit record is the only origin carrying a session pointer for these children, and the
    // pointer never enters the descriptor or the protocol (078): it lives in the adapter and the
    // timeline store is daemon memory, so a rebuilt timeline is the only proof it was absorbed.
    writeChildSession(path.join(cwd, "sub_nested_a_child.jsonl"), "CHILD_A_LINE");
    writeChildSession(path.join(cwd, "sub_nested_b_child.jsonl"), "CHILD_B_LINE");
    const agentId = await createAndRefresh(codemodeNestedTranscript(cwd));

    const timeline = await client!.fetchProviderSubagentTimeline(agentId, "sub_nested_a", {
      direction: "tail",
      limit: 200,
    });
    expect(timeline.error).toBeNull();
    expect(JSON.stringify(timeline.rows)).toContain("CHILD_A_LINE");
    expect(JSON.stringify(timeline.rows)).not.toContain("CHILD_B_LINE");
  });

  test("keeps the full task text for a child that does have a launch record", async () => {
    const agentId = await createAndRefresh(TOP_LEVEL_TRANSCRIPT);

    const { subagents } = await client!.listProviderSubagents(agentId);
    expect(subagents).toHaveLength(1);
    expect(subagents[0]).toMatchObject({
      id: "sub_top",
      status: "completed",
      title: "reviewer",
      // The launch record wins: the exit record's one-liner must not overwrite the full task.
      description: "the full task text",
    });
  });
});

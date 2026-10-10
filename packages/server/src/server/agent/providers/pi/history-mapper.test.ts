import { describe, expect, test } from "vitest";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { streamPiHistory, type PiCapturedUserMessageEntry } from "./history-mapper.js";
import type { PiAgentMessage } from "./rpc-types.js";

async function collectHistory(
  messages: PiAgentMessage[],
  userEntries: PiCapturedUserMessageEntry[] = [],
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of streamPiHistory("pi", messages, userEntries)) {
    events.push(event);
  }
  return events;
}

describe("Pi history mapper", () => {
  test("replays user, assistant, reasoning, and completed tool calls", async () => {
    await expect(
      collectHistory([
        {
          role: "user",
          content: [
            { type: "text", text: "read this" },
            { type: "image", data: "base64", mimeType: "image/png" },
            { type: "text", text: "then answer" },
          ],
        },
        {
          role: "assistant",
          responseId: "response-1",
          content: [
            { type: "thinking", thinking: "checking file" },
            { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "note.txt" } },
            { type: "text", text: "done" },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "read",
          content: [{ type: "text", text: "file contents" }],
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "read this\n\nthen answer",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "reasoning", text: "checking file" },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "read",
          status: "running",
          detail: {
            type: "read",
            filePath: "note.txt",
            content: undefined,
            offset: undefined,
            limit: undefined,
          },
          error: null,
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "assistant_message", text: "done", messageId: "response-1" },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "read",
          status: "completed",
          detail: {
            type: "read",
            filePath: "note.txt",
            content: "file contents",
            offset: undefined,
            limit: undefined,
          },
          error: null,
        },
      },
    ]);
  });

  test("replays bash execution records as completed shell calls", async () => {
    await expect(
      collectHistory([
        {
          role: "bashExecution",
          command: "echo hi",
          output: "hi\n",
          exitCode: 0,
          timestamp: 123,
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "pi-bash-123",
          name: "bash",
          status: "completed",
          detail: { type: "shell", command: "echo hi", output: "hi\n", exitCode: 0 },
          error: null,
        },
      },
    ]);
  });

  test("replays a codemode result with nestedCalls as child rows plus a parent with the nested summary", async () => {
    await expect(
      collectHistory([
        {
          role: "assistant",
          responseId: "response-1",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "codemode",
              arguments: { code: "await tools.bash({ command: 'wc -l *.md' })" },
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "codemode",
          content: [{ type: "text", text: "3" }],
          nestedCalls: {
            complete: true,
            calls: [
              {
                id: "call-1/0",
                name: "bash",
                status: "ok",
                arguments: { command: "wc -l *.md" },
              },
              {
                id: "call-1/1",
                name: "read",
                status: "ok",
                arguments: { path: "note.txt" },
              },
            ],
          },
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-1",
          name: "codemode",
          status: "running",
          detail: {
            type: "unknown",
            input: { code: "await tools.bash({ command: 'wc -l *.md' })" },
            output: null,
          },
          error: null,
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-1/0",
          name: "bash",
          status: "completed",
          detail: { type: "shell", command: "wc -l *.md" },
          error: null,
          metadata: { parentToolCallId: "call-1" },
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-1/1",
          name: "read",
          status: "completed",
          detail: {
            type: "read",
            filePath: "note.txt",
            content: undefined,
            offset: undefined,
            limit: undefined,
          },
          error: null,
          metadata: { parentToolCallId: "call-1" },
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-1",
          name: "codemode",
          status: "completed",
          detail: {
            type: "unknown",
            input: { code: "await tools.bash({ command: 'wc -l *.md' })" },
            output: { content: [{ type: "text", text: "3" }], details: undefined },
          },
          error: null,
          metadata: {
            nestedSummary: {
              editedFileCount: 0,
              commandCount: 1,
              readFileCount: 1,
              searchCount: 0,
              otherToolCount: 0,
              byspaceCallCount: 0,
            },
          },
        },
      },
    ]);
  });

  test("replays nested codemode calls with hierarchical ids pointing at their direct caller", async () => {
    await expect(
      collectHistory([
        {
          role: "assistant",
          responseId: "response-2",
          content: [
            {
              type: "toolCall",
              id: "call-2",
              name: "codemode",
              arguments: { code: "outer" },
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "call-2",
          toolName: "codemode",
          content: [{ type: "text", text: "" }],
          nestedCalls: {
            complete: false,
            calls: [
              {
                id: "call-2/0",
                name: "codemode",
                status: "ok",
                arguments: { code: "inner" },
              },
              {
                id: "call-2/0/0",
                name: "edit",
                status: "error",
                arguments: { path: "a.ts", edits: [{ oldText: "a", newText: "b" }] },
                error: "boom",
              },
              { id: "call-2/1", name: "bash", status: "unfinished" },
              { name: "read", status: "ok" },
            ],
          },
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-2",
          name: "codemode",
          status: "running",
          detail: { type: "unknown", input: { code: "outer" }, output: null },
          error: null,
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-2/0",
          name: "codemode",
          status: "completed",
          detail: { type: "unknown", input: { code: "inner" }, output: null },
          error: null,
          metadata: { parentToolCallId: "call-2" },
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-2/0/0",
          name: "edit",
          status: "failed",
          detail: {
            type: "edit",
            filePath: "a.ts",
            oldString: "a",
            newString: "b",
            unifiedDiff: undefined,
          },
          error: "boom",
          metadata: { parentToolCallId: "call-2/0" },
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-2/1",
          name: "bash",
          status: "canceled",
          detail: { type: "unknown", input: null, output: null },
          error: null,
          metadata: { parentToolCallId: "call-2" },
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-2",
          name: "codemode",
          status: "completed",
          detail: {
            type: "unknown",
            input: { code: "outer" },
            output: { content: [{ type: "text", text: "" }], details: undefined },
          },
          error: null,
          metadata: {
            nestedSummary: {
              editedFileCount: 1,
              commandCount: 0,
              readFileCount: 0,
              searchCount: 0,
              otherToolCount: 3,
              byspaceCallCount: 0,
            },
          },
        },
      },
    ]);
  });

  test("replays non-notice custom messages as custom_message items, matching the live path", async () => {
    await expect(
      collectHistory([
        {
          role: "custom",
          customType: "background-exit",
          content: "Extension command output",
          details: { exitCode: 0 },
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "custom_message",
          customType: "background-exit",
          display: true,
          content: "Extension command output",
          details: { exitCode: 0 },
        },
      },
    ]);
  });

  test("skips display=false custom messages on replay", async () => {
    await expect(
      collectHistory([{ role: "custom", content: "context-only payload", display: false }]),
    ).resolves.toEqual([]);
  });

  test("rebuilds mcp nested rows under their server.tool name like the live path", async () => {
    await expect(
      collectHistory([
        {
          role: "toolResult",
          toolCallId: "call-3",
          toolName: "codemode",
          content: [{ type: "text", text: "" }],
          nestedCalls: {
            complete: true,
            calls: [
              {
                id: "call-3/0",
                name: "mcp",
                status: "ok",
                arguments: { server: "github", tool: "list_issues" },
              },
            ],
          },
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-3/0",
          name: "github.list_issues",
          status: "completed",
          detail: {
            type: "unknown",
            input: { server: "github", tool: "list_issues" },
            output: null,
          },
          error: null,
          metadata: { parentToolCallId: "call-3" },
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-3",
          name: "codemode",
          status: "completed",
          detail: {
            type: "unknown",
            input: null,
            output: { content: [{ type: "text", text: "" }], details: undefined },
          },
          error: null,
          metadata: {
            nestedSummary: {
              editedFileCount: 0,
              commandCount: 0,
              readFileCount: 0,
              searchCount: 0,
              otherToolCount: 1,
              byspaceCallCount: 0,
            },
          },
        },
      },
    ]);
  });

  test("drops malformed nestedCalls and still replays the parent with no nested summary", async () => {
    await expect(
      collectHistory([
        {
          role: "toolResult",
          toolCallId: "call-4",
          toolName: "codemode",
          content: [{ type: "text", text: "" }],
          nestedCalls: null,
        },
        {
          role: "toolResult",
          toolCallId: "call-5",
          toolName: "codemode",
          content: [{ type: "text", text: "" }],
          nestedCalls: { complete: true, calls: "x" },
        },
        {
          role: "toolResult",
          toolCallId: "call-6",
          toolName: "codemode",
          content: [{ type: "text", text: "" }],
          nestedCalls: {
            complete: true,
            calls: [
              null,
              7,
              { name: "read" },
              { id: "call-6/0", name: "   " },
              { id: "call-6/1", name: "bash", status: "weird" },
              { id: "call-6/2", name: "read", status: "error", error: { code: 5 } },
            ],
          },
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-4",
          name: "codemode",
          status: "completed",
          detail: {
            type: "unknown",
            input: null,
            output: { content: [{ type: "text", text: "" }], details: undefined },
          },
          error: null,
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-5",
          name: "codemode",
          status: "completed",
          detail: {
            type: "unknown",
            input: null,
            output: { content: [{ type: "text", text: "" }], details: undefined },
          },
          error: null,
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-6/1",
          name: "bash",
          status: "canceled",
          detail: { type: "unknown", input: null, output: null },
          error: null,
          metadata: { parentToolCallId: "call-6" },
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-6/2",
          name: "read",
          status: "failed",
          detail: { type: "unknown", input: null, output: null },
          error: "Tool call failed",
          metadata: { parentToolCallId: "call-6" },
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call-6",
          name: "codemode",
          status: "completed",
          detail: {
            type: "unknown",
            input: null,
            output: { content: [{ type: "text", text: "" }], details: undefined },
          },
          error: null,
          // The summary counts name-bearing records even when the id is missing and the row is
          // dropped — the fallback badge is for transcripts whose rows cannot be rebuilt. Records
          // without arguments map to unknown details, so everything categorizes as other.
          metadata: {
            nestedSummary: {
              editedFileCount: 0,
              commandCount: 0,
              readFileCount: 0,
              searchCount: 0,
              otherToolCount: 3,
              byspaceCallCount: 0,
            },
          },
        },
      },
    ]);
  });

  test("uses Pi tree entry ids for replayed user messages", async () => {
    await expect(
      collectHistory(
        [
          { role: "user", content: "first prompt" },
          { role: "assistant", content: [{ type: "text", text: "first answer" }] },
          { role: "user", content: "second prompt" },
        ],
        [
          { id: "entry-user-1", text: "first prompt" },
          { id: "entry-user-2", text: "second prompt" },
        ],
      ),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "first prompt",
          messageId: "entry-user-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "assistant_message",
          text: "first answer",
          messageId: "pi-history-assistant-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "second prompt",
          messageId: "entry-user-2",
        },
      },
    ]);
  });
});

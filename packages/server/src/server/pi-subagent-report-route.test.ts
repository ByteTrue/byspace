import { expect, it } from "vitest";
import type express from "express";
import type { AgentManager } from "./agent/agent-manager.js";
import { createPiSubagentReportRouteHandler } from "./bootstrap.js";

interface MockResponse {
  statusCode: number;
  body: unknown;
  status(code: number): MockResponse;
  json(body: unknown): MockResponse;
  end(): MockResponse;
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number): MockResponse {
      this.statusCode = code;
      return this;
    },
    json(body: unknown): MockResponse {
      this.body = body;
      return this;
    },
    end(): MockResponse {
      return this;
    },
  };
}

function createMockRequest(input: { body: unknown; remoteAddress?: string }): express.Request {
  return {
    body: input.body,
    socket: {
      remoteAddress: input.remoteAddress ?? "127.0.0.1",
    },
  } as express.Request;
}

/**
 * Token semantics live in AgentManager (minted per pi launch, resolved against the live map);
 * the route contract under test is the status-code ladder and the observation pass-through.
 */
function createStubManager(input: { tokens?: string[]; accepted?: unknown[] }): AgentManager {
  return {
    applyPiSubagentReport: (token: string, records: readonly unknown[]) => {
      if (!input.tokens?.includes(token)) {
        return "unauthorized" as const;
      }
      input.accepted?.push(...records);
      return "ok" as const;
    },
  } as unknown as AgentManager;
}

async function invoke(
  manager: AgentManager | null,
  request: { body: unknown; remoteAddress?: string },
): Promise<MockResponse> {
  const response = createMockResponse();
  await createPiSubagentReportRouteHandler(() => manager)(
    createMockRequest(request),
    response as unknown as express.Response,
    () => undefined,
  );
  return response;
}

const validBody = {
  token: "tok",
  observations: [{ id: "sub_abc", status: "running" }],
};

it("returns 503 while the agent manager holder is still unfilled", async () => {
  const response = await invoke(null, { body: validBody });
  expect(response.statusCode).toBe(503);
});

it("rejects non-loopback reports before token handling", async () => {
  const response = await invoke(createStubManager({ tokens: ["tok"] }), {
    body: validBody,
    remoteAddress: "192.168.1.5",
  });
  expect(response.statusCode).toBe(403);
});

it("returns 400 for a body without a token and for empty observations", async () => {
  const manager = createStubManager({});
  for (const body of [
    { observations: [{ id: "sub_abc" }] },
    { token: "tok", observations: [] },
    {},
  ]) {
    const response = await invoke(manager, { body });
    expect(response.statusCode).toBe(400);
  }
});

it("answers unknown and stale tokens with one 403 rejection", async () => {
  const response = await invoke(createStubManager({ tokens: ["minted"] }), {
    body: { token: "wrong", observations: [{ id: "sub_abc" }] },
  });
  expect(response.statusCode).toBe(403);
});

it("accepts a minted token and passes observations through to the manager", async () => {
  const accepted: unknown[] = [];
  const observations = [
    { id: "sub_abc", status: "running", sessionId: "s1", cwd: "/repo" },
    { id: "sub_def", status: "completed" },
  ];
  const response = await invoke(createStubManager({ tokens: ["tok"], accepted }), {
    body: { token: "tok", observations },
  });
  expect(response.statusCode).toBe(204);
  expect(accepted).toEqual(observations);
});

import { describe, expect, test } from "vitest";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import {
  consumeForcedTimelineTailReplacement,
  fenceTimelineRequest,
  requestTimelineReplacement,
  TimelineReplacementRequests,
} from "./timeline-replacement";
import type { TimelineResponsePayload } from "./viewed-timeline-sync";

function response(requestId: string, direction: "tail" | "after"): TimelineResponsePayload {
  return { agentId: "agent-1", requestId, direction } as TimelineResponsePayload;
}

const successfulClient = {
  fetchAgentTimeline: async () => ({}) as Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>,
};

describe("requestTimelineReplacement", () => {
  test("requests one projected tail and clears its request mark on failure", async () => {
    const requests: Parameters<DaemonClient["fetchAgentTimeline"]>[] = [];
    const client = {
      fetchAgentTimeline: async (...request: Parameters<DaemonClient["fetchAgentTimeline"]>) => {
        requests.push(request);
        throw new Error("fetch complete");
      },
    };
    const replacements = new TimelineReplacementRequests();
    await expect(requestTimelineReplacement(client, "agent-1", replacements)).rejects.toThrow(
      "fetch complete",
    );
    expect(replacements.size).toBe(0);
    expect(requests[0]?.[0]).toBe("agent-1");
    expect(requests[0]?.[1]).toMatchObject({
      direction: "tail",
      projection: "projected",
      limit: 40,
    });
    expect(requests[0]?.[1]?.requestId).toEqual(expect.any(String));
  });

  test("accepts only the replacement request, even when older responses arrive in reverse order", async () => {
    const replacements = new TimelineReplacementRequests();
    await requestTimelineReplacement(successfulClient, "agent-1", replacements);
    const requestId = replacements.get("agent-1")!;
    expect(
      consumeForcedTimelineTailReplacement(response("old-after", "after"), replacements),
    ).toBeNull();
    expect(
      consumeForcedTimelineTailReplacement(response("old-tail", "tail"), replacements),
    ).toBeNull();
    expect(
      consumeForcedTimelineTailReplacement(response(requestId, "tail"), replacements),
    ).toMatchObject({ reset: true });
    expect(replacements.size).toBe(0);
  });

  test("only destructive replacements discard same-epoch live rows", async () => {
    const routineRequests = new TimelineReplacementRequests();
    await requestTimelineReplacement(successfulClient, "agent-1", routineRequests);
    const routineId = routineRequests.get("agent-1")!;
    const routine = consumeForcedTimelineTailReplacement(
      response(routineId, "tail"),
      routineRequests,
    );
    expect(routine).toMatchObject({ reset: true });
    expect(routine?.forceReplacement).toBeUndefined();

    const destructiveRequests = new TimelineReplacementRequests();
    await requestTimelineReplacement(successfulClient, "agent-1", destructiveRequests, {
      destructive: true,
    });
    const destructiveId = destructiveRequests.get("agent-1")!;
    expect(
      consumeForcedTimelineTailReplacement(response(destructiveId, "tail"), destructiveRequests),
    ).toMatchObject({ reset: true, forceReplacement: true });
  });

  test("forgets a superseded failed request without accepting its late response", async () => {
    const replacements = new TimelineReplacementRequests();
    let rejectFirst!: (error: Error) => void;
    const firstClient = {
      fetchAgentTimeline: () =>
        new Promise<never>((_, reject) => {
          rejectFirst = reject;
        }),
    };
    const first = requestTimelineReplacement(firstClient, "agent-1", replacements);
    const firstId = replacements.get("agent-1")!;
    const firstGeneration = replacements.generation("agent-1");
    await requestTimelineReplacement(successfulClient, "agent-1", replacements);
    const secondId = replacements.get("agent-1")!;
    expect(replacements.generation("agent-1")).toBeGreaterThan(firstGeneration);
    rejectFirst(new Error("superseded"));
    await expect(first).rejects.toThrow("superseded");
    expect(
      consumeForcedTimelineTailReplacement(response(firstId, "tail"), replacements),
    ).toBeNull();
    expect(
      consumeForcedTimelineTailReplacement(response(secondId, "tail"), replacements),
    ).toMatchObject({ reset: true });
  });

  test("invalidates catch-ups registered while the replacement was pending", async () => {
    const replacements = new TimelineReplacementRequests();
    await requestTimelineReplacement(successfulClient, "agent-1", replacements);
    const replacementId = replacements.get("agent-1")!;
    const pendingGeneration = replacements.generation("agent-1");
    const staleCatchUp = fenceTimelineRequest(replacements, "agent-1", { direction: "after" });
    expect(replacements.generation("agent-1")).toBe(pendingGeneration);
    expect(
      consumeForcedTimelineTailReplacement(response(replacementId, "tail"), replacements),
    ).toMatchObject({ reset: true });
    expect(replacements.generation("agent-1")).toBeGreaterThan(pendingGeneration);
    expect(
      consumeForcedTimelineTailReplacement(
        response(staleCatchUp.requestId!, "after"),
        replacements,
      ),
    ).toBeNull();
  });

  test("rejects an older response arriving after the accepted replacement", async () => {
    const replacements = new TimelineReplacementRequests();
    const oldRequest = fenceTimelineRequest(replacements, "agent-1", { direction: "tail" });
    await requestTimelineReplacement(successfulClient, "agent-1", replacements);
    const replacementId = replacements.get("agent-1")!;
    expect(
      consumeForcedTimelineTailReplacement(response(replacementId, "tail"), replacements),
    ).toMatchObject({ reset: true });
    expect(
      consumeForcedTimelineTailReplacement(response(oldRequest.requestId!, "tail"), replacements),
    ).toBeNull();
    const current = fenceTimelineRequest(replacements, "agent-1", { direction: "after" });
    expect(
      consumeForcedTimelineTailReplacement(response(current.requestId!, "after"), replacements),
    ).not.toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  normalizeCheckoutPrStatusPayload,
  normalizeForgeSearchPayload,
  normalizeForgeCheckDetailsPayload,
} from "./normalize-forge";

describe("forge wire compatibility normalization", () => {
  it("keeps valid search siblings when another item is malformed", () => {
    const payload = normalizeForgeSearchPayload({
      items: [
        {
          kind: "change_request",
          number: 7,
          title: "Ship forge support",
          url: "https://gitlab.com/acme/repo/-/merge_requests/7",
          state: "opened",
          body: null,
          labels: [],
          forge: "gitlab",
        },
        { kind: "change_request", number: "bad" },
      ],
      authState: "authenticated",
      forge: "gitlab",
      error: null,
      requestId: "req-1",
    });

    expect(payload.items).toEqual([
      {
        kind: "change_request",
        number: 7,
        title: "Ship forge support",
        url: "https://gitlab.com/acme/repo/-/merge_requests/7",
        state: "opened",
        body: null,
        labels: [],
        forge: "gitlab",
      },
    ]);
  });

  it("normalizes legacy GitHub status without trusting unknown future auth values", () => {
    const legacy = normalizeCheckoutPrStatusPayload({
      cwd: "/repo",
      status: null,
      githubFeaturesEnabled: true,
      error: null,
      requestId: "req-2",
    });
    const future = normalizeCheckoutPrStatusPayload({
      cwd: "/repo",
      status: null,
      githubFeaturesEnabled: true,
      authState: "future-auth-state",
      forge: "future-forge",
      error: null,
      requestId: "req-3",
    });

    expect(legacy).toMatchObject({ forge: "github", authState: "authenticated" });
    expect(future).toMatchObject({ forge: "future-forge", authState: "error" });
  });

  it("normalizes optional pipeline stage and job lists after validation", () => {
    expect(
      normalizeForgeCheckDetailsPayload({
        cwd: "/repo",
        success: true,
        details: {
          checkRunId: 1,
          name: "pipeline",
          status: "failure",
          url: null,
          annotations: [],
          failedJobs: [],
          truncated: false,
          pipeline: {
            id: 7,
            status: "failed",
            rawStatus: "failed",
          },
        },
        error: null,
        requestId: "req-pipeline",
      }).details?.pipeline,
    ).toEqual({ id: 7, status: "failed", rawStatus: "failed", stages: [] });
  });
});

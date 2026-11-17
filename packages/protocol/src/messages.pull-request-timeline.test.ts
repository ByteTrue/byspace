import { describe, expect, test } from "vitest";
import {
  CheckoutPrStatusResponseSchema,
  PullRequestTimelineRequestSchema,
  PullRequestTimelineResponseSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("pull request timeline message schemas", () => {
  test("requires request identity fields", () => {
    expect(() =>
      PullRequestTimelineRequestSchema.parse({
        type: "pull_request_timeline_request",
      }),
    ).toThrow();
  });

  test("parses request fields", () => {
    const parsed = PullRequestTimelineRequestSchema.parse({
      type: "pull_request_timeline_request",
      cwd: "/tmp/repo",
      prNumber: 42,
      repoOwner: "bytetrue",
      repoName: "byspace",
      requestId: "request-1",
    });

    expect(parsed).toEqual({
      type: "pull_request_timeline_request",
      cwd: "/tmp/repo",
      prNumber: 42,
      repoOwner: "bytetrue",
      repoName: "byspace",
      requestId: "request-1",
    });
  });

  test("parses request through the inbound message union", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "pull_request_timeline_request",
      cwd: "/tmp/repo",
      prNumber: 42,
      repoOwner: "bytetrue",
      repoName: "byspace",
      requestId: "request-1",
    });

    expect(parsed).toEqual({
      type: "pull_request_timeline_request",
      cwd: "/tmp/repo",
      prNumber: 42,
      repoOwner: "bytetrue",
      repoName: "byspace",
      requestId: "request-1",
    });
  });

  test("defaults optional response payload and malformed timeline item fields", () => {
    const parsed = PullRequestTimelineResponseSchema.parse({
      type: "pull_request_timeline_response",
      payload: {
        items: [{}, { kind: "review" }],
      },
    });

    expect(parsed).toEqual({
      type: "pull_request_timeline_response",
      payload: {
        cwd: "",
        prNumber: null,
        items: [
          {
            id: "",
            kind: "comment",
            author: "unknown",
            body: "",
            createdAt: 0,
            url: "",
          },
          {
            id: "",
            kind: "review",
            author: "unknown",
            body: "",
            createdAt: 0,
            url: "",
            reviewState: "commented",
          },
        ],
        truncated: false,
        error: null,
        requestId: "",
      },
    });
  });

  test("normalizes unknown timeline item kinds to comments", () => {
    const parsed = PullRequestTimelineResponseSchema.parse({
      type: "pull_request_timeline_response",
      payload: {
        items: [
          {
            id: "future-1",
            kind: "unknown_future_kind",
            author: "octocat",
            body: "Future daemon item",
            createdAt: 1710000000000,
            url: "https://github.com/bytetrue/byspace/pull/42#future-1",
          },
        ],
      },
    });

    expect(parsed.payload.items).toEqual([
      {
        id: "future-1",
        kind: "comment",
        author: "octocat",
        body: "Future daemon item",
        createdAt: 1710000000000,
        url: "https://github.com/bytetrue/byspace/pull/42#future-1",
      },
    ]);
  });

  test("parses optional author avatar, author URL, and inline comment location fields", () => {
    const parsed = PullRequestTimelineResponseSchema.parse({
      type: "pull_request_timeline_response",
      payload: {
        items: [
          {
            id: "review-1",
            kind: "review",
            author: "octocat",
            authorUrl: "https://github.com/octocat",
            avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
            body: "Looks good",
            createdAt: 1710000000000,
            url: "https://github.com/bytetrue/byspace/pull/42#pullrequestreview-1",
            reviewState: "approved",
          },
          {
            id: "thread-comment-1",
            kind: "comment",
            author: "hubot",
            authorUrl: "https://github.com/hubot",
            avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
            body: "Inline note",
            createdAt: 1710000001000,
            url: "https://github.com/bytetrue/byspace/pull/42#discussion_r1",
            location: {
              path: "packages/app/src/git/pull-request-panel/data.ts",
              line: 24,
              startLine: 20,
              threadId: "PRRT_1",
              isResolved: true,
              isOutdated: false,
            },
          },
        ],
      },
    });

    expect(parsed.payload.items).toEqual([
      {
        id: "review-1",
        kind: "review",
        author: "octocat",
        authorUrl: "https://github.com/octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        body: "Looks good",
        createdAt: 1710000000000,
        url: "https://github.com/bytetrue/byspace/pull/42#pullrequestreview-1",
        reviewState: "approved",
      },
      {
        id: "thread-comment-1",
        kind: "comment",
        author: "hubot",
        authorUrl: "https://github.com/hubot",
        avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
        body: "Inline note",
        createdAt: 1710000001000,
        url: "https://github.com/bytetrue/byspace/pull/42#discussion_r1",
        location: {
          path: "packages/app/src/git/pull-request-panel/data.ts",
          line: 24,
          startLine: 20,
          threadId: "PRRT_1",
          isResolved: true,
          isOutdated: false,
        },
      },
    ]);
  });

  test("parses response through the outbound message union", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "pull_request_timeline_response",
      payload: {
        cwd: "/tmp/repo",
        prNumber: 42,
        items: [
          {
            id: "review-1",
            kind: "review",
            author: "octocat",
            body: "Looks good",
            createdAt: 1710000000000,
            url: "https://github.com/bytetrue/byspace/pull/42#pullrequestreview-1",
            reviewState: "approved",
          },
          {
            id: "comment-1",
            kind: "comment",
            author: "hubot",
            body: "Left a note",
            createdAt: 1710000001000,
            url: "https://github.com/bytetrue/byspace/pull/42#issuecomment-1",
          },
        ],
        truncated: true,
        error: { kind: "unknown", message: "rate limited" },
        requestId: "request-1",
      },
    });

    expect(parsed.type).toBe("pull_request_timeline_response");
  });

  test("normalizes future error kinds to unknown", () => {
    const parsed = PullRequestTimelineResponseSchema.parse({
      type: "pull_request_timeline_response",
      payload: {
        error: { kind: "future_kind", message: "x" },
      },
    });

    expect(parsed.payload.error).toEqual({ kind: "unknown", message: "x" });
  });

  test.each(["rate_limited", "", undefined])(
    "normalizes malformed error kind %j to unknown",
    (kind) => {
      const parsed = PullRequestTimelineResponseSchema.parse({
        type: "pull_request_timeline_response",
        payload: {
          error: { kind },
        },
      });

      expect(parsed.payload.error).toEqual({ kind: "unknown", message: "" });
    },
  );
});

describe("checkout PR status message schema", () => {
  test("parses a checkout PR status response with provider-specific facts", () => {
    const parsed = CheckoutPrStatusResponseSchema.parse({
      type: "checkout_pr_status_response",
      payload: {
        cwd: "/tmp/repo",
        status: {
          number: 42,
          url: "https://github.com/bytetrue/byspace/pull/42",
          title: "Wire real PR pane data",
          state: "OPEN",
          baseRefName: "main",
          headRefName: "feature/pr-pane",
          isMerged: false,
          isDraft: true,
          checks: [
            {
              name: "server-tests",
              status: "success",
              url: "https://github.com/bytetrue/byspace/actions/runs/123",
              workflow: "Server CI",
              duration: "2m 14s",
            },
          ],
          checksStatus: "success",
          reviewDecision: "APPROVED",
        },
        authState: "authenticated",
        error: null,
        requestId: "request-1",
      },
    });

    expect(parsed.payload.status?.number).toBe(42);
    expect(parsed.payload.authState).toBe("authenticated");
    // Permanent default: the Gitea family omits the top-level brand.
    expect(parsed.payload.forge).toBe("github");
  });
});

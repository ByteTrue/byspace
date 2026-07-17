import { describe, expect, test } from "vitest";

import { CheckoutPrStatusSchema } from "@bytetrue/byspace-protocol/messages";
import { normalizeCheckoutPrStatusPayload } from "./status-projection.js";

describe("checkout status projection", () => {
  test("includes repository identity fields on the PR status wire payload", () => {
    const payload = normalizeCheckoutPrStatusPayload(
      {
        number: 123,
        repoOwner: "internal-owner",
        repoName: "internal-repo",
        url: "https://github.com/ByteTrue/byspace/pull/123",
        title: "Ship PR pane",
        state: "open",
        baseRefName: "main",
        headRefName: "feature/pr-pane",
        isMerged: false,
        isDraft: true,
        mergeable: "MERGEABLE",
        checks: [
          {
            name: "typecheck",
            status: "success",
            url: "https://github.com/ByteTrue/byspace/actions/runs/1",
            workflow: "CI",
            duration: "1m 20s",
          },
        ],
        checksStatus: "success",
        reviewDecision: "approved",
      },
      "github",
    );

    expect(payload).toHaveProperty("repoOwner", "internal-owner");
    expect(payload).toHaveProperty("repoName", "internal-repo");
    expect(payload).toHaveProperty("mergeable", "MERGEABLE");
    expect(CheckoutPrStatusSchema.parse(payload)).toEqual(payload);
  });

  test("projects PR 993 GitHub merge facts without changing top-level status fields", () => {
    const payload = normalizeCheckoutPrStatusPayload(
      {
        number: 993,
        repoOwner: "ByteTrue",
        repoName: "byspace",
        url: "https://github.com/ByteTrue/byspace/pull/993",
        title: "Auto-merge UX",
        state: "open",
        baseRefName: "main",
        headRefName: "github-pr-auto-merge-ux",
        isMerged: false,
        isDraft: false,
        mergeable: "MERGEABLE",
        checks: [
          {
            name: "server tests",
            status: "pending",
            url: "https://github.com/ByteTrue/byspace/actions/runs/993",
            workflow: "CI",
          },
        ],
        checksStatus: "pending",
        reviewDecision: "approved",
        forgeSpecific: {
          forge: "github",
          mergeStateStatus: "BLOCKED",
          autoMergeRequest: null,
          viewerCanEnableAutoMerge: true,
          viewerCanDisableAutoMerge: false,
          viewerCanMergeAsAdmin: false,
          viewerCanUpdateBranch: true,
          repository: {
            autoMergeAllowed: true,
            mergeCommitAllowed: false,
            squashMergeAllowed: true,
            rebaseMergeAllowed: false,
            viewerDefaultMergeMethod: "SQUASH",
          },
          isMergeQueueEnabled: false,
          isInMergeQueue: false,
        },
      },
      "github",
    );

    expect(payload).toMatchObject({
      number: 993,
      mergeable: "MERGEABLE",
      checksStatus: "pending",
      github: {
        mergeStateStatus: "BLOCKED",
        viewerCanEnableAutoMerge: true,
        repository: {
          autoMergeAllowed: true,
          squashMergeAllowed: true,
          viewerDefaultMergeMethod: "SQUASH",
        },
      },
    });
    expect(CheckoutPrStatusSchema.parse(payload)).toEqual(payload);
  });

  test("keeps resolved Forgejo branding separate from Gitea-family facts", () => {
    const payload = normalizeCheckoutPrStatusPayload(
      {
        number: 5,
        url: "https://codeberg.org/example/repo/pulls/5",
        title: "PR 5",
        state: "open",
        baseRefName: "main",
        headRefName: "feat/five",
        isMerged: false,
        mergeable: "MERGEABLE",
        forgeSpecific: {
          forge: "gitea",
          mergeable: true,
          hasMerged: false,
          ciStatus: "success",
        },
      },
      "forgejo",
    );

    expect(payload).toMatchObject({
      forge: "forgejo",
      forgeSpecific: { forge: "gitea", ciStatus: "success" },
    });
    expect(payload).not.toHaveProperty("github");
  });
});

import { describe, expect, it } from "vitest";

import { selectPrHintFromStatus } from "./pr-hint";

const githubStatus = {
  url: "https://github.com/acme/repo/pull/42",
  state: "open",
  isMerged: false,
};

const gitlabStatus = {
  url: "https://gitlab.com/group/proj/-/merge_requests/7",
  state: "open",
  isMerged: false,
};

describe("selectPrHintFromStatus", () => {
  it("defaults the forge to github when none is supplied (old daemon)", () => {
    const hint = selectPrHintFromStatus(githubStatus);
    expect(hint).toMatchObject({ number: 42, forge: "github" });
  });

  it("carries the resolved forge onto the hint", () => {
    const hint = selectPrHintFromStatus(githubStatus, "github");
    expect(hint?.forge).toBe("github");
  });

  it("parses a GitLab merge-request URL and carries the gitlab forge", () => {
    const hint = selectPrHintFromStatus(gitlabStatus, "gitlab");
    expect(hint).toMatchObject({ number: 7, forge: "gitlab" });
  });

  it("passes an unknown forge id through untouched", () => {
    const hint = selectPrHintFromStatus(githubStatus, "bitbucket");
    expect(hint?.forge).toBe("bitbucket");
  });

  it("returns null when the url has no parseable change-request number", () => {
    expect(
      selectPrHintFromStatus({ url: "https://example.com/x", state: "open", isMerged: false }),
    ).toBeNull();
  });
});

describe("forge checks URL selection", () => {
  const check = (url: string | null) => [{ name: "build", status: "success", url }];

  it("builds the GitHub checks page safely", () => {
    expect(
      selectPrHintFromStatus({
        ...githubStatus,
        url: "https://github.com/acme/repo/pull/12?x=1#fragment",
      })?.checksUrl,
    ).toBe("https://github.com/acme/repo/pull/12/checks");
  });

  it("uses validated GitLab pipeline facts, then actual check URLs", () => {
    expect(
      selectPrHintFromStatus(
        {
          ...gitlabStatus,
          checks: check("https://gitlab.com/acme/repo/-/jobs/1"),
          forgeSpecific: {
            forge: "gitlab",
            pipelineUrl: "https://gitlab.com/acme/repo/-/pipelines/306",
          },
        },
        "gitlab",
      )?.checksUrl,
    ).toBe("https://gitlab.com/acme/repo/-/pipelines/306");
    expect(
      selectPrHintFromStatus(
        { ...gitlabStatus, checks: check("https://gitlab.com/acme/repo/-/jobs/1") },
        "gitlab",
      )?.checksUrl,
    ).toBe("https://gitlab.com/acme/repo/-/jobs/1");
  });

  it.each(["gitea", "forgejo", "codeberg", "unknown"])(
    "%s uses an actual check URL without inventing one",
    (forge) => {
      expect(
        selectPrHintFromStatus(
          { ...githubStatus, checks: check("https://forge.example/actions/1") },
          forge,
        )?.checksUrl,
      ).toBe("https://forge.example/actions/1");
      expect(selectPrHintFromStatus(githubStatus, forge)?.checksUrl).toBeNull();
    },
  );

  it("rejects malformed GitLab facts as a URL source", () => {
    expect(
      selectPrHintFromStatus(
        {
          ...gitlabStatus,
          forgeSpecific: { forge: "gitlab", pipelineUrl: 123 },
        },
        "gitlab",
      )?.checksUrl,
    ).toBeNull();
  });
});

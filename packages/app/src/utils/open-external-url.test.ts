import { describe, expect, it } from "vitest";
import { isAllowedExternalUrl } from "./open-external-url";

describe("isAllowedExternalUrl", () => {
  it("accepts only absolute HTTP and HTTPS URLs", () => {
    expect(isAllowedExternalUrl("https://gitlab.com/acme/repo/-/jobs/1")).toBe(true);
    expect(isAllowedExternalUrl("http://gitea.internal/acme/repo/actions/runs/1")).toBe(true);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
  });
});

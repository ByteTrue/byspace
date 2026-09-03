import { describe, expect, it } from "vitest";
import { normalizeSshTargetInput } from "./ssh-target-input";

describe("normalizeSshTargetInput", () => {
  it("prefixes bare user@host targets", () => {
    expect(normalizeSshTargetInput("insta360@10.1.107.129")).toBe("ssh://insta360@10.1.107.129");
    expect(normalizeSshTargetInput("build-box")).toBe("ssh://build-box");
  });

  it("prefixes scp-style host:port targets", () => {
    expect(normalizeSshTargetInput("insta360@10.1.107.129:2222")).toBe(
      "ssh://insta360@10.1.107.129:2222",
    );
  });

  it("keeps full ssh:// URIs unchanged", () => {
    expect(normalizeSshTargetInput("ssh://insta360@10.1.107.129")).toBe(
      "ssh://insta360@10.1.107.129",
    );
    expect(normalizeSshTargetInput("ssh://insta360@10.1.107.129:2222?daemonPort=7777")).toBe(
      "ssh://insta360@10.1.107.129:2222?daemonPort=7777",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeSshTargetInput("  build-box  ")).toBe("ssh://build-box");
  });

  it("leaves foreign schemes alone so the parser reports them", () => {
    expect(normalizeSshTargetInput("http://build-box")).toBe("http://build-box");
  });
});

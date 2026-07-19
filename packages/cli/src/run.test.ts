import { describe, expect, it } from "vitest";
import { createCliParseArgv } from "./run";

describe("runCli", () => {
  it("defaults an empty CLI invocation to onboard", () => {
    expect(
      createCliParseArgv({
        argv: [],
        nodeArgv: ["node", "byspace"],
      }),
    ).toEqual(["node", "byspace", "onboard"]);
  });

  it("preserves known CLI command argv", () => {
    expect(
      createCliParseArgv({
        argv: ["daemon", "set-password"],
        nodeArgv: ["node", "byspace"],
      }),
    ).toEqual(["node", "byspace", "daemon", "set-password"]);
  });

  it("preserves the hooks command argv", () => {
    expect(
      createCliParseArgv({
        argv: ["hooks", "claude", "UserPromptSubmit"],
        nodeArgv: ["node", "byspace"],
      }),
    ).toEqual(["node", "byspace", "hooks", "claude", "UserPromptSubmit"]);
  });
});

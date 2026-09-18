import { describe, expect, it } from "vitest";
import {
  WorkspaceAutomationBlockedError,
  assertWorkspaceAutomationAllowed,
  formatWorkspaceAutomationBlockedMessage,
} from "./workspace-automation-gate.js";

describe("workspace automation gate", () => {
  it("refuses executable repository automation for a cross-repository change request", () => {
    expect(() =>
      assertWorkspaceAutomationAllowed({
        kind: "change_request",
        forge: "github",
        number: 42,
        headRepository: "contributor/byspace",
      }),
    ).toThrowError(
      new WorkspaceAutomationBlockedError({
        kind: "change_request",
        forge: "github",
        number: 42,
        headRepository: "contributor/byspace",
      }),
    );
  });

  it("allows executable repository automation for ordinary workspaces", () => {
    expect(() => assertWorkspaceAutomationAllowed(undefined)).not.toThrow();
  });

  it.each([
    ["github", "PR"],
    ["gitea", "PR"],
    ["forgejo", "PR"],
    ["gitlab", "MR"],
  ])("uses the %s change request noun", (forge, noun) => {
    expect(
      formatWorkspaceAutomationBlockedMessage({
        kind: "change_request",
        forge,
        number: 42,
        headRepository: "contributor/byspace",
      }),
    ).toBe(
      `Scripts are blocked for ${noun} #42 from contributor/byspace. Run setup to allow them.`,
    );
  });
});

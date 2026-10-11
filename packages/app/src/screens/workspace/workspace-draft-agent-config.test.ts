import { describe, expect, it } from "vitest";
import { buildWorkspaceDraftAgentConfig } from "./workspace-draft-agent-config";

describe("workspace-draft-agent-config", () => {
  it("builds chat-only config for workspace draft agents", () => {
    expect(
      buildWorkspaceDraftAgentConfig({
        provider: "codex",
        cwd: "/tmp/project",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
      }),
    ).toEqual({
      provider: "codex",
      cwd: "/tmp/project",
      modeId: "auto",
      model: "gpt-5.4",
      thinkingOptionId: "high",
    });
  });

  it("carries a selected agent role into the config", () => {
    expect(
      buildWorkspaceDraftAgentConfig({
        provider: "pi",
        cwd: "/tmp/project",
        role: "chief",
      }),
    ).toEqual({
      provider: "pi",
      cwd: "/tmp/project",
      role: "chief",
    });
  });

  it("omits the role key when no role is selected", () => {
    const config = buildWorkspaceDraftAgentConfig({ provider: "codex", cwd: "/tmp/project" });
    expect(config).toEqual({ provider: "codex", cwd: "/tmp/project" });
    expect("role" in config).toBe(false);
  });
});

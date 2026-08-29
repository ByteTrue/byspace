import { describe, expect, it } from "vitest";

import {
  getBySpaceToolLeafName,
  isBySpaceToolName,
} from "@bytetrue/byspace-protocol/tool-name-normalization";

describe("isBySpaceToolName", () => {
  it("detects Claude Code format", () => {
    expect(isBySpaceToolName("mcp__byspace__create_agent")).toBe(true);
    expect(isBySpaceToolName("mcp__byspace__list_agents")).toBe(true);
  });

  it("detects byspace_voice variant", () => {
    expect(isBySpaceToolName("mcp__byspace_voice__create_agent")).toBe(true);
    expect(isBySpaceToolName("byspace_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isBySpaceToolName("mcp__byspace_voice__speak")).toBe(false);
    expect(isBySpaceToolName("mcp__byspace__speak")).toBe(false);
    expect(isBySpaceToolName("byspace.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isBySpaceToolName("byspace.create_agent")).toBe(true);
  });

  it("rejects non-byspace tools", () => {
    expect(isBySpaceToolName("Bash")).toBe(false);
    expect(isBySpaceToolName("Read")).toBe(false);
    expect(isBySpaceToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getBySpaceToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getBySpaceToolLeafName("mcp__byspace__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getBySpaceToolLeafName("byspace.create_agent")).toBe("create_agent");
    expect(getBySpaceToolLeafName("byspace.list_agents")).toBe("list_agents");
  });

  it("returns null for non-byspace tools", () => {
    expect(getBySpaceToolLeafName("Bash")).toBeNull();
  });
});

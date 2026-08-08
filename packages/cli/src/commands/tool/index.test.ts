import { describe, expect, it } from "vitest";
import { parseToolInput } from "./index.js";

describe("parseToolInput", () => {
  it("defaults to an empty object", async () => {
    await expect(parseToolInput({})).resolves.toEqual({});
  });

  it("parses inline JSON objects", async () => {
    await expect(parseToolInput({ input: '{"agentId":"agent-1"}' })).resolves.toEqual({
      agentId: "agent-1",
    });
  });

  it("rejects non-object JSON", async () => {
    await expect(parseToolInput({ input: "[]" })).rejects.toThrow(
      "Tool input must be a JSON object",
    );
  });

  it("rejects ambiguous input sources", async () => {
    await expect(parseToolInput({ input: "{}", inputFile: "input.json" })).rejects.toThrow(
      "Use either --input or --input-file, not both",
    );
  });
});

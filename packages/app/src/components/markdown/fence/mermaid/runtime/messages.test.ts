import { describe, expect, it } from "vitest";
import {
  parseMermaidRuntimeMessage,
  parseMermaidRuntimeRenderMessage,
  serializeMermaidRuntimeRenderMessage,
} from "./messages";

describe("Mermaid runtime messages", () => {
  it("parses browser render requests", () => {
    expect(
      parseMermaidRuntimeRenderMessage({
        type: "render",
        revision: 3,
        source: "graph TD; A-->B",
        colorScheme: "dark",
        interactive: true,
      }),
    ).toEqual({
      type: "render",
      revision: 3,
      source: "graph TD; A-->B",
      colorScheme: "dark",
      interactive: true,
    });
  });

  it("rejects malformed runtime messages", () => {
    expect(parseMermaidRuntimeRenderMessage({ type: "render", revision: 1.5 })).toBeNull();
    expect(parseMermaidRuntimeMessage({ type: "rendered", height: Number.NaN })).toBeNull();
  });

  it("parses rendered dimensions", () => {
    expect(
      parseMermaidRuntimeMessage({
        type: "rendered",
        revision: 2,
        source: "sequenceDiagram",
        colorScheme: "light",
        height: 120,
        width: 240,
      }),
    ).toMatchObject({ type: "rendered", revision: 2, height: 120, width: 240 });
  });

  it("escapes closing script tags when serializing iframe input", () => {
    expect(
      serializeMermaidRuntimeRenderMessage({
        type: "render",
        revision: 1,
        source: "</script>",
        colorScheme: "light",
        interactive: false,
      }),
    ).toContain("<\\/script>");
  });
});

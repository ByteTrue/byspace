import { describe, expect, it } from "vitest";
import { resolveWebScrollbarGutter } from "./use-web-scrollbar";

function elementWithAttributes(...attributes: string[]): Pick<HTMLElement, "hasAttribute"> {
  const values = new Set(attributes);
  return { hasAttribute: (name) => values.has(name) };
}

describe("resolveWebScrollbarGutter", () => {
  it("keeps the composer gutter stable", () => {
    expect(resolveWebScrollbarGutter(elementWithAttributes("data-composer-input"))).toBe("stable");
  });

  it("uses the default gutter elsewhere", () => {
    expect(resolveWebScrollbarGutter(elementWithAttributes())).toBe("auto");
  });
});

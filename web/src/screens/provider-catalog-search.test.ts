import { describe, expect, it } from "vitest";
import { filterConfiguredProviderCatalog, rankProviderCatalog } from "./provider-catalog-search";

const entries = [
  { id: "kiro-cli", title: "Kiro CLI" },
  { id: "goose", title: "goose" },
  { id: "kimi", title: "Kimi Code CLI" },
  { id: "gemini", title: "Gemini CLI" },
  { id: "qwen-code", title: "Qwen Code" },
  { id: "codex-acp", title: "Codex" },
];

function titles(list: { title: string }[]): string[] {
  return list.map((entry) => entry.title);
}

describe("rankProviderCatalog", () => {
  it("lists every provider alphabetically without a query", () => {
    expect(titles(rankProviderCatalog(entries, "  "))).toEqual([
      "Codex",
      "Gemini CLI",
      "goose",
      "Kimi Code CLI",
      "Kiro CLI",
      "Qwen Code",
    ]);
  });

  it("ranks title and id matches", () => {
    expect(titles(rankProviderCatalog(entries, "cod"))).toEqual([
      "Codex",
      "Kimi Code CLI",
      "Qwen Code",
    ]);
    expect(titles(rankProviderCatalog(entries, "kiro-cli"))).toEqual(["Kiro CLI"]);
  });

  it("breaks equal match scores alphabetically", () => {
    const tied = [
      { id: "bravo", title: "Bravo Code" },
      { id: "alpha", title: "Alpha Code" },
    ];
    expect(titles(rankProviderCatalog(tied, "code"))).toEqual(["Alpha Code", "Bravo Code"]);
  });

  it("matches subsequences and multiple tokens", () => {
    expect(titles(rankProviderCatalog(entries, "gmni"))).toEqual(["Gemini CLI"]);
    expect(titles(rankProviderCatalog(entries, "qw cod"))).toEqual(["Qwen Code"]);
  });
});

describe("filterConfiguredProviderCatalog", () => {
  it("filters configured providers even when disabled", () => {
    const available = filterConfiguredProviderCatalog(entries, [
      { provider: "goose", enabled: false },
      { provider: "kimi", enabled: true },
    ]);
    expect(titles(available)).toEqual(["Kiro CLI", "Gemini CLI", "Qwen Code", "Codex"]);
  });
});

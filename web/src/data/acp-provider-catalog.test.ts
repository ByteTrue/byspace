import { describe, expect, it } from "vitest";
import { ACP_PROVIDER_CATALOG } from "./acp-provider-catalog";
import { ACP_PROVIDER_ICON_SVGS } from "@/assets/acp-provider-icons";

describe("ACP provider catalog", () => {
  it("vendors 40 unique presets with local icons and concrete install metadata", () => {
    expect(ACP_PROVIDER_CATALOG).toHaveLength(40);
    expect(new Set(ACP_PROVIDER_CATALOG.map((entry) => entry.id)).size).toBe(40);
    expect(ACP_PROVIDER_CATALOG.filter((entry) => !entry.iconSvg).map((entry) => entry.id)).toEqual(
      [],
    );
    for (const entry of ACP_PROVIDER_CATALOG) {
      expect(entry.title).not.toBe("");
      expect(entry.description).not.toBe("");
      expect(entry.installLink).toMatch(/^https:\/\//);
      expect(entry.command.length).toBeGreaterThan(0);
      expect(entry.command[0]).not.toBe("");
      expect(entry.iconSvg).toContain("<svg");
    }
  });

  it("uses each provider's own icon instead of another product's asset", () => {
    for (const id of ["devin", "hermes", "kiro"] as const) {
      expect(ACP_PROVIDER_CATALOG.find((entry) => entry.id === id)?.iconSvg).toBe(
        ACP_PROVIDER_ICON_SVGS[id],
      );
    }
  });

  it("preserves current pinned commands and excludes unsupported or primary providers", () => {
    const byId = new Map(ACP_PROVIDER_CATALOG.map((entry) => [entry.id, entry]));
    expect(byId.get("auggie")?.version).toBe("0.36.0");
    expect(byId.get("minimax-code")?.command).toEqual([
      "npx",
      "-y",
      "-p",
      "@minimax-ai/code@0.6.13",
      "mcode",
      "acp",
    ]);
    expect(byId.has("agy")).toBe(false);
    expect(byId.has("pi-acp")).toBe(false);
    expect(["claude", "codex", "opencode", "pi"].some((id) => byId.has(id))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import { buildAcpProviderConfigPatch, getAcpProviderCatalog } from "./use-acp-provider-catalog";

function findProvider(id: string) {
  const entry = getAcpProviderCatalog().find((provider) => provider.id === id);
  if (!entry) throw new Error(`Missing ACP provider catalog entry: ${id}`);
  return entry;
}

describe("buildAcpProviderConfigPatch", () => {
  it("maps a preset to a generic ACP provider without enabling anything eagerly", () => {
    expect(buildAcpProviderConfigPatch(findProvider("amp-acp"))).toEqual({
      providers: {
        "amp-acp": {
          extends: "acp",
          label: "Amp",
          description: "ACP wrapper for Amp - the frontier coding agent",
          command: ["amp-acp"],
          env: {},
        },
      },
    });
  });

  it("preserves pinned env and params", () => {
    expect(buildAcpProviderConfigPatch(findProvider("auggie")).providers?.auggie?.env).toEqual({
      AUGMENT_DISABLE_AUTO_UPDATE: "1",
    });
    expect(
      buildAcpProviderConfigPatch(findProvider("factory-droid")).providers?.["factory-droid"]
        ?.params,
    ).toEqual({
      supportsMcpServers: false,
    });
  });

  it.each(["fx", "goose", "hoplite"])("uses declarative ACP for former bundled preset %s", (id) => {
    const entry = findProvider(id);
    expect(buildAcpProviderConfigPatch(entry).providers?.[id]).toMatchObject({
      extends: "acp",
      command: [...entry.command],
    });
    expect("bundledProvider" in entry).toBe(false);
  });

  it("returns the vendored catalog", () => {
    expect(getAcpProviderCatalog()).toBe(ACP_PROVIDER_CATALOG);
  });
});

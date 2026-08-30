import { describe, expect, it } from "vitest";
import { rebrandResource } from "./branding";

describe("i18n branding", () => {
  it("rebrands BySpace-owned public names recursively", () => {
    expect(
      rebrandResource({
        product: "Paseo supervises $PASEO_PORT and ${PASEO_URL}",
        files: ["paseo.json", "paseo-plugin.json", "paseo-plugin.d.ts"],
      }),
    ).toEqual({
      product: "BySpace supervises $BYSPACE_PORT and ${BYSPACE_URL}",
      files: ["byspace.json", "byspace-plugin.json", "byspace-plugin.d.ts"],
    });
  });

  it("preserves upstream compatibility identifiers", () => {
    expect(
      rebrandResource([
        "Paseo Hub",
        "PaseoApi",
        "@getpaseo/client",
        "https://hub.paseo.sh",
        ".paseo/workflows",
        "${{ paseo.repository }}",
      ]),
    ).toEqual([
      "Paseo Hub",
      "PaseoApi",
      "@getpaseo/client",
      "https://hub.paseo.sh",
      ".paseo/workflows",
      "${{ paseo.repository }}",
    ]);
  });
});

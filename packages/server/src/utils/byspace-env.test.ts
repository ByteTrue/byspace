import { describe, expect, it } from "vitest";
import { withByspaceEnvironment } from "./byspace-env.js";

describe("withByspaceEnvironment", () => {
  it("maps BYSPACE variables to the internal PASEO names", () => {
    expect(
      withByspaceEnvironment({
        BYSPACE_PASSWORD: "new-password",
        BYSPACE_PORT: "6777",
      }),
    ).toMatchObject({
      BYSPACE_PASSWORD: "new-password",
      BYSPACE_PORT: "6777",
      PASEO_PASSWORD: "new-password",
      PASEO_PORT: "6777",
    });
  });

  it("gives BYSPACE variables precedence over legacy PASEO variables", () => {
    expect(
      withByspaceEnvironment({
        BYSPACE_PASSWORD: "new-password",
        PASEO_PASSWORD: "legacy-password",
      }).PASEO_PASSWORD,
    ).toBe("new-password");
  });

  it("retains legacy variables when no BYSPACE alias is set", () => {
    expect(withByspaceEnvironment({ PASEO_PASSWORD: "legacy-password" }).PASEO_PASSWORD).toBe(
      "legacy-password",
    );
  });
});

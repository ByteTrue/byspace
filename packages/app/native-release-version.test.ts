import { describe, expect, it } from "vitest";

const { getNativeReleaseVersion } = require("./native-release-version");

describe("native release version", () => {
  it("reserves the final iOS build slot for a stable release", () => {
    expect(getNativeReleaseVersion("0.6.0")).toEqual({
      appVersion: "0.6.0",
      androidVersionCode: 6000,
      iosBuildNumber: "6000999",
    });
  });

  it("gives each beta a unique iOS build slot under the stable app version", () => {
    expect(getNativeReleaseVersion("0.6.0-beta.2")).toEqual({
      appVersion: "0.6.0",
      androidVersionCode: 6000,
      iosBuildNumber: "6000002",
    });
  });

  it("rejects beta numbers that consume the stable iOS build slot", () => {
    expect(() => getNativeReleaseVersion("0.6.0-beta.999")).toThrow(
      "iOS beta number must be between 1 and 998",
    );
  });
});

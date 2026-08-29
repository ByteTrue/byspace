import { describe, expect, test } from "vitest";
import { ServerInfoStatusPayloadSchema } from "./messages.js";

describe("provider options server feature", () => {
  test("keeps the feature optional for older daemons", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server-old",
        features: {},
      }).features?.providerOptions,
    ).toBeUndefined();
  });

  test("parses providerOptions support from current daemons", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server-new",
        features: { providerOptions: true },
      }).features?.providerOptions,
    ).toBe(true);
  });
});

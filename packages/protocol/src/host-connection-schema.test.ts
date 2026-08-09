import { describe, expect, test } from "vitest";
import { DirectTcpHostConnectionSchema } from "./host-connection-schema.js";

describe("DirectTcpHostConnectionSchema", () => {
  test("accepts optional direct connection headers", () => {
    expect(
      DirectTcpHostConnectionSchema.parse({
        id: "direct-test",
        type: "directTcp",
        endpoint: "localhost:6777",
        headers: { "X-Custom": "value" },
      }).headers,
    ).toEqual({ "X-Custom": "value" });
  });
});

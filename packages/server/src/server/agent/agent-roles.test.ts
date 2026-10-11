import { describe, expect, it } from "vitest";

import { AGENT_ROLE_LABEL, stripReservedLabels } from "./agent-roles.js";

describe("stripReservedLabels", () => {
  it("drops reserved identity keys and keeps other byspace.* labels", () => {
    expect(
      stripReservedLabels({
        "user.custom": "value",
        [AGENT_ROLE_LABEL]: "chief",
        "byspace.parent-agent-id": "agent-1",
      }),
    ).toEqual({ "user.custom": "value", "byspace.parent-agent-id": "agent-1" });
  });

  it("returns an empty map for undefined input", () => {
    expect(stripReservedLabels(undefined)).toEqual({});
  });
});

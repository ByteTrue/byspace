import { describe, expect, it } from "vitest";

import {
  AGENT_ROLE_LABEL,
  getAgentRole,
  listAgentRoleNames,
  stripReservedLabels,
} from "./agent-roles.js";

describe("listAgentRoleNames", () => {
  it("advertises every role the daemon can resolve, in registry order", () => {
    // The catalog is the client's only source of role names, so a name it
    // advertises must resolve — otherwise the picker offers a role that
    // silently degrades to a plain agent at creation.
    const names = listAgentRoleNames();

    expect(names).toContain("chief");
    expect(names.every((name) => getAgentRole(name) !== null)).toBe(true);
  });
});

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

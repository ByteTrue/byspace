import { describe, expect, it } from "vitest";
import { formatAgentRoleLabel } from "@/agent-controls/labels";
import { en } from "@/i18n/resources/en";
import { NO_AGENT_ROLE_ID, resolveAgentRoleNames } from "@/agent-controls/roles";

describe("resolveAgentRoleNames", () => {
  it("reads the advertised catalog when the host sends one", () => {
    expect(resolveAgentRoleNames({ agentRoleNames: ["chief", "researcher"] })).toEqual([
      "chief",
      "researcher",
    ]);
  });

  it("falls back to the chief-only registry a v0.20.0 daemon advertised", () => {
    // That daemon sent only the boolean, and chief was its whole registry.
    expect(resolveAgentRoleNames({ agentRoles: true })).toEqual(["chief"]);
  });

  it("reports no roles for a host without the feature", () => {
    expect(resolveAgentRoleNames(undefined)).toBeNull();
    expect(resolveAgentRoleNames({})).toBeNull();
    expect(resolveAgentRoleNames({ agentRoles: false })).toBeNull();
  });

  it("prefers an empty catalog over the legacy fallback", () => {
    // A newer daemon that deliberately ships no roles must not resurrect chief.
    expect(resolveAgentRoleNames({ agentRoleNames: [], agentRoles: true })).toEqual([]);
  });
});

describe("agent role form value", () => {
  it("leads with no-role and keeps it the form's empty value", () => {
    // The sentinel is the wire value: an absent role is what "no role" means, so
    // selecting it must not introduce a second encoding for the same thing.
    expect(NO_AGENT_ROLE_ID).toBe("");
  });

  it("labels a known role from the shipped en resource and humanizes the rest", () => {
    // A role added to a newer daemon has no copy here; it must render readable
    // rather than as a raw i18n key or an id with its separators intact.
    expect(formatAgentRoleLabel("chief")).toBe(en.agentControls.role.chief);
    expect(formatAgentRoleLabel("code-reviewer")).toBe("Code reviewer");
  });

  it("humanizes names that collide with Object.prototype members", () => {
    // The label map is a plain object; a bare lookup would return the function
    // on the prototype and hand i18n a function instead of a key.
    expect(formatAgentRoleLabel("constructor")).toBe("Constructor");
    expect(formatAgentRoleLabel("toString")).toBe("To string");
  });
});

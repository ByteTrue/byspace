/**
 * The built-in role catalog is product voice shipped from the repo: a gap
 * here ships agents without their instructions or skills, so the catalog
 * itself is under test — eight roles, each with its three persona files and
 * its skill set, and the assembly order a run prompt depends on.
 */
import { describe, expect, it } from "vitest";

import { builtinRoleInstructions, getBuiltinRole, listBuiltinRoles } from "./builtin-roles.js";

describe("builtin role catalog", () => {
  it("ships the eight roles the practice line earned, each complete", () => {
    const roles = listBuiltinRoles();
    expect(roles.map((role) => role.key)).toEqual([
      "backend-engineer",
      "data-analyst",
      "devops-engineer",
      "frontend-developer",
      "product-manager",
      "project-administrator",
      "qa-engineer",
      "ui-designer",
    ]);
    for (const role of roles) {
      expect(role.identity.length).toBeGreaterThan(0);
      expect(role.bible.length).toBeGreaterThan(0);
      expect(role.persona.length).toBeGreaterThan(0);
      expect(role.description.length).toBeGreaterThan(0);
      // Every skill carries a SKILL.md — native discovery reads it.
      for (const skill of role.skills) {
        expect(skill.files.some((file) => file.path === "SKILL.md")).toBe(true);
      }
    }
  });

  it("instructions assemble identity, methodology, then voice, in that order", () => {
    const role = getBuiltinRole("frontend-developer");
    const instructions = builtinRoleInstructions(role);
    expect(instructions.indexOf(role.identity)).toBe(0);
    expect(instructions.indexOf(role.bible)).toBeGreaterThan(instructions.indexOf(role.identity));
    expect(instructions.indexOf(role.persona)).toBeGreaterThan(instructions.indexOf(role.bible));
  });

  it("an unknown role key throws rather than seeding a voiceless agent", () => {
    expect(() => getBuiltinRole("no-such-role")).toThrow(/unknown built-in role/);
  });
});

describe("role display names", () => {
  it("the document-kind prefix is stripped: the agent is called by its role", () => {
    const names = listBuiltinRoles().map((role) => role.name);
    expect(names).toContain("Frontend Developer");
    expect(names).toContain("DevOps Engineer");
    expect(names.every((name) => !name.startsWith("Identity"))).toBe(true);
  });
});

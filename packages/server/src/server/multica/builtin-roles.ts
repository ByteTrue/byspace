/**
 * The eight built-in role assets, read from the repo at runtime. They came
 * from the Epic 004 practice line (harvested from the reference product,
 * adapted and actually run there) and survive into the replica as the only
 * asset that line earned: role voice for agents, not an execution surface.
 *
 * Each role is three persona files plus its own skill set. The files are
 * product voice, not code: they are assembled into an agent's instructions
 * at creation, and the skills are materialized into the run workspace the
 * way the source's execenv does ({workDir}/.pi/skills/{name}/SKILL.md, the
 * Pi row of its provider mapping table) so native discovery finds them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface BuiltinRoleSkill {
  readonly name: string;
  /** The SKILL.md frontmatter description — the skill row's description. */
  readonly description: string;
  /** Every file in the skill directory, paths relative to it. */
  readonly files: readonly { path: string; content: string }[];
}

export interface BuiltinRole {
  readonly key: string;
  readonly name: string;
  /** The first paragraph of IDENTITY — the one-line role voice. */
  readonly description: string;
  readonly identity: string;
  readonly bible: string;
  readonly persona: string;
  readonly skills: readonly BuiltinRoleSkill[];
}

const ROLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "builtin-roles");

function readSkillDir(skillDir: string, name: string): BuiltinRoleSkill {
  const files: { path: string; content: string }[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const relative = prefix === "" ? entry : `${prefix}/${entry}`;
      if (statSync(full).isDirectory()) {
        walk(full, relative);
      } else {
        files.push({ path: relative, content: readFileSync(full, "utf8") });
      }
    }
  };
  walk(skillDir, "");
  const skillMd = files.find((file) => file.path === "SKILL.md");
  // The description lives in the frontmatter's description line; a skill
  // without one still seeds, with an empty description like the table's
  // default.
  const match = skillMd?.content.match(/^description:\s*(.+)$/m);
  return { name, description: match?.[1]?.trim() ?? "", files };
}

function readRole(key: string): BuiltinRole {
  const dir = join(ROLES_DIR, key);
  const identity = readFileSync(join(dir, "IDENTITY.md"), "utf8");
  const bible = readFileSync(join(dir, "BIBLE.md"), "utf8");
  const persona = readFileSync(join(dir, "PERSONA.md"), "utf8");
  const skillsDir = join(dir, "skills");
  const skills = readdirSync(skillsDir)
    .filter((entry) => statSync(join(skillsDir, entry)).isDirectory())
    .sort()
    .map((entry) => readSkillDir(join(skillsDir, entry), entry));
  // The description is the first paragraph after the title — the line a
  // picker shows. Falling back to the whole body would show an essay.
  const body = identity.split("\n").filter((line) => line.trim() !== "");
  const description = body.find((line) => !line.startsWith("#"))?.trim() ?? key;
  const name =
    body
      .find((line) => line.startsWith("# "))
      ?.replace(/^#\s*/, "")
      // The persona files title themselves "Identity — <role>"; the agent is
      // called by the role, not by the document kind.
      .replace(/^Identity\s+(—|--|-)\s*/, "")
      .trim() ?? key;
  return { key, name, description, identity, bible, persona, skills };
}

let cached: readonly BuiltinRole[] | null = null;

/** The built-in role catalog, in directory order. Missing roles throw: a silent gap would ship agents without their voice. */
export function listBuiltinRoles(): readonly BuiltinRole[] {
  if (cached === null) {
    cached = readdirSync(ROLES_DIR)
      .filter((entry) => statSync(join(ROLES_DIR, entry)).isDirectory())
      .sort()
      .map(readRole);
  }
  return cached;
}

export function getBuiltinRole(key: string): BuiltinRole {
  const role = listBuiltinRoles().find((entry) => entry.key === key);
  if (!role) {
    throw new Error(`unknown built-in role: ${key}`);
  }
  return role;
}

/** The agent instructions a role produces: who you are, how you work, who you sound like. */
export function builtinRoleInstructions(role: BuiltinRole): string {
  return [role.identity, role.bible, role.persona].join("\n\n---\n\n");
}

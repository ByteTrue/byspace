/**
 * Putting a worker's skills where its runtime will find them.
 *
 * A worker's role prompt carries *who it is*; its skills carry *what it can do*.
 * The distinction is not cosmetic. A wake tells a coordinator to set the group's
 * goal with a command, and that command is documented in a skill. If the skill is
 * not in front of the model, the instruction is unactionable — and it fails
 * silently, because the run completes and merely reports that it could not
 * proceed.
 *
 * Pi discovers skills from two places: a user directory, and `.agents/skills`
 * beside the working directory and its ancestors. Only the second is something
 * this code controls, so the worker's own workspace is where its skills go. The
 * user directory stays the operator's; BySpace does not install into it, which
 * also means a worker sees whatever the machine's owner put there — a fact worth
 * recording rather than pretending away, and the reason the daemon's permission
 * layer, not skill visibility, is what bounds a worker.
 *
 * Copies are skipped once present rather than rewritten. A skill the operator has
 * edited inside a worker's workspace is theirs to keep, and re-copying on every
 * run would silently revert it.
 */
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Where skills are discovered relative to a worker's workspace. */
export const WORKER_SKILLS_DIRECTORY = path.join(".agents", "skills");

export interface MaterializeWorkerSkillsInput {
  workspacePath: string;
  /** The role's own skills, as `<templateRoot>/<templateId>/skills`. */
  templateSkillsDir: string;
  /**
   * Extra skills every worker needs regardless of role, named by directory.
   *
   * These are BySpace's own bundle skills rather than role content: the
   * coordination commands a worker uses to talk to its group live here, and a
   * role template cannot carry them without every role duplicating them.
   */
  sharedSkills: { sourceDir: string; names: readonly string[] };
}

export interface MaterializeWorkerSkillsResult {
  installed: string[];
  skipped: string[];
}

async function directoryExists(target: string): Promise<boolean> {
  const status = await stat(target).catch(() => null);
  return status?.isDirectory() ?? false;
}

/** A skill is a directory containing SKILL.md, which is pi's own test. */
async function isSkillDirectory(parent: string, name: string): Promise<boolean> {
  const manifest = await stat(path.join(parent, name, "SKILL.md")).catch(() => null);
  return manifest?.isFile() ?? false;
}

async function listSkills(sourceDir: string, restrictTo?: readonly string[]): Promise<string[]> {
  if (restrictTo) {
    // An absent name is not an error here: a shared skill that does not exist
    // yet must not stop a worker from running. The reference test over the
    // templates is what catches a skill that should exist and does not.
    const present = await readdir(sourceDir).catch(() => [] as string[]);
    return restrictTo.filter((name) => present.includes(name));
  }
  const entries = await readdir(sourceDir, { withFileTypes: true }).catch(() => []);
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await isSkillDirectory(sourceDir, entry.name)) names.push(entry.name);
  }
  return names;
}

/**
 * Copy a worker's role and shared skills into its workspace.
 *
 * Idempotent: an existing skill directory is left alone. Returns what was added
 * and what was already there, so a caller can log the difference rather than
 * claim it installed something it skipped.
 */
export async function materializeWorkerSkills(
  input: MaterializeWorkerSkillsInput,
): Promise<MaterializeWorkerSkillsResult> {
  const targetDir = path.join(input.workspacePath, WORKER_SKILLS_DIRECTORY);
  await mkdir(targetDir, { recursive: true });

  const [roleSkills, sharedSkills] = await Promise.all([
    listSkills(input.templateSkillsDir),
    listSkills(input.sharedSkills.sourceDir, input.sharedSkills.names),
  ]);

  const installed: string[] = [];
  const skipped: string[] = [];

  // Role skills first: a shared skill must not shadow a role's own skill of the
  // same name, because the role copy is the more specific one.
  for (const sourceDir of [input.templateSkillsDir, input.sharedSkills.sourceDir]) {
    const names = sourceDir === input.templateSkillsDir ? roleSkills : sharedSkills;
    for (const name of names) {
      if (skipped.includes(name) || installed.includes(name)) continue;
      const target = path.join(targetDir, name);
      if (await directoryExists(target)) {
        skipped.push(name);
        continue;
      }
      await cp(path.join(sourceDir, name), target, { recursive: true });
      installed.push(name);
    }
  }

  return { installed, skipped };
}

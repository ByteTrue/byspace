/**
 * Tests for putting skills in front of a worker.
 *
 * The property that matters is that a worker's own workspace ends up holding the
 * skills its runtime discovers from it, and that running it twice does not
 * overwrite what the first run put there.
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { materializeWorkerSkills, WORKER_SKILLS_DIRECTORY } from "./worker-skills.js";

let root: string;
let workspace: string;
let templateSkills: string;
let bundleSkills: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "worker-skills-"));
  workspace = path.join(root, "worker");
  templateSkills = path.join(root, "templates", "qa-engineer", "skills");
  bundleSkills = path.join(root, "skills");
  mkdirSync(workspace, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function skill(parent: string, name: string, body = "use when needed"): void {
  const dir = path.join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n\n${body}\n`);
}

function installed(): string[] {
  return readdirSync(path.join(workspace, WORKER_SKILLS_DIRECTORY)).sort();
}

function run() {
  return materializeWorkerSkills({
    workspacePath: workspace,
    templateSkillsDir: templateSkills,
    sharedSkills: { sourceDir: bundleSkills, names: ["byspace-worker-team"] },
  });
}

describe("worker skills", () => {
  it("installs the role's skills into the workspace", async () => {
    skill(templateSkills, "test-case-template");
    skill(templateSkills, "accessibility-audit");

    const result = await run();

    expect(result.installed).toEqual(["accessibility-audit", "test-case-template"]);
    expect(installed()).toEqual(["accessibility-audit", "test-case-template"]);
  });

  it("installs the shared coordination skill alongside them", async () => {
    skill(templateSkills, "test-case-template");
    skill(bundleSkills, "byspace-worker-team");

    const result = await run();

    // This is the whole point of the shared list: the wake tells a worker to set
    // a goal with a command, and that command is documented here. Without it the
    // instruction is unactionable.
    expect(result.installed).toContain("byspace-worker-team");
    expect(installed()).toEqual(["byspace-worker-team", "test-case-template"]);
  });

  it("copies a skill's supporting files, not only its manifest", async () => {
    skill(bundleSkills, "byspace-worker-team");
    mkdirSync(path.join(bundleSkills, "byspace-worker-team", "references"), { recursive: true });
    writeFileSync(
      path.join(bundleSkills, "byspace-worker-team", "references", "commands.md"),
      "the commands",
    );

    await run();

    const target = path.join(workspace, WORKER_SKILLS_DIRECTORY, "byspace-worker-team");
    expect(readdirSync(target)).toContain("references");
    expect(readdirSync(path.join(target, "references"))).toContain("commands.md");
  });

  it("skips a skill already present rather than rewriting it", async () => {
    skill(templateSkills, "test-case-template");
    // An operator may have edited a skill inside a worker's workspace. Copying
    // over it would silently revert their change on the next run.
    const existing = path.join(workspace, WORKER_SKILLS_DIRECTORY, "test-case-template");
    mkdirSync(existing, { recursive: true });
    writeFileSync(path.join(existing, "SKILL.md"), "hand edited");

    const result = await run();

    expect(result.skipped).toEqual(["test-case-template"]);
    expect(result.installed).toEqual([]);
    expect(readSkillManifest(existing)).toBe("hand edited");
  });

  it("lets the role's own skill win over a shared one of the same name", async () => {
    skill(templateSkills, "shared-name", "from the role");
    skill(bundleSkills, "shared-name", "from the bundle");

    await run();

    const target = path.join(workspace, WORKER_SKILLS_DIRECTORY, "shared-name");
    // The role copy is the more specific one, so it is installed first and the
    // bundle copy then finds the name taken.
    expect(readSkillManifest(target)).toContain("from the role");
  });

  it("ignores a directory that is not a skill", async () => {
    mkdirSync(path.join(templateSkills, "not-a-skill"), { recursive: true });
    skill(templateSkills, "real-skill");

    const result = await run();

    expect(result.installed).toEqual(["real-skill"]);
  });

  it("tolerates a shared skill that does not exist", async () => {
    skill(templateSkills, "test-case-template");
    // No bundle skills at all. A missing optional skill must not stop a worker
    // being created.
    const result = await run();

    expect(result.installed).toEqual(["test-case-template"]);
  });

  it("installs nothing but succeeds for a role with no skills", async () => {
    mkdirSync(templateSkills, { recursive: true });
    const result = await run();

    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("is idempotent across runs", async () => {
    skill(templateSkills, "test-case-template");
    skill(bundleSkills, "byspace-worker-team");

    const first = await run();
    const second = await run();

    expect(first.installed).toHaveLength(2);
    expect(second.installed).toEqual([]);
    // Reported in install order — the role's own skills, then the shared ones —
    // which is the order that decides precedence when two share a name.
    expect(second.skipped).toEqual(["test-case-template", "byspace-worker-team"]);
    expect(installed()).toHaveLength(2);
  });

  it("creates the skills directory even with nothing to install", async () => {
    const result = await run();
    expect(result.installed).toEqual([]);
    // The directory exists, so a later write into it is not the first mkdir and
    // a caller can look in one place to see what a worker has.
    expect(readdirSync(path.join(workspace, WORKER_SKILLS_DIRECTORY))).toEqual([]);
  });
});

function readSkillManifest(dir: string): string {
  return readFileSync(path.join(dir, "SKILL.md"), "utf8");
}

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BYSPACE_ORCHESTRATION_SKILL_NAMES,
  getOrchestrationSkillsStatus,
  resolveOrchestrationSkillsTargets,
  setOrchestrationSkillsInstalled,
  type OrchestrationSkillsTargets,
} from "./orchestration-skills.js";

let root: string;
let targets: OrchestrationSkillsTargets;

async function writeSkill(directory: string, name: string, content: string): Promise<void> {
  const skillDir = path.join(directory, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), content);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "byspace-orchestration-skills-"));
  targets = {
    sourceDir: path.join(root, "bundle"),
    installDirs: [
      path.join(root, "home", ".agents", "skills"),
      path.join(root, "home", ".claude", "skills"),
    ],
    manifestPath: path.join(root, "byspace-home", "managed-orchestration-skills.json"),
  };
  for (const name of BYSPACE_ORCHESTRATION_SKILL_NAMES) {
    await writeSkill(targets.sourceDir, name, `bundled ${name}`);
  }
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it("installs only to the shared and Claude skill roots", () => {
  expect(resolveOrchestrationSkillsTargets(root).installDirs).toEqual([
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
  ]);
});

describe("orchestration skills", () => {
  it("reports missing skills, installs all targets, and preserves unrelated skills", async () => {
    await writeSkill(targets.installDirs[0], "user-skill", "keep me");

    expect(await getOrchestrationSkillsStatus(targets)).toBe("not-installed");

    expect(await setOrchestrationSkillsInstalled(true, targets)).toBe("up-to-date");
    for (const installDir of targets.installDirs) {
      for (const name of BYSPACE_ORCHESTRATION_SKILL_NAMES) {
        expect(await fs.readFile(path.join(installDir, name, "SKILL.md"), "utf8")).toBe(
          `bundled ${name}`,
        );
      }
    }
    expect(
      await fs.readFile(path.join(targets.installDirs[0], "user-skill", "SKILL.md"), "utf8"),
    ).toBe("keep me");
  });

  it("detects edited content and a missing provider copy, then converges on update", async () => {
    await setOrchestrationSkillsInstalled(true, targets);
    await fs.writeFile(path.join(targets.installDirs[0], "byspace", "SKILL.md"), "locally edited");
    await fs.writeFile(path.join(targets.installDirs[0], "byspace", "obsolete.md"), "stale");
    await fs.rm(path.join(targets.installDirs[1], "byspace-loop"), {
      recursive: true,
      force: true,
    });

    expect(await getOrchestrationSkillsStatus(targets)).toBe("drift");
    expect(await setOrchestrationSkillsInstalled(true, targets)).toBe("up-to-date");
    await expect(
      fs.stat(path.join(targets.installDirs[0], "byspace", "obsolete.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uninstalls only managed names and is idempotent", async () => {
    await setOrchestrationSkillsInstalled(true, targets);
    await writeSkill(targets.installDirs[1], "user-skill", "keep me");

    expect(await setOrchestrationSkillsInstalled(false, targets)).toBe("not-installed");
    expect(await setOrchestrationSkillsInstalled(false, targets)).toBe("not-installed");
    expect(
      await fs.readFile(path.join(targets.installDirs[1], "user-skill", "SKILL.md"), "utf8"),
    ).toBe("keep me");
  });

  it("refuses to overwrite or remove an unowned same-name skill", async () => {
    await writeSkill(targets.installDirs[0], "byspace", "personal version");

    await expect(setOrchestrationSkillsInstalled(true, targets)).rejects.toThrow(
      "Refusing to overwrite non-BySpace orchestration skill",
    );
    await expect(setOrchestrationSkillsInstalled(false, targets)).rejects.toThrow(
      "Refusing to remove modified orchestration skill",
    );
    expect(
      await fs.readFile(path.join(targets.installDirs[0], "byspace", "SKILL.md"), "utf8"),
    ).toBe("personal version");
  });

  it("preserves a modified managed copy during uninstall", async () => {
    await setOrchestrationSkillsInstalled(true, targets);
    const modifiedPath = path.join(targets.installDirs[0], "byspace", "SKILL.md");
    await fs.writeFile(modifiedPath, "local changes");

    await expect(setOrchestrationSkillsInstalled(false, targets)).rejects.toThrow(
      "Refusing to remove modified orchestration skill",
    );
    expect(await fs.readFile(modifiedPath, "utf8")).toBe("local changes");
    expect(
      await fs.readFile(path.join(targets.installDirs[1], "byspace", "SKILL.md"), "utf8"),
    ).toBe("bundled byspace");
  });

  it("refuses a symlink at a managed skill path", async () => {
    const external = path.join(root, "external");
    await writeSkill(external, "content", "outside");
    await fs.mkdir(targets.installDirs[0], { recursive: true });
    await fs.symlink(external, path.join(targets.installDirs[0], "byspace"));

    await expect(getOrchestrationSkillsStatus(targets)).rejects.toThrow(
      "Orchestration skill path must be a directory",
    );
    expect(await fs.readFile(path.join(external, "content", "SKILL.md"), "utf8")).toBe("outside");
  });
});

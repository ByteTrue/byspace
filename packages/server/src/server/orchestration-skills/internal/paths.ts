import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SkillTargets } from "./operations.js";

export function resolveBundledSkillsDir(moduleUrl: string | URL = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [
    path.resolve(moduleDir, "..", "..", "..", "skills"),
    path.resolve(moduleDir, "..", "..", "..", "..", "..", "..", "skills"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export function resolveSkillTargets(home: string = os.homedir()): SkillTargets {
  return {
    sourceDir: resolveBundledSkillsDir(),
    // Codex reads ~/.agents/skills as a skill root, so it needs no directory of
    // its own. Writing one planted a directory in the home of every user who
    // installed the skills, including users who never run Codex.
    agentsDir: path.join(home, ".agents", "skills"),
    claudeDir: path.join(home, ".claude", "skills"),
    retiredDirs: [path.join(home, ".codex", "skills")],
  };
}

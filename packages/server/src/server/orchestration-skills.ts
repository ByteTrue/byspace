import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonFileAtomic } from "./atomic-file.js";

import type {
  OrchestrationSkillItemState,
  OrchestrationSkillTargetKind,
  OrchestrationSkillsState,
} from "@bytetrue/byspace-protocol/messages";

export const BYSPACE_ORCHESTRATION_SKILL_NAMES = [
  "byspace",
  "byspace-advisor",
  "byspace-committee",
  "byspace-handoff",
  "byspace-project-setup",
] as const;

export const ORCHESTRATION_SKILL_TARGET_KINDS: readonly OrchestrationSkillTargetKind[] = [
  "agents",
  "claude",
] as const;

export type { OrchestrationSkillTargetKind, OrchestrationSkillsState };

export interface OrchestrationSkillsTargets {
  sourceDir: string;
  installDirsByKind: Record<OrchestrationSkillTargetKind, string>;
  installDirs: readonly string[];
  manifestPath: string;
}

export type OrchestrationSkillItemStatus = OrchestrationSkillItemState;

export interface OrchestrationSkillsStatusResult {
  state: OrchestrationSkillsState;
  skills: OrchestrationSkillItemStatus[];
  installedTargets: OrchestrationSkillTargetKind[];
}

export interface SetOrchestrationSkillsInstalledOptions {
  installed: boolean;
  skillNames?: readonly string[];
  targets?: readonly OrchestrationSkillTargetKind[];
}

export type SetOrchestrationSkillsInstalledInput = boolean | SetOrchestrationSkillsInstalledOptions;
interface OrchestrationSkillsManifest {
  version: 1;
  managed: Record<string, string>;
}

const ORCHESTRATION_SKILL_IGNORED_PATH_NAMES = new Set([
  ".git",
  ".pi-subagents",
  ".venv",
  "evals",
  "node_modules",
  "target",
]);

function isRuntimeSkillPath(relativePath: string): boolean {
  return relativePath
    .split(path.sep)
    .every((part) => !ORCHESTRATION_SKILL_IGNORED_PATH_NAMES.has(part));
}

export function resolveOrchestrationSkillsTargets(
  byspaceHome: string,
  userHome = process.env.BYSPACE_ORCHESTRATION_SKILLS_HOME ?? os.homedir(),
): OrchestrationSkillsTargets {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packagedSourceDir = path.resolve(moduleDir, "../../skills");
  const checkoutSourceDir = path.resolve(moduleDir, "../../../../skills");
  const home = userHome;
  const agentsDir = path.join(home, ".agents", "skills");
  const claudeDir = path.join(home, ".claude", "skills");
  const installDirsByKind: Record<OrchestrationSkillTargetKind, string> = {
    agents: agentsDir,
    claude: claudeDir,
  };
  return {
    sourceDir:
      process.env.BYSPACE_NODE_ENV === "development" ? checkoutSourceDir : packagedSourceDir,
    installDirsByKind,
    installDirs: [agentsDir, claudeDir],
    manifestPath: path.join(byspaceHome, "managed-orchestration-skills.json"),
  };
}

async function hashDirectory(directory: string): Promise<string | null> {
  const stat = await fs.lstat(directory).catch(() => null);
  if (!stat) return null;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Orchestration skill path must be a directory: ${directory}`);
  }

  const hash = createHash("sha256");
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativeFsPath = path.relative(directory, fullPath);
      if (!isRuntimeSkillPath(relativeFsPath)) continue;
      const relativePath = relativeFsPath.split(path.sep).join("/");
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        hash.update(relativePath);
        hash.update("\0");
        hash.update(await fs.readFile(fullPath));
        hash.update("\0");
      } else {
        throw new Error(`Unsupported file in orchestration skill: ${fullPath}`);
      }
    }
  }
  await walk(directory);
  return hash.digest("hex");
}

async function readManifest(manifestPath: string): Promise<OrchestrationSkillsManifest> {
  const raw = await fs.readFile(manifestPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (raw === null) return { version: 1, managed: {} };

  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { managed?: unknown }).managed !== "object" ||
    (parsed as { managed?: unknown }).managed === null
  ) {
    throw new Error(`Invalid orchestration skills manifest: ${manifestPath}`);
  }
  const managed = (parsed as { managed: Record<string, unknown> }).managed;
  if (Object.values(managed).some((digest) => typeof digest !== "string")) {
    throw new Error(`Invalid orchestration skills manifest: ${manifestPath}`);
  }
  return { version: 1, managed: managed as Record<string, string> };
}

async function writeManifest(
  manifestPath: string,
  manifest: OrchestrationSkillsManifest,
): Promise<void> {
  await writeJsonFileAtomic(manifestPath, manifest);
  await fs.chmod(manifestPath, 0o600);
}

function resolveTargetsInstallDirsByKind(
  targets: OrchestrationSkillsTargets,
): Record<OrchestrationSkillTargetKind, string> {
  if (targets.installDirsByKind) return targets.installDirsByKind;
  return {
    agents: targets.installDirs[0] ?? "",
    claude: targets.installDirs[1] ?? "",
  };
}

async function readSkillDescription(sourceDir: string, name: string): Promise<string> {
  const filePath = path.join(sourceDir, name, "SKILL.md");
  const content = await fs.readFile(filePath, "utf8").catch(() => null);
  if (!content) return "";
  const match = content.match(/^description:\s*(.+)$/m);
  if (!match) return "";
  let desc = match[1].trim();
  if (
    (desc.startsWith('"') && desc.endsWith('"')) ||
    (desc.startsWith("'") && desc.endsWith("'"))
  ) {
    desc = desc.slice(1, -1);
  }
  return desc;
}

export async function getOrchestrationSkillsStatus(
  targets: OrchestrationSkillsTargets,
): Promise<OrchestrationSkillsStatusResult> {
  const installDirsByKind = resolveTargetsInstallDirsByKind(targets);
  let installedCount = 0;
  let hasDrift = false;
  const skills: OrchestrationSkillItemStatus[] = [];
  const installedTargetKindsSet = new Set<OrchestrationSkillTargetKind>();

  for (const name of BYSPACE_ORCHESTRATION_SKILL_NAMES) {
    const sourceHash = await hashDirectory(path.join(targets.sourceDir, name));
    if (!sourceHash) throw new Error(`Bundled orchestration skill is missing: ${name}`);
    const description = await readSkillDescription(targets.sourceDir, name);

    const installedTargets: OrchestrationSkillTargetKind[] = [];
    let skillHasDrift = false;

    for (const kind of ORCHESTRATION_SKILL_TARGET_KINDS) {
      const installDir = installDirsByKind[kind];
      if (!installDir) continue;
      const installedHash = await hashDirectory(path.join(installDir, name));
      if (installedHash !== null) {
        installedTargets.push(kind);
        installedTargetKindsSet.add(kind);
        if (installedHash !== sourceHash) {
          skillHasDrift = true;
        }
      }
    }

    let skillState: OrchestrationSkillsState;
    if (installedTargets.length === 0) {
      skillState = "not-installed";
    } else if (skillHasDrift) {
      skillState = "drift";
      hasDrift = true;
    } else {
      skillState = "up-to-date";
    }

    installedCount += installedTargets.length;
    skills.push({
      name,
      description,
      installedTargets,
      state: skillState,
    });
  }

  const state = computeOrchestrationSkillsState(installedCount, hasDrift);
  return {
    state,
    skills,
    installedTargets: Array.from(installedTargetKindsSet),
  };
}
function computeOrchestrationSkillsState(
  installedCount: number,
  hasDrift: boolean,
): OrchestrationSkillsState {
  if (installedCount === 0) return "not-installed";
  if (hasDrift) return "drift";
  return "up-to-date";
}

async function removeDeselectedManagedSkills(
  manifest: OrchestrationSkillsManifest,
  desiredDestinations: Set<string>,
  nextManaged: Record<string, string>,
): Promise<void> {
  for (const [prevDest, prevDigest] of Object.entries(manifest.managed)) {
    if (desiredDestinations.has(prevDest)) continue;
    const currentDigest = await hashDirectory(prevDest);
    if (currentDigest !== null) {
      if (currentDigest !== prevDigest) {
        throw new Error(`Refusing to remove modified orchestration skill: ${prevDest}`);
      }
      await fs.rm(prevDest, { recursive: true, force: true });
    }
    delete nextManaged[prevDest];
  }
}
async function replaceDirectory(source: string, destination: string): Promise<void> {
  const parent = path.dirname(destination);
  const suffix = `${process.pid}-${randomUUID()}`;
  const staged = path.join(parent, `.${path.basename(destination)}.${suffix}.tmp`);
  const backup = path.join(parent, `.${path.basename(destination)}.${suffix}.bak`);
  await fs.mkdir(parent, { recursive: true });
  await fs.cp(source, staged, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (sourcePath) => isRuntimeSkillPath(path.relative(source, sourcePath)),
  });

  const destinationExists = (await fs.lstat(destination).catch(() => null)) !== null;
  let originalMoved = false;
  let installed = false;
  try {
    if (destinationExists) {
      await fs.rename(destination, backup);
      originalMoved = true;
    }
    await fs.rename(staged, destination);
    installed = true;
  } catch (error) {
    if (originalMoved && !installed) {
      try {
        await fs.rename(backup, destination);
      } catch (rollbackError) {
        throw new Error(
          `Failed to replace orchestration skill and restore backup: ${destination}. Replacement error: ${error instanceof Error ? error.message : String(error)}`,
          { cause: rollbackError },
        );
      }
    }
    throw error;
  } finally {
    if (!installed) await fs.rm(staged, { recursive: true, force: true }).catch(() => undefined);
  }
  if (originalMoved) await fs.rm(backup, { recursive: true, force: true });
}

function resolveSelectedSkills(skillNames?: readonly string[]): readonly string[] {
  if (skillNames === undefined) return BYSPACE_ORCHESTRATION_SKILL_NAMES;
  return skillNames.filter((name) =>
    (BYSPACE_ORCHESTRATION_SKILL_NAMES as readonly string[]).includes(name),
  );
}

function resolveSelectedTargets(
  targets?: readonly OrchestrationSkillTargetKind[],
): readonly OrchestrationSkillTargetKind[] {
  if (targets === undefined) return ORCHESTRATION_SKILL_TARGET_KINDS;
  return targets.filter((k) => (ORCHESTRATION_SKILL_TARGET_KINDS as readonly string[]).includes(k));
}

async function collectDesiredSkillInstallations(
  targets: OrchestrationSkillsTargets,
  selectedSkills: readonly string[],
  selectedTargetKinds: readonly OrchestrationSkillTargetKind[],
  manifest: OrchestrationSkillsManifest,
): Promise<{
  desiredDestinations: Set<string>;
  pending: Array<{ source: string; destination: string; digest: string }>;
  nextManaged: Record<string, string>;
}> {
  const installDirsByKind = resolveTargetsInstallDirsByKind(targets);
  const nextManaged: Record<string, string> = { ...manifest.managed };
  const pending: Array<{ source: string; destination: string; digest: string }> = [];
  const desiredDestinations = new Set<string>();

  for (const name of selectedSkills) {
    const source = path.join(targets.sourceDir, name);
    const digest = await hashDirectory(source);
    if (!digest) throw new Error(`Bundled orchestration skill is missing: ${name}`);
    for (const kind of selectedTargetKinds) {
      const installDir = installDirsByKind[kind];
      if (!installDir) continue;
      const destination = path.join(installDir, name);
      desiredDestinations.add(destination);
      const installedDigest = await hashDirectory(destination);
      if (
        installedDigest !== null &&
        installedDigest !== digest &&
        !manifest.managed[destination]
      ) {
        throw new Error(`Refusing to overwrite non-BySpace orchestration skill: ${destination}`);
      }
      pending.push({ source, destination, digest });
      nextManaged[destination] = digest;
    }
  }
  return { desiredDestinations, pending, nextManaged };
}

async function installOrUpdateOrchestrationSkills(
  targets: OrchestrationSkillsTargets,
  options?: {
    skillNames?: readonly string[];
    targets?: readonly OrchestrationSkillTargetKind[];
  },
): Promise<void> {
  const selectedSkills = resolveSelectedSkills(options?.skillNames);
  const selectedTargetKinds = resolveSelectedTargets(options?.targets);
  const manifest = await readManifest(targets.manifestPath);

  const { desiredDestinations, pending, nextManaged } = await collectDesiredSkillInstallations(
    targets,
    selectedSkills,
    selectedTargetKinds,
    manifest,
  );

  if (options?.skillNames || options?.targets) {
    await removeDeselectedManagedSkills(manifest, desiredDestinations, nextManaged);
  }

  for (const item of pending) {
    if ((await hashDirectory(item.destination)) !== item.digest) {
      await replaceDirectory(item.source, item.destination);
    }
  }
  if (Object.keys(nextManaged).length === 0) {
    await fs.rm(targets.manifestPath, { force: true });
  } else {
    await writeManifest(targets.manifestPath, { version: 1, managed: nextManaged });
  }
}

async function uninstallOrchestrationSkills(
  targets: OrchestrationSkillsTargets,
  options?: {
    skillNames?: readonly string[];
    targets?: readonly OrchestrationSkillTargetKind[];
  },
): Promise<void> {
  const installDirsByKind = resolveTargetsInstallDirsByKind(targets);
  const manifest = await readManifest(targets.manifestPath);
  const targetKinds =
    options?.targets && options.targets.length > 0
      ? options.targets
      : ORCHESTRATION_SKILL_TARGET_KINDS;
  const skillNames =
    options?.skillNames && options.skillNames.length > 0
      ? options.skillNames
      : BYSPACE_ORCHESTRATION_SKILL_NAMES;

  const pending: string[] = [];
  const nextManaged = { ...manifest.managed };

  for (const name of skillNames) {
    const sourceDigest = await hashDirectory(path.join(targets.sourceDir, name));
    if (!sourceDigest) throw new Error(`Bundled orchestration skill is missing: ${name}`);
    for (const kind of targetKinds) {
      const installDir = installDirsByKind[kind];
      if (!installDir) continue;
      const destination = path.join(installDir, name);
      const installedDigest = await hashDirectory(destination);
      if (installedDigest === null) continue;
      if (installedDigest !== sourceDigest) {
        throw new Error(`Refusing to remove modified orchestration skill: ${destination}`);
      }
      if (manifest.managed[destination] || installedDigest === sourceDigest) {
        pending.push(destination);
        delete nextManaged[destination];
      }
    }
  }

  for (const destination of pending) {
    await fs.rm(destination, { recursive: true, force: true });
  }
  if (Object.keys(nextManaged).length === 0) {
    await fs.rm(targets.manifestPath, { force: true });
  } else {
    await writeManifest(targets.manifestPath, { version: 1, managed: nextManaged });
  }
}

let mutationQueue = Promise.resolve();

export function setOrchestrationSkillsInstalled(
  input: SetOrchestrationSkillsInstalledInput,
  targets: OrchestrationSkillsTargets,
): Promise<OrchestrationSkillsStatusResult> {
  const options = typeof input === "boolean" ? { installed: input } : input;
  const operation = mutationQueue.then(async () => {
    if (options.installed) {
      await installOrUpdateOrchestrationSkills(targets, options);
    } else {
      await uninstallOrchestrationSkills(targets, options);
    }
    return getOrchestrationSkillsStatus(targets);
  });
  mutationQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

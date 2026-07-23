import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonFileAtomic } from "./atomic-file.js";

export const BYSPACE_ORCHESTRATION_SKILL_NAMES = [
  "byspace",
  "byspace-advisor",
  "byspace-committee",
  "byspace-handoff",
  "byspace-loop",
] as const;

export type OrchestrationSkillsState = "not-installed" | "up-to-date" | "drift";

export interface OrchestrationSkillsTargets {
  sourceDir: string;
  installDirs: readonly string[];
  manifestPath: string;
}

interface OrchestrationSkillsManifest {
  version: 1;
  managed: Record<string, string>;
}

export function resolveOrchestrationSkillsTargets(byspaceHome: string): OrchestrationSkillsTargets {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packagedSourceDir = path.resolve(moduleDir, "../../skills");
  const checkoutSourceDir = path.resolve(moduleDir, "../../../../skills");
  const home = os.homedir();
  return {
    sourceDir:
      process.env.BYSPACE_NODE_ENV === "development" ? checkoutSourceDir : packagedSourceDir,
    installDirs: [
      path.join(home, ".agents", "skills"),
      path.join(home, ".claude", "skills"),
      path.join(home, ".codex", "skills"),
    ],
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
      const relativePath = path.relative(directory, fullPath).split(path.sep).join("/");
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

export async function getOrchestrationSkillsStatus(
  targets: OrchestrationSkillsTargets,
): Promise<OrchestrationSkillsState> {
  let installedCount = 0;
  let hasDrift = false;

  for (const name of BYSPACE_ORCHESTRATION_SKILL_NAMES) {
    const sourceHash = await hashDirectory(path.join(targets.sourceDir, name));
    if (!sourceHash) throw new Error(`Bundled orchestration skill is missing: ${name}`);
    const installedHashes = await Promise.all(
      targets.installDirs.map((directory) => hashDirectory(path.join(directory, name))),
    );
    installedCount += installedHashes.filter((hash) => hash !== null).length;
    hasDrift ||= installedHashes.some((hash) => hash !== sourceHash);
  }

  if (installedCount === 0) return "not-installed";
  return hasDrift ? "drift" : "up-to-date";
}

async function replaceDirectory(source: string, destination: string): Promise<void> {
  const parent = path.dirname(destination);
  const suffix = `${process.pid}-${randomUUID()}`;
  const staged = path.join(parent, `.${path.basename(destination)}.${suffix}.tmp`);
  const backup = path.join(parent, `.${path.basename(destination)}.${suffix}.bak`);
  await fs.mkdir(parent, { recursive: true });
  await fs.cp(source, staged, { recursive: true, errorOnExist: true, force: false });

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

async function installOrUpdateOrchestrationSkills(
  targets: OrchestrationSkillsTargets,
): Promise<void> {
  const manifest = await readManifest(targets.manifestPath);
  const nextManaged: Record<string, string> = {};
  const pending: Array<{ source: string; destination: string; digest: string }> = [];

  for (const name of BYSPACE_ORCHESTRATION_SKILL_NAMES) {
    const source = path.join(targets.sourceDir, name);
    const digest = await hashDirectory(source);
    if (!digest) throw new Error(`Bundled orchestration skill is missing: ${name}`);
    for (const installDir of targets.installDirs) {
      const destination = path.join(installDir, name);
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

  for (const item of pending) {
    if ((await hashDirectory(item.destination)) !== item.digest) {
      await replaceDirectory(item.source, item.destination);
    }
  }
  await writeManifest(targets.manifestPath, { version: 1, managed: nextManaged });
}

async function uninstallOrchestrationSkills(targets: OrchestrationSkillsTargets): Promise<void> {
  const manifest = await readManifest(targets.manifestPath);
  const pending: string[] = [];

  for (const name of BYSPACE_ORCHESTRATION_SKILL_NAMES) {
    const sourceDigest = await hashDirectory(path.join(targets.sourceDir, name));
    if (!sourceDigest) throw new Error(`Bundled orchestration skill is missing: ${name}`);
    for (const installDir of targets.installDirs) {
      const destination = path.join(installDir, name);
      const installedDigest = await hashDirectory(destination);
      if (installedDigest === null) continue;
      if (installedDigest !== sourceDigest) {
        throw new Error(`Refusing to remove modified orchestration skill: ${destination}`);
      }
      if (manifest.managed[destination] || installedDigest === sourceDigest)
        pending.push(destination);
    }
  }

  for (const destination of pending) {
    await fs.rm(destination, { recursive: true, force: true });
  }
  await fs.rm(targets.manifestPath, { force: true });
}

let mutationQueue = Promise.resolve();

export function setOrchestrationSkillsInstalled(
  installed: boolean,
  targets: OrchestrationSkillsTargets,
): Promise<OrchestrationSkillsState> {
  const operation = mutationQueue.then(async () => {
    if (installed) await installOrUpdateOrchestrationSkills(targets);
    else await uninstallOrchestrationSkills(targets);
    return getOrchestrationSkillsStatus(targets);
  });
  mutationQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AGENT_SKILL_TARGET_IDS,
  type AgentSkillSelection,
  type AgentSkillTargetId,
} from "@bytetrue/protocol/messages";
import { listFilesRecursive, removeSkill, syncSkills } from "./sync.js";

export type SkillsState = "not-installed" | "up-to-date" | "drift";

export interface SkillOp {
  kind: "add" | "update" | "delete";
  name: string;
  /**
   * Agent homes this operation writes into, or deletes from. A skill can be
   * installed in one home and removed from another in the same convergence, so
   * the targets belong to the operation rather than to the convergence.
   */
  targets: AgentSkillTargetId[];
}

/** What the user asked to have installed. `all` follows the bundle as it grows. */
export type SkillSelection = AgentSkillSelection;

/** The agent homes this daemon can write, and the subset the selection uses. */
export interface SkillTargetsStatus {
  available: AgentSkillTargetId[];
  selected: AgentSkillTargetId[];
}

export interface SkillsStatus {
  state: SkillsState;
  ops: SkillOp[];
  /** Every skill the bundle currently ships, sorted. The selectable catalog. */
  available: string[];
  /**
   * Managed skills with a directory in at least one agent home, sorted. An `add`
   * op means "missing from at least one target", so it cannot answer whether
   * there is anything on disk to delete — this can.
   */
  installed: string[];
  targets: SkillTargetsStatus;
}

export interface SkillTargets {
  sourceDir: string;
  agentsDir: string;
  claudeDir: string;
  /**
   * Agent homes BySpace used to write and no longer does. That includes Codex,
   * whose skill discovery also reads `~/.agents/skills`, so it needs no
   * directory of its own. Copies there are removed on the next convergence.
   */
  retiredDirs: readonly string[];
}

// Names the bundle used to ship. They are never selectable, but every scan still
// covers them so an older install's copies get cleaned up.
export const LEGACY_SKILL_NAMES = [
  "byspace",
  "byspace-advisor",
  "byspace-chat",
  "byspace-committee",
  "byspace-epic",
  "byspace-handoff",
  "byspace-help",
  "byspace-orchestrate",
  "byspace-orchestrator",
  "byspace-plugin",
] as const;

export interface SkillHome {
  id: AgentSkillTargetId;
  dir: string;
}

/** The homes BySpace manages, in protocol order. Both are always scannable. */
export function skillHomes(targets: SkillTargets): SkillHome[] {
  return [
    { id: "agents", dir: targets.agentsDir },
    { id: "claude", dir: targets.claudeDir },
  ];
}

/** Canonical order, deduplicated. An empty selection is a valid "write nowhere". */
export function resolveSelectedSkillTargets(
  targets: readonly AgentSkillTargetId[] | undefined,
): AgentSkillTargetId[] {
  const requested = new Set(targets);
  return AGENT_SKILL_TARGET_IDS.filter((id) => requested.has(id));
}

const ALL_SKILL_TARGETS: readonly AgentSkillTargetId[] = AGENT_SKILL_TARGET_IDS;

async function resolveHomeAliases(
  homes: readonly SkillHome[],
): Promise<Map<AgentSkillTargetId, AgentSkillTargetId>> {
  const ownerByIdentity = new Map<string, AgentSkillTargetId>();
  const aliases = new Map<AgentSkillTargetId, AgentSkillTargetId>();
  for (const home of homes) {
    const identity = await fs.realpath(home.dir).catch(() => path.resolve(home.dir));
    const owner = ownerByIdentity.get(identity);
    if (owner === undefined) {
      ownerByIdentity.set(identity, home.id);
      continue;
    }
    aliases.set(home.id, owner);
  }
  return aliases;
}

type SkillFiles = Map<string, string>;
type TargetSkills = Map<string, SkillFiles>;

/**
 * The bundle directory is the catalog. Reading it instead of a hardcoded list is
 * what makes `all` pick up skills added in a later release with no code change.
 */
async function listBundledSkills(sourceDir: string): Promise<string[]> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareStrings);
}

/** Every name BySpace owns on disk: what it ships now plus what it used to ship. */
function managedSkillNames(available: readonly string[]): string[] {
  return [...new Set([...available, ...LEGACY_SKILL_NAMES])].sort(compareStrings);
}

/** The names a convergence may create, replace, or delete. */
export async function listManagedSkillNames(sourceDir: string): Promise<string[]> {
  return managedSkillNames(await listBundledSkills(sourceDir));
}

function resolveDesiredSkills(
  selection: SkillSelection,
  available: readonly string[],
): Set<string> {
  if (selection.mode === "all") return new Set(available);
  const chosen = new Set(selection.skills);
  return new Set(available.filter((name) => chosen.has(name)));
}

async function hashSkillDir(skillDir: string): Promise<SkillFiles | null> {
  const stat = await fs.stat(skillDir).catch(() => null);
  if (!stat?.isDirectory()) return null;

  const rels = await listFilesRecursive(skillDir);
  const files: SkillFiles = new Map();
  for (const rel of rels) {
    const buf = await fs.readFile(path.join(skillDir, rel));
    const sha = createHash("sha256").update(buf).digest("hex");
    files.set(toPosix(rel), sha);
  }
  return files;
}

async function hashSkills(rootDir: string, names: readonly string[]): Promise<TargetSkills> {
  const out: TargetSkills = new Map();
  for (const name of names) {
    const files = await hashSkillDir(path.join(rootDir, name));
    if (files !== null) out.set(name, files);
  }
  return out;
}

/**
 * Homes that are the same physical directory, mapped to the first home that owns
 * it. Turning one off must not delete the other's copies, so a delete never
 * targets a home that shares its directory with a home still being written.
 */
type SkillHomeAliases = ReadonlyMap<AgentSkillTargetId, AgentSkillTargetId>;

function diff(
  bundle: TargetSkills,
  homes: readonly SkillHome[],
  disks: readonly TargetSkills[],
  names: readonly string[],
  desired: ReadonlySet<string>,
  selected: ReadonlySet<AgentSkillTargetId>,
  aliases: SkillHomeAliases,
): SkillOp[] {
  const ops: SkillOp[] = [];
  for (const name of names) {
    const b = desired.has(name) ? bundle.get(name) : undefined;
    const missing: AgentSkillTargetId[] = [];
    const changed: AgentSkillTargetId[] = [];
    const unexpected: AgentSkillTargetId[] = [];
    homes.forEach((home, index) => {
      const files = disks[index]!.get(name);
      if (b && selected.has(home.id)) {
        if (files === undefined) missing.push(home.id);
        else if (!bundleFilesMatch(b, files)) changed.push(home.id);
        return;
      }
      // A copy in a home the selection no longer targets is unwanted, whether
      // the skill stays installed elsewhere or was dropped from the bundle —
      // unless that home is the same directory as one still being written, in
      // which case deleting it would take the surviving copy with it.
      if (files !== undefined && !(aliases.get(home.id) && selected.has(aliases.get(home.id)!))) {
        unexpected.push(home.id);
      }
    });
    // Deletion first: the app reports pending removals separately, and a skill
    // can be installed in one home while being removed from another.
    if (unexpected.length > 0) ops.push({ kind: "delete", name, targets: unexpected });
    // An add carries the modified homes too: applySkills rewrites every home the
    // op names, so the op must name every home whose current bytes it replaces.
    // Otherwise a rollback cannot restore the ones it silently overwrote.
    const writes = [...missing, ...changed];
    if (writes.length > 0) {
      ops.push({ kind: missing.length > 0 ? "add" : "update", name, targets: writes });
    }
  }
  ops.sort((a, b) => compareStrings(a.name, b.name));
  return ops;
}

function hasInstalledBySpaceSkill(disks: readonly TargetSkills[]): boolean {
  return disks.some((disk) => disk.size > 0);
}

function installedSkillNames(disks: readonly TargetSkills[], names: readonly string[]): string[] {
  return names.filter((name) => disks.some((disk) => disk.has(name)));
}

function bundleFilesMatch(bundle: SkillFiles, disk: SkillFiles): boolean {
  for (const [rel, sha] of bundle) {
    if (disk.get(rel) !== sha) return false;
  }
  return true;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export async function getSkillsStatus(
  targets: SkillTargets,
  selection: SkillSelection,
  selectedTargets: readonly AgentSkillTargetId[] = ALL_SKILL_TARGETS,
): Promise<SkillsStatus> {
  const available = await listBundledSkills(targets.sourceDir);
  const names = managedSkillNames(available);
  const homes = skillHomes(targets);
  const selected = resolveSelectedSkillTargets(selectedTargets);
  const aliases = await resolveHomeAliases(homes);
  const [bundle, ...disks] = await Promise.all([
    hashSkills(targets.sourceDir, available),
    ...homes.map((home) => hashSkills(home.dir, names)),
  ]);
  const ops = diff(
    bundle,
    homes,
    disks,
    names,
    resolveDesiredSkills(selection, available),
    new Set(selected),
    aliases,
  );
  const installed = installedSkillNames(disks, names);
  const targetsStatus: SkillTargetsStatus = {
    available: homes.map((home) => home.id),
    selected,
  };

  if (!hasInstalledBySpaceSkill(disks))
    return { state: "not-installed", ops, available, installed, targets: targetsStatus };
  if (ops.length === 0)
    return { state: "up-to-date", ops, available, installed, targets: targetsStatus };
  return { state: "drift", ops, available, installed, targets: targetsStatus };
}

async function applySkills(
  targets: SkillTargets,
  selection: SkillSelection,
  selectedTargets: readonly AgentSkillTargetId[] = ALL_SKILL_TARGETS,
  initialStatus?: SkillsStatus,
): Promise<SkillsStatus> {
  const status = initialStatus ?? (await getSkillsStatus(targets, selection, selectedTargets));
  const dirs = new Map(skillHomes(targets).map((home) => [home.id, home.dir] as const));
  const dirsFor = (ids: readonly AgentSkillTargetId[]) =>
    ids.map((id) => dirs.get(id)).filter((dir): dir is string => dir !== undefined);

  // One sync per op rather than one sync over every selected home: the homes
  // written must be exactly the homes the op names, because the transaction
  // only captured those. A wider write would overwrite bytes nothing backed up.
  for (const op of status.ops) {
    if (op.kind === "delete") continue;
    await syncSkills({
      sourceDir: targets.sourceDir,
      targetDirs: dirsFor(op.targets),
      skillNames: [op.name],
    });
  }

  for (const op of status.ops) {
    if (op.kind !== "delete") continue;
    await removeSkill(op.name, dirsFor(op.targets));
  }

  // Retired agent homes are not part of the plan: they only ever lose copies,
  // and the status scan no longer reports them. Cleaning them here means the
  // first convergence after an upgrade takes the leftover directories away.
  await removeRetiredSkillCopies(targets);

  return getSkillsStatus(targets, selection, selectedTargets);
}

export async function installSkills(
  targets: SkillTargets,
  selection: SkillSelection,
  selectedTargets: readonly AgentSkillTargetId[] = ALL_SKILL_TARGETS,
  /** Apply exactly this plan instead of rescanning, so a confirmed plan is the applied plan. */
  plan?: SkillsStatus,
): Promise<SkillsStatus> {
  return applySkills(targets, selection, selectedTargets, plan);
}

export async function updateSkills(
  targets: SkillTargets,
  selection: SkillSelection,
  selectedTargets: readonly AgentSkillTargetId[] = ALL_SKILL_TARGETS,
): Promise<SkillsStatus> {
  const status = await getSkillsStatus(targets, selection, selectedTargets);
  return applySkills(targets, selection, selectedTargets, nonDestructivePlan(status));
}

function nonDestructivePlan(status: SkillsStatus): SkillsStatus {
  return { ...status, ops: status.ops.filter((op) => op.kind !== "delete") };
}

export async function autoUpdateInstalledSkills(
  targets: SkillTargets,
  selection: SkillSelection,
  selectedTargets: readonly AgentSkillTargetId[] = ALL_SKILL_TARGETS,
): Promise<SkillsStatus> {
  // Runs before the drift check: cleaning a retired agent home is not drift, so
  // an installation that is already current would otherwise keep the leftover
  // directories forever.
  await removeRetiredSkillCopies(targets);
  const status = await getSkillsStatus(targets, selection, selectedTargets);
  if (status.state !== "drift") return status;
  // Automatic maintenance may repair selected skills, but removal is an
  // interactive operation because managed directories can contain user files.
  return applySkills(targets, selection, selectedTargets, nonDestructivePlan(status));
}

export async function uninstallSkills(
  targets: SkillTargets,
  selection: SkillSelection,
  selectedTargets: readonly AgentSkillTargetId[] = ALL_SKILL_TARGETS,
): Promise<SkillsStatus> {
  const available = await listBundledSkills(targets.sourceDir);
  // Uninstall is the "remove everything BySpace put on this host" action, so it
  // sweeps every managed home even the ones the selection does not target.
  const dirs = skillHomes(targets).map((home) => home.dir);
  for (const name of managedSkillNames(available)) {
    await removeSkill(name, dirs);
  }
  await removeRetiredSkillCopies(targets);
  return getSkillsStatus(targets, selection, selectedTargets);
}

/**
 * Deletes BySpace's own copies under agent homes it no longer writes.
 *
 * Ownership is the managed-files manifest BySpace writes into every directory it
 * creates, not the skill name. A stale copy from an older BySpace release named
 * after a skill we ship now is still ours, and a user's own directory that
 * happens to share a name is not. Like every other managed-directory removal in
 * this module, the whole directory goes — including anything the user added
 * inside it. The root goes only if that leaves it empty, so a retired home
 * holding only the user's own skills survives.
 */
export async function removeRetiredSkillCopies(targets: SkillTargets): Promise<void> {
  for (const root of targets.retiredDirs) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const skillDir = path.join(root, entry.name);
      if (!entry.isDirectory()) continue;
      if (!(await hasManagedFilesManifest(skillDir))) continue;
      await fs.rm(skillDir, { recursive: true, force: true });
    }
    // rmdir fails on a non-empty directory, which is what keeps a retired home
    // in place when the user keeps their own skills in it.
    await fs.rmdir(root).catch(() => {});
  }
}

async function hasManagedFilesManifest(skillDir: string): Promise<boolean> {
  const manifest = await fs
    .stat(path.join(skillDir, ".byspace-managed-files.json"))
    .catch(() => null);
  return manifest?.isFile() === true;
}

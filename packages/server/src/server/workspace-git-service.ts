import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { LRUCache } from "lru-cache";
import type pino from "pino";
import type { ProjectCheckoutLitePayload } from "@bytetrue/byspace-protocol/messages";
import { parseGitRemoteLocation } from "@bytetrue/byspace-protocol/git-remote";
import type { CheckoutContext } from "../utils/checkout-git.js";
import {
  type BranchCheckoutResolution,
  type BranchSuggestion,
  type CheckoutSnapshotFacts,
  type CheckoutDiffCompare,
  type CheckoutDiffResult,
  getCheckoutDiff,
  getCheckoutSnapshotFacts,
  getCheckoutShortstat,
  getCheckoutStatus,
  getPullRequestStatus,
  forgeAuthStateFromError,
  listBranchSuggestions,
  resolveRepositoryDefaultBranch,
  resolveBranchCheckout,
} from "../utils/checkout-git.js";
import type {
  ForgeAuthState,
  ForgeService,
  ForgeSpecificStatusFacts,
  PullRequestMergeable,
} from "../services/forge-service.js";
import { createForgeService } from "../services/forge-registry.js";
import {
  createForgeResolver,
  type ForgeResolution,
  type ForgeResolver,
} from "../services/forge-resolver.js";
import { runGitCommand } from "../utils/run-git-command.js";
import { listBySpaceWorktrees, type BySpaceWorktreeInfo } from "../utils/worktree.js";
import { READ_ONLY_GIT_ENV } from "./checkout-git-utils.js";
import {
  buildWorkspaceGitMetadataFromSnapshot,
  type WorkspaceGitMetadata,
} from "./workspace-git-metadata.js";
import { checkoutLiteFromGitSnapshot } from "./workspace-registry-model.js";

// Auxiliary reads may reuse cached values within this window; snapshots do not expire on read.
const WORKSPACE_GIT_AUXILIARY_READ_TTL_MS = 15_000;
// Non-forced demand reads share this minimum gap; force bypasses it.
const WORKSPACE_GIT_INTERNAL_MIN_GAP_MS = 2_000;
// Heavy values (multi-MB highlighted diffs); cap aggressively. Ephemeral worktree cwds would otherwise pile up forever.
const WORKSPACE_GIT_CHECKOUT_DIFF_CACHE_MAX = 64;
// Small values (booleans, short strings, small arrays); generous cap.
const WORKSPACE_GIT_AUXILIARY_CACHE_MAX = 256;
const WORKSPACE_GIT_FACTS_REUSE_TTL_MS = 1_000;

export interface WorkspaceGitRuntimeSnapshot {
  cwd: string;
  git: {
    isGit: boolean;
    repoRoot: string | null;
    mainRepoRoot: string | null;
    currentBranch: string | null;
    /** Opaque identity for the inputs used by checkout.commits.list. */
    commitsVersion?: string;
    remoteUrl: string | null;
    isBySpaceOwnedWorktree: boolean;
    isDirty: boolean | null;
    baseRef: string | null;
    aheadBehind: { ahead: number; behind: number } | null;
    aheadOfOrigin: number | null;
    behindOfOrigin: number | null;
    hasRemote: boolean;
    diffStat: { additions: number; deletions: number } | null;
  };
  forge: {
    featuresEnabled: boolean;
    authState: ForgeAuthState;
    /**
     * Forge resolved for this workspace from its remote — including the per-host
     * probe, so self-managed GitLab hosts (no "gitlab" in the name) are labeled
     * correctly. The wire projection prefers this over the bare name heuristic.
     */
    forge?: string;
    pullRequest: {
      number?: number;
      repoOwner?: string;
      repoName?: string;
      projectPath?: string;
      url: string;
      title: string;
      state: string;
      baseRefName: string;
      headRefName: string;
      isMerged: boolean;
      isDraft?: boolean;
      mergeable?: PullRequestMergeable;
      checks?: Array<{
        name: string;
        status: "success" | "failure" | "pending" | "skipped" | "cancelled";
        url: string | null;
        workflow?: string;
        duration?: string;
      }>;
      checksStatus?: "none" | "pending" | "success" | "failure";
      reviewDecision?: "approved" | "changes_requested" | "pending" | null;
      forgeSpecific?: ForgeSpecificStatusFacts;
    } | null;
    error: { message: string } | null;
  };
}

export interface WorkspaceGitService {
  registerWorkspace(
    params: { cwd: string },
    listener: WorkspaceGitListener,
  ): WorkspaceGitSubscription;

  onSnapshotUpdated(listener: WorkspaceGitSnapshotUpdatedListener): WorkspaceGitSubscription;
  peekSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot | null;
  getCheckout(cwd: string): Promise<ProjectCheckoutLitePayload>;
  getSnapshot(
    cwd: string,
    options?: WorkspaceGitSnapshotOptions,
  ): Promise<WorkspaceGitRuntimeSnapshot>;
  resolveForge(cwd: string): Promise<ForgeResolution | null>;
  getCheckoutDiff(
    cwd: string,
    options: CheckoutDiffCompare,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<CheckoutDiffResult>;
  validateBranchRef(
    cwd: string,
    ref: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchValidationResult>;
  hasLocalBranch(cwd: string, branch: string, options?: WorkspaceGitReadOptions): Promise<boolean>;
  suggestBranchesForCwd(
    cwd: string,
    options?: WorkspaceGitBranchSuggestionsOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchSuggestion[]>;
  listStashes(
    cwd: string,
    options?: WorkspaceGitStashListOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitStashEntry[]>;
  listWorktrees(
    cwdOrRepoRoot: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitWorktreeInfo[]>;
  invalidateWorktreeLists?(): void;
  getWorkspaceGitMetadata(
    cwd: string,
    options?: WorkspaceGitReadOptions & { directoryName?: string },
  ): Promise<WorkspaceGitMetadata>;
  resolveRepoRoot(cwd: string, options?: WorkspaceGitReadOptions): Promise<string>;
  resolveDefaultBranch(cwdOrRepoRoot: string, options?: WorkspaceGitReadOptions): Promise<string>;
  resolveRepoRemoteUrl(cwd: string, options?: WorkspaceGitReadOptions): Promise<string | null>;
  invalidateForge(cwd: string): void;
  getMetrics(): WorkspaceGitServiceMetrics;
  dispose(): void;
}

export interface WorkspaceGitServiceMetrics {
  workspaceTargetCount: number;
  workspaceListenerCount: number;
  workspaceRefreshInFlightCount: number;
  workspaceRefreshQueuedCount: number;
  snapshotUpdatedListenerCount: number;
}

export type WorkspaceGitListener = (snapshot: WorkspaceGitRuntimeSnapshot) => void;
export type WorkspaceGitSnapshotUpdatedListener = (snapshot: WorkspaceGitRuntimeSnapshot) => void;

export interface WorkspaceGitSubscription {
  unsubscribe: () => void;
}

export type WorkspaceGitReadOptions =
  | {
      force?: false;
      reason?: string;
    }
  | {
      force: true;
      reason: string;
    };

export interface WorkspaceGitBranchSuggestionsOptions {
  query?: string;
  limit?: number;
}

export interface WorkspaceGitStashListOptions {
  byspaceOnly?: boolean;
}

export interface WorkspaceGitStashEntry {
  index: number;
  message: string;
  branch: string | null;
  isBySpace: boolean;
}

export type WorkspaceGitBranchValidationResult = BranchCheckoutResolution;
export type WorkspaceGitBranchSuggestion = BranchSuggestion;
export type WorkspaceGitWorktreeInfo = BySpaceWorktreeInfo;

export type WorkspaceGitSnapshotOptions =
  | {
      force?: false;
      includeForge?: boolean;
      reason?: string;
    }
  | {
      force: true;
      includeForge?: boolean;
      reason: string;
    };

interface WorkspaceGitRefreshRequest {
  force: boolean;
  includeForge: boolean;
  invalidateCommits: boolean;
  reason: string;
  notify: boolean;
}

function shouldInvalidateCheckoutCommits(input: { force: boolean; reason: string }): boolean {
  return input.force;
}

type WorkspaceGitRefreshState =
  | {
      status: "idle";
    }
  | {
      status: "in-flight";
      promise: Promise<WorkspaceGitRuntimeSnapshot>;
      force: boolean;
      includeForge: boolean;
      invalidateCommits: boolean;
      queued: WorkspaceGitRefreshRequest | null;
    };

interface WorkspaceGitServiceDependencies {
  getCheckoutSnapshotFacts: typeof getCheckoutSnapshotFacts;
  getCheckoutStatus: typeof getCheckoutStatus;
  getCheckoutShortstat: typeof getCheckoutShortstat;
  getCheckoutDiff: typeof getCheckoutDiff;
  getPullRequestStatus: typeof getPullRequestStatus;
  resolveBranchCheckout: typeof resolveBranchCheckout;
  resolveRepositoryDefaultBranch: typeof resolveRepositoryDefaultBranch;
  listBranchSuggestions: typeof listBranchSuggestions;
  listBySpaceWorktrees: typeof listBySpaceWorktrees;
  /**
   * Adapter instances to bind by forge id instead of building from the registry
   * — the injection seam for the daemon's shared GitHub adapter and for test
   * fakes. Any forge not listed here is built (and cached once) by the registry.
   */
  forgeOverrides?: Record<string, ForgeService>;
  runGitCommand: typeof runGitCommand;
  now: () => Date;
}

interface WorkspaceGitServiceOptions {
  logger: pino.Logger;
  byspaceHome: string;
  worktreesRoot?: string;
  deps?: Partial<WorkspaceGitServiceDependencies>;
}

interface WorkspaceGitTarget {
  cwd: string;
  listeners: Set<WorkspaceGitListener>;
  refreshState: WorkspaceGitRefreshState;
  latestGit: WorkspaceGitRuntimeSnapshot["git"] | null;
  latestForge: WorkspaceGitRuntimeSnapshot["forge"] | null;
  latestSnapshot: WorkspaceGitRuntimeSnapshot | null;
  latestFacts: CheckoutSnapshotFacts | null;
  latestFactsLoadedAtMs: number | null;
  factsPromise: Promise<CheckoutSnapshotFacts> | null;
  commitsVersion: string | null;
  commitsIdentity: string | null;
  latestFingerprint: string | null;
  lastShellOutAtMs: number | null;
  closed: boolean;
}

interface WorkspaceGitAuxiliaryReadCacheEntry<T> {
  value: T | null;
  loadedAtMs: number | null;
  lastShellOutAtMs: number | null;
  inFlight: Promise<T> | null;
}

function buildDefaultWorkspaceGitServiceDeps(): WorkspaceGitServiceDependencies {
  return {
    getCheckoutSnapshotFacts,
    getCheckoutStatus,
    getCheckoutShortstat,
    getCheckoutDiff,
    getPullRequestStatus,
    resolveBranchCheckout,
    resolveRepositoryDefaultBranch,
    listBranchSuggestions,
    listBySpaceWorktrees,
    runGitCommand,
    now: () => new Date(),
  };
}

function resolveWorkspaceGitServiceDeps(
  deps: Partial<WorkspaceGitServiceDependencies> | undefined,
): WorkspaceGitServiceDependencies {
  return { ...buildDefaultWorkspaceGitServiceDeps(), ...deps };
}

export class WorkspaceGitServiceImpl implements WorkspaceGitService {
  private readonly logger: pino.Logger;
  private readonly byspaceHome: string;
  private readonly worktreesRoot: string | undefined;
  private readonly deps: WorkspaceGitServiceDependencies;
  private readonly forgeResolver: ForgeResolver;
  private readonly snapshotUpdatedListeners = new Set<WorkspaceGitSnapshotUpdatedListener>();
  private readonly workspaceTargets = new Map<string, WorkspaceGitTarget>();
  private readonly branchValidationCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitBranchValidationResult>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly localBranchCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<boolean>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly branchSuggestionsCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitBranchSuggestion[]>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly stashListCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitStashEntry[]>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly worktreeListCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitWorktreeInfo[]>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly defaultBranchCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<string>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly checkoutDiffCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<CheckoutDiffResult>
  >({ max: WORKSPACE_GIT_CHECKOUT_DIFF_CACHE_MAX });
  constructor(options: WorkspaceGitServiceOptions) {
    this.logger = options.logger.child({ module: "workspace-git-service" });
    this.byspaceHome = options.byspaceHome;
    this.worktreesRoot = options.worktreesRoot;
    this.deps = resolveWorkspaceGitServiceDeps(options.deps);
    this.forgeResolver = createForgeResolver({
      createService: (forge) => this.deps.forgeOverrides?.[forge] ?? createForgeService(forge),
    });
  }

  resolveForge(cwd: string): Promise<ForgeResolution | null> {
    return this.forgeResolver.resolve(resolve(cwd));
  }

  registerWorkspace(
    params: { cwd: string },
    listener: WorkspaceGitListener,
  ): WorkspaceGitSubscription {
    const cwd = resolve(params.cwd);
    const target = this.ensureWorkspaceTarget(cwd);
    target.listeners.add(listener);

    return {
      unsubscribe: () => {
        this.removeWorkspaceListener(cwd, listener);
      },
    };
  }

  onSnapshotUpdated(listener: WorkspaceGitSnapshotUpdatedListener): WorkspaceGitSubscription {
    this.snapshotUpdatedListeners.add(listener);
    return {
      unsubscribe: () => {
        this.snapshotUpdatedListeners.delete(listener);
      },
    };
  }

  getMetrics(): WorkspaceGitServiceMetrics {
    let workspaceListenerCount = 0;
    let workspaceRefreshInFlightCount = 0;
    let workspaceRefreshQueuedCount = 0;
    for (const target of this.workspaceTargets.values()) {
      workspaceListenerCount += target.listeners.size;
      if (target.refreshState.status === "in-flight") {
        workspaceRefreshInFlightCount += 1;
        if (target.refreshState.queued) workspaceRefreshQueuedCount += 1;
      }
    }
    return {
      workspaceTargetCount: this.workspaceTargets.size,
      workspaceListenerCount,
      workspaceRefreshInFlightCount,
      workspaceRefreshQueuedCount,
      snapshotUpdatedListenerCount: this.snapshotUpdatedListeners.size,
    };
  }

  async getSnapshot(
    cwd: string,
    options?: WorkspaceGitSnapshotOptions,
  ): Promise<WorkspaceGitRuntimeSnapshot> {
    cwd = resolve(cwd);
    const request = this.normalizeRefreshRequest(options, "getSnapshot", true);
    const target = this.ensureWorkspaceTarget(cwd);
    if (!request.force && target.latestSnapshot) {
      return target.latestSnapshot;
    }

    return this.requestWorkspaceSnapshot(target, request);
  }

  async getCheckout(cwd: string): Promise<ProjectCheckoutLitePayload> {
    const normalizedCwd = resolve(cwd);
    try {
      const status = await this.deps.getCheckoutStatus(normalizedCwd, {
        byspaceHome: this.byspaceHome,
        worktreesRoot: this.worktreesRoot,
        logger: this.logger,
      });
      if (!status.isGit) {
        return checkoutLiteFromGitSnapshot(normalizedCwd, {
          isGit: false,
          currentBranch: null,
          remoteUrl: null,
          repoRoot: null,
          isBySpaceOwnedWorktree: false,
          mainRepoRoot: null,
        });
      }
      return checkoutLiteFromGitSnapshot(normalizedCwd, {
        isGit: true,
        currentBranch: status.currentBranch,
        remoteUrl: status.remoteUrl,
        repoRoot: status.repoRoot,
        isBySpaceOwnedWorktree: status.isBySpaceOwnedWorktree,
        mainRepoRoot: status.mainRepoRoot,
      });
    } catch {
      return checkoutLiteFromGitSnapshot(normalizedCwd, {
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        repoRoot: null,
        isBySpaceOwnedWorktree: false,
        mainRepoRoot: null,
      });
    }
  }

  peekSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot | null {
    cwd = resolve(cwd);
    return this.workspaceTargets.get(cwd)?.latestSnapshot ?? null;
  }

  getCheckoutDiff(
    cwd: string,
    options: CheckoutDiffCompare,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<CheckoutDiffResult> {
    const normalizedCwd = resolve(cwd);
    const normalizedOptions = this.normalizeCheckoutDiffOptions(options);
    const key = this.buildCheckoutDiffCacheKey(normalizedCwd, normalizedOptions);
    return this.readAuxiliaryCache(this.checkoutDiffCache, key, readOptions, () =>
      this.deps.getCheckoutDiff(normalizedCwd, normalizedOptions, {
        byspaceHome: this.byspaceHome,
        worktreesRoot: this.worktreesRoot,
      }),
    );
  }

  private normalizeCheckoutDiffOptions(options: CheckoutDiffCompare): CheckoutDiffCompare {
    return {
      mode: options.mode,
      ...(options.mode === "base" && options.baseRef !== undefined
        ? { baseRef: options.baseRef }
        : {}),
      ...(options.ignoreWhitespace === true ? { ignoreWhitespace: true } : {}),
      ...(options.includeStructured === true ? { includeStructured: true } : {}),
    };
  }

  private buildCheckoutDiffCacheKey(cwd: string, options: CheckoutDiffCompare): string {
    // Diff content varies by compare signature. Keep the cache per exact diff read shape so
    // hot diff panes coalesce while base refs and rendering options never share stale patches.
    return JSON.stringify([
      "checkout-diff",
      cwd,
      options.mode,
      options.mode === "base" ? (options.baseRef ?? null) : null,
      options.ignoreWhitespace === true,
      options.includeStructured === true,
    ]);
  }

  validateBranchRef(
    cwd: string,
    ref: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchValidationResult> {
    const normalizedCwd = resolve(cwd);
    const normalizedRef = ref.trim();
    const key = JSON.stringify(["branch-validation", normalizedCwd, normalizedRef]);
    return this.readAuxiliaryCache(this.branchValidationCache, key, options, () =>
      this.deps.resolveBranchCheckout(normalizedCwd, normalizedRef),
    );
  }

  hasLocalBranch(cwd: string, branch: string, options?: WorkspaceGitReadOptions): Promise<boolean> {
    const normalizedCwd = resolve(cwd);
    const normalizedBranch = branch.trim();
    const ref = `refs/heads/${normalizedBranch}`;
    const key = JSON.stringify(["local-branch", normalizedCwd, ref]);
    return this.readAuxiliaryCache(this.localBranchCache, key, options, async () => {
      const result = await this.deps.runGitCommand(["rev-parse", "--verify", "--quiet", ref], {
        cwd: normalizedCwd,
        envOverlay: READ_ONLY_GIT_ENV,
        acceptExitCodes: [0, 1],
      });
      return result.exitCode === 0;
    });
  }

  suggestBranchesForCwd(
    cwd: string,
    options?: WorkspaceGitBranchSuggestionsOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchSuggestion[]> {
    const normalizedCwd = resolve(cwd);
    const query = options?.query ?? "";
    const limit = options?.limit;
    const key = JSON.stringify(["branch-suggestions", normalizedCwd, query, limit ?? null]);
    return this.readAuxiliaryCache(this.branchSuggestionsCache, key, readOptions, () =>
      this.deps.listBranchSuggestions(normalizedCwd, options),
    );
  }

  listStashes(
    cwd: string,
    options?: WorkspaceGitStashListOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitStashEntry[]> {
    const normalizedCwd = resolve(cwd);
    const byspaceOnly = options?.byspaceOnly !== false;
    const key = JSON.stringify(["stashes", normalizedCwd, byspaceOnly]);
    return this.readAuxiliaryCache(this.stashListCache, key, readOptions, async () => {
      const { stdout } = await this.deps.runGitCommand(["stash", "list", "--format=%gd%x00%s"], {
        cwd: normalizedCwd,
        envOverlay: READ_ONLY_GIT_ENV,
      });
      return parseWorkspaceGitStashList(stdout, { byspaceOnly });
    });
  }

  invalidateWorktreeLists(): void {
    this.worktreeListCache.clear();
  }

  async listWorktrees(
    cwdOrRepoRoot: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitWorktreeInfo[]> {
    const repoRoot = await this.resolveRepoRoot(cwdOrRepoRoot, options);
    const key = JSON.stringify(["worktrees", repoRoot]);
    return this.readAuxiliaryCache(this.worktreeListCache, key, options, () =>
      this.deps.listBySpaceWorktrees({
        cwd: repoRoot,
        byspaceHome: this.byspaceHome,
        worktreesRoot: this.worktreesRoot,
      }),
    );
  }

  async resolveRepoRoot(cwd: string, options?: WorkspaceGitReadOptions): Promise<string> {
    const snapshot = await this.getSnapshot(cwd, options);
    if (!snapshot.git.isGit) {
      throw new Error("Create worktree requires a git repository");
    }

    return snapshot.git.isBySpaceOwnedWorktree
      ? (snapshot.git.mainRepoRoot ?? snapshot.git.repoRoot ?? resolve(cwd))
      : (snapshot.git.repoRoot ?? resolve(cwd));
  }

  async resolveDefaultBranch(
    cwdOrRepoRoot: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<string> {
    const cwd = resolve(cwdOrRepoRoot);
    const key = JSON.stringify(["default-branch", cwd]);
    return this.readAuxiliaryCache(this.defaultBranchCache, key, options, async () => {
      const defaultBranch = await this.deps.resolveRepositoryDefaultBranch(cwd);
      if (!defaultBranch) {
        throw new Error("Unable to resolve repository default branch");
      }
      return defaultBranch;
    });
  }

  async getWorkspaceGitMetadata(
    cwd: string,
    options?: WorkspaceGitReadOptions & { directoryName?: string },
  ): Promise<WorkspaceGitMetadata> {
    const snapshot = await this.getSnapshot(cwd, options);
    const directoryName = options?.directoryName ?? basename(cwd) ?? cwd;
    return buildWorkspaceGitMetadataFromSnapshot({
      cwd: resolve(cwd),
      directoryName,
      isGit: snapshot.git.isGit,
      repoRoot: snapshot.git.repoRoot,
      mainRepoRoot: snapshot.git.mainRepoRoot,
      currentBranch: snapshot.git.currentBranch,
      remoteUrl: snapshot.git.remoteUrl,
    });
  }

  async resolveRepoRemoteUrl(
    cwd: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<string | null> {
    const snapshot = await this.getSnapshot(cwd, options);
    return snapshot.git.remoteUrl;
  }

  /** Drop the resolved forge adapter's cached state after an explicit git mutation. */
  invalidateForge(cwd: string): void {
    this.forgeResolver.invalidate(resolve(cwd));
  }

  dispose(): void {
    for (const target of this.workspaceTargets.values()) {
      this.closeWorkspaceTarget(target);
    }
    this.workspaceTargets.clear();
    this.snapshotUpdatedListeners.clear();
  }

  private ensureWorkspaceTarget(cwd: string): WorkspaceGitTarget {
    const existingTarget = this.workspaceTargets.get(cwd);
    if (existingTarget) {
      return existingTarget;
    }

    return this.createWorkspaceTarget(cwd);
  }

  private readAuxiliaryCache<T>(
    cache: LRUCache<string, WorkspaceGitAuxiliaryReadCacheEntry<T>>,
    key: string,
    options: WorkspaceGitReadOptions | undefined,
    load: () => Promise<T>,
  ): Promise<T> {
    if (options?.force && !options.reason) {
      throw new Error("WorkspaceGitService forced read requires a reason");
    }

    const entry = this.ensureAuxiliaryCacheEntry(cache, key);
    const nowMs = this.deps.now().getTime();
    if (!options?.force && entry.value !== null && entry.loadedAtMs !== null) {
      const ageMs = nowMs - entry.loadedAtMs;
      if (ageMs <= WORKSPACE_GIT_AUXILIARY_READ_TTL_MS) {
        return Promise.resolve(entry.value);
      }
      if (
        entry.lastShellOutAtMs !== null &&
        nowMs - entry.lastShellOutAtMs < WORKSPACE_GIT_INTERNAL_MIN_GAP_MS
      ) {
        return Promise.resolve(entry.value);
      }
    }

    if (entry.inFlight) {
      return entry.inFlight;
    }

    entry.lastShellOutAtMs = nowMs;
    entry.inFlight = load()
      .then((value) => {
        entry.value = value;
        entry.loadedAtMs = this.deps.now().getTime();
        return value;
      })
      .finally(() => {
        entry.inFlight = null;
      });
    return entry.inFlight;
  }

  private ensureAuxiliaryCacheEntry<T>(
    cache: LRUCache<string, WorkspaceGitAuxiliaryReadCacheEntry<T>>,
    key: string,
  ): WorkspaceGitAuxiliaryReadCacheEntry<T> {
    const existing = cache.get(key);
    if (existing) {
      return existing;
    }

    const entry: WorkspaceGitAuxiliaryReadCacheEntry<T> = {
      value: null,
      loadedAtMs: null,
      lastShellOutAtMs: null,
      inFlight: null,
    };
    cache.set(key, entry);
    return entry;
  }

  private createWorkspaceTarget(cwd: string): WorkspaceGitTarget {
    const target: WorkspaceGitTarget = {
      cwd,
      listeners: new Set(),
      refreshState: { status: "idle" },
      latestGit: null,
      latestForge: null,
      latestSnapshot: null,
      latestFacts: null,
      latestFactsLoadedAtMs: null,
      factsPromise: null,
      commitsVersion: null,
      commitsIdentity: null,
      latestFingerprint: null,
      lastShellOutAtMs: null,
      closed: false,
    };
    this.workspaceTargets.set(cwd, target);
    return target;
  }

  private loadCheckoutFacts(
    target: WorkspaceGitTarget,
    options: CheckoutContext & { allowRecent: boolean },
  ): Promise<CheckoutSnapshotFacts> {
    if (options.allowRecent && target.latestFacts && target.latestFactsLoadedAtMs !== null) {
      const ageMs = this.deps.now().getTime() - target.latestFactsLoadedAtMs;
      if (ageMs < WORKSPACE_GIT_FACTS_REUSE_TTL_MS) {
        return Promise.resolve(target.latestFacts);
      }
    }

    if (target.factsPromise) {
      return target.factsPromise;
    }

    const { allowRecent: _allowRecent, ...context } = options;
    const promise = this.deps
      .getCheckoutSnapshotFacts(target.cwd, context)
      .then((facts) => {
        target.latestFacts = facts;
        target.latestFactsLoadedAtMs = this.deps.now().getTime();
        return facts;
      })
      .finally(() => {
        if (target.factsPromise === promise) {
          target.factsPromise = null;
        }
      });
    target.factsPromise = promise;
    return promise;
  }

  private requestWorkspaceSnapshot(
    target: WorkspaceGitTarget,
    request: WorkspaceGitRefreshRequest,
  ): Promise<WorkspaceGitRuntimeSnapshot> {
    if (target.refreshState.status === "in-flight") {
      const needsForgeRefresh = request.includeForge && !target.refreshState.includeForge;
      const needsCommitInvalidation =
        request.invalidateCommits &&
        (!target.refreshState.invalidateCommits || request.reason === "repo-fetch");
      if (request.force || needsForgeRefresh || needsCommitInvalidation) {
        target.refreshState.queued = this.mergeRefreshRequests(target.refreshState.queued, request);
      }
      return target.refreshState.promise;
    }

    if (
      !request.force &&
      !request.invalidateCommits &&
      this.shouldThrottleNonForcedRefresh(target)
    ) {
      return Promise.resolve(target.latestSnapshot);
    }

    const promise = this.runWorkspaceRefreshLoop(target, request).finally(() => {
      const state = target.refreshState;
      if (state.status === "in-flight" && state.promise === promise) {
        target.refreshState = { status: "idle" };
      }
    });
    target.refreshState = {
      status: "in-flight",
      promise,
      force: request.force,
      includeForge: request.includeForge,
      invalidateCommits: request.invalidateCommits,
      queued: null,
    };

    return promise;
  }

  private normalizeRefreshRequest(
    options: WorkspaceGitSnapshotOptions | undefined,
    defaultReason: string,
    notify: boolean,
  ): WorkspaceGitRefreshRequest {
    if (options?.force && !options.reason) {
      throw new Error("WorkspaceGitService.getSnapshot force refresh requires a reason");
    }

    const force = options?.force === true;
    const reason = options?.reason ?? defaultReason;
    return {
      force,
      includeForge: options?.includeForge ?? true,
      invalidateCommits: shouldInvalidateCheckoutCommits({ force, reason }),
      reason,
      notify,
    };
  }

  private shouldThrottleNonForcedRefresh(
    target: WorkspaceGitTarget,
  ): target is WorkspaceGitTarget & {
    latestSnapshot: WorkspaceGitRuntimeSnapshot;
  } {
    if (!target.latestSnapshot || target.lastShellOutAtMs === null) {
      return false;
    }

    return this.deps.now().getTime() - target.lastShellOutAtMs < WORKSPACE_GIT_INTERNAL_MIN_GAP_MS;
  }

  private mergeRefreshRequests(
    pending: WorkspaceGitRefreshRequest | null,
    request: WorkspaceGitRefreshRequest,
  ): WorkspaceGitRefreshRequest {
    if (!pending) {
      return request;
    }

    const force = pending.force || request.force;
    const upgradesForce = request.force && !pending.force;
    const upgradesForge = request.includeForge && !pending.includeForge;
    const upgradesCommits = request.invalidateCommits && !pending.invalidateCommits;
    return {
      force,
      includeForge: pending.includeForge || request.includeForge,
      invalidateCommits: pending.invalidateCommits || request.invalidateCommits,
      reason: upgradesForce || upgradesForge || upgradesCommits ? request.reason : pending.reason,
      notify: pending.notify || request.notify,
    };
  }

  private async runWorkspaceRefreshLoop(
    target: WorkspaceGitTarget,
    initialRequest: WorkspaceGitRefreshRequest,
  ): Promise<WorkspaceGitRuntimeSnapshot> {
    let request = initialRequest;
    let snapshot!: WorkspaceGitRuntimeSnapshot;

    while (true) {
      snapshot = await this.refreshSnapshot(target, request);
      this.rememberSnapshot(target, snapshot, {
        notify: request.notify,
        forceEmit: request.force,
      });

      const state = target.refreshState;
      if (state.status !== "in-flight" || !state.queued) {
        break;
      }

      request = state.queued;
      state.queued = null;
      state.force = request.force;
      state.includeForge = request.includeForge;
      state.invalidateCommits = request.invalidateCommits;
    }

    return snapshot;
  }

  private async refreshSnapshot(
    target: WorkspaceGitTarget,
    request: WorkspaceGitRefreshRequest,
  ): Promise<WorkspaceGitRuntimeSnapshot> {
    const facts = await this.refreshGitSnapshot(target, request);
    if (request.includeForge) {
      await this.refreshForgeSnapshot(target, request, facts);
    }

    const snapshot = this.combineSnapshot(target);
    return snapshot;
  }

  private async refreshGitSnapshot(
    target: WorkspaceGitTarget,
    request: WorkspaceGitRefreshRequest,
  ): Promise<CheckoutSnapshotFacts> {
    const now = this.deps.now();
    target.lastShellOutAtMs = now.getTime();

    const cwd = target.cwd;
    const previousForgeIdentity = this.getForgeIdentity(target);
    const baseContext: CheckoutContext = {
      byspaceHome: this.byspaceHome,
      worktreesRoot: this.worktreesRoot,
      logger: this.logger,
    };
    const facts = await this.loadCheckoutFacts(target, {
      ...baseContext,
      allowRecent: !request.force,
    });
    const context: CheckoutContext = { ...baseContext, facts };
    const checkoutStatus = await this.deps.getCheckoutStatus(cwd, context);
    if (!checkoutStatus.isGit) {
      target.latestGit = buildNotGitSnapshot(cwd).git;
      target.latestForge = buildForgeUnavailableSnapshot();
      return facts;
    }

    const diffStat = await this.deps
      .getCheckoutShortstat(cwd, context, { force: request.force })
      .catch(() => null);

    const headSha = facts.isGit ? facts.pullRequestLookupTarget?.headSha : undefined;
    const commitsIdentity = headSha
      ? JSON.stringify([
          headSha,
          checkoutStatus.repoRoot,
          checkoutStatus.currentBranch,
          checkoutStatus.baseRef,
          checkoutStatus.aheadBehind,
          checkoutStatus.aheadOfOrigin,
          checkoutStatus.behindOfOrigin,
          checkoutStatus.remoteUrl,
        ])
      : null;
    if (
      commitsIdentity &&
      (commitsIdentity !== target.commitsIdentity || request.invalidateCommits)
    ) {
      target.commitsVersion = randomUUID();
    }
    target.commitsIdentity = commitsIdentity;
    if (!commitsIdentity) {
      target.commitsVersion = null;
    }
    target.latestGit = {
      isGit: true,
      repoRoot: checkoutStatus.repoRoot,
      mainRepoRoot: checkoutStatus.mainRepoRoot,
      currentBranch: checkoutStatus.currentBranch,
      ...(target.commitsVersion ? { commitsVersion: target.commitsVersion } : {}),
      remoteUrl: checkoutStatus.remoteUrl,
      isBySpaceOwnedWorktree: checkoutStatus.isBySpaceOwnedWorktree,
      isDirty: checkoutStatus.isDirty,
      baseRef: checkoutStatus.baseRef,
      aheadBehind: checkoutStatus.aheadBehind,
      aheadOfOrigin: checkoutStatus.aheadOfOrigin,
      behindOfOrigin: checkoutStatus.behindOfOrigin,
      hasRemote: checkoutStatus.hasRemote,
      diffStat,
    };
    if (previousForgeIdentity !== this.getForgeIdentity(target)) {
      target.latestForge = buildForgeUnavailableSnapshot();
    }
    return facts;
  }

  private async refreshForgeSnapshot(
    target: WorkspaceGitTarget,
    request: WorkspaceGitRefreshRequest,
    facts: CheckoutSnapshotFacts,
  ): Promise<void> {
    const remoteUrl = target.latestGit?.remoteUrl ?? null;
    const resolution = await this.forgeResolver.resolveFromRemoteUrlAsync(remoteUrl);
    // Every forge gates on the resolver alone: a cloud host matches synchronously
    // and a self-hosted/Enterprise host is recognized by the adapter probe (which
    // this async resolution populates), so GitHub Enterprise is no longer gated
    // out by a cloud-only identity check.
    if (!resolution) {
      target.latestForge = buildUnresolvedRemoteForgeSnapshot(remoteUrl);
      return;
    }
    const forgeService: ForgeService = resolution.service;
    const forceForge = request.force && request.includeForge;
    if (forceForge) {
      forgeService.invalidate({ cwd: target.cwd });
    }

    const forgeSnapshot = await loadForgeSnapshot({
      cwd: target.cwd,
      forgeService,
      now: this.deps.now(),
      deps: this.deps,
      force: forceForge,
      reason: request.reason,
      facts,
    });
    // Carry the resolved forge (probe-aware) so the wire projection labels
    // self-managed GitLab hosts correctly instead of falling back to "github".
    target.latestForge = { ...forgeSnapshot, forge: resolution.forge };
  }

  private combineSnapshot(target: WorkspaceGitTarget): WorkspaceGitRuntimeSnapshot {
    if (!target.latestGit) {
      return target.latestSnapshot ?? buildNotGitSnapshot(target.cwd);
    }

    return {
      cwd: target.cwd,
      git: target.latestGit,
      forge: target.latestForge ?? buildForgeUnavailableSnapshot(),
    };
  }

  private getForgeIdentity(target: WorkspaceGitTarget): string | null {
    const git = target.latestGit;
    if (!git?.currentBranch || !git.remoteUrl) {
      return null;
    }
    const lookup =
      target.latestFacts?.isGit && target.latestFacts.currentBranch === git.currentBranch
        ? target.latestFacts.pullRequestLookupTarget
        : null;
    return JSON.stringify([
      git.remoteUrl,
      git.currentBranch,
      lookup?.headRef ?? null,
      lookup?.headSha ?? null,
      lookup?.headRepositoryOwner ?? null,
    ]);
  }

  private rememberSnapshot(
    target: WorkspaceGitTarget,
    snapshot: WorkspaceGitRuntimeSnapshot,
    options?: { forceEmit?: boolean; notify?: boolean },
  ): void {
    target.latestSnapshot = snapshot;
    const fingerprint = JSON.stringify(snapshot);
    const fingerprintMatches = target.latestFingerprint === fingerprint;
    if (fingerprintMatches && !options?.forceEmit) {
      return;
    }
    target.latestFingerprint = fingerprint;
    if (!options?.notify || target.listeners.size === 0) {
      return;
    }
    for (const listener of target.listeners) {
      listener(snapshot);
    }
    for (const listener of this.snapshotUpdatedListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger.warn(
          { err: error, cwd: snapshot.cwd },
          "Workspace git snapshot listener threw",
        );
      }
    }
  }

  private removeWorkspaceListener(cwd: string, listener: WorkspaceGitListener): void {
    const target = this.workspaceTargets.get(cwd);
    if (!target) {
      return;
    }

    target.listeners.delete(listener);
    if (target.listeners.size > 0) {
      return;
    }

    this.removeWorkspaceTarget(target);
  }

  private removeWorkspaceTarget(target: WorkspaceGitTarget): void {
    this.closeWorkspaceTarget(target);
    this.workspaceTargets.delete(target.cwd);
  }

  private closeWorkspaceTarget(target: WorkspaceGitTarget): void {
    target.closed = true;
    target.listeners.clear();
  }
}

async function loadForgeSnapshot(options: {
  cwd: string;
  forgeService: ForgeService | null;
  now: Date;
  deps: Pick<WorkspaceGitServiceDependencies, "getPullRequestStatus">;
  force?: boolean;
  reason?: string;
  facts?: CheckoutSnapshotFacts;
}): Promise<WorkspaceGitRuntimeSnapshot["forge"]> {
  const forgeService = options.forgeService;
  if (!forgeService) {
    return buildForgeSnapshot("no_remote", null, null);
  }

  // GitHub's isAuthenticated throws the precise CLI-missing / auth error; GitLab's
  // and Gitea's return false without throwing (the precise kind surfaces from
  // the PR-status lookup below instead), so probing them here can't change the
  // outcome and would just be a wasted CLI spawn on every refresh.
  if (forgeService.authProbeCanThrow) {
    try {
      await forgeService.isAuthenticated({ cwd: options.cwd });
    } catch (error) {
      return buildForgeSnapshot(forgeAuthStateFromError(error), null, null);
    }
  }

  try {
    const result = await options.deps.getPullRequestStatus(
      options.cwd,
      forgeService,
      {
        force: options.force,
        reason: options.reason,
      },
      { facts: options.facts },
    );
    return buildForgeSnapshot(result.authState, result.status, null);
  } catch (error) {
    // The auth probe succeeded, so a failure here is a command error, not an
    // auth problem — surface it as an error while keeping features enabled.
    return buildForgeSnapshot("authenticated", null, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildForgeSnapshot(
  authState: ForgeAuthState,
  pullRequest: WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"],
  error: WorkspaceGitRuntimeSnapshot["forge"]["error"],
): WorkspaceGitRuntimeSnapshot["forge"] {
  return {
    featuresEnabled: authState === "authenticated",
    authState,
    pullRequest,
    error,
  };
}

function parseWorkspaceGitStashList(
  stdout: string,
  options: { byspaceOnly: boolean },
): WorkspaceGitStashEntry[] {
  const entries: WorkspaceGitStashEntry[] = [];
  const lines = stdout.trim().split("\n").filter(Boolean);

  for (const line of lines) {
    const sepIdx = line.indexOf("\0");
    if (sepIdx < 0) {
      continue;
    }

    const refPart = line.slice(0, sepIdx);
    const subject = line.slice(sepIdx + 1);
    const indexMatch = refPart.match(/\{(\d+)\}/);
    if (!indexMatch) {
      continue;
    }

    const index = Number(indexMatch[1]);
    const prefix = "byspace-auto-stash:";
    const prefixIdx = subject.indexOf(prefix);
    const isBySpace = prefixIdx >= 0;
    const branch = isBySpace ? subject.slice(prefixIdx + prefix.length).trim() || null : null;

    if (options.byspaceOnly && !isBySpace) {
      continue;
    }

    entries.push({ index, message: subject, branch, isBySpace });
  }

  return entries;
}

function buildNotGitSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot {
  return {
    cwd,
    git: {
      isGit: false,
      repoRoot: null,
      mainRepoRoot: null,
      currentBranch: null,
      remoteUrl: null,
      isBySpaceOwnedWorktree: false,
      isDirty: null,
      baseRef: null,
      aheadBehind: null,
      aheadOfOrigin: null,
      behindOfOrigin: null,
      hasRemote: false,
      diffStat: null,
    },
    forge: buildForgeUnavailableSnapshot(),
  };
}

function buildForgeUnavailableSnapshot(): WorkspaceGitRuntimeSnapshot["forge"] {
  return buildForgeSnapshot("no_remote", null, null);
}

/**
 * Snapshot for a remote whose host matched no registered forge and no
 * CLI-authenticated host. Deliberate choice: expose the hostname as the open
 * `forge` id with `authState: "unauthenticated"`, because a self-hosted
 * GitLab/Gitea becomes resolvable the moment its CLI is authenticated for
 * that host — so "authenticate" is the actionable next step. The trade-off:
 * a genuinely unsupported host (e.g. Bitbucket) also reads as a login
 * problem; clients that want to distinguish can check the id against the
 * forge registry.
 */
function buildUnresolvedRemoteForgeSnapshot(
  remoteUrl: string | null,
): WorkspaceGitRuntimeSnapshot["forge"] {
  const host = remoteUrl ? parseGitRemoteLocation(remoteUrl)?.host : null;
  if (!host) {
    return buildForgeUnavailableSnapshot();
  }
  return { ...buildForgeSnapshot("unauthenticated", null, null), forge: host };
}

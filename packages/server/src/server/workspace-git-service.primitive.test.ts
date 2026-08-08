import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ForgeService } from "../services/forge-service.js";
import {
  getCheckoutDiff as getCheckoutDiffUncached,
  getCheckoutSnapshotFacts as getCheckoutSnapshotFactsUncached,
  getCheckoutStatus as getCheckoutStatusUncached,
  type CheckoutDiffCompare,
  type CheckoutDiffResult,
  type CheckoutSnapshotFacts,
  type CheckoutStatusGit,
  type PullRequestStatusResult,
} from "../utils/checkout-git.js";
import {
  WorkspaceGitServiceImpl,
  type WorkspaceGitRuntimeSnapshot,
} from "./workspace-git-service.js";

const REPO_CWD = resolvePath("/tmp/repo");

function createLogger() {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    warn: vi.fn(),
  };
  return logger;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

function createCheckoutFacts(
  cwd: string,
  overrides?: Partial<Extract<CheckoutSnapshotFacts, { isGit: true }>>,
): CheckoutSnapshotFacts {
  return {
    isGit: true,
    worktreeRoot: cwd,
    currentBranch: "main",
    remoteUrl: "https://github.com/acme/repo.git",
    absoluteGitDir: join(cwd, ".git"),
    gitCommonDir: join(cwd, ".git"),
    byspaceWorktree: { isBySpaceOwnedWorktree: false },
    storedBaseRef: null,
    resolvedBaseRef: "main",
    mainRepoRoot: null,
    comparisonBaseRef: null,
    branchRemoteName: null,
    branchMergeRef: null,
    pullRequestLookupTarget: { headRef: "main" },
    ...overrides,
  };
}

function createCheckoutStatus(
  cwd: string,
  overrides?: Partial<CheckoutStatusGit>,
): CheckoutStatusGit {
  return {
    isGit: true,
    repoRoot: cwd,
    mainRepoRoot: null,
    currentBranch: "main",
    isDirty: false,
    baseRef: "main",
    aheadBehind: { ahead: 0, behind: 0 },
    aheadOfOrigin: 0,
    behindOfOrigin: 0,
    hasRemote: true,
    remoteUrl: "https://github.com/acme/repo.git",
    isBySpaceOwnedWorktree: false,
    ...overrides,
  };
}

function createPullRequestStatusResult(title = "Update feature"): PullRequestStatusResult {
  return {
    status: {
      url: "https://github.com/acme/repo/pull/123",
      title,
      state: "open",
      baseRefName: "main",
      headRefName: "feature",
      isMerged: false,
    },
    authState: "authenticated",
    featuresEnabled: true,
    githubFeaturesEnabled: true,
  };
}

interface SnapshotOverrides {
  git?: Partial<WorkspaceGitRuntimeSnapshot["git"]>;
  forge?: Partial<WorkspaceGitRuntimeSnapshot["forge"]>;
}

function createBaseSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot {
  return {
    cwd,
    git: {
      isGit: true,
      repoRoot: cwd,
      mainRepoRoot: null,
      currentBranch: "main",
      remoteUrl: "https://github.com/acme/repo.git",
      isBySpaceOwnedWorktree: false,
      isDirty: false,
      baseRef: "main",
      aheadBehind: { ahead: 0, behind: 0 },
      aheadOfOrigin: 0,
      behindOfOrigin: 0,
      hasRemote: true,
      diffStat: { additions: 1, deletions: 0 },
    },
    forge: {
      featuresEnabled: true,
      pullRequest: {
        url: "https://github.com/acme/repo/pull/123",
        title: "Update feature",
        state: "open",
        baseRefName: "main",
        headRefName: "feature",
        isMerged: false,
      },
      error: null,
    },
  };
}

function hasGithubOverride(
  overrides: SnapshotOverrides | undefined,
  key: keyof WorkspaceGitRuntimeSnapshot["forge"],
): boolean {
  return Boolean(overrides?.forge && key in overrides.forge);
}

function resolveSnapshotForge(
  base: WorkspaceGitRuntimeSnapshot,
  overrides: SnapshotOverrides | undefined,
): string | undefined {
  if (hasGithubOverride(overrides, "forge")) {
    return overrides?.forge?.forge;
  }

  const remoteUrl = overrides?.git?.remoteUrl ?? base.git.remoteUrl;
  const explicitlyUnavailable =
    overrides?.forge?.featuresEnabled === false && overrides.forge.pullRequest === null;
  if (explicitlyUnavailable || !remoteUrl) {
    return undefined;
  }

  return "github";
}

function resolveSnapshotPullRequest(
  base: WorkspaceGitRuntimeSnapshot,
  overrides: SnapshotOverrides | undefined,
): WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"] {
  if (hasGithubOverride(overrides, "pullRequest")) {
    return overrides?.forge?.pullRequest ?? null;
  }

  return base.forge.pullRequest;
}

function resolveSnapshotError(
  base: WorkspaceGitRuntimeSnapshot,
  overrides: SnapshotOverrides | undefined,
): WorkspaceGitRuntimeSnapshot["forge"]["error"] {
  if (hasGithubOverride(overrides, "error")) {
    return overrides?.forge?.error ?? null;
  }

  return base.forge.error;
}

function createSnapshot(cwd: string, overrides?: SnapshotOverrides): WorkspaceGitRuntimeSnapshot {
  const base = createBaseSnapshot(cwd);

  const featuresEnabled = overrides?.forge?.featuresEnabled ?? base.forge.featuresEnabled;
  const authState =
    overrides?.forge?.authState ?? (featuresEnabled ? "authenticated" : "no_remote");
  const forge = resolveSnapshotForge(base, overrides);
  return {
    cwd,
    git: {
      ...base.git,
      ...overrides?.git,
    },
    forge: {
      ...base.forge,
      ...overrides?.forge,
      featuresEnabled,
      authState,
      ...(forge ? { forge } : {}),
      pullRequest: resolveSnapshotPullRequest(base, overrides),
      error: resolveSnapshotError(base, overrides),
    },
  };
}

function createGitHubServiceStub(): ForgeService {
  return {
    listPullRequests: vi.fn(async () => []),
    listIssues: vi.fn(async () => []),
    searchIssuesAndPrs: vi.fn(async () => ({
      items: [],
      featuresEnabled: true,
      githubFeaturesEnabled: true,
    })),
    getPullRequest: vi.fn(async () => ({
      number: 1,
      title: "PR",
      url: "https://github.com/acme/repo/pull/1",
      state: "OPEN",
      body: null,
      baseRefName: "main",
      headRefName: "feature",
      labels: [],
    })),
    getPullRequestHeadRef: vi.fn(async () => "feature"),
    getPullRequestCheckoutTarget: vi.fn(async ({ number }) => ({
      number,
      baseRefName: "main",
      headRefName: "feature",
      headOwnerLogin: null,
      headRepositorySshUrl: null,
      headRepositoryUrl: null,
      isCrossRepository: false,
    })),
    getCurrentPullRequestStatus: vi.fn(async () => null),
    getPullRequestTimeline: vi.fn(async () => ({
      pullRequest: null,
      events: [],
    })),
    createPullRequest: vi.fn(async () => ({
      url: "https://github.com/acme/repo/pull/1",
      number: 1,
    })),
    mergePullRequest: vi.fn(async () => ({ success: true })),
    isAuthenticated: vi.fn(async () => true),
    invalidate: vi.fn(),
  };
}

interface CreateServiceOptions {
  getCheckoutSnapshotFacts?: ReturnType<typeof vi.fn>;
  getCheckoutStatus?: ReturnType<typeof vi.fn>;
  getCheckoutShortstat?: ReturnType<typeof vi.fn>;
  getPullRequestStatus?: ReturnType<typeof vi.fn>;
  getCheckoutDiff?: ReturnType<typeof vi.fn>;
  resolveBranchCheckout?: ReturnType<typeof vi.fn>;
  resolveRepositoryDefaultBranch?: ReturnType<typeof vi.fn>;
  listBranchSuggestions?: ReturnType<typeof vi.fn>;
  listBySpaceWorktrees?: ReturnType<typeof vi.fn>;
  github?: ForgeService;
  now?: () => Date;
}

function buildDefaultServiceDeps() {
  return {
    getCheckoutSnapshotFacts: vi.fn(async (cwd: string) => createCheckoutFacts(cwd)),
    getCheckoutStatus: vi.fn(async (cwd: string) => createCheckoutStatus(cwd)),
    getCheckoutShortstat: vi.fn(async () => ({
      additions: 1,
      deletions: 0,
    })),
    getPullRequestStatus: vi.fn(async () => createPullRequestStatusResult()),
    getCheckoutDiff: vi.fn(async () => ({ diff: "", structured: [] })),
    resolveBranchCheckout: vi.fn(async () => ({ kind: "not-found" })),
    resolveRepositoryDefaultBranch: vi.fn(async () => "main"),
    listBranchSuggestions: vi.fn(async () => []),
    listBySpaceWorktrees: vi.fn(async () => []),
    forgeOverrides: { github: createGitHubServiceStub() },
    now: () => new Date("2026-04-12T00:00:00.000Z"),
  };
}

function buildServiceDeps(options?: CreateServiceOptions) {
  const { github, ...rest } = options ?? {};
  const defaults = buildDefaultServiceDeps();
  return {
    ...defaults,
    ...rest,
    forgeOverrides: github ? { github } : defaults.forgeOverrides,
  };
}

function createService(options?: CreateServiceOptions) {
  return new WorkspaceGitServiceImpl({
    logger: createLogger() as never,
    byspaceHome: "/tmp/byspace-test",
    deps: buildServiceDeps(options),
  });
}

describe("WorkspaceGitServiceImpl primitive refresh entrypoint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("getSnapshot returns the current snapshot without shelling out", async () => {
    let nowMs = Date.parse("2026-04-12T00:00:00.000Z");
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });

    await expect(service.getSnapshot(REPO_CWD)).resolves.toEqual(createSnapshot(REPO_CWD));
    nowMs += 1_000;
    await expect(service.getSnapshot(REPO_CWD)).resolves.toEqual(createSnapshot(REPO_CWD));

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("getSnapshot cold-loads when no snapshot exists yet with one shell burst", async () => {
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const getCheckoutShortstat = vi.fn(async () => ({ additions: 1, deletions: 0 }));
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());
    const service = createService({
      getCheckoutStatus,
      getCheckoutShortstat,
      getPullRequestStatus,
    });

    await expect(service.getSnapshot(REPO_CWD)).resolves.toEqual(createSnapshot(REPO_CWD));

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);
    expect(getCheckoutShortstat).toHaveBeenCalledTimes(1);
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("getSnapshot reports an unresolved self-hosted remote as neutral unauthenticated", async () => {
    vi.useRealTimers();
    const previousPath = process.env.PATH;
    const emptyPathDir = mkdtempSync(join(tmpdir(), "workspace-git-no-forge-cli-"));
    process.env.PATH = emptyPathDir;
    const remoteUrl = "https://git.internal/acme/repo.git";
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());
    const service = createService({
      getCheckoutSnapshotFacts: vi.fn(async (cwd: string) =>
        createCheckoutFacts(cwd, {
          remoteUrl,
        }),
      ),
      getCheckoutStatus: vi.fn(async (cwd: string) =>
        createCheckoutStatus(cwd, {
          remoteUrl,
        }),
      ),
      getPullRequestStatus,
    });

    try {
      await expect(service.getSnapshot(REPO_CWD)).resolves.toMatchObject({
        forge: {
          featuresEnabled: false,
          authState: "unauthenticated",
          forge: "git.internal",
          pullRequest: null,
          error: null,
        },
      });
      expect(getPullRequestStatus).not.toHaveBeenCalled();
    } finally {
      service.dispose();
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
      rmSync(emptyPathDir, { recursive: true, force: true });
    }
  });

  test("forced getSnapshot bypasses the internal min-gap and re-shells", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });

    await service.getSnapshot(REPO_CWD);
    nowMs = 1;
    await service.getSnapshot(REPO_CWD, { force: true, reason: "test" });

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("forced getSnapshot emits even when the fingerprint matches", async () => {
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({ getCheckoutStatus });
    await service.getSnapshot(REPO_CWD);

    const listener = vi.fn();
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, listener);

    await service.getSnapshot(REPO_CWD, { force: true, reason: "test" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(createSnapshot(REPO_CWD));

    subscription.unsubscribe();
    service.dispose();
  });

  test("two concurrent getSnapshot calls produce one shell burst and share the result", async () => {
    const checkoutStatusDeferred = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi.fn(async () => checkoutStatusDeferred.promise);
    const service = createService({ getCheckoutStatus });

    const first = service.getSnapshot(REPO_CWD);
    const second = service.getSnapshot(join(REPO_CWD, "."));
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    checkoutStatusDeferred.resolve(createCheckoutStatus(REPO_CWD));

    await expect(Promise.all([first, second])).resolves.toEqual([
      createSnapshot(REPO_CWD),
      createSnapshot(REPO_CWD),
    ]);
    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("a forced call during an in-flight forced refresh queues a fresh re-run", async () => {
    const forcedRefresh = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi
      .fn<() => Promise<CheckoutStatusGit>>()
      .mockImplementationOnce(async () => createCheckoutStatus(REPO_CWD))
      .mockImplementationOnce(async () => forcedRefresh.promise)
      .mockImplementationOnce(async () => createCheckoutStatus(REPO_CWD, { isDirty: true }));
    const service = createService({ getCheckoutStatus });
    await service.getSnapshot(REPO_CWD);

    const first = service.getSnapshot(REPO_CWD, { force: true, reason: "test" });
    await flushPromises();
    const second = service.getSnapshot(REPO_CWD, { force: true, reason: "test" });
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    forcedRefresh.resolve(createCheckoutStatus(REPO_CWD));
    const snapshots = await Promise.all([first, second]);

    expect(getCheckoutStatus).toHaveBeenCalledTimes(3);
    expect(snapshots.map((snapshot) => snapshot.git.isDirty)).toEqual([true, true]);

    service.dispose();
  });

  test("a forced listener microtask starts a new read after the current refresh settles", async () => {
    const getCheckoutStatus = vi
      .fn<() => Promise<CheckoutStatusGit>>()
      .mockImplementationOnce(async () => createCheckoutStatus(REPO_CWD))
      .mockImplementationOnce(async () => createCheckoutStatus(REPO_CWD))
      .mockImplementationOnce(async () => createCheckoutStatus(REPO_CWD, { isDirty: true }));
    const service = createService({ getCheckoutStatus });
    await service.getSnapshot(REPO_CWD);

    let secondRefresh: Promise<WorkspaceGitRuntimeSnapshot> | null = null;
    const requestSecondRefresh = () => {
      secondRefresh ??= service.getSnapshot(REPO_CWD, {
        force: true,
        includeForge: false,
        reason: "listener-microtask",
      });
    };
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, () =>
      queueMicrotask(requestSecondRefresh),
    );

    await service.getSnapshot(REPO_CWD, {
      force: true,
      includeForge: false,
      reason: "first",
    });
    await flushPromises();
    if (!secondRefresh) {
      throw new Error("listener did not schedule the second refresh");
    }
    const snapshot = await secondRefresh;

    expect(getCheckoutStatus).toHaveBeenCalledTimes(3);
    expect(snapshot.git.isDirty).toBe(true);

    subscription.unsubscribe();
    service.dispose();
  });

  test("a queued forced refresh still runs when the current refresh fails", async () => {
    const failedRefresh = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi
      .fn<() => Promise<CheckoutStatusGit>>()
      .mockImplementationOnce(async () => createCheckoutStatus(REPO_CWD))
      .mockImplementationOnce(async () => failedRefresh.promise)
      .mockImplementationOnce(async () => createCheckoutStatus(REPO_CWD, { isDirty: true }));
    const service = createService({ getCheckoutStatus });
    await service.getSnapshot(REPO_CWD);

    const first = service.getSnapshot(REPO_CWD, { force: true, reason: "first" });
    await flushPromises();
    const second = service.getSnapshot(REPO_CWD, { force: true, reason: "second" });
    const completion = Promise.all([first, second]);

    failedRefresh.reject(new Error("first refresh failed"));
    const snapshots = await completion;

    expect(getCheckoutStatus).toHaveBeenCalledTimes(3);
    expect(snapshots.map((snapshot) => snapshot.git.isDirty)).toEqual([true, true]);

    service.dispose();
  });

  test("a forced GitHub-inclusive call during an in-flight forced git refresh queues a GitHub refresh", async () => {
    const forcedGitRefresh = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi
      .fn<() => Promise<CheckoutStatusGit>>()
      .mockImplementationOnce(async () => forcedGitRefresh.promise)
      .mockImplementation(async () => createCheckoutStatus(REPO_CWD));
    const getPullRequestStatus = vi.fn(async () =>
      createPullRequestStatusResult("Fresh validation PR"),
    );
    const service = createService({ getCheckoutStatus, getPullRequestStatus });

    const gitRefresh = service.getSnapshot(REPO_CWD, {
      force: true,
      includeForge: false,
      reason: "watch",
    });
    await flushPromises();

    const validationRefresh = service.getSnapshot(REPO_CWD, {
      force: true,
      includeForge: true,
      reason: "merge-pr-validation",
    });
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    forcedGitRefresh.resolve(createCheckoutStatus(REPO_CWD));

    await expect(validationRefresh).resolves.toEqual(
      createSnapshot(REPO_CWD, {
        forge: {
          pullRequest: {
            url: "https://github.com/acme/repo/pull/123",
            title: "Fresh validation PR",
            state: "open",
            baseRefName: "main",
            headRefName: "feature",
            isMerged: false,
          },
        },
      }),
    );
    await gitRefresh;

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);
    expect(getPullRequestStatus).toHaveBeenCalledWith(
      REPO_CWD,
      expect.anything(),
      { force: true, reason: "merge-pr-validation" },
      expect.anything(),
    );

    service.dispose();
  });

  test("non-forced getSnapshot keeps returning the current snapshot after time passes", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });
    await service.getSnapshot(REPO_CWD);

    nowMs = 16_000;
    await service.getSnapshot(REPO_CWD);

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });
});

describe("WorkspaceGitServiceImpl D2 read methods", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("validateBranchRef cold-loads, warms, forces, and coalesces per cwd/ref", async () => {
    let nowMs = 0;
    const branchResolution = createDeferred<{ kind: "local"; name: string }>();
    const resolveBranchCheckout = vi
      .fn()
      .mockImplementationOnce(async () => branchResolution.promise)
      .mockResolvedValue({ kind: "local", name: "feature" });
    const service = createService({
      resolveBranchCheckout,
      now: () => new Date(nowMs),
    });

    const first = service.validateBranchRef(REPO_CWD, "feature");
    const second = service.validateBranchRef(join(REPO_CWD, "."), "feature");
    await flushPromises();

    expect(resolveBranchCheckout).toHaveBeenCalledTimes(1);
    branchResolution.resolve({ kind: "local", name: "feature" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: "local", name: "feature" },
      { kind: "local", name: "feature" },
    ]);

    nowMs = 1_000;
    await service.validateBranchRef(REPO_CWD, "feature");
    expect(resolveBranchCheckout).toHaveBeenCalledTimes(1);

    await service.validateBranchRef(REPO_CWD, "feature", { force: true, reason: "test" });
    expect(resolveBranchCheckout).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("hasLocalBranch cold-loads, warms, forces, and coalesces per cwd/ref", async () => {
    let nowMs = 0;
    const branchLookup = createDeferred<{
      stdout: string;
      stderr: string;
      truncated: boolean;
      exitCode: number;
      signal: NodeJS.Signals | null;
    }>();
    const runGitCommand = vi
      .fn()
      .mockImplementationOnce(async () => branchLookup.promise)
      .mockResolvedValue({
        stdout: "",
        stderr: "",
        truncated: false,
        exitCode: 1,
        signal: null,
      });
    const service = createService({
      runGitCommand,
      now: () => new Date(nowMs),
    });

    const first = service.hasLocalBranch(REPO_CWD, "feature");
    const second = service.hasLocalBranch(join(REPO_CWD, "."), "feature");
    await flushPromises();

    expect(runGitCommand).toHaveBeenCalledTimes(1);
    expect(runGitCommand).toHaveBeenCalledWith(
      ["rev-parse", "--verify", "--quiet", "refs/heads/feature"],
      expect.objectContaining({
        cwd: REPO_CWD,
        acceptExitCodes: [0, 1],
      }),
    );
    branchLookup.resolve({
      stdout: "",
      stderr: "",
      truncated: false,
      exitCode: 0,
      signal: null,
    });
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);

    nowMs = 1_000;
    await expect(service.hasLocalBranch(REPO_CWD, "feature")).resolves.toBe(true);
    expect(runGitCommand).toHaveBeenCalledTimes(1);

    await expect(
      service.hasLocalBranch(REPO_CWD, "feature", { force: true, reason: "test" }),
    ).resolves.toBe(false);
    expect(runGitCommand).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("validateBranchRef serves stale cache during internal min-gap after a failed refresh", async () => {
    let nowMs = 0;
    const resolveBranchCheckout = vi
      .fn()
      .mockResolvedValueOnce({ kind: "local", name: "feature-old" })
      .mockRejectedValueOnce(new Error("git is busy"))
      .mockResolvedValue({ kind: "local", name: "feature-new" });
    const service = createService({
      resolveBranchCheckout,
      now: () => new Date(nowMs),
    });

    await expect(service.validateBranchRef(REPO_CWD, "feature")).resolves.toEqual({
      kind: "local",
      name: "feature-old",
    });

    nowMs = 16_000;
    resolveBranchCheckout.mockClear();
    await expect(service.validateBranchRef(REPO_CWD, "feature")).rejects.toThrow("git is busy");
    expect(resolveBranchCheckout).toHaveBeenCalledTimes(1);

    nowMs = 16_500;
    await expect(service.validateBranchRef(REPO_CWD, "feature")).resolves.toEqual({
      kind: "local",
      name: "feature-old",
    });
    expect(resolveBranchCheckout).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("suggestBranchesForCwd cold-loads, warms, forces, and coalesces per query", async () => {
    let nowMs = 0;
    const suggestions = [{ name: "feature", committerDate: 1, hasLocal: true, hasRemote: false }];
    const suggestionsDeferred = createDeferred<typeof suggestions>();
    const listBranchSuggestions = vi
      .fn()
      .mockImplementationOnce(async () => suggestionsDeferred.promise)
      .mockResolvedValue(suggestions);
    const service = createService({
      listBranchSuggestions,
      now: () => new Date(nowMs),
    });

    const first = service.suggestBranchesForCwd(REPO_CWD, { query: "feat", limit: 5 });
    const second = service.suggestBranchesForCwd(join(REPO_CWD, "."), {
      query: "feat",
      limit: 5,
    });
    await flushPromises();

    expect(listBranchSuggestions).toHaveBeenCalledTimes(1);
    suggestionsDeferred.resolve(suggestions);
    await expect(Promise.all([first, second])).resolves.toEqual([suggestions, suggestions]);

    nowMs = 1_000;
    await service.suggestBranchesForCwd(REPO_CWD, { query: "feat", limit: 5 });
    expect(listBranchSuggestions).toHaveBeenCalledTimes(1);

    await service.suggestBranchesForCwd(
      REPO_CWD,
      { query: "feat", limit: 5 },
      { force: true, reason: "test" },
    );
    expect(listBranchSuggestions).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("listStashes cold-loads, warms, forces, and coalesces per cwd", async () => {
    let nowMs = 0;
    const stashOutput = "stash@{0}\u0000byspace-auto-stash: feature\n";
    const stashDeferred = createDeferred<{
      stdout: string;
      stderr: string;
      truncated: boolean;
      exitCode: number;
      signal: null;
    }>();
    const runGitCommand = vi
      .fn()
      .mockImplementationOnce(async () => stashDeferred.promise)
      .mockResolvedValue({
        stdout: stashOutput,
        stderr: "",
        truncated: false,
        exitCode: 0,
        signal: null,
      });
    const service = createService({
      runGitCommand,
      now: () => new Date(nowMs),
    });

    const first = service.listStashes(REPO_CWD, { byspaceOnly: true });
    const second = service.listStashes(join(REPO_CWD, "."), { byspaceOnly: true });
    await flushPromises();

    expect(runGitCommand).toHaveBeenCalledTimes(1);
    stashDeferred.resolve({
      stdout: stashOutput,
      stderr: "",
      truncated: false,
      exitCode: 0,
      signal: null,
    });
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ index: 0, message: "byspace-auto-stash: feature", branch: "feature", isBySpace: true }],
      [{ index: 0, message: "byspace-auto-stash: feature", branch: "feature", isBySpace: true }],
    ]);

    nowMs = 1_000;
    await service.listStashes(REPO_CWD, { byspaceOnly: true });
    expect(runGitCommand).toHaveBeenCalledTimes(1);

    await service.listStashes(REPO_CWD, { byspaceOnly: true }, { force: true, reason: "test" });
    expect(runGitCommand).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("listWorktrees cold-loads, warms, forces, and coalesces per repo root", async () => {
    let nowMs = 0;
    const worktrees = [
      {
        path: "/tmp/byspace-home/worktrees/repo/feature",
        createdAt: "2026-04-12T00:00:00.000Z",
        branchName: "feature",
      },
    ];
    const listBySpaceWorktrees = vi.fn().mockResolvedValue(worktrees);
    const service = createService({
      listBySpaceWorktrees,
      now: () => new Date(nowMs),
    });

    const first = service.listWorktrees(REPO_CWD);
    const second = service.listWorktrees(join(REPO_CWD, "."));
    await expect(Promise.all([first, second])).resolves.toEqual([worktrees, worktrees]);
    expect(listBySpaceWorktrees).toHaveBeenCalledTimes(1);

    nowMs = 1_000;
    await service.listWorktrees(REPO_CWD);
    expect(listBySpaceWorktrees).toHaveBeenCalledTimes(1);

    await service.listWorktrees(REPO_CWD, { force: true, reason: "test" });
    expect(listBySpaceWorktrees).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("listWorktrees shares one repo-root scoped read across sibling workspace cwds", async () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "workspace-git-service-")));
    const repoDir = join(tempDir, "repo");
    const nestedWorkspaceDir = join(repoDir, "packages", "app");
    mkdirSync(nestedWorkspaceDir, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "pipe" });

    const worktrees = [
      {
        path: join(tempDir, "byspace-home", "worktrees", "repo", "feature"),
        createdAt: "2026-04-12T00:00:00.000Z",
        branchName: "feature",
      },
    ];
    const listBySpaceWorktrees = vi.fn(async () => worktrees);
    const service = createService({
      getCheckoutSnapshotFacts: getCheckoutSnapshotFactsUncached as never,
      getCheckoutStatus: getCheckoutStatusUncached as never,
      listBySpaceWorktrees,
    });

    try {
      await expect(
        Promise.all([service.listWorktrees(repoDir), service.listWorktrees(nestedWorkspaceDir)]),
      ).resolves.toEqual([worktrees, worktrees]);
      await expect(service.listWorktrees(nestedWorkspaceDir)).resolves.toEqual(worktrees);

      expect(listBySpaceWorktrees).toHaveBeenCalledTimes(1);
      expect(listBySpaceWorktrees).toHaveBeenCalledWith({
        cwd: realpathSync.native(repoDir).replace(/\\/g, "/"),
        byspaceHome: "/tmp/byspace-test",
      });
    } finally {
      service.dispose();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("resolveDefaultBranch cold-loads, warms, forces, and coalesces per cwd", async () => {
    let nowMs = 0;
    const defaultBranch = createDeferred<string | null>();
    const resolveRepositoryDefaultBranch = vi
      .fn()
      .mockImplementationOnce(async () => defaultBranch.promise)
      .mockResolvedValue("trunk");
    const service = createService({
      resolveRepositoryDefaultBranch,
      now: () => new Date(nowMs),
    });

    const first = service.resolveDefaultBranch(REPO_CWD);
    const second = service.resolveDefaultBranch(join(REPO_CWD, "."));
    await flushPromises();

    expect(resolveRepositoryDefaultBranch).toHaveBeenCalledTimes(1);
    defaultBranch.resolve("main");
    await expect(Promise.all([first, second])).resolves.toEqual(["main", "main"]);

    nowMs = 1_000;
    await service.resolveDefaultBranch(REPO_CWD);
    expect(resolveRepositoryDefaultBranch).toHaveBeenCalledTimes(1);

    await service.resolveDefaultBranch(REPO_CWD, { force: true, reason: "test" });
    expect(resolveRepositoryDefaultBranch).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("resolveRepoRoot cold-loads, warms, forces, and coalesces through snapshots", async () => {
    let nowMs = 0;
    const checkoutDeferred = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi
      .fn()
      .mockImplementationOnce(async () => checkoutDeferred.promise)
      .mockResolvedValue(createCheckoutStatus(REPO_CWD));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });

    const first = service.resolveRepoRoot(REPO_CWD);
    const second = service.resolveRepoRoot(join(REPO_CWD, "."));
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);
    checkoutDeferred.resolve(createCheckoutStatus(REPO_CWD));
    await expect(Promise.all([first, second])).resolves.toEqual([REPO_CWD, REPO_CWD]);

    nowMs = 1_000;
    await service.resolveRepoRoot(REPO_CWD);
    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    await service.resolveRepoRoot(REPO_CWD, { force: true, reason: "test" });
    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("resolveRepoRemoteUrl reads remote URL through the snapshot cache", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) =>
      createCheckoutStatus(cwd, {
        remoteUrl: "https://github.com/ByteTrue/byspace.git",
      }),
    );
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });

    await expect(service.resolveRepoRemoteUrl(REPO_CWD)).resolves.toBe(
      "https://github.com/ByteTrue/byspace.git",
    );
    nowMs = 1_000;
    await expect(service.resolveRepoRemoteUrl(join(REPO_CWD, "."))).resolves.toBe(
      "https://github.com/ByteTrue/byspace.git",
    );

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("getWorkspaceGitMetadata derives reconciliation metadata from the snapshot cache", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) =>
      createCheckoutStatus(cwd, {
        currentBranch: "feature/service-metadata",
        remoteUrl: "https://github.com/ByteTrue/byspace.git",
        repoRoot: REPO_CWD,
      }),
    );
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });

    await expect(
      service.getWorkspaceGitMetadata(REPO_CWD, { directoryName: "Local Repo" }),
    ).resolves.toEqual({
      projectKind: "git",
      projectDisplayName: "ByteTrue/byspace",
      workspaceDisplayName: "feature/service-metadata",
      gitRemote: "https://github.com/ByteTrue/byspace.git",
      isWorktree: false,
      mainRepoRoot: null,
      projectSlug: "byspace",
      repoRoot: REPO_CWD,
      currentBranch: "feature/service-metadata",
      remoteUrl: "https://github.com/ByteTrue/byspace.git",
    });

    nowMs = 1_000;
    await service.getWorkspaceGitMetadata(join(REPO_CWD, "."), { directoryName: "Local Repo" });
    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("getCheckoutDiff returns real staged and unstaged changes from a temp git repo", async () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "workspace-git-service-diff-")));
    const repoDir = join(tempDir, "repo");
    mkdirSync(repoDir, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], {
      cwd: repoDir,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "tracked.txt"), "before\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: repoDir, stdio: "pipe" });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
      cwd: repoDir,
      stdio: "pipe",
    });
    writeFileSync(join(repoDir, "tracked.txt"), "before\nafter\n");
    writeFileSync(join(repoDir, "staged.txt"), "staged\n");
    execFileSync("git", ["add", "staged.txt"], { cwd: repoDir, stdio: "pipe" });

    const service = createService({
      getCheckoutDiff: getCheckoutDiffUncached as never,
    });

    try {
      const diff = await service.getCheckoutDiff(repoDir, {
        mode: "uncommitted",
        includeStructured: true,
      });

      expect(diff.diff).toContain("tracked.txt");
      expect(diff.diff).toContain("staged.txt");
      expect(diff.structured?.map((file) => file.path).sort()).toEqual([
        "staged.txt",
        "tracked.txt",
      ]);
    } finally {
      service.dispose();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("getCheckoutDiff coalesces concurrent callers per cwd and compare options", async () => {
    const diffDeferred = createDeferred<CheckoutDiffResult>();
    const getCheckoutDiff = vi
      .fn<(cwd: string, compare: CheckoutDiffCompare) => Promise<CheckoutDiffResult>>()
      .mockImplementationOnce(async () => diffDeferred.promise)
      .mockResolvedValue({ diff: "second" });
    const service = createService({ getCheckoutDiff, now: () => new Date(0) });

    const first = service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" });
    const second = service.getCheckoutDiff(join(REPO_CWD, "."), { mode: "uncommitted" });
    await flushPromises();

    expect(getCheckoutDiff).toHaveBeenCalledTimes(1);
    diffDeferred.resolve({ diff: "shared" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { diff: "shared" },
      { diff: "shared" },
    ]);
    expect(getCheckoutDiff).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("forced getCheckoutDiff bypasses warm cache and internal min-gap", async () => {
    let nowMs = 0;
    const getCheckoutDiff = vi
      .fn()
      .mockResolvedValueOnce({ diff: "first" })
      .mockResolvedValueOnce({ diff: "forced" });
    const service = createService({
      getCheckoutDiff,
      now: () => new Date(nowMs),
    });

    await expect(service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" })).resolves.toEqual({
      diff: "first",
    });
    nowMs = 1;
    await expect(
      service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" }, { force: true, reason: "test" }),
    ).resolves.toEqual({ diff: "forced" });

    expect(getCheckoutDiff).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("getCheckoutDiff serves cached value within the internal min-gap for non-forced reads", async () => {
    let nowMs = 0;
    const getCheckoutDiff = vi
      .fn()
      .mockResolvedValueOnce({ diff: "first" })
      .mockRejectedValueOnce(new Error("git is busy"))
      .mockResolvedValueOnce({ diff: "second" });
    const service = createService({
      getCheckoutDiff,
      now: () => new Date(nowMs),
    });

    await expect(service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" })).resolves.toEqual({
      diff: "first",
    });
    nowMs = 16_000;
    await expect(service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" })).rejects.toThrow(
      "git is busy",
    );
    nowMs = 16_500;
    await expect(service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" })).resolves.toEqual({
      diff: "first",
    });

    expect(getCheckoutDiff).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("getCheckoutDiff uses different cache keys for different compare arguments", async () => {
    const getCheckoutDiff = vi
      .fn()
      .mockResolvedValueOnce({ diff: "main" })
      .mockResolvedValueOnce({ diff: "release" })
      .mockResolvedValueOnce({ diff: "main-whitespace" });
    const service = createService({
      getCheckoutDiff,
      now: () => new Date(0),
    });

    await expect(
      service.getCheckoutDiff(REPO_CWD, { mode: "base", baseRef: "main" }),
    ).resolves.toEqual({ diff: "main" });
    await expect(
      service.getCheckoutDiff(REPO_CWD, { mode: "base", baseRef: "release" }),
    ).resolves.toEqual({ diff: "release" });
    await expect(
      service.getCheckoutDiff(REPO_CWD, {
        mode: "base",
        baseRef: "main",
        ignoreWhitespace: true,
      }),
    ).resolves.toEqual({ diff: "main-whitespace" });

    expect(getCheckoutDiff).toHaveBeenCalledTimes(3);

    service.dispose();
  });
});

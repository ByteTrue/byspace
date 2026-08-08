import type { SubscribeCheckoutDiffRequest, SessionOutboundMessage } from "./messages.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import { expandTilde } from "../utils/path.js";
import { toCheckoutError } from "./checkout-git-utils.js";

type CheckoutDiffWorkspace = Pick<WorkspaceGitService, "getCheckoutDiff">;

export type CheckoutDiffCompareInput = SubscribeCheckoutDiffRequest["compare"];

export type CheckoutDiffSnapshotPayload = Omit<
  Extract<SessionOutboundMessage, { type: "checkout_diff_update" }>["payload"],
  "subscriptionId"
>;

export interface CheckoutDiffMetrics {
  checkoutDiffTargetCount: number;
  checkoutDiffSubscriptionCount: number;
}

interface CheckoutDiffTarget {
  key: string;
  cwd: string;
  compare: CheckoutDiffCompareInput;
  listeners: Set<(snapshot: CheckoutDiffSnapshotPayload) => void>;
  loadPromise: Promise<CheckoutDiffSnapshotPayload> | null;
  refreshPromise: Promise<void> | null;
  refreshQueued: boolean;
  latestPayload: CheckoutDiffSnapshotPayload | null;
  latestFingerprint: string | null;
}

export interface CheckoutDiffSubscriptionRequest {
  cwd: string;
  compare: CheckoutDiffCompareInput;
  signal?: AbortSignal;
}

export interface CheckoutDiffSubscription {
  initial: CheckoutDiffSnapshotPayload;
  unsubscribe: () => void;
}

export class CheckoutDiffManager {
  private readonly workspaceGitService: CheckoutDiffWorkspace;
  private readonly targets = new Map<string, CheckoutDiffTarget>();

  constructor(workspaceGitService: CheckoutDiffWorkspace) {
    this.workspaceGitService = workspaceGitService;
  }

  async subscribe(
    params: CheckoutDiffSubscriptionRequest,
    listener: (snapshot: CheckoutDiffSnapshotPayload) => void,
  ): Promise<CheckoutDiffSubscription> {
    const cwd = expandTilde(params.cwd);
    const compare = this.normalizeCompare(params.compare);
    const target = this.ensureTarget(cwd, compare);
    target.listeners.add(listener);

    let isSubscribed = true;
    const unsubscribe = () => {
      if (!isSubscribed) return;
      isSubscribed = false;
      params.signal?.removeEventListener("abort", unsubscribe);
      this.removeListener(target, listener);
    };
    params.signal?.addEventListener("abort", unsubscribe, { once: true });
    if (params.signal?.aborted) unsubscribe();

    try {
      const initial = target.latestPayload ?? (await this.loadTarget(target));
      return { initial, unsubscribe };
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  scheduleRefreshForCwd(cwd: string): void {
    const resolvedCwd = expandTilde(cwd);
    for (const target of this.targets.values()) {
      if (target.cwd === resolvedCwd) void this.refreshTarget(target);
    }
  }

  getMetrics(): CheckoutDiffMetrics {
    let checkoutDiffSubscriptionCount = 0;
    for (const target of this.targets.values()) {
      checkoutDiffSubscriptionCount += target.listeners.size;
    }
    return {
      checkoutDiffTargetCount: this.targets.size,
      checkoutDiffSubscriptionCount,
    };
  }

  dispose(): void {
    for (const target of this.targets.values()) target.listeners.clear();
    this.targets.clear();
  }

  private normalizeCompare(compare: CheckoutDiffCompareInput): CheckoutDiffCompareInput {
    const ignoreWhitespace = compare.ignoreWhitespace === true;
    if (compare.mode === "uncommitted") return { mode: "uncommitted", ignoreWhitespace };
    const trimmedBaseRef = compare.baseRef?.trim();
    return trimmedBaseRef
      ? { mode: "base", baseRef: trimmedBaseRef, ignoreWhitespace }
      : { mode: "base", ignoreWhitespace };
  }

  private buildTargetKey(cwd: string, compare: CheckoutDiffCompareInput): string {
    return JSON.stringify([
      cwd,
      compare.mode,
      compare.mode === "base" ? (compare.baseRef ?? "") : "",
      compare.ignoreWhitespace === true,
    ]);
  }

  private removeListener(
    target: CheckoutDiffTarget,
    listener: (snapshot: CheckoutDiffSnapshotPayload) => void,
  ): void {
    target.listeners.delete(listener);
    if (target.listeners.size > 0) return;
    if (this.targets.get(target.key) === target) this.targets.delete(target.key);
  }

  private async computeCheckoutDiffSnapshot(
    target: CheckoutDiffTarget,
    force = false,
  ): Promise<CheckoutDiffSnapshotPayload> {
    try {
      const diffResult = await this.workspaceGitService.getCheckoutDiff(
        target.cwd,
        {
          mode: target.compare.mode,
          baseRef: target.compare.baseRef,
          ignoreWhitespace: target.compare.ignoreWhitespace,
          includeStructured: true,
        },
        force ? { force: true, reason: "explicit-refresh" } : undefined,
      );
      if (diffResult.diffTooLarge) {
        return {
          cwd: target.cwd,
          files: [],
          diffTooLarge: true,
          error: toCheckoutError(new Error("Diff too large to display")),
        };
      }
      const files = [...(diffResult.structured ?? [])].sort((a, b) => {
        if (a.path === b.path) {
          return 0;
        }
        return a.path < b.path ? -1 : 1;
      });
      return { cwd: target.cwd, files, error: null };
    } catch (error) {
      return { cwd: target.cwd, files: [], error: toCheckoutError(error) };
    }
  }

  private loadTarget(target: CheckoutDiffTarget): Promise<CheckoutDiffSnapshotPayload> {
    target.loadPromise ??= this.computeCheckoutDiffSnapshot(target)
      .then((snapshot) => {
        target.latestPayload = snapshot;
        target.latestFingerprint = JSON.stringify(snapshot);
        return snapshot;
      })
      .finally(() => {
        target.loadPromise = null;
      });
    return target.loadPromise;
  }

  private async refreshTarget(target: CheckoutDiffTarget): Promise<void> {
    if (target.refreshPromise) {
      target.refreshQueued = true;
      return;
    }
    const loadPromise = target.loadPromise;
    target.refreshPromise = (async () => {
      if (loadPromise) await loadPromise;
      do {
        target.refreshQueued = false;
        const snapshot = await this.computeCheckoutDiffSnapshot(target, true);
        target.latestPayload = snapshot;
        const fingerprint = JSON.stringify(snapshot);
        if (fingerprint !== target.latestFingerprint) {
          target.latestFingerprint = fingerprint;
          for (const listener of target.listeners) listener(snapshot);
        }
      } while (target.refreshQueued);
    })();
    try {
      await target.refreshPromise;
    } finally {
      target.refreshPromise = null;
    }
  }

  private ensureTarget(cwd: string, compare: CheckoutDiffCompareInput): CheckoutDiffTarget {
    const key = this.buildTargetKey(cwd, compare);
    const existing = this.targets.get(key);
    if (existing) return existing;
    const target: CheckoutDiffTarget = {
      key,
      cwd,
      compare,
      listeners: new Set(),
      loadPromise: null,
      refreshPromise: null,
      refreshQueued: false,
      latestPayload: null,
      latestFingerprint: null,
    };
    this.targets.set(key, target);
    return target;
  }
}

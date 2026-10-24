import type { AgentSkillOperation, AgentSkillTargetId } from "@bytetrue/protocol/messages";
import {
  autoUpdateInstalledSkills,
  getSkillsStatus,
  installSkills,
  type SkillOp,
  type SkillSelection,
  type SkillsStatus,
  type SkillTargets,
  uninstallSkills,
  updateSkills,
} from "./operations.js";
import {
  coerceSkillNames,
  coerceSkillSelection,
  coerceSkillTargets,
  type SkillSelectionStore,
} from "./selection-store.js";
import { beginSkillsTransaction, recoverInterruptedSkillTransactions } from "./transaction.js";

/** Everything the settings UI needs to render skills in one round trip. */
export interface SkillsSnapshot extends Omit<SkillsStatus, "ops"> {
  /**
   * Wire shape: the operation's target homes stay internal. The selection's
   * `targets` already tells the client where the next convergence writes.
   */
  ops: AgentSkillOperation[];
  selection: SkillSelection;
  /**
   * Whether the user has ever chosen a selection. A `false` here is what makes
   * Install open the picker instead of installing the bundle wholesale.
   */
  selectionSaved: boolean;
}

export interface SkillsSaveResult extends SkillsSnapshot {
  /**
   * Non-null when the save did nothing because these directories would be
   * deleted and the request had not confirmed them. Retry with the names.
   */
  confirmationRequired: { removals: string[] } | null;
}

export interface SkillsController {
  status(): Promise<SkillsSnapshot>;
  install(): Promise<SkillsSnapshot>;
  update(): Promise<SkillsSnapshot>;
  uninstall(): Promise<SkillsSnapshot>;
  autoUpdate(): Promise<SkillsSnapshot>;
  save(request: unknown): Promise<SkillsSaveResult>;
  importLegacySelectionIfUnset(selection: unknown): Promise<{
    imported: boolean;
    selection: SkillSelection;
  }>;
}

type Converge = (
  targets: SkillTargets,
  selection: SkillSelection,
  selectedTargets: readonly AgentSkillTargetId[],
) => Promise<SkillsStatus>;
const MAX_SAVE_ATTEMPTS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wireOps(ops: readonly SkillOp[]): AgentSkillOperation[] {
  return ops.map(({ kind, name }) => ({ kind, name }));
}

function snapshot(
  status: SkillsStatus,
  selection: SkillSelection,
  selectionSaved: boolean,
): SkillsSnapshot {
  return { ...status, ops: wireOps(status.ops), selection, selectionSaved };
}

/**
 * The single writer for installed skills. Startup convergence and every settings
 * command run through one queue, so no operation applies a plan computed from a
 * selection another one has already replaced, and no read sees a half-applied
 * directory. Ordering between concurrent callers is not promised — consistency
 * after both finish is.
 */
export function createSkillsController({
  resolveTargets,
  selectionStore,
}: {
  // Resolved per operation, not at wiring time: the bundle path depends on how
  // the app was packaged, which is not knowable when the controller is built.
  resolveTargets: () => SkillTargets;
  selectionStore: SkillSelectionStore;
}): SkillsController {
  let queue: Promise<unknown> = Promise.resolve();

  function serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run, run);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function converge(apply: Converge): Promise<SkillsSnapshot> {
    const targets = resolveTargets();
    const selection = await selectionStore.get();
    const selectedTargets = await selectionStore.getTargets();
    await recoverInterruptedSkillTransactions(targets, selection, selectedTargets);
    const status = await apply(targets, selection, selectedTargets);
    return snapshot(status, selection, await selectionStore.isSet());
  }

  async function saveSelection(request: unknown): Promise<SkillsSaveResult> {
    const targets = resolveTargets();
    // Two shapes are accepted: `{ selection, targets?, confirmedRemovals? }` from
    // the RPC facade, and a bare selection (with optional confirmedRemovals)
    // from callers that predate the wrapper.
    const wrapped = isRecord(request) && request.mode === undefined;
    const next = coerceSkillSelection(wrapped ? request.selection : request);
    // A request that does not name targets keeps the saved ones, so an app
    // release that predates target selection cannot narrow an install.
    const nextTargets =
      wrapped && request.targets !== undefined
        ? coerceSkillTargets(request.targets)
        : await selectionStore.getTargets();
    const previous = await selectionStore.get();
    const previousTargets = await selectionStore.getTargets();
    const previouslySaved = await selectionStore.isSet();
    await recoverInterruptedSkillTransactions(targets, previous, previousTargets);
    const confirmed = new Set(
      coerceSkillNames(isRecord(request) ? request.confirmedRemovals : null),
    );

    // The plan comes from a scan taken here, inside the queue, and is the exact
    // plan applied below. Deciding what will be deleted from an older snapshot
    // leaves a window for a directory to appear and be deleted unannounced.
    let plan = await getSkillsStatus(targets, next, nextTargets);
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      const removals = plan.ops.filter((op) => op.kind === "delete").map((op) => op.name);
      if (removals.some((name) => !confirmed.has(name))) {
        return {
          ...snapshot(
            await getSkillsStatus(targets, previous, previousTargets),
            previous,
            previouslySaved,
          ),
          confirmationRequired: { removals },
        };
      }

      // Capture only paths this frozen plan can mutate. Capturing every managed
      // path would make rollback delete a new external directory that appeared
      // after the scan merely because it was absent from the snapshot.
      const transaction = await beginSkillsTransaction(targets, previous, next, plan.ops, {
        previousTargets,
        nextTargets,
      });
      let status: SkillsStatus;
      try {
        status = await installSkills(targets, next, nextTargets, {
          ...plan,
          // beginSkillsTransaction atomically staged these directories. Running
          // removeSkill afterward would delete a path another writer recreated.
          ops: plan.ops.filter((op) => op.kind !== "delete"),
        });
      } catch (error) {
        await transaction.rollback();
        throw error;
      }

      // An empty custom selection converges to the intentional not-installed
      // state; zero remaining operations is the invariant, not the label.
      if (status.ops.length === 0) {
        try {
          await selectionStore.set(next, nextTargets);
        } catch (error) {
          await transaction.rollback();
          throw error;
        }
        try {
          await transaction.commit();
        } catch {
          // Selection and disk convergence are already durable. The owned
          // manifest stays behind so the next serialized operation retries
          // cleanup; reporting this save as failed would misstate its outcome.
        }
        return {
          ...snapshot(status, next, true),
          confirmationRequired: null,
        };
      }

      // The frozen plan became incomplete while it was being applied. Put only
      // its mutations back, rescan, and either request confirmation for a new
      // deletion or retry harmless additions/updates from the fresh plan.
      await transaction.rollback();
      plan = await getSkillsStatus(targets, next, nextTargets);
    }

    throw new Error("Skills changed repeatedly while the selection was being saved");
  }

  async function importLegacySelectionIfUnset(selection: unknown) {
    if (await selectionStore.isSet()) {
      return { imported: false, selection: await selectionStore.get() };
    }
    const imported = await selectionStore.set(selection, await selectionStore.getTargets());
    return { imported: true, selection: imported };
  }

  return {
    status: () => serialize(() => converge(getSkillsStatus)),
    install: () => serialize(() => converge(updateSkills)),
    update: () => serialize(() => converge(updateSkills)),
    uninstall: () => serialize(() => converge(uninstallSkills)),
    autoUpdate: () => serialize(() => converge(autoUpdateInstalledSkills)),
    save: (selection) => serialize(() => saveSelection(selection)),
    importLegacySelectionIfUnset: (selection) =>
      serialize(() => importLegacySelectionIfUnset(selection)),
  };
}

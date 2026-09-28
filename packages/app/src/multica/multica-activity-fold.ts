/**
 * The timeline's activity fold, translated from the source's activity-block
 * rules: consecutive activity entries form one block; a comment breaks the
 * run. Every block except the trailing one folds to a single summary line,
 * because a run of fifty status flips would otherwise drown the comment
 * area; the trailing block stays open but shows only its most recent
 * entries, the older ones behind a show-more line. Folding is a projection
 * over the full entry list — nothing is dropped from the data.
 */
export const LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT = 8;

export interface ActivityBlockData<T> {
  readonly entries: readonly T[];
  /** True for the stream's final block — the one that stays open. */
  readonly trailing: boolean;
  /** Entries the fold shows without any interaction. */
  readonly visible: readonly T[];
  /** Entries behind the block's expand affordance. */
  readonly folded: readonly T[];
}

export function groupActivityBlocks<T extends { kind: string }>(
  entries: readonly T[],
): ActivityBlockData<T>[] {
  const runs: T[][] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.kind !== "activity") {
      continue;
    }
    const previous = index > 0 ? entries[index - 1] : null;
    if (previous?.kind === "activity" && runs.length > 0) {
      runs[runs.length - 1].push(entry);
    } else {
      runs.push([entry]);
    }
  }
  return runs.map((run, index) => {
    const trailing = index === runs.length - 1;
    if (!trailing) {
      return { entries: run, trailing, visible: [], folded: run };
    }
    const over = run.length - LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT;
    const split = over > 0 ? over : 0;
    return {
      entries: run,
      trailing,
      visible: run.slice(split),
      folded: run.slice(0, split),
    };
  });
}

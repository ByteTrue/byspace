import type { TFunction } from "i18next";
import { formatDuration } from "@/utils/time";
import type { OverviewSummary } from "./model";

function joinSummaryParts(parts: string[], conjunction: string): string {
  if (parts.length === 0) {
    return "";
  }
  if (parts.length === 1) {
    return parts[0] ?? "";
  }
  if (parts.length === 2) {
    return `${parts[0]} ${conjunction} ${parts[1]}`;
  }
  return `${parts.slice(0, -1).join(", ")}, ${conjunction} ${parts.at(-1)}`;
}

/**
 * Renders the counts as one sentence, e.g. "Ran 2 commands, read 1 file, and searched 1 time".
 * Pass `capitalize: false` where the text continues a badge label and should stay lowercase.
 */
export function formatOverviewSummary(
  summary: OverviewSummary,
  t: TFunction,
  options?: { capitalize?: boolean },
): string {
  const parts: string[] = [];
  if (summary.thoughtCount > 0) {
    if (summary.thoughtDurationMs > 0) {
      const seconds = Math.max(1, Math.round(summary.thoughtDurationMs / 1000));
      parts.push(
        t("toolCallGroup.thoughtFor", {
          duration: formatDuration(seconds * 1000),
        }).toLocaleLowerCase(),
      );
    } else {
      parts.push(t("toolCallGroup.thought").toLocaleLowerCase());
    }
  }
  const entries = [
    [summary.editedFileCount, "toolCallGroup.editedFiles"],
    [summary.commandCount, "toolCallGroup.commands"],
    [summary.readFileCount, "toolCallGroup.readFiles"],
    [summary.searchCount, "toolCallGroup.searches"],
    [summary.otherToolCount, "toolCallGroup.otherTools"],
    [summary.byspaceCallCount, "toolCallGroup.byspaceCalls"],
  ] as const;
  for (const [count, key] of entries) {
    if (count > 0) {
      parts.push(t(`${key}.${count === 1 ? "one" : "other"}`, { count }));
    }
  }
  const joined = joinSummaryParts(parts, t("toolCallGroup.and"));
  const firstCharacter = joined[0];
  if (!firstCharacter || options?.capitalize === false) {
    return joined;
  }
  return `${firstCharacter.toLocaleUpperCase()}${joined.slice(1)}`;
}

export const SOURCE_PRESENTATION_BUDGETS = {
  highlighted: 10 * 1024 * 1024,
  plain: 50 * 1024 * 1024,
} as const;

export type SourcePresentation = "highlighted" | "plain" | "unsupported";

export function selectSourcePresentation(input: { size: number }): SourcePresentation {
  if (input.size <= SOURCE_PRESENTATION_BUDGETS.highlighted) return "highlighted";
  if (input.size <= SOURCE_PRESENTATION_BUDGETS.plain) return "plain";
  return "unsupported";
}

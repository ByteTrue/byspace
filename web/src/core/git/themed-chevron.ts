import { ChevronRight } from "lucide-react";
import type { Theme } from "@/styles/theme";
import { withTheme } from "~/app/theme-object";

// Shared chevron used by collapsible git rows (changed-files tree, commits
// section). Kept in one place so the muted-foreground tint and the
// withTheme wrapping stay consistent across every disclosure control.
export const ThemedChevron = withTheme(ChevronRight);

export const chevronColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

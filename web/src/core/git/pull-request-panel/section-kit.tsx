// Port of archive/expo-app:packages/app/src/git/pull-request-panel/section-kit.tsx: the PR pane's collapsible
// sections, their summary pills, and the check-row classes the checks list and the GitLab pipeline
// share. The Expo file exports React Native styles and colour mappings; here they are class names.
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CountedCheckPresentation } from "@/git/check-presentation";
import {
  CheckPresentationIcon,
  getCheckPresentationTone,
  type CheckPresentationTone,
} from "@/git/check-presentation.view";
import { cn } from "cn";

export const sectionKitClassNames = {
  emptyText: "px-3 py-2 text-xs text-muted-foreground",
  // A fixed 32px, not a minimum plus padding: a row's trailing slot can hold an xs button, which
  // would otherwise make rows with "Add to chat" taller than rows without one.
  checkRow: "flex h-8 items-center gap-2 px-3",
  checkName: "min-w-0 truncate text-sm text-foreground",
  checkWorkflow: "min-w-0 truncate text-xs text-muted-foreground",
  checkTrailing: "ml-auto flex shrink-0 items-center gap-2",
  checkDuration: "text-xs text-muted-foreground",
} as const;

const TONE_TEXT: Record<CheckPresentationTone, string> = {
  success: "text-status-success",
  danger: "text-status-danger",
  warning: "text-status-warning",
  muted: "text-muted-foreground",
};

interface SectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
  accessibilityLabel?: string;
}

export function Section({
  title,
  open,
  onToggle,
  summary,
  children,
  accessibilityLabel,
}: SectionProps) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Chevron size={14} className="shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <span className="ml-auto flex items-center gap-2">{summary}</span>
      </button>
      {open ? <div className="pb-3">{children}</div> : null}
    </div>
  );
}

export type SummaryPillVariant = CheckPresentationTone;

export function SummaryPill({
  count,
  icon,
  variant,
  testID,
}: {
  count: number;
  icon: ReactNode;
  variant: SummaryPillVariant;
  testID?: string;
}) {
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-[3px]" data-testid={testID}>
      {icon}
      <span className={cn("text-xs", TONE_TEXT[variant])}>{count}</span>
    </span>
  );
}

export function CheckPresentationSummaryPill({
  count,
  presentation,
  testID,
}: {
  count: number;
  presentation: CountedCheckPresentation;
  testID?: string;
}) {
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-[3px]" data-testid={testID}>
      <CheckPresentationIcon presentation={presentation} size={12} />
      <span className={cn("text-xs", TONE_TEXT[getCheckPresentationTone(presentation)])}>
        {count}
      </span>
    </span>
  );
}

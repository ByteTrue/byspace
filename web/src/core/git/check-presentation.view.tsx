import type { ReactNode } from "react";
import { CircleCheck, CircleDot, CircleSlash, CircleX } from "lucide-react";
import { ManualStatusIcon } from "@/components/icons/manual-status-icon";
import type { Theme } from "@/styles/theme";
import type { CheckPresentation } from "./check-presentation";
import { withTheme } from "~/app/theme-object";

const ThemedCircleCheck = withTheme(CircleCheck);
const ThemedCircleDot = withTheme(CircleDot);
const ThemedCircleSlash = withTheme(CircleSlash);
const ThemedCircleX = withTheme(CircleX);
const ThemedManualStatusIcon = withTheme(ManualStatusIcon);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const successColorMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

export type CheckPresentationTone = "success" | "danger" | "warning" | "muted";

interface CheckPresentationViewPolicy {
  tone: CheckPresentationTone;
  renderIcon: (size: number) => ReactNode;
}

const CHECK_PRESENTATION_VIEW_POLICY: Record<CheckPresentation, CheckPresentationViewPolicy> = {
  success: {
    tone: "success",
    renderIcon(size) {
      return <ThemedCircleCheck size={size} themeProps={successColorMapping} />;
    },
  },
  failure: {
    tone: "danger",
    renderIcon(size) {
      return <ThemedCircleX size={size} themeProps={dangerColorMapping} />;
    },
  },
  warning: {
    tone: "warning",
    renderIcon(size) {
      return <ThemedCircleX size={size} themeProps={warningColorMapping} />;
    },
  },
  actionRequired: {
    tone: "warning",
    renderIcon(size) {
      return <ThemedManualStatusIcon size={size} themeProps={warningColorMapping} />;
    },
  },
  manual: {
    tone: "muted",
    renderIcon(size) {
      return <ThemedManualStatusIcon size={size} themeProps={foregroundMutedColorMapping} />;
    },
  },
  pending: {
    tone: "warning",
    renderIcon(size) {
      return <ThemedCircleDot size={size} themeProps={warningColorMapping} />;
    },
  },
  ignored: {
    tone: "muted",
    renderIcon(size) {
      return <ThemedCircleSlash size={size} themeProps={foregroundMutedColorMapping} />;
    },
  },
};

export function getCheckPresentationTone(presentation: CheckPresentation): CheckPresentationTone {
  return CHECK_PRESENTATION_VIEW_POLICY[presentation].tone;
}

export function CheckPresentationIcon({
  presentation,
  size,
}: {
  presentation: CheckPresentation;
  size: number;
}): ReactNode {
  return CHECK_PRESENTATION_VIEW_POLICY[presentation].renderIcon(size);
}

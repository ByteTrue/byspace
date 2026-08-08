import { Fragment, useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Globe,
} from "lucide-react-native";
import type { HostBadgeModel } from "@/hosts/appearance";
import { HostBadge, HOST_BADGE_ICON_SIZE } from "@/hosts/host-badge";
import type { PrHint } from "@/git/pr-hint";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import { openExternalUrl } from "@/utils/open-external-url";
import { useSidebarMetaPreferences } from "@/components/sidebar/display-preferences/model";
import type { Theme } from "@/styles/theme";
import type { CheckSummary, CheckSummaryState } from "./check-summary";
import { selectMetaRowItems, type MetaRowItem } from "./meta-items";
import type { WorkspaceServiceSummary } from "./service-summary";

export {
  selectWorkspaceServiceSummary,
  workspaceServiceLabelKey,
  type WorkspaceServiceSummary,
} from "./service-summary";
export { selectMetaRowItems } from "./meta-items";
export { selectCheckSummary, type CheckSummary } from "./check-summary";

const META_ICON_SIZE = HOST_BADGE_ICON_SIZE;
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedGitMerge = withUnistyles(GitMerge);
const ThemedGitPullRequestClosed = withUnistyles(GitPullRequestClosed);
const ThemedGlobe = withUnistyles(Globe);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedCircleX = withUnistyles(CircleX);
const ThemedCircleDashed = withUnistyles(CircleDashed);

const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const successMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });
const mergedMapping = (theme: Theme) => ({ color: theme.colors.statusMerged });
const dangerMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });
const warningMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

export function WorkspaceMetaRow({
  hostBadge,
  prHint,
  serviceSummary,
}: {
  hostBadge: HostBadgeModel | null;
  prHint: PrHint | null;
  serviceSummary: WorkspaceServiceSummary | null;
}) {
  const { rowItems, checksDisplay } = useSidebarMetaPreferences();
  const items = selectMetaRowItems({
    hasHostBadge: hostBadge !== null,
    prHint,
    serviceSummary,
    visible: rowItems,
    checksDisplay,
  });
  if (items.length === 0) return null;

  return (
    <View style={styles.row}>
      {items.map((item, index) => (
        <Fragment key={item.kind}>
          {index > 0 ? <Text style={styles.separator}>·</Text> : null}
          <MetaItemNode item={item} hostBadge={hostBadge} />
        </Fragment>
      ))}
    </View>
  );
}

function MetaItemNode({
  item,
  hostBadge,
}: {
  item: MetaRowItem;
  hostBadge: HostBadgeModel | null;
}): ReactNode {
  if (item.kind === "host")
    return hostBadge ? <HostBadge badge={hostBadge} accessible={false} /> : null;
  if (item.kind === "changeRequest") return <PullRequestItem hint={item.hint} />;
  if (item.kind === "checks") return <ChecksItem summary={item.summary} label={item.label} />;
  return <ServiceItem summary={item.summary} />;
}

function PullRequestItem({ hint }: { hint: PrHint }) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const presentation = getForgePresentation(normalizeForge(hint.forge));
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      void openExternalUrl(hint.url);
    },
    [hint.url],
  );
  const handlePressIn = useCallback((event: GestureResponderEvent) => event.stopPropagation(), []);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const Icon = isHovered ? ThemedExternalLink : PR_ICONS[hint.state];

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t("workspace.git.pr.accessibility.pullRequest", {
        number: hint.number,
        context: presentation.changeRequestContext,
      })}
      hitSlop={4}
      onPressIn={handlePressIn}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={pressableItemStyle}
    >
      <Icon
        size={META_ICON_SIZE}
        uniProps={isHovered ? foregroundMapping : PR_COLOR_MAPPINGS[hint.state]}
      />
      <Text style={isHovered ? styles.prTextHovered : styles.prText} numberOfLines={1}>
        {hint.number}
        {hint.state === "open" ? "" : ` ${t(PR_STATE_LABEL_KEYS[hint.state])}`}
      </Text>
    </Pressable>
  );
}

function ChecksItem({ summary, label }: { summary: CheckSummary; label: boolean }) {
  const { t } = useTranslation();
  const Icon = CHECK_ICONS[summary.state];
  return (
    <View
      style={styles.item}
      accessible={false}
      testID={`sidebar-workspace-checks-${summary.state}`}
    >
      <Icon size={META_ICON_SIZE} uniProps={CHECK_COLOR_MAPPINGS[summary.state]} />
      {label ? (
        <Text style={checksTextStyle(summary.state)} numberOfLines={1}>
          {t(CHECK_STATE_LABEL_KEYS[summary.state])}
        </Text>
      ) : null}
    </View>
  );
}

function ServiceItem({ summary }: { summary: WorkspaceServiceSummary }) {
  const unhealthy = summary.health === "unhealthy";
  return (
    <View
      style={styles.serviceItem}
      accessible={false}
      testID={unhealthy ? "workspace-service-unhealthy" : "workspace-service"}
    >
      <ThemedGlobe size={META_ICON_SIZE} uniProps={unhealthy ? dangerMapping : successMapping} />
      <Text style={unhealthy ? styles.serviceNameUnhealthy : styles.serviceName} numberOfLines={1}>
        {summary.name}
      </Text>
    </View>
  );
}

const CHECK_STATE_LABEL_KEYS = {
  passed: "workspace.git.pr.checksSummary.passedLabel",
  failed: "workspace.git.pr.checksSummary.failedLabel",
  running: "workspace.git.pr.checksSummary.runningLabel",
} as const;

export const CHECK_STATE_ACCESSIBLE_KEYS = {
  passed: "workspace.git.pr.checksSummary.passedAccessible",
  failed: "workspace.git.pr.checksSummary.failedAccessible",
  running: "workspace.git.pr.checksSummary.runningAccessible",
} as const;

const CHECK_ICONS = {
  passed: ThemedCircleCheck,
  failed: ThemedCircleX,
  running: ThemedCircleDashed,
} as const;
const CHECK_COLOR_MAPPINGS = {
  passed: successMapping,
  failed: dangerMapping,
  running: warningMapping,
} as const;
const PR_ICONS = {
  open: ThemedGitPullRequest,
  merged: ThemedGitMerge,
  closed: ThemedGitPullRequestClosed,
} as const;
const PR_COLOR_MAPPINGS = {
  open: successMapping,
  merged: mergedMapping,
  closed: dangerMapping,
} as const;
const PR_STATE_LABEL_KEYS = {
  merged: "workspace.git.pr.states.merged",
  closed: "workspace.git.pr.states.closed",
} as const;

function pressableItemStyle({ pressed }: { pressed: boolean }) {
  return [styles.item, pressed && styles.itemPressed];
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
    marginTop: theme.spacing[1],
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minWidth: 0,
    flexShrink: 0,
  },
  itemPressed: { opacity: 0.82 },
  separator: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
    flexShrink: 0,
  },
  serviceItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minWidth: 0,
    flexShrink: 1,
  },
  serviceName: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
    flexShrink: 1,
  },
  serviceNameUnhealthy: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
    flexShrink: 1,
  },
  prText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  prTextHovered: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  checksTextPassed: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  checksTextFailed: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  checksTextRunning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
}));

function checksTextStyle(state: CheckSummaryState) {
  if (state === "failed") return styles.checksTextFailed;
  if (state === "running") return styles.checksTextRunning;
  return styles.checksTextPassed;
}

import { memo, useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Maximize2, Server, X } from "lucide-react-native";

const ThemedMaximize = withUnistyles(Maximize2, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedServer = withUnistyles(Server, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedX = withUnistyles(X, (theme) => ({ color: theme.colors.foregroundMuted }));
import {
  PaneProvider,
  PaneFocusProvider,
  createPaneFocusContextValue,
  type PaneContextValue,
} from "@/panels/pane-context";
import { AgentConversationPanel } from "@/panels/agent-panel";
import { useHosts } from "@/runtime/host-runtime";
import { useHostChooser } from "@/hosts/host-chooser";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useTranslation } from "react-i18next";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { useVisibleAgentTimeline } from "@/timeline/use-visible-agent-timeline";
import { resolveChiefFabWindowBottom, useChiefFabClearance } from "./chief-fab-clearance";
import type { ChiefAgentInfo } from "./use-chief-agent";

const stateStyles = StyleSheet.create((theme) => ({
  stateContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  } as const,
  stateText: {
    fontSize: 13,
    textAlign: "center",
    color: theme.colors.foregroundMuted,
  } as const,
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  } as const,
  retryText: {
    fontSize: 12,
    color: theme.colors.foreground,
  } as const,
}));

function ChiefStateMessage({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
}): ReactElement {
  return (
    <View style={stateStyles.stateContainer}>
      <Text style={stateStyles.stateText}>{message}</Text>
      {retryLabel && onRetry ? (
        <Pressable
          onPress={onRetry}
          style={stateStyles.retryButton}
          accessibilityLabel={retryLabel}
        >
          <Text style={stateStyles.retryText}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ChiefPaneContent({ serverId, agent }: { serverId: string; agent: ChiefAgentInfo }) {
  // The workspace screen is the only other publisher of on-screen agents, and a
  // selective daemon catches up nothing it was not told about. Without this the
  // floating window shows an endless spinner: the pane's first-paint gate waits
  // for an authoritative timeline that no subscription ever fetches. Maximizing
  // "worked" because it lands on the workspace screen, which does register.
  useVisibleAgentTimeline({ serverId, agentId: agent.agentId });
  const paneContextValue = useMemo<PaneContextValue>(
    () => ({
      serverId,
      workspaceId: agent.workspaceId,
      host: "main",
      tabId: `chief:${agent.agentId}`,
      target: { kind: "agent" as const, agentId: agent.agentId },
      state: undefined,
      fileNavigationRevision: undefined,
      openTab: () => {},
      openPreferredTarget: () => {},
      closeCurrentTab: () => {},
      retargetCurrentTab: () => {},
      setCurrentTabState: () => {},
      openFileInWorkspace: () => {},
      openImportSheet: () => {},
    }),
    [serverId, agent],
  );
  const paneFocusValue = useMemo(
    () => createPaneFocusContextValue({ isWorkspaceFocused: true, isPaneFocused: true }),
    [],
  );

  return (
    <PaneProvider value={paneContextValue}>
      <PaneFocusProvider value={paneFocusValue}>
        <AgentConversationPanel />
      </PaneFocusProvider>
    </PaneProvider>
  );
}

export interface ChiefFloatingWindowProps {
  serverId: string;
  agent: ChiefAgentInfo | null;
  error: string | null;
  noHomeWorkspace: boolean;
  onRetry: () => void;
  onClose: () => void;
}

export const ChiefFloatingWindow = memo(function ChiefFloatingWindow({
  serverId,
  agent,
  error,
  noHomeWorkspace,
  onRetry,
  onClose,
}: ChiefFloatingWindowProps): ReactElement {
  const { t } = useTranslation();
  const router = useRouter();
  const hosts = useHosts();
  const openHostChooser = useHostChooser();
  // The window replaces the entry at the same corner, so it yields to the
  // composer for the same reason the entry does.
  const clearance = useChiefFabClearance();
  const windowStyle = useMemo(
    () => [styles.window, inlineUnistylesStyle({ bottom: resolveChiefFabWindowBottom(clearance) })],
    [clearance],
  );

  const hostLabel = useMemo(
    () => hosts.find((h) => h.serverId === serverId)?.label ?? serverId,
    [hosts, serverId],
  );

  const handleMaximize = useCallback(() => {
    if (agent) {
      onClose();
      router.push(buildHostAgentDetailRoute(serverId, agent.agentId, agent.workspaceId));
    }
  }, [agent, serverId, router, onClose]);

  const renderChiefBody = useCallback((): ReactElement => {
    if (agent) {
      return <ChiefPaneContent serverId={serverId} agent={agent} />;
    }
    if (error) {
      return <ChiefStateMessage message={error} retryLabel={t("chief.retry")} onRetry={onRetry} />;
    }
    if (noHomeWorkspace) {
      return <ChiefStateMessage message={t("chief.noHomeWorkspace")} />;
    }
    return (
      <View style={styles.loadingContainer}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  }, [agent, error, noHomeWorkspace, serverId, onRetry, t]);

  const handleSwitchHost = useCallback(() => {
    openHostChooser({
      title: t("chief.switchHost"),
      onChooseHost: (chosenServerId) => {
        if (chosenServerId !== serverId) {
          router.push(`/h/${chosenServerId}`);
        }
      },
    });
  }, [openHostChooser, serverId, router, t]);

  return (
    <View style={windowStyle} testID="chief-floating-window">
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.statusDot} />
          <Text style={styles.title}>Chief</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            onPress={handleSwitchHost}
            style={styles.headerButton}
            accessibilityLabel={t("chief.switchHost")}
            testID="chief-switch-host"
          >
            <ThemedServer size={14} />
            <Text style={styles.hostText}>{hostLabel}</Text>
          </Pressable>
          <Pressable
            onPress={handleMaximize}
            style={styles.headerButton}
            accessibilityLabel={t("chief.maximize")}
            testID="chief-maximize"
          >
            <ThemedMaximize size={14} />
          </Pressable>
          <Pressable
            onPress={onClose}
            style={styles.headerButton}
            accessibilityLabel={t("chief.close")}
            testID="chief-close"
          >
            <ThemedX size={14} />
          </Pressable>
        </View>
      </View>

      <View style={styles.content}>{renderChiefBody()}</View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  window: {
    position: "absolute",
    right: 20,
    width: 420,
    height: 560,
    maxWidth: "95%",
    maxHeight: "80%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
    boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
    zIndex: 901,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.accent,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 4,
    borderRadius: 4,
  },
  hostText: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stateContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  stateText: {
    fontSize: 13,
    textAlign: "center",
    color: theme.colors.foregroundMuted,
  },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  retryText: {
    fontSize: 12,
    color: theme.colors.foreground,
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
}));

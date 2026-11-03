// Port of packages/app/src/app/h/[serverId]/workspace/[workspaceId]/index.tsx: the same open
// intent handling and workspace deck, without React Navigation.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { router, useGlobalSearchParams, useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { RetainedPanel } from "@/components/retained-panel";
import {
  type ActiveWorkspaceSelection,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useHasHydratedWorkspaces, useWorkspaceExists } from "@/stores/session-store-hooks";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { WorkspaceScreen } from "@/screens/workspace/workspace-screen";
import { useWorkspaceLayoutStoreHydrated } from "@/stores/workspace-layout-store";
import {
  areRetainedWorkspaceSelectionListsEqual,
  areWorkspaceSelectionsEqual,
  getNextWorkspaceDeckExpirationDelay,
  getWorkspaceSelectionKey,
  orderWorkspaceSelectionsForStableRender,
  reconcileRetainedWorkspaceSelections,
  resolveWorkspaceDeckRetentionLimit,
  type RetainedWorkspaceSelection,
  resolveWorkspaceDeckEntries,
  shouldKeepWorkspaceDeckEntryMounted,
} from "@/screens/workspace/workspace-deck-retention";
import {
  decodeWorkspaceIdFromPathSegment,
  parseWorkspaceOpenIntent,
  type WorkspaceOpenIntent,
} from "@/utils/host-routes";
import { stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit } from "@/utils/host-route-browser";
import { prepareWorkspaceTab } from "@/utils/workspace-navigation";
import { RenderProfile } from "@/utils/render-profiler";

function getParamValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue.trim() : "";
  }
  return "";
}

function getOpenIntentTarget(openIntent: WorkspaceOpenIntent): WorkspaceTabTarget {
  if (openIntent.kind === "agent") {
    return { kind: "agent", agentId: openIntent.agentId };
  }
  if (openIntent.kind === "terminal") {
    return { kind: "terminal", terminalId: openIntent.terminalId };
  }
  if (openIntent.kind === "file") {
    return { kind: "file", path: openIntent.path };
  }
  if (openIntent.kind === "setup") {
    return { kind: "setup", workspaceId: openIntent.workspaceId };
  }
  return { kind: "draft", draftId: openIntent.draftId };
}

/** Drops the consumed `?open=` from the URL through the router, so its location updates too. */
function clearConsumedOpenIntent() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("open")) {
    return;
  }
  url.searchParams.delete("open");
  router.replace(`${url.pathname}${url.search}${url.hash}`);
}

export default function HostWorkspaceIndexRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostWorkspaceRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostWorkspaceRouteContent() {
  const hasHydratedWorkspaceLayoutStore = useWorkspaceLayoutStoreHydrated();
  const consumedIntentRef = useRef<string | null>(null);
  const [intentConsumed, setIntentConsumed] = useState(false);
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    workspaceId?: string | string[];
  }>();
  const globalParams = useGlobalSearchParams<{
    open?: string | string[];
  }>();
  const serverId = getParamValue(params.serverId);
  const workspaceValue = getParamValue(params.workspaceId);
  const workspaceId = workspaceValue
    ? (decodeWorkspaceIdFromPathSegment(workspaceValue) ?? "")
    : "";
  const openValue = getParamValue(globalParams.open);
  const hasHydratedWorkspaces = useHasHydratedWorkspaces(serverId);
  const workspaceExists = useWorkspaceExists(serverId, workspaceId);
  const openIntent = useMemo(() => parseWorkspaceOpenIntent(openValue), [openValue]);
  const recoveryAgentId = openIntent?.kind === "agent" ? openIntent.agentId : null;
  const isAgentOpenIntent = recoveryAgentId !== null;
  const isOpenIntentWaitingForWorkspace = Boolean(
    isAgentOpenIntent && (!hasHydratedWorkspaces || !workspaceExists),
  );
  useEffect(() => {
    if (!serverId || !workspaceId) {
      return;
    }
    stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit();
  }, [serverId, workspaceId]);

  useEffect(() => {
    if (!openValue) {
      return;
    }
    if (!hasHydratedWorkspaceLayoutStore) {
      return;
    }
    if (isOpenIntentWaitingForWorkspace) {
      return;
    }

    const consumptionKey = `${serverId}:${workspaceId}:${openValue}`;
    if (consumedIntentRef.current === consumptionKey) {
      clearConsumedOpenIntent();
      setIntentConsumed(true);
      return;
    }
    consumedIntentRef.current = consumptionKey;

    if (openIntent) {
      prepareWorkspaceTab({
        serverId,
        workspaceId,
        target: getOpenIntentTarget(openIntent),
        pin: openIntent.kind === "agent",
      });
    }

    // Expo Router's replace ignores query-param-only changes (findDivergentState
    // skips search params). Strip ?open from the browser URL directly so the
    // address bar reflects the clean workspace route.
    clearConsumedOpenIntent();

    setIntentConsumed(true);
  }, [
    hasHydratedWorkspaceLayoutStore,
    isOpenIntentWaitingForWorkspace,
    openIntent,
    openValue,
    serverId,
    workspaceId,
  ]);

  if (
    openValue &&
    !isOpenIntentWaitingForWorkspace &&
    (!intentConsumed || !hasHydratedWorkspaceLayoutStore)
  ) {
    return null;
  }

  return <WorkspaceDeck recoveryRequested={isAgentOpenIntent} recoveryAgentId={recoveryAgentId} />;
}

function WorkspaceDeck({
  recoveryRequested,
  recoveryAgentId,
}: {
  recoveryRequested: boolean;
  recoveryAgentId: string | null;
}) {
  const activeSelection = useActiveWorkspaceSelection();
  const [retainedSelections, setRetainedSelections] = useState<RetainedWorkspaceSelection[]>(() =>
    activeSelection ? [{ selection: activeSelection, inactiveSince: null }] : [],
  );
  const unmountWorkspaceSelection = useCallback((selection: ActiveWorkspaceSelection) => {
    setRetainedSelections((current) =>
      current.filter((entry) => !areWorkspaceSelectionsEqual(entry.selection, selection)),
    );
  }, []);

  const reconciliationNow = Date.now();
  const nextRetainedSelections = useMemo(
    () =>
      reconcileRetainedWorkspaceSelections({
        currentEntries: retainedSelections,
        activeSelection,
        now: reconciliationNow,
        maxMountedWorkspaces: resolveWorkspaceDeckRetentionLimit(),
      }),
    [activeSelection, reconciliationNow, retainedSelections],
  );
  const renderedSelections = useMemo(
    () =>
      orderWorkspaceSelectionsForStableRender(
        nextRetainedSelections.map((entry) => entry.selection),
      ),
    [nextRetainedSelections],
  );
  const renderedEntries = useMemo(
    () => resolveWorkspaceDeckEntries({ selections: renderedSelections, activeSelection }),
    [activeSelection, renderedSelections],
  );

  useLayoutEffect(() => {
    if (!areRetainedWorkspaceSelectionListsEqual(retainedSelections, nextRetainedSelections)) {
      setRetainedSelections(nextRetainedSelections);
    }
  }, [nextRetainedSelections, retainedSelections]);

  useEffect(() => {
    const expirationDelay = getNextWorkspaceDeckExpirationDelay({
      entries: nextRetainedSelections,
      activeSelection,
      now: reconciliationNow,
    });
    if (expirationDelay === null) {
      return;
    }
    const timeout = setTimeout(() => {
      setRetainedSelections((current) =>
        reconcileRetainedWorkspaceSelections({
          currentEntries: current,
          activeSelection,
          now: Date.now(),
          maxMountedWorkspaces: resolveWorkspaceDeckRetentionLimit(),
        }),
      );
    }, expirationDelay + 1);
    return () => clearTimeout(timeout);
  }, [activeSelection, nextRetainedSelections, reconciliationNow]);

  return (
    <RenderProfile id="WorkspaceDeck">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {renderedEntries.map(({ selection, active }) => {
          return (
            <WorkspaceDeckEntry
              key={getWorkspaceSelectionKey(selection)}
              selection={selection}
              active={active}
              recoveryRequested={recoveryRequested}
              recoveryAgentId={recoveryAgentId}
              onUnmountInactive={unmountWorkspaceSelection}
            />
          );
        })}
      </div>
    </RenderProfile>
  );
}

function WorkspaceDeckEntry({
  selection,
  active,
  recoveryRequested,
  recoveryAgentId,
  onUnmountInactive,
}: {
  selection: ActiveWorkspaceSelection;
  active: boolean;
  recoveryRequested: boolean;
  recoveryAgentId: string | null;
  onUnmountInactive: (selection: ActiveWorkspaceSelection) => void;
}) {
  const hasHydratedWorkspaces = useHasHydratedWorkspaces(selection.serverId);
  const workspaceExists = useWorkspaceExists(selection.serverId, selection.workspaceId);
  const shouldKeepMounted = shouldKeepWorkspaceDeckEntryMounted({
    isActive: active,
    hasHydratedWorkspaces,
    workspaceExists,
  });

  useEffect(() => {
    if (!shouldKeepMounted) {
      onUnmountInactive(selection);
    }
  }, [onUnmountInactive, selection, shouldKeepMounted]);

  if (!shouldKeepMounted) {
    return null;
  }

  return (
    <RetainedPanel
      active={active}
      testID={`workspace-deck-entry-${selection.serverId}:${selection.workspaceId}`}
    >
      <WorkspaceScreen
        serverId={selection.serverId}
        workspaceId={selection.workspaceId}
        isRouteFocused={active}
        recoveryRequested={active && recoveryRequested}
        recoveryAgentId={active ? recoveryAgentId : null}
      />
    </RetainedPanel>
  );
}

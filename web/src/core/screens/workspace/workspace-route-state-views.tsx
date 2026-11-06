// Port of archive/expo-app:packages/app/src/screens/workspace/workspace-route-state-views.tsx: what the
// workspace page shows while its host or workspace is not ready (connecting, offline, archived,
// missing, needs a host update). Same states and actions; DOM view.
import type { ReactNode } from "react";
import { ArrowLeftToLine, RotateCw, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  InfoHoverCard,
  InfoHoverCardContent,
  InfoHoverCardTrigger,
} from "~/components/info-hover-card";
import type { WorkspaceRouteState } from "@/screens/workspace/workspace-route-state";
import { formatConnectionStatus } from "@/utils/daemons";
import { Spinner } from "~/components/ui/spinner";

const RETRY_ICON = <RotateCw />;
const BACK_ICON = <ArrowLeftToLine />;
const SETTINGS_ICON = <Settings />;

interface WorkspaceRouteStateActions {
  onRetryHost: () => void;
  onManageHost: () => void;
  onDismissMissingWorkspace: () => void;
  onRecoverWorkspace: () => void;
  onRetryRecoveryInspection: () => void;
}

export function renderWorkspaceRouteGate(input: {
  state: WorkspaceRouteState;
  actions: WorkspaceRouteStateActions;
}): ReactNode {
  switch (input.state.kind) {
    case "loading":
      return <WorkspaceConnecting hostName={input.state.hostName} />;
    case "missing":
      return (
        <WorkspaceEmptyState
          titleKey="workspace.route.recovery.unavailableTitle"
          hostName={input.state.hostName}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "archived":
      return (
        <ArchivedWorkspaceRecovery
          state={input.state}
          onRecover={input.actions.onRecoverWorkspace}
        />
      );
    case "needsHostUpgrade":
      return (
        <WorkspaceEmptyState
          titleKey="workspace.route.needsHostUpgrade"
          hostName={input.state.hostName}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "unreachable":
      return (
        <WorkspaceUnreachable
          state={input.state}
          onRetry={input.actions.onRetryHost}
          onManageHost={input.actions.onManageHost}
        />
      );
    case "recoveryUnavailable":
      return (
        <WorkspaceEmptyState
          titleKey="workspace.route.recovery.unavailableTitle"
          description={input.state.message}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "recoveryInspectionFailed":
      return (
        <WorkspaceRecoveryInspectionFailed
          state={input.state}
          onRetry={input.actions.onRetryRecoveryInspection}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "ready":
    case "reconnecting":
      return null;
  }
}

function getWorkspaceHostStateTitle(
  state: Extract<WorkspaceRouteState, { kind: "unreachable" }>,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (state.connectionStatus === "connecting" || state.connectionStatus === "idle") {
    return t("workspace.route.connecting");
  }
  if (state.connectionStatus === "offline") {
    return t("workspace.route.hostOffline", { hostName: state.hostName });
  }
  return t("workspace.route.cannotReachHost", { hostName: state.hostName });
}

function StateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">{children}</div>
  );
}

function TextStack({ children }: { children: ReactNode }) {
  return (
    // The Expo app's title and description set no line height (normal); its error text is 20px.
    <div className="flex max-w-[520px] flex-col items-center gap-2 text-center text-sm leading-[normal]">
      {children}
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>;
}

function WorkspaceConnecting({ hostName }: { hostName: string }) {
  const { t } = useTranslation();
  return (
    <StateFrame>
      <Spinner className="text-muted-foreground" />
      <TextStack>
        <p className="text-foreground">{t("workspace.route.loading")}</p>
        <p className="text-muted-foreground">{hostName}</p>
      </TextStack>
    </StateFrame>
  );
}

function ArchivedWorkspaceRecovery({
  state,
  onRecover,
}: {
  state: Extract<WorkspaceRouteState, { kind: "archived" }>;
  onRecover: () => void;
}) {
  const { t } = useTranslation();
  const { recovery } = state;
  const isRestoring = recovery.phase === "restoring";
  let actionLabel = t("workspace.route.recovery.unarchiveAction");
  if (recovery.recovery.action === "restore")
    actionLabel = t("workspace.route.recovery.restoreAction");
  if (recovery.phase === "failed") actionLabel = t("common.actions.retry");
  const description =
    recovery.recovery.action === "restore"
      ? t("workspace.route.recovery.restoreDescription", {
          workspaceName: recovery.recovery.workspaceName,
          branch: recovery.recovery.branch,
        })
      : t("workspace.route.recovery.unarchiveDescription", {
          workspaceName: recovery.recovery.workspaceName,
        });
  return (
    <StateFrame>
      {isRestoring ? <Spinner className="text-muted-foreground" /> : null}
      <TextStack>
        <p className="text-foreground">
          {isRestoring
            ? t("workspace.route.recovery.restoringTitle")
            : t("workspace.route.recovery.archivedTitle")}
        </p>
        <p className="text-muted-foreground">{description}</p>
        {recovery.error ? (
          <p className="leading-5 text-destructive" data-testid="workspace-recovery-error">
            {recovery.error}
          </p>
        ) : null}
      </TextStack>
      <Actions>
        <Button
          size="sm"
          variant="default"
          onClick={onRecover}
          data-testid="workspace-recovery-action"
          disabled={isRestoring}
        >
          {isRestoring ? undefined : RETRY_ICON}
          {isRestoring ? t("workspace.route.recovery.restoringAction") : actionLabel}
        </Button>
      </Actions>
    </StateFrame>
  );
}

function WorkspaceRecoveryInspectionFailed({
  state,
  onRetry,
  onDismiss,
}: {
  state: Extract<WorkspaceRouteState, { kind: "recoveryInspectionFailed" }>;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <StateFrame>
      <TextStack>
        <p className="text-foreground">{t("workspace.route.recovery.checkFailedTitle")}</p>
        <p className="leading-5 text-destructive">{state.error}</p>
      </TextStack>
      <Actions>
        <Button size="sm" variant="default" onClick={onRetry}>
          {RETRY_ICON}
          {t("common.actions.retry")}
        </Button>
        <Button size="sm" variant="outline" onClick={onDismiss}>
          {BACK_ICON}
          {t("common.actions.back")}
        </Button>
      </Actions>
    </StateFrame>
  );
}

function WorkspaceUnreachable({
  state,
  onRetry,
  onManageHost,
}: {
  state: Extract<WorkspaceRouteState, { kind: "unreachable" }>;
  onRetry: () => void;
  onManageHost: () => void;
}) {
  const { t } = useTranslation();
  const connecting = state.connectionStatus === "connecting" || state.connectionStatus === "idle";
  const canRetry = state.connectionStatus === "offline" || state.connectionStatus === "error";
  return (
    <StateFrame>
      {connecting ? <Spinner className="text-muted-foreground" /> : null}
      <TextStack>
        <p className="text-foreground">{getWorkspaceHostStateTitle(state, t)}</p>
        <p className="text-muted-foreground">
          {connecting
            ? state.hostName
            : t("workspace.route.hostStatus", {
                status: formatConnectionStatus(state.connectionStatus),
              })}
        </p>
        {state.lastError ? (
          <InfoHoverCard>
            <InfoHoverCardTrigger>
              <p className="line-clamp-3 leading-5 text-destructive">{state.lastError}</p>
            </InfoHoverCardTrigger>
            <InfoHoverCardContent side="top" className="w-[420px] max-w-[80vw]">
              <span className="break-words">{state.lastError}</span>
            </InfoHoverCardContent>
          </InfoHoverCard>
        ) : null}
      </TextStack>
      {canRetry ? (
        <Actions>
          <Button size="sm" variant="default" onClick={onRetry}>
            {RETRY_ICON}
            {t("common.actions.retry")}
          </Button>
          <Button size="sm" variant="outline" onClick={onManageHost}>
            {SETTINGS_ICON}
            {t("workspace.route.manageHost")}
          </Button>
        </Actions>
      ) : null}
    </StateFrame>
  );
}

function WorkspaceEmptyState({
  titleKey,
  hostName,
  description,
  onDismiss,
}: {
  titleKey: "workspace.route.needsHostUpgrade" | "workspace.route.recovery.unavailableTitle";
  hostName?: string;
  description?: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <StateFrame>
      <TextStack>
        <p className="text-foreground">{t(titleKey)}</p>
        <p className="text-muted-foreground">{description ?? hostName}</p>
      </TextStack>
      <Actions>
        <Button size="sm" variant="default" onClick={onDismiss}>
          {BACK_ICON}
          {t("common.actions.back")}
        </Button>
      </Actions>
    </StateFrame>
  );
}

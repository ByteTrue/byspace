// Port of archive/expo-app:packages/app/src/navigation/agent-route-resolution-view.tsx in shadcn/ui: what an
// agent link shows while it waits for its host, looks the agent up, or fails.
import { ArrowLeftToLine, RotateCw, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentRouteResolution } from "@/navigation/agent-route-resolution";
import { formatConnectionStatus } from "@/utils/daemons";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

type VisibleAgentRouteResolution = Extract<
  AgentRouteResolution,
  { kind: "waitingForHost" | "fetchingAgent" | "lookupError" }
>;

function State({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center"
    >
      {children}
    </div>
  );
}

export function AgentRouteResolutionView({
  resolution,
  hostName,
  lastHostError,
  onRetry,
  onManageHost,
  onBack,
}: {
  resolution: VisibleAgentRouteResolution;
  hostName: string;
  lastHostError: string | null;
  onRetry: () => void;
  onManageHost: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  if (resolution.kind === "fetchingAgent") {
    return (
      <State testId="agent-route-fetching">
        <Spinner className="text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            {t("agentPanel.unavailable.preparingSession", { serverLabel: hostName })}
          </p>
          <p className="text-sm text-muted-foreground">{t("agentPanel.unavailable.showSoon")}</p>
        </div>
      </State>
    );
  }

  if (resolution.kind === "lookupError") {
    return (
      <State testId="agent-route-lookup-error">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{t("agentPanel.states.failedToLoad")}</p>
          <p className="text-sm text-destructive">{resolution.error}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onRetry}>
            <RotateCw />
            {t("common.actions.retry")}
          </Button>
          <Button size="sm" variant="outline" onClick={onBack}>
            <ArrowLeftToLine />
            {t("common.actions.back")}
          </Button>
        </div>
      </State>
    );
  }

  const isConnecting =
    resolution.connectionStatus === "connecting" || resolution.connectionStatus === "idle";
  let title = t("workspace.route.cannotReachHost", { hostName });
  if (isConnecting) {
    title = t("agentPanel.unavailable.connecting", { serverLabel: hostName });
  } else if (resolution.connectionStatus === "offline") {
    title = t("workspace.route.hostOffline", { hostName });
  }

  return (
    <State testId="agent-route-waiting-for-host">
      {isConnecting ? <Spinner className="text-muted-foreground" /> : null}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">
          {isConnecting
            ? t("agentPanel.unavailable.showWhenOnline")
            : t("workspace.route.hostStatus", {
                status: formatConnectionStatus(resolution.connectionStatus),
              })}
        </p>
        {lastHostError ? <p className="text-sm text-destructive">{lastHostError}</p> : null}
      </div>
      {isConnecting ? null : (
        <div className="flex gap-2">
          <Button size="sm" onClick={onRetry}>
            <RotateCw />
            {t("common.actions.retry")}
          </Button>
          <Button size="sm" variant="outline" onClick={onManageHost}>
            <Settings />
            {t("workspace.route.manageHost")}
          </Button>
        </div>
      )}
    </State>
  );
}

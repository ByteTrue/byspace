// Override of packages/app/src/panels/setup-panel.tsx: the worktree setup log — one collapsible
// row per setup command, the running one open, its output below. Same logic; the view is DOM.
// Generated from the Expo file by web/scripts/port/setup-panel.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, CircleAlert, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { cn } from "cn";
import {
  useWorkspaceSetupStore,
  type WorkspaceSetupSnapshot,
} from "@/stores/workspace-setup-store";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";

function useSetupPanelDescriptor(
  target: { kind: "setup"; workspaceId: string },
  context: { serverId: string; workspaceId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const key = buildWorkspaceTabPersistenceKey({
    serverId: context.serverId,
    workspaceId: target.workspaceId,
  });
  const snapshot = useWorkspaceSetupStore((state) => (key ? (state.snapshots[key] ?? null) : null));

  if (snapshot?.status === "completed") {
    return {
      label: t("workspace.setup.descriptor.label"),
      subtitle: t("workspace.setup.descriptor.completed"),
      tooltip: t("workspace.setup.descriptor.completed"),
      titleState: "ready",
      icon: CheckCircle2,
      statusBucket: null,
    };
  }

  if (snapshot?.status === "failed") {
    return {
      label: t("workspace.setup.descriptor.label"),
      subtitle: t("workspace.setup.descriptor.failed"),
      tooltip: t("workspace.setup.descriptor.failed"),
      titleState: "ready",
      icon: CircleAlert,
      statusBucket: null,
    };
  }

  if (snapshot?.status === "blocked") {
    return {
      label: t("workspace.setup.descriptor.label"),
      subtitle: t("workspace.setup.descriptor.blocked"),
      tooltip: t("workspace.setup.descriptor.blocked"),
      titleState: "ready",
      icon: CircleAlert,
      statusBucket: null,
    };
  }

  return {
    label: t("workspace.setup.descriptor.label"),
    subtitle: t("workspace.setup.descriptor.workspace"),
    tooltip: t("workspace.setup.descriptor.workspace"),
    titleState: "ready",
    icon: SquareTerminal,
    statusBucket: snapshot?.status === "running" ? "running" : null,
  };
}

type CommandStatus = "running" | "completed" | "failed";

function CommandStatusIcon({ status }: { status: CommandStatus }) {
  if (status === "running") {
    return <LoadingSpinner size={14} className="text-foreground" />;
  }
  if (status === "completed") {
    return <CheckCircle2 size={14} className="text-green-500" />;
  }
  return <CircleAlert size={14} className="text-red-500" />;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Process carriage returns in log text so progress-bar output renders cleanly.
 * Splits on \r, keeps only the last segment per CR-delimited group (unless followed by \n).
 */
function processCarriageReturns(text: string): string {
  if (!text.includes("\r")) return text;
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      const segments = line.split("\r");
      return segments[segments.length - 1];
    })
    .join("\n");
}

type SetupCommand = WorkspaceSetupSnapshot["detail"]["commands"][number];

const EMPTY_COMMANDS: SetupCommand[] = [];

function BlockedSetupNotice({
  serverId,
  workspaceId,
  source,
}: {
  serverId: string;
  workspaceId: string;
  source: NonNullable<WorkspaceSetupSnapshot["blockedSource"]>;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const supportsSetupRun = useHostFeature(serverId, "workspaceSetupRun");
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunningSetup, setIsRunningSetup] = useState(false);
  const runSetup = useCallback(async () => {
    if (!client) return;
    setRunError(null);
    setIsRunningSetup(true);
    try {
      const response = await client.runWorkspaceSetup(workspaceId);
      if (response.error) throw new Error(response.error);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : t("workspace.setup.blocked.runFailed"));
    } finally {
      setIsRunningSetup(false);
    }
  }, [client, t, workspaceId]);

  return (
    <>
      <Alert
        variant="warning"
        title={t("workspace.setup.blocked.title")}
        description={t("workspace.setup.blocked.description", {
          repository: source.headRepository,
        })}
        testID="workspace-setup-blocked"
      >
        {supportsSetupRun ? (
          <Button accessibilityRole="button" onPress={runSetup} loading={isRunningSetup} size="sm">
            {t("workspace.setup.blocked.run")}
          </Button>
        ) : null}
      </Alert>
      {runError ? <Alert variant="error" description={runError} /> : null}
    </>
  );
}

function resolveAutoExpandIndex(commands: { index: number; status: string }[]): number | null {
  const running = commands.find((c) => c.status === "running");
  if (running) return running.index;
  if (commands.length > 0) return commands[commands.length - 1].index;
  return null;
}

function resolveSetupStatusLabel(
  status: string | undefined,
  labels: Record<CommandStatus | "blocked" | "waiting", string>,
): string {
  if (status === "running") return labels.running;
  if (status === "completed") return labels.completed;
  if (status === "failed") return labels.failed;
  if (status === "blocked") return labels.blocked;
  return labels.waiting;
}

function resolveCommandLog(
  command: SetupCommand,
  autoExpandIndex: number | null,
  log: string,
): string {
  if ("log" in command && typeof command.log === "string") {
    return command.log;
  }
  if (command.index === autoExpandIndex) return log;
  return "";
}

interface BuildCommandRowPropsArgs {
  command: SetupCommand;
  autoExpandIndex: number | null;
  log: string;
  expandedIndices: Set<number>;
  manuallyCollapsed: Set<number>;
  snapshotError: string | null | undefined;
}

function buildCommandRowState(args: BuildCommandRowPropsArgs) {
  const { command, autoExpandIndex, log, expandedIndices, manuallyCollapsed, snapshotError } = args;
  const isExpanded = expandedIndices.has(command.index);
  const hasError = command.status === "failed" && Boolean(snapshotError);
  const commandLog = resolveCommandLog(command, autoExpandIndex, log);
  const hasLog = commandLog.trim().length > 0;
  const isExpandable = command.status !== "running" || hasLog || hasError;
  const isAutoExpanded = command.index === autoExpandIndex && !manuallyCollapsed.has(command.index);
  const showDetail = isExpanded || isAutoExpanded;
  const processedLog = hasLog ? processCarriageReturns(commandLog) : "";
  return { hasError, hasLog, isExpandable, isAutoExpanded, showDetail, processedLog };
}

function useWorkspaceSetupSnapshot(serverId: string, workspaceId: string) {
  const client = useHostRuntimeClient(serverId);
  const key = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const snapshot = useWorkspaceSetupStore((state) => (key ? (state.snapshots[key] ?? null) : null));
  const upsertProgress = useWorkspaceSetupStore((state) => state.upsertProgress);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (snapshot || requestedRef.current || !client) return;
    requestedRef.current = true;
    client
      .fetchWorkspaceSetupStatus(workspaceId)
      .then((response) => {
        if (response.snapshot) {
          upsertProgress({
            serverId,
            payload: { workspaceId: response.workspaceId, ...response.snapshot },
          });
        }
        return;
      })
      .catch(() => {
        // Server may not support this yet — ignore.
      });
  }, [client, snapshot, serverId, upsertProgress, workspaceId]);

  return snapshot;
}

function useExpandedSetupCommands() {
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());
  const [manuallyCollapsed, setManuallyCollapsed] = useState<Set<number>>(new Set());
  const toggleExpanded = useCallback((index: number, isAutoExpanded: boolean) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index) || isAutoExpanded) {
        next.delete(index);
        if (isAutoExpanded) setManuallyCollapsed((current) => new Set(current).add(index));
      } else {
        next.add(index);
        setManuallyCollapsed((current) => {
          const updated = new Set(current);
          updated.delete(index);
          return updated;
        });
      }
      return next;
    });
  }, []);
  return { expandedIndices, manuallyCollapsed, toggleExpanded };
}

function SetupPanel() {
  const { t } = useTranslation();
  const { serverId, target } = usePaneContext();
  invariant(target.kind === "setup", "SetupPanel requires setup target");

  const snapshot = useWorkspaceSetupSnapshot(serverId, target.workspaceId);

  const commands = snapshot?.detail.commands ?? EMPTY_COMMANDS;
  const log = snapshot?.detail.log ?? "";
  const hasNoSetupCommands =
    snapshot?.status === "completed" && commands.length === 0 && log.trim().length === 0;
  const isWaiting = !snapshot || (snapshot.status === "running" && commands.length === 0);

  const { expandedIndices, manuallyCollapsed, toggleExpanded } = useExpandedSetupCommands();

  const autoExpandIndex = resolveAutoExpandIndex(commands);
  const statusLabels = useMemo(
    () => ({
      running: t("workspace.setup.status.running"),
      completed: t("workspace.setup.status.completed"),
      failed: t("workspace.setup.status.failed"),
      blocked: t("workspace.setup.status.blocked"),
      waiting: t("workspace.setup.status.waiting"),
    }),
    [t],
  );
  const statusLabel = resolveSetupStatusLabel(snapshot?.status, statusLabels);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background p-4"
      data-testid="workspace-setup-panel"
    >
      {/* Hidden element for status — preserves testID for E2E */}
      <span className="sr-only" data-testid="workspace-setup-status">
        {statusLabel}
      </span>
      <SetupPanelBody
        serverId={serverId}
        workspaceId={target.workspaceId}
        snapshot={snapshot}
        commands={commands}
        log={log}
        isWaiting={isWaiting}
        hasNoSetupCommands={hasNoSetupCommands}
        autoExpandIndex={autoExpandIndex}
        expandedIndices={expandedIndices}
        manuallyCollapsed={manuallyCollapsed}
        onToggle={toggleExpanded}
      />
    </div>
  );
}

interface SetupPanelBodyProps {
  serverId: string;
  workspaceId: string;
  snapshot: WorkspaceSetupSnapshot | null;
  commands: SetupCommand[];
  log: string;
  isWaiting: boolean;
  hasNoSetupCommands: boolean;
  autoExpandIndex: number | null;
  expandedIndices: Set<number>;
  manuallyCollapsed: Set<number>;
  onToggle: (index: number, isAutoExpanded: boolean) => void;
}

function SetupPanelBody(props: SetupPanelBodyProps) {
  const { t } = useTranslation();
  const { snapshot, commands, log } = props;
  if (snapshot?.status === "blocked" && snapshot.blockedSource) {
    return (
      <BlockedSetupNotice
        serverId={props.serverId}
        workspaceId={props.workspaceId}
        source={snapshot.blockedSource}
      />
    );
  }
  if (props.isWaiting) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <LoadingSpinner size="large" className="text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{t("workspace.setup.waiting")}</span>
      </div>
    );
  }
  if (props.hasNoSetupCommands) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span
          className="text-sm text-muted-foreground"
          aria-label={t("workspace.setup.accessibility.noCommands")}
        >
          {t("workspace.setup.empty.noCommands")}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {commands.map((command) => {
        const rowState = buildCommandRowState({
          command,
          autoExpandIndex: props.autoExpandIndex,
          log,
          expandedIndices: props.expandedIndices,
          manuallyCollapsed: props.manuallyCollapsed,
          snapshotError: snapshot?.error,
        });
        return (
          <SetupCommandRow
            key={`${command.index}:${command.command}`}
            command={command}
            {...rowState}
            errorMessage={snapshot?.error ?? null}
            onToggle={props.onToggle}
          />
        );
      })}
      <StandaloneLogView commands={commands} log={log} />
      <TopLevelSetupError snapshotError={snapshot?.error ?? null} commands={commands} />
    </div>
  );
}

interface SetupCommandRowProps {
  command: SetupCommand;
  showDetail: boolean;
  isAutoExpanded: boolean;
  isExpandable: boolean;
  hasLog: boolean;
  hasError: boolean;
  processedLog: string;
  errorMessage: string | null;
  onToggle: (index: number, isAutoExpanded: boolean) => void;
}

function SetupCommandRow({
  command,
  showDetail,
  isAutoExpanded,
  isExpandable,
  hasLog,
  hasError,
  processedLog,
  errorMessage,
  onToggle,
}: SetupCommandRowProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    if (!isExpandable) return;
    onToggle(command.index, isAutoExpanded);
  }, [command.index, isAutoExpanded, isExpandable, onToggle]);

  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={handlePress}
        aria-expanded={showDetail}
        className={cn(
          "flex w-full items-center gap-2 bg-card px-3 py-2 text-left outline-none focus-visible:bg-accent active:opacity-80",
          showDetail && "border-b",
          !isExpandable && "cursor-default",
        )}
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center">
          <CommandStatusIcon status={command.status} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm leading-[18px] text-foreground">
          {command.command}
        </span>
        {command.durationMs != null ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatDuration(command.durationMs)}
          </span>
        ) : null}
        <SetupCommandChevron showDetail={showDetail} />
      </button>
      {showDetail ? (
        <div className="bg-background">
          {hasLog ? (
            <div
              className="max-h-[400px] overflow-y-auto p-3"
              data-testid="workspace-setup-log"
              aria-label={t("workspace.setup.accessibility.log")}
            >
              <pre className="font-mono text-[13px] leading-5 whitespace-pre-wrap break-words text-foreground select-text">
                {processedLog}
              </pre>
            </div>
          ) : (
            <div
              className="p-3"
              data-testid="workspace-setup-log"
              aria-label={t("workspace.setup.accessibility.log")}
            >
              <span className="text-sm text-muted-foreground italic">
                {t("workspace.setup.log.noOutput")}
              </span>
            </div>
          )}
          {hasError && errorMessage ? (
            <div className="bg-red-100 p-3 text-sm leading-[18px] whitespace-pre-wrap text-red-800 select-text dark:bg-red-950 dark:text-red-200">
              {errorMessage}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const setupPanelRegistration = definePanel("setup", {
  component: SetupPanel,
  useDescriptor: useSetupPanelDescriptor,
});

function SetupCommandChevron({ showDetail }: { showDetail: boolean }) {
  return (
    <ChevronRight
      size={14}
      className={cn("shrink-0 text-muted-foreground", showDetail && "rotate-90")}
    />
  );
}

function StandaloneLogView({ commands, log }: { commands: SetupCommand[]; log: string }) {
  const { t } = useTranslation();
  if (commands.length !== 0 || log.trim().length === 0) return null;
  return (
    <div
      className="max-h-[400px] overflow-y-auto p-3"
      data-testid="workspace-setup-log"
      aria-label={t("workspace.setup.accessibility.log")}
    >
      <pre className="font-mono text-[13px] leading-5 whitespace-pre-wrap break-words text-foreground select-text">
        {log}
      </pre>
    </div>
  );
}

function TopLevelSetupError({
  snapshotError,
  commands,
}: {
  snapshotError: string | null;
  commands: SetupCommand[];
}) {
  if (!snapshotError) return null;
  if (commands.some((c) => c.status === "failed")) return null;
  return (
    <div className="bg-red-100 p-3 text-sm leading-[18px] whitespace-pre-wrap text-red-800 select-text dark:bg-red-950 dark:text-red-200">
      {snapshotError}
    </div>
  );
}

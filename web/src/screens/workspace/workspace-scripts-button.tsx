// Port of archive/expo-app:packages/app/src/screens/workspace/workspace-scripts-button.tsx: the header's
// Scripts button and its panel (each script with run/stop/restart/view, services with their URL).
// Same mutations, restart model and test IDs. The panel is a popover rather than a menu: its rows
// hold several buttons each, which a menu's single-item focus model hides from the keyboard.
import * as Clipboard from "@/platform/clipboard";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ChevronDown,
  Copy,
  Eye,
  Globe,
  Play,
  RotateCw,
  Square,
  SquareTerminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { openServiceUrl } from "@/screens/open-service-url";
import { resolveWorkspaceScriptLink } from "@/screens/workspace-script-links";
import { cn } from "cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Button } from "@/ui/button";

type RowActionIcon = "copy" | "open" | "restart" | "start" | "stop" | "terminal";
type ScriptDescriptor = WorkspaceDescriptor["scripts"][number];
type ActiveConnection = NonNullable<ReturnType<typeof useHostRuntimeSnapshot>>["activeConnection"];

interface WorkspaceScriptsButtonProps {
  serverId: string;
  workspaceId: string;
  scripts: WorkspaceDescriptor["scripts"];
  liveTerminalIds?: readonly string[];
  onScriptTerminalStarted?: (terminalId: string) => void;
  onViewTerminal?: (terminalId: string) => void;
  hideLabels?: boolean;
  /** Icon-only header actions are unframed, like the icons beside them. */
  ghost?: boolean;
  /** shadcn's Button size for the trigger; default is the standalone size. */
  size?: "default" | "sm";
  presentation?: "split" | "ghost";
}

/** Closes the scripts panel; actions that leave it (open, copy) call it first, as the Expo app does. */
const ClosePanelContext = createContext<() => void>(() => undefined);

const ROW_ICONS = {
  copy: { Icon: Copy, size: 11 },
  open: { Icon: Eye, size: 12 },
  restart: { Icon: RotateCw, size: 11 },
  start: { Icon: Play, size: 11 },
  stop: { Icon: Square, size: 11 },
  terminal: { Icon: SquareTerminal, size: 12 },
} as const;

function ScriptRowActionButton({
  accessibilityLabel,
  disabled,
  icon,
  onPress,
  testID,
  tooltipLabel,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  icon: RowActionIcon;
  onPress: () => void;
  testID: string;
  tooltipLabel: string;
}): ReactElement {
  const { Icon, size } = ROW_ICONS[icon];
  const handleClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={accessibilityLabel}
          data-testid={testID}
          disabled={disabled}
          onClick={handleClick}
        >
          <Icon size={size} fill={icon === "start" ? "transparent" : undefined} />
        </Button>
      </TooltipTrigger>
      <TooltipContent data-testid={`${testID}-tooltip`} side="top">
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  );
}

function ServiceLinkRow({
  link,
  scriptName,
  onCopy,
}: {
  link: { label: string; url: string };
  scriptName: string;
  onCopy: (url: string, label: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const closePanel = useContext(ClosePanelContext);
  const { label, url } = link;
  const handleCopy = useCallback(() => {
    closePanel();
    onCopy(url, label);
  }, [closePanel, label, onCopy, url]);
  return (
    <div className="flex min-h-[18px] items-center gap-2 py-0.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="size-3.5" />
        <span className="min-w-0 shrink truncate text-xs leading-[14px] text-muted-foreground">
          {label}
        </span>
      </div>
      <ScriptRowActionButton
        accessibilityLabel={t("workspace.scripts.accessibility.copyUrl", { scriptName })}
        testID={`workspace-scripts-copy-${scriptName}`}
        icon="copy"
        onPress={handleCopy}
        tooltipLabel={t("workspace.scripts.actions.copyUrl")}
      />
    </div>
  );
}

function ExitCodeBadge({ code }: { code: number }): ReactElement {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "rounded-[2px] bg-muted px-1.5 py-px text-[10px] leading-3 font-medium text-muted-foreground",
        code !== 0 && "text-red-300",
      )}
    >
      {t("workspace.scripts.states.exitCode", { code })}
    </span>
  );
}

function scriptIconClass(script: ScriptDescriptor, isService: boolean, isRunning: boolean): string {
  if (!isRunning) return "text-muted-foreground";
  if (isService && script.health === "healthy") return "text-green-500";
  if (isService && script.health === "unhealthy") return "text-red-500";
  return "text-blue-500";
}

function ScriptRow({
  script,
  liveTerminalIdSet,
  activeConnection,
  isStartPending,
  isStopPending,
  onStartScript,
  onStopScript,
  onRestartScript,
  onCopyUrl,
  onViewTerminal,
}: {
  script: ScriptDescriptor;
  liveTerminalIdSet: Set<string>;
  activeConnection: ActiveConnection | null;
  isStartPending: boolean;
  isStopPending: boolean;
  onStartScript: (scriptName: string) => void;
  onStopScript: (scriptName: string) => void;
  onRestartScript: (scriptName: string) => void;
  onCopyUrl: (url: string, label: string) => void;
  onViewTerminal?: (terminalId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const closePanel = useContext(ClosePanelContext);
  const isRunning = script.lifecycle === "running";
  const isService = (script.type ?? "service") === "service";
  const exitCode = script.exitCode ?? null;
  const selectedLink = resolveWorkspaceScriptLink({ script, activeConnection });
  const liveTerminalId =
    script.terminalId && liveTerminalIdSet.has(script.terminalId) ? script.terminalId : null;
  const ScriptIcon = isService ? Globe : SquareTerminal;
  const name = script.scriptName;

  const handleOpenService = useCallback(() => {
    if (!selectedLink) return;
    closePanel();
    void openServiceUrl(selectedLink.url);
  }, [closePanel, selectedLink]);
  const handleView = useCallback(() => {
    if (liveTerminalId) onViewTerminal?.(liveTerminalId);
  }, [liveTerminalId, onViewTerminal]);
  const handleRun = useCallback(() => onStartScript(name), [name, onStartScript]);
  const handleStop = useCallback(() => onStopScript(name), [name, onStopScript]);
  const handleRestart = useCallback(() => onRestartScript(name), [name, onRestartScript]);

  return (
    <div
      data-testid={`workspace-scripts-item-${name}`}
      aria-label={t("workspace.scripts.accessibility.script", { scriptName: name })}
    >
      <div className="flex min-h-7 items-center gap-2 px-3">
        <ScriptIcon
          size={14}
          className={cn("shrink-0", scriptIconClass(script, isService, isRunning))}
        />
        <span
          className={cn(
            "min-w-0 shrink truncate text-sm leading-[18px]",
            isRunning ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {name}
        </span>
        {!isRunning && exitCode !== null ? <ExitCodeBadge code={exitCode} /> : null}
        <span className="min-w-0 flex-1" />
        {selectedLink ? (
          <ScriptRowActionButton
            accessibilityLabel={t("workspace.scripts.accessibility.openService", {
              scriptName: name,
            })}
            testID={`workspace-scripts-open-${name}`}
            icon="open"
            onPress={handleOpenService}
            tooltipLabel={t("workspace.scripts.actions.openService")}
          />
        ) : null}
        {isRunning && liveTerminalId ? (
          <ScriptRowActionButton
            accessibilityLabel={t("workspace.scripts.accessibility.viewTerminal", {
              scriptName: name,
            })}
            testID={`workspace-scripts-view-${name}`}
            icon="terminal"
            onPress={handleView}
            tooltipLabel={t("workspace.scripts.actions.view")}
          />
        ) : null}
        {isRunning ? (
          <ScriptRowActionButton
            accessibilityLabel={t("workspace.scripts.accessibility.restartScript", {
              scriptName: name,
            })}
            testID={`workspace-scripts-restart-${name}`}
            disabled={isStopPending}
            icon="restart"
            onPress={handleRestart}
            tooltipLabel={t("workspace.scripts.actions.restart")}
          />
        ) : null}
        {isRunning ? (
          <ScriptRowActionButton
            accessibilityLabel={t("workspace.scripts.accessibility.stopScript", {
              scriptName: name,
            })}
            testID={`workspace-scripts-stop-${name}`}
            disabled={isStopPending}
            icon="stop"
            onPress={handleStop}
            tooltipLabel={t("workspace.scripts.actions.stop")}
          />
        ) : (
          <ScriptRowActionButton
            accessibilityLabel={t("workspace.scripts.accessibility.runScript", {
              scriptName: name,
            })}
            testID={`workspace-scripts-start-${name}`}
            disabled={isStartPending}
            icon="start"
            onPress={handleRun}
            tooltipLabel={t("workspace.scripts.actions.run")}
          />
        )}
      </div>
      {selectedLink ? (
        <div className="mt-0.5 px-3">
          <ServiceLinkRow link={selectedLink} scriptName={name} onCopy={onCopyUrl} />
        </div>
      ) : null}
    </div>
  );
}

function computeTriggerSize(size: "default" | "sm", compact: boolean) {
  if (size === "sm") return compact ? "icon-sm" : "sm";
  return compact ? "icon" : "default";
}

export function WorkspaceScriptsButton({
  serverId,
  workspaceId,
  scripts,
  liveTerminalIds = [],
  onScriptTerminalStarted,
  onViewTerminal,
  hideLabels,
  size = "default",
  ghost: ghostProp = false,
  presentation = "split",
}: WorkspaceScriptsButtonProps): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const closePanel = useCallback(() => setOpen(false), []);
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const activeConnection = useHostRuntimeSnapshot(serverId)?.activeConnection ?? null;
  const liveTerminalIdSet = useMemo(() => new Set(liveTerminalIds), [liveTerminalIds]);
  const pendingRestartRef = useRef<Set<string>>(new Set());

  const startScriptMutation = useMutation({
    mutationFn: async (scriptName: string) => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      const result = await client.startWorkspaceScript(workspaceId, scriptName);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onError: (error, scriptName) => {
      toast.show(
        error instanceof Error
          ? error.message
          : t("workspace.scripts.states.startFailed", { scriptName }),
        { variant: "error" },
      );
    },
    onSuccess: (result) => {
      if (result.terminalId) onScriptTerminalStarted?.(result.terminalId);
    },
  });
  const startScript = startScriptMutation.mutate;

  const stopScriptMutation = useMutation({
    mutationFn: async (scriptName: string) => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      const terminalId = scripts.find((s) => s.scriptName === scriptName)?.terminalId;
      if (!terminalId) throw new Error(t("workspace.scripts.states.stopFailed", { scriptName }));
      const result = await client.killTerminal(terminalId);
      if (!result.success)
        throw new Error(t("workspace.scripts.states.stopFailed", { scriptName }));
    },
    onError: (error, scriptName) => {
      pendingRestartRef.current.delete(scriptName);
      toast.show(
        error instanceof Error
          ? error.message
          : t("workspace.scripts.states.stopFailed", { scriptName }),
        { variant: "error" },
      );
    },
  });

  // Restart = kill the script terminal, then start again once the daemon reports the script as
  // stopped (it tears the runtime entry down on exit).
  useEffect(() => {
    const pending = pendingRestartRef.current;
    if (pending.size === 0) return;
    for (const script of scripts) {
      if (!pending.has(script.scriptName) || script.lifecycle === "running") continue;
      pending.delete(script.scriptName);
      startScript(script.scriptName);
    }
  }, [scripts, startScript]);

  const handleStartScript = useCallback(
    (scriptName: string) => startScriptMutation.mutate(scriptName),
    [startScriptMutation],
  );
  const handleStopScript = useCallback(
    (scriptName: string) => stopScriptMutation.mutate(scriptName),
    [stopScriptMutation],
  );
  const handleRestartScript = useCallback(
    (scriptName: string) => {
      pendingRestartRef.current.add(scriptName);
      stopScriptMutation.mutate(scriptName);
    },
    [stopScriptMutation],
  );
  const handleCopyUrl = useCallback(
    (url: string, label: string) => {
      void Clipboard.writeText(url);
      toast.copied(label);
    },
    [toast],
  );
  if (scripts.length === 0) return null;
  const hasAnyRunning = scripts.some((s) => s.lifecycle === "running");
  const ghost = presentation === "ghost" || ghostProp;
  const triggerSize = computeTriggerSize(size, ghost || hideLabels === true);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* `size` shrinks the trigger in the workspace's 36px header. */}
          <Button
            variant={ghost ? "ghost" : "outline"}
            size={triggerSize}
            data-testid="workspace-scripts-button"
            aria-label={t("workspace.scripts.accessibility.trigger")}
          >
            <Play className={hasAnyRunning ? "text-blue-500" : undefined} />
            {hideLabels || ghost ? null : t("workspace.scripts.title")}
            {ghost || hideLabels ? null : <ChevronDown data-icon="inline-end" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={4}
          className="w-auto max-w-[280px] min-w-[200px] gap-0 p-1"
          data-testid="workspace-scripts-menu"
        >
          <ClosePanelContext value={closePanel}>
            {scripts.map((script) => (
              <ScriptRow
                key={script.scriptName}
                script={script}
                liveTerminalIdSet={liveTerminalIdSet}
                activeConnection={activeConnection}
                isStartPending={startScriptMutation.isPending}
                isStopPending={stopScriptMutation.isPending}
                onStartScript={handleStartScript}
                onStopScript={handleStopScript}
                onRestartScript={handleRestartScript}
                onCopyUrl={handleCopyUrl}
                onViewTerminal={onViewTerminal}
              />
            ))}
          </ClosePanelContext>
        </PopoverContent>
      </Popover>
    </div>
  );
}

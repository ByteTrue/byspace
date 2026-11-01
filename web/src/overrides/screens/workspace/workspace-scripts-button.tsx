// Override of packages/app/src/screens/workspace/workspace-scripts-button.tsx: the header's
// Scripts button and its panel (each script with run/stop/restart/view, services with their URL
// and route choice). Same mutations, restart model and test IDs. The panel is a popover rather
// than a menu: its rows hold several buttons each, which a menu's single-item focus model hides
// from the keyboard.
import * as Clipboard from "expo-clipboard";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { openServiceUrl } from "@/utils/open-service-url";
import {
  resolveWorkspaceScriptLink,
  type WorkspaceScriptLinkKind,
  type WorkspaceScriptLinkTarget,
} from "@/utils/workspace-script-links";
import { useWorkspaceServiceRoutePreferencesStore } from "@/workspace-service-routes/store";
import { cn } from "cn";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";

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
  presentation?: "split" | "ghost";
}

/** Closes the scripts panel; actions that leave it (open, copy) call it first, as packages/app does. */
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
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={accessibilityLabel}
          data-testid={testID}
          disabled={disabled}
          onClick={handleClick}
          className="rounded-sm p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <Icon size={size} fill={icon === "start" ? "transparent" : undefined} />
        </button>
      </TooltipTrigger>
      <TooltipContent testID={`${testID}-tooltip`} side="top" offset={8}>
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  );
}

function routeLabelKey(kind: WorkspaceScriptLinkKind) {
  switch (kind) {
    case "public":
      return "workspace.scripts.routes.public" as const;
    case "byspace":
      return "workspace.scripts.routes.byspace" as const;
    case "direct":
      return "workspace.scripts.routes.direct" as const;
  }
}

function ServiceRouteOption({
  scriptName,
  selectedKind,
  target,
  onSelect,
}: {
  scriptName: string;
  selectedKind: WorkspaceScriptLinkKind;
  target: WorkspaceScriptLinkTarget;
  onSelect: (kind: WorkspaceScriptLinkKind) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(target.kind), [onSelect, target.kind]);
  return (
    <DropdownMenuItem
      testID={`workspace-scripts-route-${scriptName}-${target.kind}`}
      selected={target.kind === selectedKind}
      showSelectedCheck
      description={target.label}
      onSelect={handleSelect}
    >
      {t(routeLabelKey(target.kind))}
    </DropdownMenuItem>
  );
}

function ServiceRouteSelector({
  scriptName,
  selectedTarget,
  targets,
  onSelect,
}: {
  scriptName: string;
  selectedTarget: WorkspaceScriptLinkTarget;
  targets: WorkspaceScriptLinkTarget[];
  onSelect: (kind: WorkspaceScriptLinkKind) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            accessibilityLabel={t("workspace.scripts.accessibility.chooseUrl", { scriptName })}
            testID={`workspace-scripts-route-${scriptName}`}
            className="group/route flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
          >
            <span className="flex size-3.5 items-center justify-center text-muted-foreground group-hover/route:text-foreground">
              <ChevronDown size={14} />
            </span>
            <span className="min-w-0 shrink truncate text-xs leading-[14px] text-muted-foreground group-hover/route:text-foreground">
              {selectedTarget.label}
            </span>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent
          testID={`workspace-scripts-route-${scriptName}-tooltip`}
          side="top"
          offset={8}
        >
          {t("workspace.scripts.actions.chooseUrl")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="bottom" align="end" minWidth={220} maxWidth={280}>
        {targets.map((target) => (
          <ServiceRouteOption
            key={target.kind}
            scriptName={scriptName}
            selectedKind={selectedTarget.kind}
            target={target}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ServiceLinkRow({
  selectedTarget,
  targets,
  scriptName,
  onSelectKind,
  onCopy,
}: {
  selectedTarget: WorkspaceScriptLinkTarget;
  targets: WorkspaceScriptLinkTarget[];
  scriptName: string;
  onSelectKind: (kind: WorkspaceScriptLinkKind) => void;
  onCopy: (url: string, label: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const closePanel = useContext(ClosePanelContext);
  const { label, url } = selectedTarget;
  const handleCopy = useCallback(() => {
    closePanel();
    onCopy(url, label);
  }, [closePanel, label, onCopy, url]);
  return (
    <div className="flex min-h-[18px] items-center gap-2 py-0.5">
      {targets.length > 1 ? (
        <ServiceRouteSelector
          scriptName={scriptName}
          selectedTarget={selectedTarget}
          targets={targets}
          onSelect={onSelectKind}
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="size-3.5" />
          <span className="min-w-0 shrink truncate text-xs leading-[14px] text-muted-foreground">
            {label}
          </span>
        </div>
      )}
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
  preferredRouteKind,
  onSelectRouteKind,
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
  preferredRouteKind: WorkspaceScriptLinkKind | null;
  onSelectRouteKind: (kind: WorkspaceScriptLinkKind) => void;
  onViewTerminal?: (terminalId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const closePanel = useContext(ClosePanelContext);
  const isRunning = script.lifecycle === "running";
  const isService = (script.type ?? "service") === "service";
  const exitCode = script.exitCode ?? null;
  const serviceLink = resolveWorkspaceScriptLink({ script, activeConnection });
  const selectedLink =
    isService && isRunning
      ? (serviceLink.targets.find((target) => target.kind === preferredRouteKind) ??
        serviceLink.primary)
      : null;
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
          <ServiceLinkRow
            selectedTarget={selectedLink}
            targets={serviceLink.targets}
            scriptName={name}
            onSelectKind={onSelectRouteKind}
            onCopy={onCopyUrl}
          />
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceScriptsButton({
  serverId,
  workspaceId,
  scripts,
  liveTerminalIds = [],
  onScriptTerminalStarted,
  onViewTerminal,
  hideLabels,
  presentation = "split",
}: WorkspaceScriptsButtonProps): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const closePanel = useCallback(() => setOpen(false), []);
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const activeConnection = useHostRuntimeSnapshot(serverId)?.activeConnection ?? null;
  const preferredRouteKind = useWorkspaceServiceRoutePreferencesStore(
    (state) => state.byServerId[serverId] ?? null,
  );
  const setPreferredRoute = useWorkspaceServiceRoutePreferencesStore(
    (state) => state.setPreferredRoute,
  );
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
      void Clipboard.setStringAsync(url);
      toast.copied(label);
    },
    [toast],
  );
  const handleSelectRouteKind = useCallback(
    (kind: WorkspaceScriptLinkKind) => setPreferredRoute(serverId, kind),
    [serverId, setPreferredRoute],
  );

  if (scripts.length === 0) return null;
  const hasAnyRunning = scripts.some((s) => s.lifecycle === "running");
  const ghost = presentation === "ghost";

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="workspace-scripts-button"
            aria-label={t("workspace.scripts.accessibility.trigger")}
            className={cn(
              "flex items-center justify-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              ghost
                ? "size-8 rounded-lg hover:bg-muted aria-expanded:bg-muted"
                : "h-8 rounded-md border bg-background px-3 hover:bg-muted aria-expanded:bg-muted md:h-7 md:px-2 dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
            )}
          >
            <span className="flex items-center justify-center gap-1.5 md:gap-1">
              <Play
                size={ghost ? 16 : 14}
                strokeWidth={ghost ? 1.5 : 2}
                fill="transparent"
                className={hasAnyRunning ? "text-blue-500" : "text-muted-foreground"}
              />
              {hideLabels ? null : (
                <span className="text-sm font-medium text-foreground">
                  {t("workspace.scripts.title")}
                </span>
              )}
              {ghost ? null : <ChevronDown size={16} className="text-extra-muted-foreground" />}
            </span>
          </button>
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
                preferredRouteKind={preferredRouteKind}
                onSelectRouteKind={handleSelectRouteKind}
                onViewTerminal={onViewTerminal}
              />
            ))}
          </ClosePanelContext>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Port of archive/expo-app:packages/app/src/command-center/command-center.tsx. The state (built-in rows,
// sections, ranking, scope, focus restore) is the Expo file's, unchanged; the view is shadcn's
// CommandDialog. cmdk's own filtering and pointer selection are off: ranking and the active row
// stay with results.ts, and keys go through the same handler as before.
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Folder, X } from "lucide-react";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { useHosts } from "@/runtime/host-runtime";
import {
  useKeyboardShortcutsStore,
  type CommandCenterScope,
} from "@/stores/keyboard-shortcuts-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import {
  clearCommandCenterFocusRestoreElement,
  takeCommandCenterFocusRestoreElement,
} from "@/utils/command-center-focus-restore";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { shortenPath } from "@/utils/shorten-path";
import { formatTimeAgo } from "@/utils/time";
import { focusWithRetries } from "@/utils/web-focus";
import { useCommandCenterContributions } from "@/command-center/provider";
import {
  buildContributionSections,
  filterAndRankBuiltInResults,
  joinSubtitleParts,
  moveActiveResultId,
  PINNED_SECTION_BAND,
  preserveActiveResultId,
  projectCommandCenterRows,
  type CommandCenterAgentResult,
  type CommandCenterFileResult,
  type CommandCenterListGroup,
  type CommandCenterResult,
  type CommandCenterResultSection,
  type CommandCenterSearchFields,
  type CommandCenterWorkspaceResult,
} from "@/command-center/results";
import { useWorkspaceFileSearch } from "@/command-center/workspace-file-search";
import { filterAndRankWorkspaces } from "@/command-center/workspace-search";
import { AgentStatusDot } from "~/components/agent-status-dot";
import { FileIcon } from "~/components/file-icon";
import { Shortcut } from "~/components/shortcut";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "~/components/ui/command";
import { Spinner } from "~/components/ui/spinner";
import { Button } from "~/components/ui/button";

function sortAgents(left: AggregatedAgent, right: AggregatedAgent): number {
  const leftNeedsInput = (left.pendingPermissionCount ?? 0) > 0 ? 1 : 0;
  const rightNeedsInput = (right.pendingPermissionCount ?? 0) > 0 ? 1 : 0;
  if (leftNeedsInput !== rightNeedsInput) return rightNeedsInput - leftNeedsInput;
  const leftAttention = left.requiresAttention ? 1 : 0;
  const rightAttention = right.requiresAttention ? 1 : 0;
  if (leftAttention !== rightAttention) return rightAttention - leftAttention;
  const leftRunning = left.status === "running" ? 1 : 0;
  const rightRunning = right.status === "running" ? 1 : 0;
  if (leftRunning !== rightRunning) return rightRunning - leftRunning;
  return right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
}

function compareWorkspacesByTitle(
  left: CommandCenterWorkspaceResult,
  right: CommandCenterWorkspaceResult,
): number {
  const titleDelta = left.title.localeCompare(right.title, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return titleDelta || left.subtitle.localeCompare(right.subtitle);
}

/** `cwd` is not rendered, so a path match must never outrank a match on text the user can see. */
function agentSearchFields(result: CommandCenterAgentResult): CommandCenterSearchFields {
  return { visible: [result.title, result.subtitle], hidden: [result.agent.cwd] };
}

/**
 * Build every pinned row, in its default order. Deliberately not keyed on `query`: none of this
 * work depends on what was typed, and rebuilding it per keystroke means re-running an Intl
 * collation sort over every workspace.
 *
 * The cost is that `formatTimeAgo` is baked into the agent subtitle here, so relative timestamps
 * now refresh when agents or projects change rather than on every keystroke.
 */
function useBuiltInRows(open: boolean): {
  workspaces: CommandCenterWorkspaceResult[];
  agents: CommandCenterAgentResult[];
} {
  const { t } = useTranslation();
  const { agents } = useAggregatedAgents({ demand: open });
  const { projects } = useProjects({ enabled: open });
  const showHost = useHosts().length > 1;

  return useMemo(() => {
    if (!open) return { workspaces: [], agents: [] };
    const allWorkspaces: CommandCenterWorkspaceResult[] = [];
    for (const project of projects) {
      for (const host of project.hosts) {
        for (const workspace of host.workspaces) {
          if (workspace.archivingAt) continue;
          allWorkspaces.push({
            kind: "workspace",
            id: `workspace:${host.serverId}:${workspace.id}`,
            title: workspace.title ?? workspace.name,
            subtitle: joinSubtitleParts([
              showHost ? host.serverName : null,
              project.projectName,
              workspace.currentBranch,
            ]),
            changeRequestNumber: workspace.changeRequestNumber,
            run: () => {
              clearCommandCenterFocusRestoreElement();
              navigateToWorkspace({ serverId: host.serverId, workspaceId: workspace.id });
            },
          });
        }
      }
    }
    allWorkspaces.sort(compareWorkspacesByTitle);
    const workspaceTitleByKey = new Map(
      allWorkspaces.map((workspace) => [workspace.id.slice("workspace:".length), workspace.title]),
    );
    const agentRows = agents
      .map<CommandCenterAgentResult>((agent) => {
        const workspaceTitle = agent.workspaceId
          ? workspaceTitleByKey.get(`${agent.serverId}:${agent.workspaceId}`)
          : undefined;
        return {
          kind: "agent",
          id: `agent:${agent.serverId}:${agent.id}`,
          agent,
          title: agent.title || t("shell.commandCenter.newAgent"),
          subtitle: joinSubtitleParts([
            showHost ? agent.serverLabel : null,
            workspaceTitle ?? shortenPath(agent.cwd),
            formatTimeAgo(agent.lastActivityAt),
          ]),
          run: () => {
            clearCommandCenterFocusRestoreElement();
            navigateToAgent({ serverId: agent.serverId, agentId: agent.id });
          },
        };
      })
      .sort((left, right) => sortAgents(left.agent, right.agent));
    return { workspaces: allWorkspaces, agents: agentRows };
  }, [agents, open, projects, showHost, t]);
}

function useBuiltInSections(open: boolean, query: string): CommandCenterResultSection[] {
  const { t } = useTranslation();
  const rows = useBuiltInRows(open);

  return useMemo(() => {
    if (!open) return [];
    return [
      {
        id: "workspaces",
        band: PINNED_SECTION_BAND,
        rank: 2,
        title: t("shell.commandCenter.workspaces"),
        results: filterAndRankWorkspaces(rows.workspaces, query, compareWorkspacesByTitle),
      },
      {
        id: "agents",
        band: PINNED_SECTION_BAND,
        rank: 3,
        title: t("shell.commandCenter.agents"),
        results: filterAndRankBuiltInResults(rows.agents, query, agentSearchFields, (left, right) =>
          sortAgents(left.agent, right.agent),
        ),
      },
    ];
  }, [open, query, rows, t]);
}

interface CommandCenterState {
  open: boolean;
  scope: CommandCenterScope;
  clearScope(): void;
  query: string;
  setQuery(query: string): void;
  activeId: string | null;
  /** The pointer moved onto a row: Command makes it the active one. */
  setActiveId(id: string): void;
  groups: readonly CommandCenterListGroup[];
  results: readonly CommandCenterResult[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  fileSearchLoading: boolean;
  fileSearchError: string | null;
  close(): void;
  select(result: CommandCenterResult): void;
  key(key: string): boolean;
}

function useCommandCenterState(): CommandCenterState {
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  const { t } = useTranslation();
  const open = useKeyboardShortcutsStore((state) => state.commandCenterOpen);
  const scope = useKeyboardShortcutsStore((state) => state.commandCenterScope);
  const setOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const setScope = useKeyboardShortcutsStore((state) => state.setCommandCenterScope);
  const snapshot = useCommandCenterContributions();
  const inputRef = useRef<HTMLInputElement>(null);
  const previousOpenRef = useRef(open);
  const [query, setQueryState] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const builtInSections = useBuiltInSections(open, query);
  const {
    entries: fileSearchEntries,
    loading: fileSearchLoading,
    error: fileSearchError,
    openFile,
  } = useWorkspaceFileSearch({
    enabled: open && (scope === "files" || Boolean(query.trim())),
    query,
  });
  const fileSections = useMemo<CommandCenterResultSection[]>(() => {
    const results = fileSearchEntries.map<CommandCenterFileResult>((entry) => ({
      kind: "file",
      id: `file:${entry.path}`,
      filePath: entry.path,
      title: entry.name,
      subtitle: entry.directory,
      run: () => openFile(entry.path),
    }));
    // File rows are matched by the daemon, so they carry no client-side score and cannot be
    // relevance-compared against the rows that do. Pinning them keeps the section comparator
    // total: band is decided before any score is read.
    return [
      {
        id: "files",
        band: PINNED_SECTION_BAND,
        rank: 4,
        title: t("shell.commandCenter.files"),
        results,
      },
    ];
  }, [fileSearchEntries, openFile, t]);
  const contributionSections = useMemo(
    () => buildContributionSections(snapshot.contributions, query),
    [query, snapshot.contributions],
  );
  const projection = useMemo(
    () =>
      projectCommandCenterRows(
        scope === "files"
          ? fileSections
          : [...contributionSections, ...fileSections, ...builtInSections],
      ),
    [builtInSections, contributionSections, fileSections, scope],
  );
  const resolvedActiveId = preserveActiveResultId(activeId, projection.selectableResults);

  // Editing the query re-ranks everything, so an arrow-key selection made under the previous
  // query is no longer meaningful. Reset it in the same update as the query rather than in an
  // effect, so there is no intermediate render holding the stale selection.
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setActiveId(null);
  }, []);

  const close = useCallback(() => setOpen(false), [setOpen]);
  const select = useCallback(
    (result: CommandCenterResult) => {
      setOpen(false);
      void result.run();
    },
    [setOpen],
  );
  const key = useCallback(
    (pressed: string): boolean => {
      if (!open) return false;
      const results = projection.selectableResults;
      if (pressed === "Escape") {
        close();
        return true;
      }
      if (pressed === "Backspace" && !query.trim() && scope) {
        setScope(null);
        return true;
      }
      if (pressed === "Enter") {
        const selected = results.find((result) => result.id === resolvedActiveId);
        if (!selected) return false;
        select(selected);
        return true;
      }
      if (pressed !== "ArrowDown" && pressed !== "ArrowUp") return false;
      if (results.length === 0) return false;
      const direction = pressed === "ArrowDown" ? "next" : "previous";
      setActiveId(moveActiveResultId(resolvedActiveId, results, direction));
      return true;
    },
    [close, open, projection.selectableResults, query, resolvedActiveId, scope, select, setScope],
  );

  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
    setQueryState("");
    setActiveId(null);
    if (!wasOpen) return;
    const element = takeCommandCenterFocusRestoreElement();
    if (!element) return;
    const cancel = focusWithRetries({
      focus: () => element.focus(),
      isFocused: () => typeof document !== "undefined" && document.activeElement === element,
      onTimeout: () =>
        keyboardActionDispatcher.dispatch({ id: "message-input.focus", scope: "message-input" }),
    });
    return cancel;
  }, [keyboardActionDispatcher, open]);

  return {
    open,
    scope,
    clearScope: () => setScope(null),
    query,
    setQuery,
    activeId: resolvedActiveId,
    setActiveId,
    groups: projection.groups,
    results: projection.selectableResults,
    inputRef,
    fileSearchLoading,
    fileSearchError,
    close,
    select,
    key,
  };
}

function ResultContent({ result }: { result: CommandCenterResult }) {
  if (result.kind === "file") {
    return (
      <>
        <span
          className="flex size-4 shrink-0 items-center justify-center"
          data-testid="command-center-file-icon"
        >
          <FileIcon fileName={result.title} />
        </span>
        <span className="min-w-0 flex-1 truncate" data-testid="command-center-file-line">
          <span data-testid="command-center-file-name">{result.title}</span>
          {result.subtitle ? (
            <span className="text-muted-foreground" data-testid="command-center-file-path">
              {" "}
              {result.subtitle}
            </span>
          ) : null}
        </span>
      </>
    );
  }
  if (result.kind === "agent") {
    const agent = result.agent;
    return (
      <span
        className="flex min-w-0 flex-1 items-center gap-2"
        data-testid={`command-center-agent-${agent.serverId}:${agent.id}`}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <AgentStatusDot
            status={agent.status}
            requiresAttention={agent.requiresAttention}
            showInactive
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{result.title}</span>
          <span
            className="truncate text-xs text-muted-foreground"
            data-testid="command-center-agent-subtitle"
          >
            {result.subtitle}
          </span>
        </span>
      </span>
    );
  }
  if (result.kind === "workspace") {
    const key = result.id.slice("workspace:".length);
    return (
      <span
        className="flex min-w-0 flex-1 items-center gap-2"
        data-testid={`command-center-workspace-${key}`}
      >
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{result.title}</span>
          <span
            className="truncate text-xs text-muted-foreground"
            data-testid="command-center-workspace-subtitle"
          >
            {result.subtitle}
          </span>
        </span>
      </span>
    );
  }
  const presentation = result.contribution.presentation;
  const Icon = presentation.icon;
  if (presentation.kind === "action") {
    return (
      <>
        {Icon ? (
          <span className="flex size-4 shrink-0 items-center justify-center">
            <Icon size={16} />
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{presentation.title}</span>
          {presentation.subtitle ? (
            <span className="text-xs text-muted-foreground">{presentation.subtitle}</span>
          ) : null}
        </span>
        {presentation.shortcutKeys ? <Shortcut chord={presentation.shortcutKeys} /> : null}
      </>
    );
  }
  return (
    <>
      {Icon ? (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Icon size={16} />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-1">
        {presentation.path.map((part, index) => (
          <span
            key={presentation.path.slice(0, index + 1).join("\u0000")}
            className="flex min-w-0 items-center gap-1"
          >
            {index > 0 ? (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
            <span
              className={
                index === presentation.path.length - 1
                  ? "truncate"
                  : "truncate text-muted-foreground"
              }
            >
              {part}
            </span>
          </span>
        ))}
      </span>
      {presentation.selected ? <Check className="size-4 shrink-0" /> : null}
    </>
  );
}

const ResultRow = memo(function ResultRow({
  result,
  onSelect,
}: {
  result: CommandCenterResult;
  onSelect(result: CommandCenterResult): void;
}) {
  const choice =
    result.kind === "contribution" && result.contribution.presentation.kind === "choice"
      ? result.contribution.presentation
      : null;
  const label =
    result.kind === "file"
      ? [result.title, result.subtitle].filter(Boolean).join(" ")
      : choice?.path.join(" › ");
  const handleSelect = useCallback(() => onSelect(result), [onSelect, result]);
  return (
    <CommandItem
      value={result.id}
      onSelect={handleSelect}
      aria-label={label}
      aria-pressed={choice?.selected}
      data-testid={
        result.kind === "file" ? `command-center-file-row-${result.filePath}` : choice?.testId
      }
    >
      <ResultContent result={result} />
    </CommandItem>
  );
});

function ResultGroup({
  group,
  divider,
  onSelect,
}: {
  group: CommandCenterListGroup;
  divider: boolean;
  onSelect(result: CommandCenterResult): void;
}) {
  return (
    <>
      {divider ? <CommandSeparator /> : null}
      <CommandGroup heading={group.title}>
        {group.results.map((result) => (
          <ResultRow key={result.id} result={result} onSelect={onSelect} />
        ))}
      </CommandGroup>
    </>
  );
}

export function CommandCenter() {
  const { t } = useTranslation();
  const state = useCommandCenterState();
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // Escape belongs to the dialog; everything else goes through the shared handler.
      if (event.key === "Escape") return;
      if (event.key === "Backspace" && state.query) return;
      if (state.key(event.key)) event.preventDefault();
    },
    [state],
  );
  const { close } = state;
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) close();
    },
    [close],
  );
  const activeId = state.activeId;
  useEffect(() => {
    if (!state.open || !activeId) return;
    document
      .querySelector(`[data-slot="command-item"][data-value="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeId, state.open]);

  return (
    <CommandDialog
      open={state.open}
      onOpenChange={handleOpenChange}
      title={t("shell.commandCenter.placeholder")}
      description={t("shell.commandCenter.placeholder")}
      // shadcn's dialog default (24rem) cuts the placeholder and fits a handful of rows.
      className="sm:max-w-2xl"
    >
      <Command
        shouldFilter={false}
        value={activeId ?? ""}
        onValueChange={state.setActiveId}
        onKeyDown={handleKeyDown}
        data-testid="command-center-panel"
      >
        <div className="relative flex items-center gap-1" data-testid="command-center-header">
          {state.scope === "files" ? (
            <Button
              variant="secondary"
              size="xs"
              type="button"
              onClick={state.clearScope}
              aria-label={t("shell.commandCenter.files")}
              data-testid="command-center-files-scope"
              className="mt-1 ml-1"
            >
              <Folder className="size-3.5 text-muted-foreground" />
              {t("shell.commandCenter.files")}
              <X className="size-3 text-muted-foreground" />
            </Button>
          ) : null}
          <div className="min-w-0 flex-1">
            <CommandInput
              ref={state.inputRef}
              value={state.query}
              onValueChange={state.setQuery}
              placeholder={
                state.scope === "files"
                  ? t("shell.commandCenter.filePlaceholder")
                  : t("shell.commandCenter.placeholder")
              }
              autoCapitalize="none"
              autoCorrect="off"
              data-testid="command-center-input"
            />
          </div>
          {/* Over the input's end, so the input spans the dialog. */}
          <span
            className="pointer-events-none absolute top-1/2 right-3 flex size-4 -translate-y-1/2 items-center justify-center"
            data-testid="command-center-file-search-status"
          >
            {state.fileSearchLoading ? (
              <Spinner
                className="size-3.5 text-muted-foreground"
                aria-label={t("shell.commandCenter.searchingFiles")}
                data-testid="command-center-file-search-loading"
              />
            ) : null}
          </span>
        </div>
        {state.fileSearchError ? (
          <p
            aria-live="polite"
            // The Expo app's errorText: a bordered strip in the status danger colour.
            className="border-b px-4 py-3 text-sm text-status-danger"
            data-testid="command-center-file-search-error"
          >
            {t("common.errors.error")}: {state.fileSearchError}
          </p>
        ) : null}
        <CommandList className="max-h-[min(28rem,60vh)]" data-testid="command-center-results">
          {state.groups.length === 0 && !state.fileSearchError && !state.fileSearchLoading ? (
            <CommandEmpty>{t("shell.commandCenter.noMatches")}</CommandEmpty>
          ) : null}
          {state.groups.map((group, index) => (
            <ResultGroup
              key={group.key}
              group={group}
              divider={index > 0}
              onSelect={state.select}
            />
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

// Port of archive/expo-app:packages/app/src/components/add-project-flow.tsx: the Add project palette; a Radix dialog laid out like the Expo overlay, DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/add-project-flow.py; edit it directly.
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { router } from "~/app/navigation";
import type { WorkspaceProjectDescriptorPayload } from "@bytetrue/protocol/messages";
import {
  ArrowLeft,
  Folder,
  FolderPlus,
  Github,
  HardDrive,
  Plus,
  Search,
  Server,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  useLayoutEffect,
} from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "cn";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import {
  applyAvailableAddProjectHosts,
  backAddProjectPage,
  chooseAddProjectHost,
  currentAddProjectPage,
  moveAddProjectSelection,
  openAddProjectFlow,
  openDirectorySearchPage,
  openGithubLocationPage,
  openGithubSearchPage,
  openNewDirectoryNamePage,
  openNewDirectoryParentPage,
  setAddProjectActiveIndex,
  setAddProjectPageInput,
  setNewDirectoryName,
  updateCurrentAddProjectPage,
  type AddProjectFlowState,
  type AddProjectHost,
  type AddProjectPage,
  type GithubRepositoryChoice,
} from "@/add-project-flow/model";
import {
  buildAddProjectMethods,
  addProjectMethodEmptyText,
  buildCloneLocationOptions,
  buildManualGithubRepositoryChoices,
  buildSuggestedParentDirectories,
  filterAddProjectHosts,
  joinDirectoryPath,
  pathBaseName,
  type AddProjectMethodId,
} from "@/add-project-flow/options";
import {
  buildProjectPickerOptions,
  type ProjectPickerOption,
} from "@/components/project-picker-options";
import { Shortcut } from "@/components/ui/shortcut";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import { useFetchQuery } from "@/data/query";
import { getOpenProjectFailureReason, registerProjectDescriptor } from "@/hooks/open-project";
import { useCloneGithubProject, useOpenProject } from "@/hooks/use-open-project";
import {
  useHosts,
  useHostRuntimeClient,
  useHostRuntimeConnectionStatuses,
} from "@/runtime/host-runtime";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { useRecommendedProjectPaths } from "@/stores/session-store-hooks";
import type { AddProjectFlowRequest } from "@/stores/add-project-flow-store";
import { shortenPath } from "@/utils/shorten-path";
import { buildNewWorkspaceRoute, buildSettingsAddHostRoute } from "@/utils/host-routes";

interface AddProjectFlowProps {
  request: AddProjectFlowRequest;
  onClose: () => void;
}

interface FlowRowOption {
  id: string;
  title: string;
  subtitle: string | null;
  icon: ComponentType<{ size?: number; color?: string }>;
  disabled?: boolean;
  testID: string;
  select: () => void;
}

type GithubLocationPage = Extract<AddProjectPage, { kind: "github-location" }>;

interface FlowIconProps {
  icon: ComponentType<{ size?: number; color?: string }>;
  size?: number;
  color?: string;
}

function FlowIcon({ icon: Icon, size, color }: FlowIconProps) {
  return <Icon size={size} color={color} />;
}

const lastCloneParentByHost = new Map<string, string>();
const EMPTY_PATHS: string[] = [];
const NAVIGATION_HINT_KEYS = ["Up", "Down"];
const SELECT_HINT_KEYS = ["Enter"];
const ESCAPE_HINT_KEYS = ["Esc"];

function FlowBackButton({ onPress }: { onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex h-5 w-[18px] shrink-0 items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground"
      aria-label="Back"
      data-testid="add-project-flow-back"
    >
      <ArrowLeft size={18} />
    </button>
  );
}

function FlowTitleRow({
  title,
  hostLabel,
  onBack,
}: {
  title: string;
  hostLabel: string | null;
  onBack: (() => void) | null;
}) {
  return (
    <div className="flex min-h-5 flex-row items-center gap-2">
      {onBack ? <FlowBackButton onPress={onBack} /> : null}
      <div
        className="flex min-w-0 flex-1 flex-row items-baseline gap-2"
        data-testid="add-project-flow-title"
      >
        <DialogPrimitive.Title asChild>
          <span className="min-w-0 shrink truncate text-xs leading-[normal] font-normal text-foreground">
            {title}
          </span>
        </DialogPrimitive.Title>
        {hostLabel ? (
          <span className="min-w-0 shrink truncate text-xs leading-[normal] text-muted-foreground">
            {hostLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function methodIcon(method: AddProjectMethodId): FlowRowOption["icon"] {
  if (method === "github") return Github;
  if (method === "new-directory") return FolderPlus;
  return Search;
}

function directoryOptionSubtitle(option: ProjectPickerOption, shortPath: string): string | null {
  if (option.kind === "path") return "Open this path";
  if (shortPath === option.path) return null;
  return option.path;
}

function progressText(page: AddProjectPage): string {
  if (page.kind === "github-location") return "Cloning project...";
  if (page.kind === "new-directory-name") return "Creating directory...";
  return "Adding project...";
}

function emptyText(page: AddProjectPage, host: AddProjectHost | null): string {
  if (page.kind === "host") return "No connected hosts";
  if (page.kind === "github-search") return "Enter a GitHub URL or owner/repo";
  if (page.kind === "method") return addProjectMethodEmptyText(host);
  return "No matching options";
}

interface QueryErrorInput {
  searchesDirectories: boolean;
  directoryFailed: boolean;
  githubFailed: boolean;
  githubAvailable: boolean | null;
  githubError: string | null;
}

function queryErrorText(input: QueryErrorInput): string | null {
  if (input.searchesDirectories && input.directoryFailed) return "Unable to search directories";
  if (input.githubFailed) return "Unable to search GitHub repositories";
  if (input.githubError) return input.githubError;
  if (input.githubAvailable === false) return input.githubError ?? "GitHub search is unavailable";
  return null;
}

function pageHostId(page: AddProjectPage): string | null {
  return page.kind === "host" ? null : page.hostId;
}

function pageTitle(page: AddProjectPage): string {
  switch (page.kind) {
    case "host":
      return "Choose host";
    case "method":
      return "Add project";
    case "directory-search":
      return "Search for directory";
    case "github-search":
      return "Clone from GitHub";
    case "github-location":
      return "Choose destination";
    case "new-directory-parent":
      return "Choose parent directory";
    case "new-directory-name":
      return "Name directory";
  }
}

type AddProjectInputPage = Exclude<AddProjectPage, { kind: "method" }>;

function pagePlaceholder(page: AddProjectInputPage): string {
  switch (page.kind) {
    case "host":
      return "Search hosts...";
    case "directory-search":
      return "Search directories or enter a path...";
    case "github-search":
      return "Search or enter a GitHub repository...";
    case "github-location":
    case "new-directory-parent":
      return "Search parent directories or enter a path...";
    case "new-directory-name":
      return "Directory name";
  }
}

function pageInput(page: AddProjectInputPage): string {
  return page.kind === "new-directory-name" ? page.name : page.query;
}

function pathTestId(path: string): string {
  return `add-project-flow-path-${encodeURIComponent(path)}`;
}

function FlowRow({ option, active }: { option: FlowRowOption; active: boolean }) {
  // The active row is muted, not the Expo app's surface1: in the light theme surface1 is the
  // panel's own white, so neither the keyboard selection nor the hover showed.
  return (
    <button
      type="button"
      disabled={option.disabled}
      onClick={option.select}
      className={cn(
        "flex flex-row items-center gap-3 px-4 py-2 text-left enabled:hover:bg-muted enabled:active:bg-muted",
        active && "bg-muted",
        option.disabled && "opacity-50",
      )}
      aria-current={active ? "true" : undefined}
      data-testid={option.testID}
    >
      <span className="flex w-[18px] shrink-0 items-center justify-center text-muted-foreground">
        <FlowIcon icon={option.icon} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-[normal] text-foreground">{option.title}</span>
        {option.subtitle ? (
          <span className="mt-0.5 truncate text-xs leading-[normal] text-muted-foreground">
            {option.subtitle}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function FlowHint({ keys, action }: { keys: string[]; action: string }) {
  const shortcutsAvailable = useKeyboardShortcutsAvailable();
  if (!shortcutsAvailable) return null;

  return (
    <div className="flex flex-row items-center gap-1.5">
      <Shortcut keys={keys} />
      <span className="text-xs leading-[normal] text-muted-foreground">{action}</span>
    </div>
  );
}

function setPageStatus(
  state: AddProjectFlowState,
  kind: AddProjectPage["kind"],
  input: { isSubmitting?: boolean; error?: string | null },
): AddProjectFlowState {
  return updateCurrentAddProjectPage(state, (page) =>
    page.kind === kind ? { ...page, ...input } : page,
  );
}

// The product flow is intentionally one cohesive page-stack state machine.
// eslint-disable-next-line complexity
export function AddProjectFlow({ request, onClose }: AddProjectFlowProps) {
  const hosts = useHosts();
  const hostIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(hostIds);
  const projectAddByHost = useHostFeatureMap(hostIds, "projectAdd");
  // COMPAT(stableProjectIdentity): added in v0.1.109, remove gate after 2027-01-15.
  const stableProjectIdentityByHost = useHostFeatureMap(hostIds, "stableProjectIdentity");
  // COMPAT(projectGithubClone): added in v0.1.108, remove gate after 2027-01-15.
  const githubCloneByHost = useHostFeatureMap(hostIds, "projectGithubClone");
  // COMPAT(workspaceGithubRepositorySearch): added in v0.1.108, remove gate after 2027-01-15.
  const githubSearchByHost = useHostFeatureMap(hostIds, "workspaceGithubRepositorySearch");
  // COMPAT(projectCreateDirectory): added in v0.1.108, remove gate after 2027-01-15.
  const createDirectoryByHost = useHostFeatureMap(hostIds, "projectCreateDirectory");
  const availableHosts = useMemo<AddProjectHost[]>(
    () =>
      hosts.flatMap((host) => {
        if (connectionStatuses.get(host.serverId) !== "online") return [];
        const canAddProject =
          projectAddByHost.get(host.serverId) === true &&
          stableProjectIdentityByHost.get(host.serverId) === true;
        return [
          {
            serverId: host.serverId,
            label: host.label,
            canAddProject,
            canCloneGithubRepositories: githubCloneByHost.get(host.serverId) === true,
            canSearchGithubRepositories: githubSearchByHost.get(host.serverId) === true,
            canCreateDirectory: createDirectoryByHost.get(host.serverId) === true,
          },
        ];
      }),
    [
      connectionStatuses,
      createDirectoryByHost,
      githubCloneByHost,
      githubSearchByHost,
      hosts,
      projectAddByHost,
      stableProjectIdentityByHost,
    ],
  );
  const [state, setState] = useState(() =>
    openAddProjectFlow({
      hosts: availableHosts,
      ...(request.preferredHostId ? { preferredHostId: request.preferredHostId } : {}),
    }),
  );
  const page = currentAddProjectPage(state);
  const hostId = pageHostId(page);
  const host = hostId ? state.hosts.find((candidate) => candidate.serverId === hostId) : null;
  const client = useHostRuntimeClient(hostId ?? "");
  const recommendedPaths = useRecommendedProjectPaths(hostId);
  const openProject = useOpenProject(hostId);
  const cloneGithubProject = useCloneGithubProject(hostId);
  const upsertProject = useCallback(
    (
      targetServerId: string,
      project: Parameters<ReturnType<typeof getHostRuntimeStore>["acceptProjectSnapshot"]>[1],
    ) => {
      getHostRuntimeStore().acceptProjectSnapshot(targetServerId, project);
    },
    [],
  );
  const setHasHydratedWorkspaces = useSessionStore((store) => store.setHasHydratedWorkspaces);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const submissionInFlightRef = useRef(false);
  const query = page.kind === "new-directory-name" || page.kind === "method" ? "" : page.query;
  const pageInputValueRef = useRef(page.kind === "method" ? "" : pageInput(page));
  pageInputValueRef.current = page.kind === "method" ? "" : pageInput(page);
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    setState((current) =>
      applyAvailableAddProjectHosts(current, availableHosts, request.preferredHostId),
    );
  }, [availableHosts, request.preferredHostId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Before the page paints, not after: keys typed as soon as the page shows must land in the
  // input, and a late reset would wipe the first of them.
  useLayoutEffect(() => {
    inputRef.current?.replaceText(pageInputValueRef.current);
    inputRef.current?.focus();
  }, [page.kind]);

  const searchesDirectories =
    page.kind === "directory-search" ||
    page.kind === "github-location" ||
    page.kind === "new-directory-parent";
  const directoryQuery = useFetchQuery({
    queryKey: ["add-project-flow-directories", hostId, debouncedQuery],
    queryFn: async () => {
      if (!client) return { query: debouncedQuery, paths: [] as string[] };
      const payload = await client.getDirectorySuggestions({
        query: debouncedQuery,
        includeDirectories: true,
        includeFiles: false,
        limit: 30,
      });
      return {
        query: debouncedQuery,
        paths:
          payload.entries?.flatMap((entry) => (entry.kind === "directory" ? [entry.path] : [])) ??
          [],
      };
    },
    enabled: Boolean(client && searchesDirectories),
    dataShape: "value",
    retry: false,
    staleTimeMs: 15_000,
  });
  const githubQuery = useFetchQuery({
    queryKey: ["add-project-flow-github", hostId, debouncedQuery],
    queryFn: async () => {
      if (!client) throw new Error("Host is unavailable");
      const payload = await client.searchGithubRepositories({ query: debouncedQuery, limit: 30 });
      return { query: debouncedQuery, payload };
    },
    enabled: Boolean(client && page.kind === "github-search" && host?.canSearchGithubRepositories),
    dataShape: "value",
    retry: false,
    staleTimeMs: 15_000,
  });

  // Not from inside a setState updater: React runs those while rendering, and closing the flow
  // there updated another component mid-render ("Cannot update a component while rendering").
  const handleBack = useCallback(() => {
    const previous = backAddProjectPage(state);
    if (previous) setState(previous);
    else onClose();
  }, [onClose, state]);

  const openNewWorkspaceForProject = useCallback(
    (serverId: string, project: WorkspaceProjectDescriptorPayload) => {
      onClose();
      router.push(
        buildNewWorkspaceRoute({
          serverId,
          projectId: project.projectId,
          sourceDirectory: project.projectRootPath,
          displayName: project.projectDisplayName,
        }),
      );
    },
    [onClose],
  );

  const openAddedProject = useCallback(
    async (path: string, sourceKind: "directory-search" | "method") => {
      if (!hostId || submissionInFlightRef.current) return;
      submissionInFlightRef.current = true;
      setState((current) =>
        setPageStatus(current, sourceKind, { isSubmitting: true, error: null }),
      );
      try {
        const result = await openProject(path);
        if (result.ok) {
          openNewWorkspaceForProject(hostId, result.project);
          return;
        }
        const reason = getOpenProjectFailureReason(result);
        const message =
          reason === "directory_not_found" ? "Directory not found" : "Unable to add project";
        setState((current) =>
          setPageStatus(current, sourceKind, { isSubmitting: false, error: message }),
        );
      } catch {
        setState((current) =>
          setPageStatus(current, sourceKind, {
            isSubmitting: false,
            error: "Unable to add project",
          }),
        );
      } finally {
        submissionInFlightRef.current = false;
      }
    },
    [hostId, openNewWorkspaceForProject, openProject],
  );

  const selectMethod = useCallback(
    (method: AddProjectMethodId) => {
      if (!hostId) return;
      if (method === "directory-search") {
        setState((current) => openDirectorySearchPage(current, hostId));
      } else if (method === "github") {
        setState((current) => openGithubSearchPage(current, hostId));
      } else {
        setState((current) => openNewDirectoryParentPage(current, hostId));
      }
    },
    [hostId],
  );

  const directoryPaths = useMemo(
    () => (directoryQuery.data?.query === query ? directoryQuery.data.paths : EMPTY_PATHS),
    [directoryQuery.data, query],
  );
  const pathOptions = useMemo(
    () =>
      buildProjectPickerOptions({
        recommendedPaths,
        serverPaths: directoryPaths,
        query,
      }),
    [directoryPaths, query, recommendedPaths],
  );
  const cloneRepository = useCallback(
    async (locationPage: GithubLocationPage, parentPath: string) => {
      if (submissionInFlightRef.current) return;
      submissionInFlightRef.current = true;
      setState((current) =>
        setPageStatus(current, "github-location", { isSubmitting: true, error: null }),
      );
      try {
        const result = await cloneGithubProject(
          locationPage.repository.cloneUrl,
          parentPath,
          locationPage.repository.cloneProtocol,
        );
        if (result.ok) {
          lastCloneParentByHost.set(locationPage.hostId, parentPath);
          openNewWorkspaceForProject(locationPage.hostId, result.project);
          return;
        }
        setState((current) =>
          setPageStatus(current, "github-location", {
            isSubmitting: false,
            error: result.error ?? "Unable to clone repository",
          }),
        );
      } catch (error) {
        setState((current) =>
          setPageStatus(current, "github-location", {
            isSubmitting: false,
            error: error instanceof Error ? error.message : "Unable to clone repository",
          }),
        );
      } finally {
        submissionInFlightRef.current = false;
      }
    },
    [cloneGithubProject, openNewWorkspaceForProject],
  );
  const rows = useMemo<FlowRowOption[]>(() => {
    if (page.kind === "host") {
      const choices = filterAddProjectHosts(state.hosts, page.query).map<FlowRowOption>(
        (choice) => ({
          id: choice.serverId,
          title: choice.label,
          subtitle: choice.serverId,
          icon: Server,
          testID: `add-project-flow-host-${choice.serverId}`,
          select: () => setState((current) => chooseAddProjectHost(current, choice.serverId)),
        }),
      );
      if (state.hosts.length === 0) {
        choices.push({
          id: "add-host",
          title: "Add host",
          subtitle: "No connected hosts",
          icon: Plus,
          testID: "add-project-flow-add-host",
          select: () => {
            onClose();
            router.push(buildSettingsAddHostRoute(Date.now()));
          },
        });
      }
      return choices;
    }
    if (page.kind === "method") {
      if (!host) return [];
      return buildAddProjectMethods(host).map((method) => ({
        id: method.id,
        title: method.label,
        subtitle: method.description,
        icon: methodIcon(method.id),
        disabled: method.disabled,
        testID: `add-project-flow-method-${method.id}`,
        select: () => selectMethod(method.id),
      }));
    }
    if (page.kind === "directory-search") {
      return pathOptions.map((option) => {
        const shortPath = shortenPath(option.path);
        return {
          id: option.path,
          title: shortPath,
          subtitle: directoryOptionSubtitle(option, shortPath),
          icon: Folder,
          testID: pathTestId(option.path),
          select: () => void openAddedProject(option.path, "directory-search"),
        };
      });
    }
    if (page.kind === "github-search") {
      const search = githubQuery.data?.query === page.query ? githubQuery.data.payload : null;
      const repositories = search?.repositories ?? [];
      const normalizedQuery = page.query.trim().toLowerCase();
      const hasExactSearchResult = repositories.some(
        (repository) =>
          repository.nameWithOwner.toLowerCase() === normalizedQuery ||
          repository.cloneUrl.toLowerCase() === normalizedQuery,
      );
      const manualRepositories = hasExactSearchResult
        ? []
        : buildManualGithubRepositoryChoices(page.query);
      const repositoryChoices: GithubRepositoryChoice[] = [...manualRepositories, ...repositories];
      return repositoryChoices.map((repository) => ({
        id: repository.id,
        title: repository.cloneProtocol
          ? `${repository.nameWithOwner} via ${repository.cloneProtocol.toUpperCase()}`
          : repository.nameWithOwner,
        subtitle: repository.description,
        icon: Github,
        testID: `add-project-flow-repository-${repository.id}`,
        select: () =>
          setState((current) => openGithubLocationPage(current, page.hostId, repository)),
      }));
    }
    if (page.kind === "github-location") {
      const repositoryName = pathBaseName(page.repository.nameWithOwner);
      const lastParent = lastCloneParentByHost.get(page.hostId);
      const parents = buildSuggestedParentDirectories(recommendedPaths);
      const orderedParents = lastParent
        ? [lastParent, ...parents.filter((parent) => parent !== lastParent)]
        : parents;
      const filteredParents = buildProjectPickerOptions({
        recommendedPaths: orderedParents,
        serverPaths: directoryPaths,
        query: page.query,
      }).map((option) => option.path);
      return buildCloneLocationOptions({
        parents: filteredParents,
        repositoryName,
        existingPaths: [...recommendedPaths, ...directoryPaths],
      }).map((option) => ({
        id: option.id,
        title: shortenPath(option.displayPath),
        subtitle: option.secondaryText,
        icon: HardDrive,
        disabled: option.disabled,
        testID: pathTestId(option.displayPath),
        select: () => void cloneRepository(page, option.path),
      }));
    }
    if (page.kind === "new-directory-parent") {
      return pathOptions.map((option) => ({
        id: option.path,
        title: shortenPath(option.path),
        subtitle: option.kind === "path" ? "Use this parent" : option.path,
        icon: Folder,
        testID: pathTestId(option.path),
        select: () =>
          setState((current) => openNewDirectoryNamePage(current, page.hostId, option.path)),
      }));
    }
    return [];
  }, [
    cloneRepository,
    directoryPaths,
    githubQuery.data,
    host,
    onClose,
    openAddedProject,
    page,
    pathOptions,
    recommendedPaths,
    selectMethod,
    state.hosts,
  ]);

  const activeIndex = rows.length === 0 ? 0 : Math.min(page.activeIndex, rows.length - 1);
  const createDirectory = useCallback(async () => {
    if (page.kind !== "new-directory-name" || !client) return;
    const name = page.name.trim();
    if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
      setState((current) =>
        setPageStatus(current, "new-directory-name", { error: "Enter a directory name" }),
      );
      return;
    }
    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    setState((current) =>
      setPageStatus(current, "new-directory-name", { isSubmitting: true, error: null }),
    );
    try {
      const payload = await client.createProjectDirectory({
        parentPath: page.parentPath,
        name,
      });
      if (payload.error || !payload.project) {
        setState((current) =>
          setPageStatus(current, "new-directory-name", {
            isSubmitting: false,
            error: payload.error ?? "Unable to create directory",
          }),
        );
        return;
      }
      registerProjectDescriptor({
        serverId: page.hostId,
        project: payload.project,
        upsertProject,
        setHasHydratedWorkspaces,
      });
      openNewWorkspaceForProject(page.hostId, payload.project);
    } catch {
      setState((current) =>
        setPageStatus(current, "new-directory-name", {
          isSubmitting: false,
          error: "Unable to create directory",
        }),
      );
    } finally {
      submissionInFlightRef.current = false;
    }
  }, [client, openNewWorkspaceForProject, page, setHasHydratedWorkspaces, upsertProject]);

  const submitActive = useCallback(() => {
    if (page.kind === "new-directory-name") {
      void createDirectory();
      return;
    }
    const option = rows[activeIndex];
    if (option && !option.disabled) option.select();
  }, [activeIndex, createDirectory, page.kind, rows]);

  const handleKey = useCallback(
    (key: string): boolean => {
      if (key === "Escape") {
        handleBack();
        return true;
      }
      if (key === "Enter") {
        submitActive();
        return true;
      }
      if (key !== "ArrowDown" && key !== "ArrowUp") return false;
      const next = moveAddProjectSelection(
        activeIndex,
        rows.map((row) => row.disabled !== true),
        key === "ArrowDown" ? "next" : "previous",
      );
      setState((current) => setAddProjectActiveIndex(current, next));
      return true;
    },
    [activeIndex, handleBack, rows, submitActive],
  );

  // Escape goes back a page (closing on the first), so Radix's own dismiss is replaced. The other
  // keys come from the dialog, which keeps focus inside itself.
  const handleEscapeKeyDown = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      handleBack();
    },
    [handleBack],
  );
  const handleDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape" || event.nativeEvent.isComposing) return;
      if (handleKey(event.key)) event.preventDefault();
    },
    [handleKey],
  );
  // The input, not the first button. On a later page the page effect has focused it already; on
  // open it could not, as the portal mounts the content after that effect ran.
  const handleOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    const dialog = event.currentTarget;
    if (!(dialog instanceof HTMLElement) || dialog.contains(document.activeElement)) return;
    inputRef.current?.focus();
    if (!dialog.contains(document.activeElement)) dialog.focus();
  }, []);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  const handleInputChange = useCallback((value: string) => {
    setState((current) =>
      currentAddProjectPage(current).kind === "new-directory-name"
        ? setNewDirectoryName(current, value)
        : setAddProjectPageInput(current, value),
    );
  }, []);
  const isSubmitting = "isSubmitting" in page && page.isSubmitting;
  const currentGithubSearch =
    page.kind === "github-search" && githubQuery.data?.query === page.query
      ? githubQuery.data.payload
      : null;
  const loading =
    (searchesDirectories && (query !== debouncedQuery || directoryQuery.isFetching)) ||
    (page.kind === "github-search" &&
      host?.canSearchGithubRepositories === true &&
      (query !== debouncedQuery || githubQuery.isFetching));
  const queryError = queryErrorText({
    searchesDirectories,
    directoryFailed: directoryQuery.isError,
    githubFailed: page.kind === "github-search" && githubQuery.isError,
    githubAvailable: currentGithubSearch?.available ?? null,
    githubError: currentGithubSearch?.error ?? null,
  });
  const preview =
    page.kind === "new-directory-name" && page.name.trim()
      ? joinDirectoryPath(page.parentPath, page.name.trim())
      : null;

  return (
    <DialogPrimitive.Root open onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        {/* The dialog is the whole overlay, as the Expo app's Modal: the backdrop is a sibling of
            the panel inside it, and a click on it closes the flow. */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onEscapeKeyDown={handleEscapeKeyDown}
          onOpenAutoFocus={handleOpenAutoFocus}
          onKeyDown={handleDialogKeyDown}
          className="fixed inset-0 z-50 flex flex-col items-center justify-start pt-12 outline-none"
          data-testid="add-project-flow"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
            data-testid="add-project-flow-backdrop"
          />
          <div
            className="relative flex max-h-[80%] w-[640px] max-w-[92%] flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
            data-testid={`add-project-flow-page-${page.kind}`}
            aria-label={`Add project: ${page.kind}`}
          >
            <div className="flex shrink-0 flex-col gap-2 border-b px-4 pt-2 pb-3">
              <FlowTitleRow
                title={pageTitle(page)}
                hostLabel={host?.label ?? null}
                onBack={state.pages.length > 1 ? handleBack : null}
              />
              {page.kind !== "method" ? (
                <TextInput
                  ref={inputRef}
                  initialValue={pageInput(page)}
                  onChangeText={handleInputChange}
                  placeholder={pagePlaceholder(page)}
                  className="py-1 text-sm leading-[normal] text-foreground outline-none placeholder:text-muted-foreground"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSubmitting}
                  enterKeyHint="go"
                  testID="add-project-flow-input"
                />
              ) : null}
            </div>
            <div
              className="min-h-0 shrink grow-0 overflow-y-auto [scrollbar-width:none]"
              data-testid="add-project-flow-results"
            >
              <div className="flex flex-col py-2">
                {preview ? (
                  <span
                    className="px-4 py-2 text-sm leading-[normal] text-muted-foreground"
                    data-testid="add-project-flow-path-preview"
                  >
                    {shortenPath(preview)}
                  </span>
                ) : null}
                {isSubmitting ? (
                  <span
                    className="p-4 text-sm leading-[normal] text-muted-foreground"
                    data-testid="add-project-flow-progress"
                  >
                    {progressText(page)}
                  </span>
                ) : null}
                {!isSubmitting && page.error ? (
                  <span
                    className="px-4 py-3 text-xs leading-[normal] text-destructive"
                    data-testid="add-project-flow-error"
                  >
                    {page.error}
                  </span>
                ) : null}
                {!isSubmitting && queryError ? (
                  <span
                    className="px-4 py-3 text-xs leading-[normal] text-destructive"
                    data-testid="add-project-flow-query-error"
                  >
                    {queryError}
                  </span>
                ) : null}
                {!isSubmitting && loading ? (
                  <span
                    className="p-4 text-sm leading-[normal] text-muted-foreground"
                    data-testid="add-project-flow-loading"
                  >
                    Loading...
                  </span>
                ) : null}
                {!isSubmitting &&
                (!loading || page.kind === "github-search") &&
                (!queryError || page.kind === "github-search")
                  ? rows.map((option, index) => (
                      <FlowRow key={option.id} option={option} active={index === activeIndex} />
                    ))
                  : null}
                {!isSubmitting &&
                !loading &&
                !queryError &&
                rows.length === 0 &&
                page.kind !== "new-directory-name" ? (
                  <span
                    className="p-4 text-sm leading-[normal] text-muted-foreground"
                    data-testid="add-project-flow-empty"
                  >
                    {emptyText(page, host ?? null)}
                  </span>
                ) : null}
              </div>
            </div>
            <div
              className="flex shrink-0 flex-row flex-wrap items-center gap-4 border-t px-4 py-2"
              data-testid="add-project-flow-footer"
            >
              <FlowHint keys={NAVIGATION_HINT_KEYS} action="Navigate" />
              <FlowHint keys={SELECT_HINT_KEYS} action="Select" />
              <FlowHint
                keys={ESCAPE_HINT_KEYS}
                action={state.pages.length > 1 ? "Back" : "Close"}
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Override of packages/app/src/screens/new-workspace-screen.tsx: same logic, DOM view.
// Generated from the Expo file by web/scripts/port/new-workspace-screen.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useUnistyles, withUnistyles } from "react-native-unistyles";
import { createNameId } from "mnemonic-id";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Folder, FolderPlus, GitBranch, GitPullRequest } from "lucide-react";
import { Composer } from "@/composer";
import { KeyboardTranslateView } from "@/components/keyboard-translate-view";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import {
  resolveComposerAttachmentSubmitFormat,
  splitComposerAttachmentsForSubmit,
} from "@/composer/attachments/submit";
import { HostStatusDot } from "@/components/host-status-dot";
import { HostPicker } from "@/components/hosts/host-picker";
import { ProjectIconView } from "@/components/project-icon-view";
import { Combobox, ComboboxItem } from "@/components/ui/combobox";
import type { ComboboxOption as ComboboxOptionType, ComboboxProps } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { HEADER_INNER_HEIGHT, MAX_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { useForgeSearchQuery } from "@/git/use-forge-search-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { ensureCheckoutStatus } from "@/git/checkout-status-cache";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useSettings } from "@/hooks/use-settings";
import { resolveTerminalProfiles } from "@bytetrue/protocol/terminal-profiles";
import type { TerminalProfile } from "@bytetrue/protocol/messages";
import { LaunchControl } from "@/new-workspace-launch/launch-control";
import { resolveLaunchTarget, type LaunchTarget } from "@/new-workspace-launch/target";
import { useTerminalComposerState } from "@/new-workspace-launch/composer-state";
import { runCreateTerminalWorkspace } from "@/screens/new-workspace-terminal";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionStatuses,
  useHostRuntimeIsConnected,
  useHosts,
  type HostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import { useHostFeature, useHostFeatureMap } from "@/runtime/host-features";
import type { HostProfile } from "@/types/host-connection";
import {
  navigateToWorkspace,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { normalizeWorkspaceDescriptor, type WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { buildNewWorkspaceDraftKey, generateDraftId } from "@/stores/draft-keys";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { isActiveCreateFlowForDraft, useCreateFlowStore } from "@/stores/create-flow-store";
import {
  useWorkspaceDraftSubmissionStore,
  type PendingWorkspaceDraftSetup,
} from "@/stores/workspace-draft-submission-store";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { CreateAgentInitialValues } from "@/hooks/use-agent-form-state";
import { generateMessageId } from "@/types/stream";
import { toErrorMessage } from "@/utils/error-messages";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import {
  getHostProjectSourceDirectory,
  getHostProjectId,
  getWorktreeSupportForHostProject,
  hostProjectFromRoute,
  hostProjectFromWorkspace,
  resolveHostProjectCandidate,
  useHostProjects,
  type HostProjectListItem,
} from "@/projects/host-projects";
import { useProjectIcons } from "@/projects/icons";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { CSSProperties } from "react";
import { cn } from "cn";
import type { ComposerAttachment } from "@/attachments/types";
import { useDraftWorkspaceAttachmentScopeKey } from "@/attachments/workspace-attachments-store";
import { requestWorkspaceDraftAgent } from "@/composer/draft/create-agent-request";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import type { MessagePayload } from "@/composer/types";
import type { UserComposerAttachment } from "@/attachments/types";
import type { AgentAttachment, ForgeSearchItem } from "@bytetrue/protocol/messages";
import type {
  CreateBySpaceWorktreeInput,
  DaemonClient,
} from "@bytetrue/client/internal/daemon-client";
import type { AgentProvider } from "@bytetrue/protocol/agent-types";
import type { WorkspaceDraftTabSetup, WorkspaceTabTarget } from "@/workspace-tabs/model";
import { isEmptyWorkspaceSubmission, runCreateEmptyWorkspace } from "@/screens/new-workspace-empty";
import {
  getWorkspaceNamingAttachments,
  remapDraftCwdToWorkspace,
} from "@/screens/new-workspace-fork-context";
import {
  buildPickerOptionData,
  pinnedBasePickerItem,
  pickerItemLabel,
  pickerItemToCheckoutRequest,
  resolveNewWorkspaceBaseItem,
  type BranchPickerDetail,
  type PickerCheckoutRequest,
  type PickerItem,
  type PickerOptionData,
} from "@/screens/new-workspace-picker-item";
import {
  clearPickerPrAttachmentForTargetChange,
  initialPickerSelectionState,
  reducePickerSelection,
  syncPickerPrAttachment,
} from "@/screens/new-workspace-picker-state";
import {
  resolveNewWorkspaceAutomaticServerId,
  resolveNewWorkspaceInitialServerId,
} from "@/screens/new-workspace-initial-context";
import { buildNewWorkspaceProjectIconTargets } from "@/screens/new-workspace/project-icon-targets";
import { useNewWorkspaceProjectPicker } from "@/screens/new-workspace/project-picker";
import {
  buildTerminalsQueryKey,
  type ListTerminalsPayload,
  upsertCreatedTerminalPayload,
} from "@/screens/workspace/terminals/state";
import {
  captureWorkspaceDraftCleanup,
  createWorkspaceAgentInBackground,
} from "@/screens/new-workspace/background-handoff";
import { useNewWorkspaceScreenPresence } from "@/screens/new-workspace/screen-presence";

const ThemedFolderPlus = withUnistyles(FolderPlus);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const addProjectIcon = (
  <ThemedFolderPlus size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
);

function useIsNewWorkspaceDraftHandoffActive(input: {
  draftId: string | undefined;
  selectedServerId: string;
}): boolean {
  const normalizedDraftId = input.draftId?.trim() ?? "";
  return useCreateFlowStore((state) =>
    isActiveCreateFlowForDraft({
      draftId: normalizedDraftId,
      serverId: input.selectedServerId,
      pending: normalizedDraftId ? state.pendingByDraftId[normalizedDraftId] : null,
    }),
  );
}

function resolveVisibleDraftContextScopeKeys(input: {
  isDraftHandoffActive: boolean;
  draftContextScopeKey: string;
}): readonly string[] {
  if (input.isDraftHandoffActive || !input.draftContextScopeKey) {
    return [];
  }
  return [input.draftContextScopeKey];
}

function isNewWorkspacePending(input: {
  pendingAction: "chat" | "empty" | "terminal" | null;
  isDraftHandoffActive: boolean;
}): boolean {
  return input.pendingAction !== null || input.isDraftHandoffActive;
}

function buildFirstAgentContext(input: {
  prompt: string;
  attachments: AgentAttachment[];
}): { prompt?: string; attachments?: AgentAttachment[] } | undefined {
  const trimmedPrompt = input.prompt.trim();
  if (!trimmedPrompt && input.attachments.length === 0) {
    return undefined;
  }

  return {
    ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
    attachments: input.attachments,
  };
}

interface NewWorkspaceScreenProps {
  serverId: string;
  sourceDirectory?: string;
  projectId?: string;
  displayName?: string;
  draftId?: string;
}

// A terminal launch sends argv, not a message: there is nothing to attach and
// no draft to persist, so the composer's attachment and draft seams are inert.
const NO_TERMINAL_ATTACHMENTS: UserComposerAttachment[] = [];
function noopChangeAttachments() {}
function noopClearDraft() {}

const PROJECT_ICON_FALLBACK_FONT_SIZE = 10;
const PROJECT_ICON_FALLBACK_TEXT: CSSProperties = {
  fontSize: PROJECT_ICON_FALLBACK_FONT_SIZE,
  fontWeight: 600,
};
const ThemedChevronDown = withUnistyles(ChevronDown);
const chevronExtraMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

// Every picker chip on this screen shares one chevron so they stay a single
// visual family. Extra-muted: the chevron is an affordance, not information,
// and it should sit behind the label it belongs to.
function MetaChevron(): ReactElement {
  return (
    <span className="flex shrink-0 translate-y-px">
      <ThemedChevronDown size={ICON_SIZE.sm} uniProps={chevronExtraMutedMapping} />
    </span>
  );
}

const metaChevron = <MetaChevron />;

// Stable reference so the keyboard-action handler doesn't re-register each render.
const PROJECT_PICK_ACTIONS: readonly KeyboardActionId[] = ["workspace.project.pick"];
// A picker-trigger badge: 28px tall, the same height the compact form's spacer reserves, so
// toggling Isolation to Local hides the Base row without shifting the form.
const BADGE =
  "flex h-7 max-w-60 min-w-0 shrink items-center gap-1 overflow-hidden rounded-2xl px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 enabled:hover:bg-muted enabled:active:bg-background";
// The badge's own padding is offset so the project icon lands on the title's left edge.
const CENTERED_CONTENT_STYLE: CSSProperties = { paddingBottom: HEADER_INNER_HEIGHT + 24 };
const CONTENT_WIDTH_STYLE: CSSProperties = { maxWidth: MAX_CONTENT_WIDTH };

function RefPickerBadgeContent({
  selectedItem,
  triggerLabel,
  iconColor,
  iconSize,
}: {
  selectedItem: PickerItem | null;
  triggerLabel: string;
  iconColor: string;
  iconSize: number;
}) {
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {selectedItem?.kind === "github-pr" ? (
          <GitPullRequest size={iconSize} color={iconColor} />
        ) : (
          <GitBranch size={iconSize} color={iconColor} />
        )}
      </span>
      <span className="min-w-0 shrink truncate text-sm text-muted-foreground">{triggerLabel}</span>
    </>
  );
}

function RefPickerTrigger({
  pickerAnchorRef,
  onPress,
  disabled,
  badgeClassName,
  selectedItem,
  triggerLabel,
  accessibilityLabel,
  tooltipLabel,
  iconColor,
  iconSize,
}: {
  pickerAnchorRef: React.RefObject<HTMLButtonElement | null>;
  onPress: () => void;
  disabled: boolean;
  badgeClassName: string;
  selectedItem: PickerItem | null;
  triggerLabel: string;
  accessibilityLabel: string;
  tooltipLabel: string;
  iconColor: string;
  iconSize: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild triggerRefProp="ref">
        <ComboboxTrigger
          chevron={metaChevron}
          ref={pickerAnchorRef}
          testID="new-workspace-ref-picker-trigger"
          onPress={onPress}
          disabled={disabled}
          className={badgeClassName}
          accessibilityLabel={accessibilityLabel}
        >
          <RefPickerBadgeContent
            selectedItem={selectedItem}
            triggerLabel={triggerLabel}
            iconColor={iconColor}
            iconSize={iconSize}
          />
        </ComboboxTrigger>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  );
}

function ProjectPickerTrigger({
  pickerAnchorRef,
  onPress,
  disabled,
  badgeClassName,
  label,
  tooltipLabel,
  projectViewKey,
  iconDataUri,
  iconColor,
  iconSize,
}: {
  pickerAnchorRef: React.RefObject<HTMLButtonElement | null>;
  onPress: () => void;
  disabled: boolean;
  badgeClassName: string;
  label: string;
  tooltipLabel: string;
  projectViewKey: string | null;
  iconDataUri: string | null;
  iconColor: string;
  iconSize: number;
}) {
  const placeholderLabel = projectIconPlaceholderLabelFromDisplayName(label);
  const placeholderInitial = placeholderLabel.charAt(0).toUpperCase() || "?";
  return (
    <Tooltip>
      <TooltipTrigger asChild triggerRefProp="ref">
        <ComboboxTrigger
          chevron={metaChevron}
          ref={pickerAnchorRef}
          testID="new-workspace-project-picker-trigger"
          onPress={onPress}
          disabled={disabled}
          className={badgeClassName}
          accessibilityLabel="Workspace project"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            {projectViewKey ? (
              <ProjectIconView
                iconDataUri={iconDataUri}
                initial={placeholderInitial}
                projectViewKey={projectViewKey}
                size={ICON_SIZE.md}
                textStyle={PROJECT_ICON_FALLBACK_TEXT}
              />
            ) : (
              <Folder size={iconSize} color={iconColor} />
            )}
          </span>
          <span className="min-w-0 shrink truncate text-sm text-muted-foreground">{label}</span>
        </ComboboxTrigger>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  );
}

function PickerOptionItem({
  testID,
  label,
  description,
  selected,
  active,
  disabled,
  onPress,
  isBranch,
  trailingLabel,
  accessibilityLabel,
  iconColor,
  iconSize,
}: {
  testID: string;
  label: string;
  description: string | undefined;
  selected: boolean;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
  isBranch: boolean;
  trailingLabel?: string;
  accessibilityLabel?: string;
  iconColor: string;
  iconSize: number;
}) {
  const leadingSlot = useMemo(
    () => (
      <span className="flex size-4 items-center justify-center">
        {isBranch ? (
          <GitBranch size={iconSize} color={iconColor} />
        ) : (
          <GitPullRequest size={iconSize} color={iconColor} />
        )}
      </span>
    ),
    [isBranch, iconSize, iconColor],
  );
  const trailingSlot = useMemo(
    () =>
      trailingLabel ? (
        <span className="text-xs text-muted-foreground tabular-nums">{trailingLabel}</span>
      ) : undefined,
    [trailingLabel],
  );
  return (
    <ComboboxItem
      testID={testID}
      label={label}
      description={description}
      selected={selected}
      active={active}
      disabled={disabled}
      onPress={onPress}
      leadingSlot={leadingSlot}
      trailingSlot={trailingSlot}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

function IsolationOptionItem({
  optionId,
  label,
  selected,
  active,
  disabled,
  onPress,
  iconColor,
  iconSize,
}: {
  optionId: string;
  label: string;
  selected: boolean;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
  iconColor: string;
  iconSize: number;
}) {
  const leadingSlot = useMemo(
    () => (
      <span className="flex size-4 items-center justify-center">
        {optionId === "worktree" ? (
          <GitBranch size={iconSize} color={iconColor} />
        ) : (
          <Folder size={iconSize} color={iconColor} />
        )}
      </span>
    ),
    [optionId, iconSize, iconColor],
  );
  return (
    <ComboboxItem
      testID={`workspace-create-isolation-${optionId}`}
      label={label}
      selected={selected}
      active={active}
      disabled={disabled}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

function ProjectOptionItem({
  testID,
  projectViewKey,
  iconDataUri,
  label,
  description,
  selected,
  active,
  disabled,
  onPress,
}: {
  testID: string;
  projectViewKey: string;
  iconDataUri: string | null;
  label: string;
  description: string | undefined;
  selected: boolean;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const placeholderLabel = projectIconPlaceholderLabelFromDisplayName(label);
  const placeholderInitial = placeholderLabel.charAt(0).toUpperCase() || "?";
  const leadingSlot = useMemo(
    () => (
      <span className="flex size-4 items-center justify-center">
        <ProjectIconView
          iconDataUri={iconDataUri}
          initial={placeholderInitial}
          projectViewKey={projectViewKey}
          size={ICON_SIZE.md}
          textStyle={PROJECT_ICON_FALLBACK_TEXT}
        />
      </span>
    ),
    [iconDataUri, placeholderInitial, projectViewKey],
  );

  return (
    <ComboboxItem
      testID={testID}
      label={label}
      description={description}
      selected={selected}
      active={active}
      disabled={disabled}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

function NewWorkspacePickerOption({
  option,
  selected,
  active,
  onPress,
  itemById,
  isPending,
}: {
  option: ComboboxOptionType;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  itemById: Map<string, PickerItem>;
  isPending: boolean;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const item = itemById.get(option.id);
  if (!item) return null;

  const isBranch = item.kind === "branch";
  const testID = isBranch
    ? `new-workspace-ref-picker-branch-${item.name}`
    : `new-workspace-ref-picker-pr-${item.item.number}`;
  const description =
    !isBranch && item.item.baseRefName
      ? t("newWorkspace.refPicker.intoBase", { baseRef: item.item.baseRefName })
      : undefined;

  return (
    <PickerOptionItem
      testID={testID}
      label={pickerItemLabel(item)}
      description={description}
      selected={selected}
      active={active}
      disabled={isPending}
      onPress={onPress}
      isBranch={isBranch}
      trailingLabel={isBranch ? item.divergenceLabel : undefined}
      accessibilityLabel={isBranch ? item.accessibilityLabel : undefined}
      iconColor={theme.colors.foregroundMuted}
      iconSize={theme.iconSize.sm}
    />
  );
}

function NewWorkspaceProjectPickerOption({
  option,
  selected,
  active,
  onPress,
  projectByOptionId,
  projectIconDataByProjectViewKey,
  selectedServerId,
  isPending,
  supportsWorkspaceMultiplicity,
}: {
  option: ComboboxOptionType;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  projectByOptionId: Map<string, HostProjectListItem>;
  projectIconDataByProjectViewKey: Map<string, string | null>;
  selectedServerId: string;
  isPending: boolean;
  supportsWorkspaceMultiplicity: boolean;
}) {
  const project = projectByOptionId.get(option.id);
  if (!project) return null;
  const sourceDirectory =
    getHostProjectSourceDirectory(project, selectedServerId) ?? project.iconWorkingDir;

  return (
    <ProjectOptionItem
      testID={`new-workspace-project-picker-option-${project.viewKey}`}
      projectViewKey={project.viewKey}
      iconDataUri={projectIconDataByProjectViewKey.get(project.viewKey) ?? null}
      label={project.projectName}
      description={sourceDirectory}
      selected={selected}
      active={active}
      disabled={
        isPending ||
        (!supportsWorkspaceMultiplicity &&
          !project.hosts.some((host) => host.worktreeSupport !== "unsupported"))
      }
      onPress={onPress}
    />
  );
}

function AddProjectPickerAction({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const openProjectKeys = useShortcutKeys("new-agent");
  const shortcut = useMemo(
    () => (openProjectKeys ? <Shortcut chord={openProjectKeys} /> : null),
    [openProjectKeys],
  );

  return (
    <ComboboxItem
      testID="new-workspace-project-picker-add-project"
      label={t("sidebar.actions.addProject")}
      onPress={onPress}
      leadingSlot={addProjectIcon}
      trailingSlot={shortcut}
    />
  );
}

function newWorkspaceHostOptionTestID(serverId: string): string {
  return `new-workspace-host-picker-option-${serverId}`;
}

function IsolationPickerTrigger({
  pickerAnchorRef,
  onPress,
  disabled,
  badgeClassName,
  isolation,
  label,
  tooltipLabel,
  iconColor,
  iconSize,
}: {
  pickerAnchorRef: React.RefObject<HTMLButtonElement | null>;
  onPress: () => void;
  disabled: boolean;
  badgeClassName: string;
  isolation: "local" | "worktree";
  label: string;
  tooltipLabel: string;
  iconColor: string;
  iconSize: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild triggerRefProp="ref">
        <ComboboxTrigger
          chevron={metaChevron}
          ref={pickerAnchorRef}
          testID="workspace-create-isolation-trigger"
          onPress={onPress}
          disabled={disabled}
          className={badgeClassName}
          accessibilityLabel="Workspace isolation"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            {isolation === "worktree" ? (
              <GitBranch size={iconSize} color={iconColor} />
            ) : (
              <Folder size={iconSize} color={iconColor} />
            )}
          </span>
          <span className="min-w-0 shrink truncate text-sm text-muted-foreground">{label}</span>
        </ComboboxTrigger>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  );
}

// Wraps a single argument control in the mobile vertical stack. On desktop the
// controls are laid out in one horizontal row, so no per-control wrapper is used.
function FormRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1 pl-4">{children}</div>;
}

interface WorkspaceIsolationState {
  isolation: "local" | "worktree";
  setIsolation: (value: "local" | "worktree") => void;
  effectiveIsolation: "local" | "worktree";
  canCreateWorktree: boolean;
  showRefPicker: boolean;
}

// Preserve the user's worktree choice while route metadata is provisional. Once
// the authoritative placement arrives, unsupported projects fall back to local.
function useWorkspaceIsolation(input: {
  supportsMultiplicity: boolean;
  worktreeSupport: "supported" | "unsupported" | "unknown";
  projectIsolation?: "local" | "worktree" | null;
}): WorkspaceIsolationState {
  const { supportsMultiplicity, worktreeSupport, projectIsolation } = input;
  // Precedence: manual pick > project default (issue 068) > remembered global choice.
  // A manual in-screen pick overrides the defaults until the screen remounts.
  const { preferences, updatePreferences } = useFormPreferences();
  const [manualIsolation, setManualIsolation] = useState<"local" | "worktree" | null>(null);
  // Precedence: manual pick > project default (issue 068) > remembered global choice > local.
  const isolation = manualIsolation ?? projectIsolation ?? preferences.isolation ?? "local";
  const canCreateWorktree = supportsMultiplicity && worktreeSupport !== "unsupported";
  const isWorktree = isolation === "worktree" && canCreateWorktree;

  const setIsolation = useCallback(
    (value: "local" | "worktree") => {
      setManualIsolation(value);
      void updatePreferences({ isolation: value });
    },
    [updatePreferences],
  );

  return {
    isolation,
    setIsolation,
    effectiveIsolation: isWorktree ? "worktree" : "local",
    canCreateWorktree,
    showRefPicker: !supportsMultiplicity || isWorktree,
  };
}

function isolationLabel(t: TFunction, isolation: "local" | "worktree"): string {
  return isolation === "worktree"
    ? t("newWorkspace.isolation.worktree")
    : t("newWorkspace.isolation.local");
}

function getContentLayout(input: { isCompact: boolean }): {
  className: string;
  style?: CSSProperties;
} {
  if (input.isCompact) {
    return {
      className:
        "relative flex min-h-0 flex-1 flex-col items-center justify-end pb-[env(safe-area-inset-bottom)]",
    };
  }
  return {
    className: "relative flex min-h-0 flex-1 flex-col items-center justify-center",
    style: CENTERED_CONTENT_STYLE,
  };
}

function normalizeBranchDetails(
  data: { branchDetails?: BranchPickerDetail[]; branches?: string[] } | undefined,
): BranchPickerDetail[] {
  const details = data?.branchDetails;
  if (details && details.length > 0) return details;
  const names = data?.branches ?? [];
  return names.map((name) => ({ name, committerDate: 0 }));
}

/**
 * "background" means the user left the New workspace screen mid-creation, so nothing navigated
 * and the screen — if still mounted under another route — has to drop its pending state itself.
 */
type SubmitOutcome = "navigated" | "background";

interface SubmitDraftInput {
  clearConsumedDraft: () => void;
  serverId: string;
  draftKey: string;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  draftId?: string;
  draftContextScopeKey: string | null;
  initialSetup?: WorkspaceDraftTabSetup;
  workspaceId: string;
  workspaceDirectory: string;
  text: string;
  attachments: ComposerAttachment[];
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
  supportsForgeSearch: boolean;
  resolveClient: () => DaemonClient;
  isStillOnCreateScreen: () => boolean;
}

type NewWorkspaceComposerState = NonNullable<
  ReturnType<typeof useAgentInputDraft>["composerState"]
>;

interface WorkspaceDraftSubmissionConfig {
  cwd: string;
  provider: AgentProvider;
  modeId: string | null;
  model: string | null;
  thinkingOptionId: string | null;
  featureValues: Record<string, unknown> | undefined;
  role: string | null;
  target: WorkspaceTabTarget;
}

async function createAndMergeWorkspace(input: {
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  createInput: Parameters<
    NonNullable<ReturnType<typeof useHostRuntimeClient>>["createBySpaceWorktree"]
  >[0];
  mergeWorkspaces: (
    serverId: string,
    workspaces: ReturnType<typeof normalizeWorkspaceDescriptor>[],
  ) => void;
  serverId: string;
  createFailedMessage: string;
}): Promise<ReturnType<typeof normalizeWorkspaceDescriptor>> {
  const payload = await input.client.createBySpaceWorktree(input.createInput);
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? input.createFailedMessage);
  }
  const normalizedWorkspace = normalizeWorkspaceDescriptor(payload.workspace);
  const workspaceForInitialMerge = input.createInput.firstAgentContext
    ? { ...normalizedWorkspace, status: "running" as const, statusEnteredAt: new Date() }
    : normalizedWorkspace;
  input.mergeWorkspaces(input.serverId, [workspaceForInitialMerge]);
  return normalizedWorkspace;
}

async function createMultiplicityWorkspace(input: {
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  isolation: "local" | "worktree";
  project: HostProjectListItem;
  sourceDirectory: string;
  checkoutRequest: PickerCheckoutRequest | undefined;
  withInitialAgent: boolean;
  prompt: string;
  attachments: AgentAttachment[];
  mergeWorkspaces: (
    serverId: string,
    workspaces: ReturnType<typeof normalizeWorkspaceDescriptor>[],
  ) => void;
  serverId: string;
  createFailedMessage: string;
}): Promise<ReturnType<typeof normalizeWorkspaceDescriptor>> {
  const projectId = getHostProjectId(input.project, input.serverId);
  if (!projectId) throw new Error("Project is not available on the selected host");
  const isWorktree = input.isolation === "worktree";
  const firstAgentContext = buildFirstAgentContext({
    prompt: input.prompt,
    attachments: input.attachments,
  });
  const payload = await input.client.createWorkspace({
    source: isWorktree
      ? {
          kind: "worktree",
          cwd: input.sourceDirectory,
          projectId,
          worktreeSlug: createNameId(),
          ...input.checkoutRequest,
        }
      : {
          kind: "directory",
          path: input.sourceDirectory,
          projectId,
        },
    ...(firstAgentContext ? { firstAgentContext } : {}),
  });
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? input.createFailedMessage);
  }
  const normalizedWorkspace = normalizeWorkspaceDescriptor(payload.workspace);
  const workspaceForInitialMerge = input.withInitialAgent
    ? { ...normalizedWorkspace, status: "running" as const, statusEnteredAt: new Date() }
    : normalizedWorkspace;
  input.mergeWorkspaces(input.serverId, [workspaceForInitialMerge]);
  return normalizedWorkspace;
}

interface CreateChatAgentInput {
  payload: MessagePayload;
  composerState: ReturnType<typeof useAgentInputDraft>["composerState"];
  forkDraftSetup?: PendingWorkspaceDraftSetup | null;
  ensureWorkspace: (input: {
    cwd: string;
    prompt: string;
    attachments: AgentAttachment[];
    withInitialAgent: boolean;
  }) => Promise<ReturnType<typeof normalizeWorkspaceDescriptor>>;
  serverId: string;
  draftKey: string;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  draftId?: string;
  draftContextScopeKey: string | null;
  supportsForgeSearch: boolean;
  resolveClient: () => DaemonClient;
  isStillOnCreateScreen: () => boolean;
  labels: {
    composerStateRequired: string;
    selectModel: string;
  };
}

function buildWorkspaceDraftSetupFromComposer(input: {
  cwd: string;
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
}): WorkspaceDraftTabSetup {
  return {
    provider: input.provider,
    cwd: input.cwd,
    modeId: input.composerState.selectedMode || null,
    model: input.composerState.effectiveModelId || null,
    thinkingOptionId: input.composerState.effectiveThinkingOptionId || null,
    role: input.composerState.selectedRole || null,
    featureValues: input.composerState.featureValues ?? {},
  };
}

function buildWorkspaceDraftSetupForCreatedWorkspace(input: {
  forkDraftSetup: PendingWorkspaceDraftSetup | null | undefined;
  workspaceDirectory: string;
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
}): WorkspaceDraftTabSetup | undefined {
  if (!input.forkDraftSetup) {
    return undefined;
  }
  return buildWorkspaceDraftSetupFromComposer({
    cwd: remapDraftCwdToWorkspace({
      cwd: input.forkDraftSetup.setup.cwd,
      sourceDirectory: input.forkDraftSetup.sourceDirectory,
      workspaceDirectory: input.workspaceDirectory,
    }),
    provider: input.provider,
    composerState: input.composerState,
  });
}

function buildComposerInitialValues(input: {
  initialSetup?: WorkspaceDraftTabSetup | null;
}): CreateAgentInitialValues | undefined {
  if (input.initialSetup) {
    return {
      provider: input.initialSetup.provider,
      modeId: input.initialSetup.modeId,
      model: input.initialSetup.model,
      thinkingOptionId: input.initialSetup.thinkingOptionId,
      role: input.initialSetup.role,
    };
  }
  return undefined;
}

async function runCreateChatAgent(input: CreateChatAgentInput): Promise<SubmitOutcome> {
  const { payload, composerState, ensureWorkspace, serverId, clearDraft } = input;
  const clearConsumedDraft = captureWorkspaceDraftCleanup(input);
  const { text, attachments, cwd } = payload;
  if (!composerState) {
    throw new Error(input.labels.composerStateRequired);
  }
  const provider = composerState.selectedProvider;
  if (!provider) {
    throw new Error(input.labels.selectModel);
  }
  const attachmentSubmitFormat = resolveComposerAttachmentSubmitFormat({
    supportsForgeAttachments: input.supportsForgeSearch,
  });
  const { attachments: reviewAttachments } = splitComposerAttachmentsForSubmit(attachments, {
    format: attachmentSubmitFormat,
  });
  const workspaceNamingAttachments = getWorkspaceNamingAttachments(reviewAttachments);
  const ensuredWorkspace = await ensureWorkspace({
    cwd,
    prompt: text,
    attachments: workspaceNamingAttachments,
    withInitialAgent: true,
  });
  const initialSetup = buildWorkspaceDraftSetupForCreatedWorkspace({
    forkDraftSetup: input.forkDraftSetup,
    workspaceDirectory: ensuredWorkspace.workspaceDirectory,
    provider,
    composerState,
  });
  return await submitWorkspaceDraft({
    clearConsumedDraft,
    serverId,
    clearDraft,
    draftKey: input.draftKey,
    draftId: input.draftId,
    draftContextScopeKey: input.draftContextScopeKey,
    initialSetup,
    workspaceId: ensuredWorkspace.id,
    workspaceDirectory: ensuredWorkspace.workspaceDirectory,
    text,
    attachments,
    provider,
    composerState,
    supportsForgeSearch: input.supportsForgeSearch,
    resolveClient: input.resolveClient,
    isStillOnCreateScreen: input.isStillOnCreateScreen,
  });
}

function buildComposerConfig(input: {
  serverId: string;
  workspaceDirectory: string | null;
  sourceDirectory: string | null;
  initialSetup?: WorkspaceDraftTabSetup | null;
}): Parameters<typeof useAgentInputDraft>[0]["composer"] {
  const { serverId, workspaceDirectory, sourceDirectory, initialSetup } = input;
  const workingDir = workspaceDirectory || sourceDirectory || undefined;
  return {
    initialServerId: serverId || null,
    initialValues: buildComposerInitialValues({ initialSetup }),
    initialFeatureValues: initialSetup?.featureValues,
    isVisible: true,
    lockedWorkingDir: workingDir,
  };
}

function usePendingWorkspaceDraftSetup(
  draftId: string | undefined,
): PendingWorkspaceDraftSetup | null {
  const normalizedDraftId = draftId?.trim() ?? "";
  return useWorkspaceDraftSubmissionStore((state) => {
    if (!normalizedDraftId) {
      return null;
    }
    return state.setupByDraftId[normalizedDraftId] ?? null;
  });
}

function resolveWorkspaceDraftSubmissionConfig(input: {
  draftId: string;
  workspaceDirectory: string;
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
  initialSetup?: WorkspaceDraftTabSetup;
}): WorkspaceDraftSubmissionConfig {
  const { draftId, workspaceDirectory, provider, composerState, initialSetup } = input;
  if (initialSetup) {
    return {
      cwd: initialSetup.cwd,
      provider: initialSetup.provider,
      modeId: initialSetup.modeId,
      model: initialSetup.model,
      thinkingOptionId: initialSetup.thinkingOptionId,
      featureValues: initialSetup.featureValues,
      role: composerState.selectedRole || null,
      target: { kind: "draft", draftId, setup: initialSetup },
    };
  }
  return {
    cwd: workspaceDirectory,
    provider,
    modeId: composerState.selectedMode || null,
    model: composerState.effectiveModelId || null,
    thinkingOptionId: composerState.effectiveThinkingOptionId || null,
    featureValues: composerState.featureValues,
    role: composerState.selectedRole || null,
    target: { kind: "draft", draftId },
  };
}

async function submitWorkspaceDraft(input: SubmitDraftInput): Promise<SubmitOutcome> {
  const {
    serverId,
    clearDraft,
    draftId: draftIdInput,
    workspaceId,
    workspaceDirectory,
    text,
    attachments,
    provider,
    composerState,
    initialSetup,
  } = input;
  const draftId = draftIdInput?.trim() || generateDraftId();
  const clientMessageId = generateMessageId();
  const timestamp = Date.now();
  const wirePayload = splitComposerAttachmentsForSubmit(attachments, {
    format: resolveComposerAttachmentSubmitFormat({
      supportsForgeAttachments: input.supportsForgeSearch,
    }),
  });
  const submission = resolveWorkspaceDraftSubmissionConfig({
    draftId,
    workspaceDirectory,
    provider,
    composerState,
    initialSetup,
  });
  // Creation blocks on a slow daemon RPC. If the user moved on while it ran, the destination
  // screen's draft tab will never mount to issue create_agent, so this path does it instead.
  if (!input.isStillOnCreateScreen()) {
    await createWorkspaceAgentInBackground({
      clearConsumedDraft: input.clearConsumedDraft,
      createAgent: () =>
        requestWorkspaceDraftAgent(input.resolveClient(), {
          workspaceId,
          config: buildWorkspaceDraftAgentConfig({
            provider: submission.provider,
            cwd: submission.cwd,
            ...(submission.modeId ? { modeId: submission.modeId } : {}),
            ...(submission.model ? { model: submission.model } : {}),
            ...(submission.thinkingOptionId
              ? { thinkingOptionId: submission.thinkingOptionId }
              : {}),
            ...(submission.featureValues ? { featureValues: submission.featureValues } : {}),
            ...(submission.role ? { role: submission.role } : {}),
          }),
          text: text.trim(),
          clientMessageId,
          ...(wirePayload.images.length > 0 ? { images: wirePayload.images } : {}),
          ...(wirePayload.attachments.length > 0 ? { attachments: wirePayload.attachments } : {}),
        }),
    });
    return "background";
  }

  useCreateFlowStore.getState().setPending({
    serverId,
    draftId,
    workspaceId,
    agentId: null,
    clientMessageId,
    text: text.trim(),
    timestamp,
    ...(wirePayload.images.length > 0 ? { images: wirePayload.images } : {}),
    ...(wirePayload.attachments.length > 0 ? { attachments: wirePayload.attachments } : {}),
  });
  useWorkspaceDraftSubmissionStore.getState().setPending({
    serverId,
    workspaceId,
    draftId,
    text: text.trim(),
    attachments,
    cwd: submission.cwd,
    provider: submission.provider,
    clientMessageId,
    timestamp,
    ...(submission.modeId ? { modeId: submission.modeId } : {}),
    ...(submission.model ? { model: submission.model } : {}),
    ...(submission.thinkingOptionId ? { thinkingOptionId: submission.thinkingOptionId } : {}),
    ...(submission.featureValues ? { featureValues: submission.featureValues } : {}),
    role: submission.role,
    allowEmptyText: true,
  });
  clearDraft("sent");
  navigateToWorkspace({
    serverId,
    workspaceId,
    target: submission.target,
  });
  return "navigated";
}

function useNewWorkspaceHostSelector(input: {
  initialServerId: string;
  allServerIds: string[];
  projects: HostProjectListItem[];
  lastActiveProject: HostProjectListItem | null;
  hostConnectionStatusByServerId: ReadonlyMap<string, HostRuntimeConnectionStatus>;
  workspaceMultiplicityByServerId: ReadonlyMap<string, boolean>;
  pinnedServerId: string | null;
  localServerId: string | null;
}) {
  const routeServerId = input.initialServerId.trim();
  const defaultServerId = useMemo(
    () =>
      resolveNewWorkspaceInitialServerId({
        allServerIds: input.allServerIds,
        routeServerId: input.initialServerId,
        lastActiveProject: input.lastActiveProject,
        projects: input.projects,
        hostConnectionStatusByServerId: input.hostConnectionStatusByServerId,
        workspaceMultiplicityByServerId: input.workspaceMultiplicityByServerId,
        pinnedServerId: input.pinnedServerId,
        localServerId: input.localServerId,
      }),
    [
      input.allServerIds,
      input.hostConnectionStatusByServerId,
      input.initialServerId,
      input.lastActiveProject,
      input.projects,
      input.workspaceMultiplicityByServerId,
      input.pinnedServerId,
      input.localServerId,
    ],
  );
  const [automaticSelection, setAutomaticSelection] = useState(() => ({
    routeServerId,
    serverId: defaultServerId,
  }));
  const [manualSelection, setManualSelection] = useState<{
    routeServerId: string;
    serverId: string;
  } | null>(null);
  const [hostPickerOpen, setHostPickerOpen] = useState(false);

  useEffect(() => {
    setAutomaticSelection((current) => {
      const nextServerId =
        current.routeServerId === routeServerId
          ? resolveNewWorkspaceAutomaticServerId({
              allServerIds: input.allServerIds,
              routeServerId: input.initialServerId,
              lastActiveProject: input.lastActiveProject,
              projects: input.projects,
              hostConnectionStatusByServerId: input.hostConnectionStatusByServerId,
              workspaceMultiplicityByServerId: input.workspaceMultiplicityByServerId,
              pinnedServerId: input.pinnedServerId,
              localServerId: input.localServerId,
              currentServerId: current.serverId,
              nextServerId: defaultServerId,
            })
          : defaultServerId;

      if (current.routeServerId === routeServerId && current.serverId === nextServerId) {
        return current;
      }

      return { routeServerId, serverId: nextServerId };
    });
  }, [
    defaultServerId,
    input.allServerIds,
    input.hostConnectionStatusByServerId,
    input.initialServerId,
    input.lastActiveProject,
    input.projects,
    input.workspaceMultiplicityByServerId,
    input.pinnedServerId,
    input.localServerId,
    routeServerId,
  ]);

  const automaticServerId =
    automaticSelection.routeServerId === routeServerId &&
    input.allServerIds.includes(automaticSelection.serverId)
      ? automaticSelection.serverId
      : defaultServerId;
  const selectedServerId =
    manualSelection?.routeServerId === routeServerId &&
    input.allServerIds.includes(manualSelection.serverId)
      ? manualSelection.serverId
      : automaticServerId;

  const handleSelectHost = useCallback(
    (id: string) => {
      setManualSelection({ routeServerId, serverId: id });
      setHostPickerOpen(false);
    },
    [routeServerId],
  );

  const handleHostPickerOpenChange = useCallback((open: boolean) => {
    setHostPickerOpen(open);
  }, []);

  const openHostPicker = useCallback(() => {
    setHostPickerOpen(true);
  }, []);

  return {
    selectedServerId,
    hostPickerOpen,
    handleSelectHost,
    handleHostPickerOpenChange,
    openHostPicker,
  };
}

interface NewWorkspaceInitialContextState {
  allHosts: HostProfile[];
  selectedServerId: string;
  hostPickerOpen: boolean;
  handleSelectHost: (id: string) => void;
  handleHostPickerOpenChange: (open: boolean) => void;
  openHostPicker: () => void;
  projects: HostProjectListItem[];
  routeProject: HostProjectListItem | null;
  routeProjectContextViewKey: string | null;
  lastActiveProject: HostProjectListItem | null;
  /** Route project's view key, falling back to the remembered one — the per-project settings key. */
  pinViewKey: string | null;
}

function useNewWorkspaceInitialContext({
  serverId,
  sourceDirectory: sourceDirectoryProp,
  projectId,
  displayName: displayNameProp,
}: NewWorkspaceScreenProps): NewWorkspaceInitialContextState {
  const allHosts = useHosts();
  const allServerIds = useMemo(() => allHosts.map((h) => h.serverId), [allHosts]);
  const projects = useHostProjects(allServerIds);
  const routeDisplayName = displayNameProp?.trim() ?? "";
  const routePlacement = useMemo(
    () =>
      hostProjectFromRoute({
        serverId,
        projectId,
        displayName: routeDisplayName,
        sourceDirectory: sourceDirectoryProp,
      }),
    [projectId, routeDisplayName, serverId, sourceDirectoryProp],
  );
  const routeProject = useMemo(() => {
    if (!routePlacement) return null;
    return (
      resolveHostProjectCandidate({
        candidate: routePlacement,
        projects,
        serverId,
      }) ?? routePlacement
    );
  }, [projects, routePlacement, serverId]);
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const lastWorkspaceServerId = useMemo(
    () =>
      lastWorkspaceSelection && allServerIds.includes(lastWorkspaceSelection.serverId)
        ? lastWorkspaceSelection.serverId
        : null,
    [allServerIds, lastWorkspaceSelection],
  );
  const lastWorkspaceId = lastWorkspaceServerId ? lastWorkspaceSelection!.workspaceId : null;
  const lastWorkspace = useWorkspace(lastWorkspaceServerId, lastWorkspaceId);
  const lastActiveProject = useMemo(
    () =>
      lastWorkspaceServerId
        ? hostProjectFromWorkspace({ serverId: lastWorkspaceServerId, workspace: lastWorkspace })
        : null,
    [lastWorkspace, lastWorkspaceServerId],
  );
  const hostConnectionStatusByServerId = useHostRuntimeConnectionStatuses(allServerIds);
  const workspaceMultiplicityByServerId = useHostFeatureMap(allServerIds, "workspaceMultiplicity");
  const localServerId = useLocalDaemonServerId();
  const defaultHostByProject = useSettings((settings) => settings.defaultHostByProject);
  // The settings screen writes the pin under the cross-host view key from the project list. A
  // project built from one workspace carries a placement key instead, so resolve the remembered
  // one against that list first — its own key would never match the stored pin.
  const lastActiveProjectKey = useMemo(() => {
    if (!lastActiveProject || !lastWorkspaceServerId) return null;
    return (
      resolveHostProjectCandidate({
        candidate: lastActiveProject,
        projects,
        serverId: lastWorkspaceServerId,
      })?.viewKey ?? lastActiveProject.viewKey
    );
  }, [lastActiveProject, lastWorkspaceServerId, projects]);
  // Route placement first: opening "New workspace" from a project targets that project even
  // when the last active one differs.
  const pinViewKey = routeProject?.viewKey ?? lastActiveProjectKey;
  const pinnedServerId = (pinViewKey && defaultHostByProject[pinViewKey]) || null;
  const {
    selectedServerId,
    hostPickerOpen,
    handleSelectHost,
    handleHostPickerOpenChange,
    openHostPicker,
  } = useNewWorkspaceHostSelector({
    initialServerId: serverId,
    allServerIds,
    projects,
    lastActiveProject,
    hostConnectionStatusByServerId,
    workspaceMultiplicityByServerId,
    pinnedServerId,
    localServerId,
  });

  return {
    allHosts,
    selectedServerId,
    hostPickerOpen,
    handleSelectHost,
    handleHostPickerOpenChange,
    openHostPicker,
    projects,
    routeProject,
    routeProjectContextViewKey: routePlacement?.viewKey ?? null,
    lastActiveProject,
    pinViewKey,
  };
}

type RefPickerRenderOption = NonNullable<ComboboxProps["renderOption"]>;

interface FormPickerControl {
  anchorRef: RefObject<HTMLButtonElement | null>;
  open: () => void;
  openState: boolean;
  onOpenChange: (open: boolean) => void;
}

interface NewWorkspaceFormStackInput {
  isCompact: boolean;
  isPending: boolean;
  project: FormPickerControl & {
    options: ComboboxOptionType[];
    triggerLabel: string;
    selectedProject: HostProjectListItem | null;
    iconDataByProjectViewKey: Map<string, string | null>;
    selectedOptionId: string;
    onSelect: (id: string) => void;
    onAddProject: () => void;
    renderOption: RefPickerRenderOption;
  };
  host: FormPickerControl & {
    allHosts: HostProfile[];
    systemHosts?: HostProfile[];
    selectedServerId: string;
    onSelect: (id: string) => void;
  };
  isolation: FormPickerControl & {
    effectiveIsolation: "local" | "worktree";
    options: ComboboxOptionType[];
    onSelect: (id: string) => void;
    renderOption: RefPickerRenderOption;
    canCreateWorktree: boolean;
  };
  base: FormPickerControl & {
    selectedSourceDirectory: string | null;
    selectedItem: PickerItem | null;
    triggerLabel: string;
    options: ComboboxOptionType[];
    selectedOptionId: string;
    onSelect: (id: string) => void;
    setSearchQuery: (query: string) => void;
    emptyText: string;
    renderOption: RefPickerRenderOption;
    showRefPicker: boolean;
  };
  launch: {
    serverId: string;
    target: LaunchTarget;
    onChange: (target: LaunchTarget) => void;
    profiles: readonly TerminalProfile[];
    disabled: boolean;
  };
}

interface HostControlProps {
  showHostControl: boolean;
  desktopControlClassName?: string;
  host: FormPickerControl & {
    allHosts: HostProfile[];
    systemHosts?: HostProfile[];
    selectedServerId: string;
    onSelect: (id: string) => void;
  };
  isPending: boolean;
  selectedHostLabel: string;
  badgeClassName: string;
  tooltipText: string;
}

function NewWorkspaceHostControl(props: HostControlProps): ReactElement | null {
  const {
    showHostControl,
    desktopControlClassName,
    host,
    isPending,
    selectedHostLabel,
    badgeClassName,
    tooltipText,
  } = props;

  if (!showHostControl) return null;

  return (
    <div className={desktopControlClassName}>
      <HostPicker
        hosts={host.allHosts}
        value={host.selectedServerId}
        onSelect={host.onSelect}
        open={host.openState}
        onOpenChange={host.onOpenChange}
        anchorRef={host.anchorRef}
        searchable={false}
        title="Host"
        desktopPlacement="bottom-start"
        desktopMinWidth={200}
        hostOptionTestID={newWorkspaceHostOptionTestID}
      >
        <Tooltip>
          <TooltipTrigger asChild triggerRefProp="ref">
            <button
              type="button"
              ref={host.anchorRef}
              aria-label="Host"
              onClick={host.open}
              disabled={isPending}
              className={badgeClassName}
              data-testid="host-picker-trigger"
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                <HostStatusDot serverId={host.selectedServerId} />
              </span>
              <span className="min-w-0 shrink truncate text-sm text-muted-foreground">
                {selectedHostLabel}
              </span>
              {metaChevron}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </HostPicker>
    </div>
  );
}

function useNewWorkspaceFormStack(input: NewWorkspaceFormStackInput): ReactElement {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { isCompact, isPending, project, host, isolation, base, launch } = input;

  const systemHosts = host.systemHosts ?? host.allHosts;
  const selectedHostLabel =
    systemHosts.find((h) => h.serverId === host.selectedServerId)?.label ?? "Host";
  const showHostControl = systemHosts.length > 1;
  const isolationTriggerLabel = isolationLabel(t, isolation.effectiveIsolation);
  const addProjectAction = useMemo(
    () => <AddProjectPickerAction onPress={project.onAddProject} />,
    [project.onAddProject],
  );

  const badgeClassName = cn(BADGE, isPending && "opacity-60");

  const desktopControlClassName = isCompact ? undefined : "min-w-0 shrink";

  const projectControl = (
    <div className={desktopControlClassName}>
      <ProjectPickerTrigger
        pickerAnchorRef={project.anchorRef}
        onPress={project.open}
        disabled={isPending}
        badgeClassName={badgeClassName}
        label={project.triggerLabel}
        tooltipLabel={t("newWorkspace.tooltips.project")}
        projectViewKey={project.selectedProject?.viewKey ?? null}
        iconDataUri={
          project.selectedProject
            ? (project.iconDataByProjectViewKey.get(project.selectedProject.viewKey) ?? null)
            : null
        }
        iconColor={theme.colors.foregroundMuted}
        iconSize={theme.iconSize.sm}
      />
      <Combobox
        options={project.options}
        value={project.selectedOptionId}
        onSelect={project.onSelect}
        searchable
        searchPlaceholder="Search projects"
        title="Project"
        open={project.openState}
        onOpenChange={project.onOpenChange}
        desktopPlacement="bottom-start"
        desktopMinWidth={360}
        anchorRef={project.anchorRef}
        emptyText="No projects available."
        renderOption={project.renderOption}
        footer={addProjectAction}
      />
    </div>
  );

  const hostControl = (
    <NewWorkspaceHostControl
      showHostControl={showHostControl}
      desktopControlClassName={desktopControlClassName}
      host={host}
      isPending={isPending}
      selectedHostLabel={selectedHostLabel}
      badgeClassName={badgeClassName}
      tooltipText={t("newWorkspace.tooltips.host")}
    />
  );

  const isolationControl = isolation.canCreateWorktree ? (
    <div className={desktopControlClassName}>
      <IsolationPickerTrigger
        pickerAnchorRef={isolation.anchorRef}
        onPress={isolation.open}
        disabled={isPending}
        badgeClassName={badgeClassName}
        isolation={isolation.effectiveIsolation}
        label={isolationTriggerLabel}
        tooltipLabel={t("newWorkspace.tooltips.isolation")}
        iconColor={theme.colors.foregroundMuted}
        iconSize={theme.iconSize.sm}
      />
      <Combobox
        options={isolation.options}
        value={isolation.effectiveIsolation}
        onSelect={isolation.onSelect}
        title={t("newWorkspace.isolation.label")}
        open={isolation.openState}
        onOpenChange={isolation.onOpenChange}
        desktopPlacement="bottom-start"
        anchorRef={isolation.anchorRef}
        renderOption={isolation.renderOption}
      />
    </div>
  ) : null;

  const baseControl = base.showRefPicker ? (
    <div className={desktopControlClassName}>
      <RefPickerTrigger
        pickerAnchorRef={base.anchorRef}
        onPress={base.open}
        disabled={isPending || !base.selectedSourceDirectory}
        badgeClassName={badgeClassName}
        selectedItem={base.selectedItem}
        triggerLabel={base.triggerLabel}
        accessibilityLabel={t("newWorkspace.refPicker.startingRef")}
        tooltipLabel={t("newWorkspace.tooltips.startingRef")}
        iconColor={theme.colors.foregroundMuted}
        iconSize={theme.iconSize.sm}
      />
      <Combobox
        options={base.options}
        value={base.selectedOptionId}
        onSelect={base.onSelect}
        searchable
        searchPlaceholder={t("newWorkspace.refPicker.searchPlaceholder")}
        title={t("newWorkspace.refPicker.title")}
        open={base.openState}
        onOpenChange={base.onOpenChange}
        onSearchQueryChange={base.setSearchQuery}
        desktopPlacement="bottom-start"
        anchorRef={base.anchorRef}
        emptyText={base.emptyText}
        renderOption={base.renderOption}
      />
    </div>
  ) : null;

  const launchControl = (
    <LaunchControl
      serverId={launch.serverId}
      target={launch.target}
      onChange={launch.onChange}
      profiles={launch.profiles}
      disabled={launch.disabled}
      badgeClassName={badgeClassName}
    />
  );

  return isCompact ? (
    <div data-testid="new-workspace-ref-picker-row" className="mb-8 flex flex-col gap-2">
      <FormRow>{projectControl}</FormRow>
      {hostControl ? <FormRow>{hostControl}</FormRow> : null}
      {isolationControl ? <FormRow>{isolationControl}</FormRow> : null}
      {baseControl ? <FormRow>{baseControl}</FormRow> : null}
      <FormRow>{launchControl}</FormRow>
      {/* Keep fixed stack height without separating the visible controls. */}
      {isolationControl ? null : <div className="h-7" />}
      {baseControl ? null : <div className="h-7" />}
    </div>
  ) : (
    <div
      data-testid="new-workspace-ref-picker-row"
      className="mb-8 flex flex-row items-center gap-2 px-4"
    >
      {projectControl}
      {hostControl}
      {isolationControl}
      {baseControl}
      {/* Pushes the launch control to the trailing edge, on the composer's inner content. */}
      <div className="flex-1" />
      {launchControl}
    </div>
  );
}

export function NewWorkspaceScreen({
  serverId,
  sourceDirectory: sourceDirectoryProp,
  projectId,
  displayName: displayNameProp,
  draftId,
}: NewWorkspaceScreenProps) {
  const queryClient = useQueryClient();
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const toast = useToast();
  const mergeWorkspaces = useCallback(
    (targetServerId: string, workspaces: Iterable<WorkspaceDescriptor>) => {
      getHostRuntimeStore().acceptWorkspaceSnapshots(targetServerId, Array.from(workspaces));
    },
    [],
  );
  const {
    allHosts,
    selectedServerId,
    hostPickerOpen,
    handleSelectHost,
    handleHostPickerOpenChange,
    openHostPicker,
    projects,
    routeProject,
    routeProjectContextViewKey,
    lastActiveProject,
    pinViewKey,
  } = useNewWorkspaceInitialContext({
    serverId,
    sourceDirectory: sourceDirectoryProp,
    projectId,
    displayName: displayNameProp,
  });
  // Per-project New workspace defaults (issue 068): the settings screen writes them under the
  // cross-host view key, the same key the host pin uses.
  const newWorkspaceIsolationByProject = useSettings(
    (settings) => settings.newWorkspaceIsolationByProject,
  );
  const defaultBaseBranchByProject = useSettings((settings) => settings.defaultBaseBranchByProject);
  const { projectIsolation, pinnedBaseBranch } = useMemo(
    () => ({
      projectIsolation: (pinViewKey && newWorkspaceIsolationByProject[pinViewKey]) || null,
      pinnedBaseBranch: (pinViewKey && defaultBaseBranchByProject[pinViewKey]) || null,
    }),
    [defaultBaseBranchByProject, newWorkspaceIsolationByProject, pinViewKey],
  );
  // COMPAT(workspaceMultiplicity): added in v0.1.97, drop the gate when floor >= v0.1.97
  const supportsWorkspaceMultiplicity = useHostFeature(selectedServerId, "workspaceMultiplicity");
  const supportsForgeSearch = useHostFeature(selectedServerId, "forgeSearch");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdWorkspace, setCreatedWorkspace] = useState<ReturnType<
    typeof normalizeWorkspaceDescriptor
  > | null>(null);
  const [pendingAction, setPendingAction] = useState<"chat" | "empty" | "terminal" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const openAddProjectPicker = useOpenAddProject();
  const [isolationPickerOpen, setIsolationPickerOpen] = useState(false);
  const [pickerSearchQuery, setPickerSearchQuery] = useState("");
  const [debouncedPickerSearchQuery, setDebouncedPickerSearchQuery] = useState("");
  const pickerAnchorRef = useRef<HTMLButtonElement>(null);
  const projectPickerAnchorRef = useRef<HTMLButtonElement>(null);
  const isolationPickerAnchorRef = useRef<HTMLButtonElement>(null);
  const hostPickerAnchorRef = useRef<HTMLButtonElement | null>(null);
  const isDraftHandoffActive = useIsNewWorkspaceDraftHandoffActive({ draftId, selectedServerId });
  const isStillOnCreateScreen = useNewWorkspaceScreenPresence();

  // Launch target: what the composer submits to (chat agent, or a terminal
  // profile). Mirrors useWorkspaceIsolation's pattern below: the derived
  // value reads live from preferences until the user manually picks
  // something in this screen, so the async preferences load doesn't race a
  // frozen useState initializer.
  const { preferences: formPreferences, updatePreferences: updateFormPreferences } =
    useFormPreferences();
  const { config: daemonConfig } = useDaemonConfig(selectedServerId);
  const terminalProfiles: readonly TerminalProfile[] = useMemo(
    () => resolveTerminalProfiles(daemonConfig?.terminalProfiles),
    [daemonConfig?.terminalProfiles],
  );
  // Manual selection wins once the user picks something; until then the target
  // reads live from preferences so the async load can't race a frozen
  // initializer. Both go through `resolveLaunchTarget`, so a profile deleted
  // daemon-side falls back to chat rather than leaving a dead selection.
  const [manualLaunchTarget, setManualLaunchTarget] = useState<LaunchTarget | null>(null);
  const launchTarget = useMemo(
    () => resolveLaunchTarget(manualLaunchTarget ?? formPreferences.launchTarget, terminalProfiles),
    [manualLaunchTarget, formPreferences.launchTarget, terminalProfiles],
  );
  const [terminalPromptText, setTerminalPromptText] = useState("");
  const {
    isTerminalLaunch,
    selectedTerminalProfile,
    terminalTakesPrompt,
    terminalComposerValue,
    terminalPlaceholder,
    terminalSubmitLabel,
    launchFocusKey,
  } = useTerminalComposerState({ launchTarget, terminalProfiles, terminalPromptText });
  const terminalTextReplacement = useMemo(
    () => ({ key: launchFocusKey, text: terminalComposerValue }),
    [launchFocusKey, terminalComposerValue],
  );

  useEffect(() => {
    const trimmed = pickerSearchQuery.trim();
    const timer = setTimeout(() => setDebouncedPickerSearchQuery(trimmed), 180);
    return () => clearTimeout(timer);
  }, [pickerSearchQuery]);

  const workspace = createdWorkspace;
  const client = useHostRuntimeClient(selectedServerId);
  const isConnected = useHostRuntimeIsConnected(selectedServerId);
  const {
    selectedProject,
    selectedSourceDirectory,
    projectPickerOptions,
    projectByOptionId,
    selectedProjectOptionId,
    projectTriggerLabel,
    handleSelectProjectOption: selectProjectOption,
    isProjectSelectionLocked,
  } = useNewWorkspaceProjectPicker({
    selectedServerId,
    projects,
    routeProject,
    routeProjectContextViewKey,
    lastActiveProject,
    allowAllProjects: supportsWorkspaceMultiplicity,
  });

  // Host options: a pinned project (manual pick or routed context) only offers
  // hosts that have it — including equivalent clones on other hosts (same
  // projectKey). An auto-carried project never restricts the host list.
  const availableHosts = useMemo(() => {
    if (!isProjectSelectionLocked || !selectedProject) {
      return allHosts;
    }
    const projectHostServerIds = new Set<string>();
    for (const host of selectedProject.hosts) {
      projectHostServerIds.add(host.serverId);
    }
    if (selectedProject.projectKey !== null) {
      for (const project of projects) {
        if (project.projectKey !== selectedProject.projectKey) {
          continue;
        }
        for (const host of project.hosts) {
          projectHostServerIds.add(host.serverId);
        }
      }
    }
    const matched = allHosts.filter((h) => projectHostServerIds.has(h.serverId));
    return matched.length > 0 ? matched : allHosts;
  }, [allHosts, projects, selectedProject, isProjectSelectionLocked]);

  const projectIconTargets = useMemo(
    () => buildNewWorkspaceProjectIconTargets(projects, selectedServerId),
    [projects, selectedServerId],
  );

  const projectIconDataByProjectViewKey = useProjectIcons({
    projects: projectIconTargets,
  });
  const draftKey = buildNewWorkspaceDraftKey(draftId);
  const forkDraftSetup = usePendingWorkspaceDraftSetup(draftId);
  const draftContextScopeKey = useDraftWorkspaceAttachmentScopeKey(draftId);
  const visibleDraftContextScopeKeys = useMemo(
    () => resolveVisibleDraftContextScopeKeys({ isDraftHandoffActive, draftContextScopeKey }),
    [draftContextScopeKey, isDraftHandoffActive],
  );
  const chatDraft = useAgentInputDraft({
    draftKey,
    composer: buildComposerConfig({
      serverId: selectedServerId,
      workspaceDirectory: workspace?.workspaceDirectory ?? null,
      sourceDirectory: selectedSourceDirectory,
      initialSetup: forkDraftSetup?.setup,
    }),
  });
  const composerState = chatDraft.composerState;
  const [pickerSelection, dispatchPickerSelection] = useReducer(
    reducePickerSelection,
    initialPickerSelectionState,
  );
  const selectedItem = pickerSelection.selectedItem;

  const handleForgeChangeRequestDetected = useCallback(() => {
    dispatchPickerSelection({ type: "pr-detected" });
  }, []);

  const handleForgeChangeRequestAutoAttach = useCallback((item: ForgeSearchItem) => {
    dispatchPickerSelection({
      type: "pr-added",
      item: { kind: "github-pr", item },
    });
  }, []);

  const withConnectedClient = useCallback(() => {
    const connectedClient = getHostRuntimeStore().getClient(selectedServerId);
    if (!connectedClient?.isConnected) {
      throw new Error(t("newWorkspace.errors.hostDisconnected"));
    }
    return connectedClient;
  }, [selectedServerId, t]);

  const clientReady = isConnected && Boolean(client);
  const hasSelectedSourceDirectory = selectedSourceDirectory !== null;
  const pickerQueryEnabled = pickerOpen && clientReady && hasSelectedSourceDirectory;

  const { status: checkoutStatus } = useCheckoutStatusQuery({
    serverId: selectedServerId,
    cwd: selectedSourceDirectory ?? "",
  });

  const worktreeSupport = selectedProject
    ? getWorktreeSupportForHostProject({ project: selectedProject, serverId: selectedServerId })
    : "unsupported";
  const isPending = isNewWorkspacePending({ pendingAction, isDraftHandoffActive });
  const { effectiveIsolation, setIsolation, canCreateWorktree, showRefPicker } =
    useWorkspaceIsolation({
      supportsMultiplicity: supportsWorkspaceMultiplicity,
      worktreeSupport,
      projectIsolation,
    });

  const branchSuggestionsQuery = useQuery({
    queryKey: [
      "branch-suggestions",
      selectedServerId,
      selectedSourceDirectory,
      debouncedPickerSearchQuery,
    ],
    queryFn: async () => {
      if (!selectedSourceDirectory) {
        throw new Error("Choose a project");
      }
      const connectedClient = withConnectedClient();
      return connectedClient.getBranchSuggestions({
        cwd: selectedSourceDirectory,
        query: debouncedPickerSearchQuery || undefined,
        limit: 20,
      });
    },
    enabled: pickerQueryEnabled,
    staleTime: 15_000,
  });

  // The project's pinned base branch (issue 068) resolves through its own exact-name query
  // rather than the picker's list: that list is search-filtered and capped at 20, so a pin
  // ranked below the window or absent from the current search would silently fall back to
  // the checkout's default. The server filters suggestions by substring, so the exact name
  // matches as long as the branch still exists.
  const pinnedBaseQueryEnabled = useMemo(
    () => Boolean(pinnedBaseBranch) && clientReady && hasSelectedSourceDirectory,
    [pinnedBaseBranch, clientReady, hasSelectedSourceDirectory],
  );
  const pinnedBaseBranchQuery = useQuery({
    queryKey: ["pinned-base-branch", selectedServerId, selectedSourceDirectory, pinnedBaseBranch],
    queryFn: async () => {
      if (!selectedSourceDirectory || !pinnedBaseBranch) {
        throw new Error("No pinned base branch");
      }
      return withConnectedClient().getBranchSuggestions({
        cwd: selectedSourceDirectory,
        query: pinnedBaseBranch,
        limit: 20,
      });
    },
    enabled: pinnedBaseQueryEnabled,
    staleTime: 15_000,
  });

  const githubPrSearchQuery = useForgeSearchQuery({
    client,
    serverId: selectedServerId,
    cwd: selectedSourceDirectory ?? "",
    query: debouncedPickerSearchQuery,
    kinds: ["change_request"],
    supportsForgeSearch,
    enabled: pickerQueryEnabled,
  });

  const branchDetails = useMemo(
    () => normalizeBranchDetails(branchSuggestionsQuery.data),
    [branchSuggestionsQuery.data],
  );
  const forgeSearchAuthenticated =
    !githubPrSearchQuery.data || githubPrSearchQuery.data.authState === "authenticated";
  const prItems: ForgeSearchItem[] = useMemo(() => {
    if (!forgeSearchAuthenticated) return [];
    return githubPrSearchQuery.data?.items ?? [];
  }, [forgeSearchAuthenticated, githubPrSearchQuery.data?.items]);

  const pinnedBaseItem = useMemo(
    () =>
      pinnedBasePickerItem(normalizeBranchDetails(pinnedBaseBranchQuery.data), pinnedBaseBranch),
    [pinnedBaseBranch, pinnedBaseBranchQuery.data],
  );
  const baseItem = useMemo(
    () => resolveNewWorkspaceBaseItem({ selectedItem, pinnedBaseItem, checkoutStatus }),
    [checkoutStatus, pinnedBaseItem, selectedItem],
  );
  const { options, itemById, selectedOptionId }: PickerOptionData = useMemo(
    () =>
      buildPickerOptionData({
        branchDetails,
        prItems,
        baseItem,
      }),
    [baseItem, branchDetails, prItems],
  );
  const triggerLabel = useMemo(() => {
    const displayItem = itemById.get(selectedOptionId);
    return displayItem ? pickerItemLabel(displayItem) : "main";
  }, [itemById, selectedOptionId]);
  const selectPickerItem = useCallback(
    (item: PickerItem) => {
      const nextAttachments = syncPickerPrAttachment({
        attachments: chatDraft.attachments,
        item,
      });

      dispatchPickerSelection({ type: "picker-selected", item });
      chatDraft.setAttachments(nextAttachments);
      setPickerOpen(false);
    },
    [chatDraft],
  );

  const handleSelectOption = useCallback(
    (id: string) => {
      const item = itemById.get(id);
      if (!item) return;
      selectPickerItem(item);
    },
    [itemById, selectPickerItem],
  );

  const clearPickerSelectionForTargetChange = useCallback(
    (currentTargetId: string, nextTargetId: string) => {
      const nextAttachments = clearPickerPrAttachmentForTargetChange({
        attachments: chatDraft.attachments,
        currentTargetId,
        nextTargetId,
      });
      if (nextAttachments === chatDraft.attachments) return;
      chatDraft.setAttachments(nextAttachments);
      dispatchPickerSelection({ type: "target-changed" });
    },
    [chatDraft],
  );

  const handleSelectWorkspaceHost = useCallback(
    (id: string) => {
      handleSelectHost(id);
      clearPickerSelectionForTargetChange(selectedServerId, id);
    },
    [clearPickerSelectionForTargetChange, handleSelectHost, selectedServerId],
  );

  const handleSelectProjectOption = useCallback(
    (id: string) => {
      // selectProjectOption enforces selectability (worktree-only when
      // multiplicity is off, any project when it's on); don't re-gate here on
      // canCreateWorktree or non-git projects become unselectable.
      selectProjectOption(id);
      setProjectPickerOpen(false);
      clearPickerSelectionForTargetChange(selectedProjectOptionId, id);

      const targetProject = projectByOptionId.get(id);
      if (targetProject && targetProject.hosts.length > 0) {
        const isCurrentHostValid = targetProject.hosts.some((h) => h.serverId === selectedServerId);
        if (!isCurrentHostValid) {
          const nextHost = targetProject.hosts[0];
          if (nextHost) {
            handleSelectWorkspaceHost(nextHost.serverId);
          }
        }
      }
    },
    [
      clearPickerSelectionForTargetChange,
      handleSelectWorkspaceHost,
      projectByOptionId,
      selectProjectOption,
      selectedProjectOptionId,
      selectedServerId,
    ],
  );

  const handleAddProject = useCallback(() => {
    setProjectPickerOpen(false);
    openAddProjectPicker(selectedServerId);
  }, [openAddProjectPicker, selectedServerId]);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const openProjectPicker = useCallback(() => {
    setProjectPickerOpen(true);
  }, []);

  // Cmd/Ctrl+P opens the project picker with its search focused so the user can
  // switch projects from the keyboard. Registered only while this screen is
  // mounted, so the shortcut doesn't swallow the browser's native print
  // elsewhere; gated on having projects to pick.
  const handleProjectPick = useCallback(() => {
    openProjectPicker();
    return true;
  }, [openProjectPicker]);
  useKeyboardActionHandler({
    handlerId: "new-workspace-project-pick",
    actions: PROJECT_PICK_ACTIONS,
    enabled: projectPickerOptions.length > 0,
    priority: 0,
    handle: handleProjectPick,
  });

  const openIsolationPicker = useCallback(() => {
    setIsolationPickerOpen(true);
  }, []);

  const handleIsolationPickerOpenChange = useCallback((nextOpen: boolean) => {
    setIsolationPickerOpen(nextOpen);
  }, []);

  // "New worktree" is omitted entirely (not disabled) when the project isn't a
  // git checkout, since worktree isolation is impossible there.
  const isolationOptions = useMemo<ComboboxOptionType[]>(() => {
    const localOption = { id: "local", label: isolationLabel(t, "local") };
    if (!canCreateWorktree) return [localOption];
    return [localOption, { id: "worktree", label: isolationLabel(t, "worktree") }];
  }, [canCreateWorktree, t]);

  const handleSelectIsolationOption = useCallback(
    (id: string) => {
      setIsolation(id === "worktree" ? "worktree" : "local");
      setIsolationPickerOpen(false);
    },
    [setIsolation],
  );

  const renderIsolationOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOptionType;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => {
      return (
        <IsolationOptionItem
          optionId={option.id}
          label={option.label}
          selected={selected}
          active={active}
          disabled={isPending}
          onPress={onPress}
          iconColor={theme.colors.foregroundMuted}
          iconSize={theme.iconSize.sm}
        />
      );
    },
    [isPending, theme.colors.foregroundMuted, theme.iconSize.sm],
  );

  const handleClearDraft = useCallback(() => {
    // No-op: screen navigates away on success, text should stay for retry on error
  }, []);

  const handlePickerOpenChange = useCallback((nextOpen: boolean) => {
    setPickerOpen(nextOpen);
    if (!nextOpen) {
      setPickerSearchQuery("");
    }
  }, []);

  const handleProjectPickerOpenChange = useCallback((nextOpen: boolean) => {
    setProjectPickerOpen(nextOpen);
  }, []);

  const buildCreateWorktreeInput = useCallback(
    (input: {
      cwd: string;
      prompt: string;
      attachments: AgentAttachment[];
      checkoutRequest: PickerCheckoutRequest | undefined;
    }): CreateBySpaceWorktreeInput => {
      if (!selectedProject) {
        throw new Error("Choose a project");
      }
      if (!selectedSourceDirectory) {
        throw new Error("Choose a host for this project");
      }
      const firstAgentContext = buildFirstAgentContext(input);
      const hostProjectId = getHostProjectId(selectedProject, selectedServerId);
      if (!hostProjectId) {
        throw new Error("Project is not available on the selected host");
      }

      return {
        cwd: selectedSourceDirectory,
        projectId: hostProjectId,
        worktreeSlug: createNameId(),
        ...(firstAgentContext ? { firstAgentContext } : {}),
        ...input.checkoutRequest,
      };
    },
    [selectedProject, selectedServerId, selectedSourceDirectory],
  );

  const ensureWorkspace = useCallback(
    async (input: {
      cwd: string;
      prompt: string;
      attachments: AgentAttachment[];
      withInitialAgent: boolean;
    }) => {
      if (createdWorkspace) {
        return createdWorkspace;
      }
      if (!selectedProject) {
        throw new Error("Choose a project");
      }
      if (!selectedSourceDirectory) {
        throw new Error("Choose a host for this project");
      }
      const connectedClient = withConnectedClient();
      const createsWorktree = !supportsWorkspaceMultiplicity || effectiveIsolation === "worktree";
      const checkoutStatusForCreate = createsWorktree
        ? await ensureCheckoutStatus({
            queryClient,
            client: connectedClient,
            serverId: selectedServerId,
            cwd: selectedSourceDirectory,
          })
        : null;
      const checkoutRequest = checkoutStatusForCreate
        ? pickerItemToCheckoutRequest(
            resolveNewWorkspaceBaseItem({
              selectedItem,
              pinnedBaseItem,
              checkoutStatus: checkoutStatusForCreate,
            }),
          )
        : undefined;
      const normalizedWorkspace = supportsWorkspaceMultiplicity
        ? await createMultiplicityWorkspace({
            client: connectedClient,
            isolation: effectiveIsolation,
            project: selectedProject,
            sourceDirectory: selectedSourceDirectory,
            checkoutRequest,
            withInitialAgent: input.withInitialAgent,
            prompt: input.prompt,
            attachments: input.attachments,
            mergeWorkspaces,
            serverId: selectedServerId,
            createFailedMessage: t("newWorkspace.errors.createWorktreeFailed"),
          })
        : await createAndMergeWorkspace({
            client: connectedClient,
            createInput: buildCreateWorktreeInput({ ...input, checkoutRequest }),
            mergeWorkspaces,
            serverId: selectedServerId,
            createFailedMessage: t("newWorkspace.errors.createWorktreeFailed"),
          });
      setCreatedWorkspace(normalizedWorkspace);
      return normalizedWorkspace;
    },
    [
      buildCreateWorktreeInput,
      createdWorkspace,
      effectiveIsolation,
      mergeWorkspaces,
      queryClient,
      pinnedBaseItem,
      selectedItem,
      selectedProject,
      selectedServerId,
      selectedSourceDirectory,
      supportsWorkspaceMultiplicity,
      t,
      withConnectedClient,
    ],
  );

  const handleSubmitNewWorkspace = useCallback(
    async (payload: MessagePayload) => {
      try {
        setErrorMessage(null);
        await composerState?.persistFormPreferences();
        await updateFormPreferences({ launchTarget });
        if (isEmptyWorkspaceSubmission(payload)) {
          setPendingAction("empty");
          let outcome: SubmitOutcome = "background";
          await runCreateEmptyWorkspace({
            payload,
            ensureWorkspace,
            serverId: selectedServerId,
            navigate: (targetServerId, workspaceId) => {
              if (!isStillOnCreateScreen()) {
                return;
              }
              outcome = "navigated";
              navigateToWorkspace({ serverId: targetServerId, workspaceId });
            },
          });
          // Nothing navigated, so this screen may still be mounted under another route. Release
          // the pending lock it would otherwise keep forever.
          if (outcome === "background") {
            setPendingAction(null);
          }
          return;
        }

        setPendingAction("chat");
        const outcome = await runCreateChatAgent({
          payload,
          composerState,
          forkDraftSetup,
          ensureWorkspace,
          serverId: selectedServerId,
          clearDraft: chatDraft.clear,
          draftKey,
          draftId,
          draftContextScopeKey,
          supportsForgeSearch,
          resolveClient: withConnectedClient,
          isStillOnCreateScreen,
          labels: {
            composerStateRequired: t("newWorkspace.errors.composerStateRequired"),
            selectModel: t("newWorkspace.errors.selectModel"),
          },
        });
        if (outcome === "background") {
          setPendingAction(null);
        }
      } catch (error) {
        const message = toErrorMessage(error);
        setPendingAction(null);
        setErrorMessage(message);
        toast.error(message);
      }
    },
    [
      composerState,
      draftContextScopeKey,
      draftId,
      chatDraft.clear,
      draftKey,
      ensureWorkspace,
      forkDraftSetup,
      isStillOnCreateScreen,
      launchTarget,
      selectedServerId,
      supportsForgeSearch,
      t,
      toast,
      updateFormPreferences,
      withConnectedClient,
    ],
  );

  const handleSubmitTerminalLaunch = useCallback(async () => {
    try {
      setErrorMessage(null);
      await updateFormPreferences({ launchTarget });
      setPendingAction("terminal");
      let outcome: SubmitOutcome = "background";
      await runCreateTerminalWorkspace({
        cwd: selectedSourceDirectory ?? "",
        prompt: terminalPromptText,
        profile: selectedTerminalProfile,
        profileName: selectedTerminalProfile?.name,
        ensureWorkspace,
        createTerminal: async (input) => {
          const connectedClient = withConnectedClient();
          const createdTerminal = await connectedClient.createTerminal(
            input.workspaceDirectory,
            input.name,
            undefined,
            { command: input.command, args: input.args, workspaceId: input.workspaceId },
          );
          const terminal = createdTerminal.terminal;
          if (!terminal) {
            throw new Error(createdTerminal.error ?? t("newWorkspace.errors.createWorktreeFailed"));
          }
          queryClient.setQueryData<ListTerminalsPayload>(
            buildTerminalsQueryKey(selectedServerId, input.workspaceDirectory, input.workspaceId),
            (current) =>
              upsertCreatedTerminalPayload({
                current,
                terminal,
                workspaceDirectory: input.workspaceDirectory,
              }),
          );
          return { terminalId: terminal.id };
        },
        sendTerminalInput: (terminalId, data) => {
          withConnectedClient().sendTerminalInput(terminalId, { type: "input", data });
        },
        serverId: selectedServerId,
        // The terminal is spawned and fed its command before this runs, so skipping the
        // navigation costs nothing: it is standalone, and `reconcileTabs` auto-opens standalone
        // terminals when the workspace is next visited.
        navigate: (targetServerId, workspaceId, target) => {
          if (!isStillOnCreateScreen()) {
            return;
          }
          outcome = "navigated";
          navigateToWorkspace({ serverId: targetServerId, workspaceId, target });
        },
      });
      if (outcome === "background") {
        setPendingAction(null);
      }
    } catch (error) {
      const message = toErrorMessage(error);
      setPendingAction(null);
      setErrorMessage(message);
      toast.error(message);
    }
  }, [
    ensureWorkspace,
    isStillOnCreateScreen,
    launchTarget,
    queryClient,
    selectedServerId,
    selectedSourceDirectory,
    selectedTerminalProfile,
    t,
    terminalPromptText,
    toast,
    updateFormPreferences,
    withConnectedClient,
  ]);

  const renderPickerOption = useCallback(
    (props: {
      option: ComboboxOptionType;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => <NewWorkspacePickerOption {...props} itemById={itemById} isPending={isPending} />,
    [isPending, itemById],
  );

  const renderProjectOption = useCallback(
    (props: {
      option: ComboboxOptionType;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => (
      <NewWorkspaceProjectPickerOption
        {...props}
        projectByOptionId={projectByOptionId}
        projectIconDataByProjectViewKey={projectIconDataByProjectViewKey}
        selectedServerId={selectedServerId}
        isPending={isPending}
        supportsWorkspaceMultiplicity={supportsWorkspaceMultiplicity}
      />
    ),
    [
      isPending,
      projectByOptionId,
      projectIconDataByProjectViewKey,
      selectedServerId,
      supportsWorkspaceMultiplicity,
    ],
  );

  const contentLayout = getContentLayout({ isCompact });

  const agentControlsWithDisabled = useMemo(
    () =>
      composerState
        ? {
            ...composerState.agentControls,
            disabled: isPending,
          }
        : undefined,
    [composerState, isPending],
  );

  const pickerEmptyText =
    branchSuggestionsQuery.isFetching || githubPrSearchQuery.isFetching
      ? t("newWorkspace.refPicker.searching")
      : t("newWorkspace.refPicker.noMatchingRefs");

  const formStack = useNewWorkspaceFormStack({
    isCompact,
    isPending,
    project: {
      anchorRef: projectPickerAnchorRef,
      open: openProjectPicker,
      options: projectPickerOptions,
      triggerLabel: projectTriggerLabel,
      selectedProject,
      iconDataByProjectViewKey: projectIconDataByProjectViewKey,
      selectedOptionId: selectedProjectOptionId,
      onSelect: handleSelectProjectOption,
      onAddProject: handleAddProject,
      openState: projectPickerOpen,
      onOpenChange: handleProjectPickerOpenChange,
      renderOption: renderProjectOption,
    },
    host: {
      allHosts: availableHosts,
      systemHosts: allHosts,
      selectedServerId,
      onSelect: handleSelectWorkspaceHost,
      openState: hostPickerOpen,
      onOpenChange: handleHostPickerOpenChange,
      anchorRef: hostPickerAnchorRef,
      open: openHostPicker,
    },
    isolation: {
      anchorRef: isolationPickerAnchorRef,
      open: openIsolationPicker,
      effectiveIsolation,
      options: isolationOptions,
      onSelect: handleSelectIsolationOption,
      openState: isolationPickerOpen,
      onOpenChange: handleIsolationPickerOpenChange,
      renderOption: renderIsolationOption,
      canCreateWorktree,
    },
    base: {
      anchorRef: pickerAnchorRef,
      open: openPicker,
      selectedSourceDirectory,
      selectedItem,
      triggerLabel,
      options,
      selectedOptionId,
      onSelect: handleSelectOption,
      openState: pickerOpen,
      onOpenChange: handlePickerOpenChange,
      setSearchQuery: setPickerSearchQuery,
      emptyText: pickerEmptyText,
      renderOption: renderPickerOption,
      showRefPicker,
    },
    launch: {
      serverId: selectedServerId,
      target: launchTarget,
      onChange: setManualLaunchTarget,
      profiles: terminalProfiles,
      disabled: isPending,
    },
  });

  const screenHeaderLeft = useMemo(() => <SidebarMenuToggle />, []);

  return (
    <FileDropZone className="flex min-h-0 flex-1 flex-col bg-background select-none">
      <ScreenHeader left={screenHeaderLeft} borderless />
      <div className={contentLayout.className} style={contentLayout.style}>
        <div className="w-full" style={CONTENT_WIDTH_STYLE}>
          <KeyboardTranslateView>
            <div className="mb-8 pr-4 pl-6">
              <h1 className="text-xl font-normal text-foreground">{t("newWorkspace.title")}</h1>
            </div>
            {formStack}
            {isTerminalLaunch ? (
              <Composer
                key="terminal"
                externalKeyboardShift
                inputMode="terminal"
                readOnly={!terminalTakesPrompt}
                placeholder={terminalPlaceholder}
                submitLabel={terminalSubmitLabel}
                agentId={draftKey}
                serverId={selectedServerId}
                isPaneFocused={true}
                onSubmitMessage={handleSubmitTerminalLaunch}
                allowEmptySubmit={true}
                submitButtonAccessibilityLabel={t("newWorkspace.launch.submit")}
                submitButtonTestID="new-workspace-launch-submit"
                isSubmitLoading={isPending}
                submitBehavior="preserve-and-lock"
                blurOnSubmit={true}
                value={terminalComposerValue}
                onChangeText={setTerminalPromptText}
                textReplacement={terminalTextReplacement}
                attachments={NO_TERMINAL_ATTACHMENTS}
                onChangeAttachments={noopChangeAttachments}
                cwd={selectedSourceDirectory ?? ""}
                clearDraft={noopClearDraft}
                autoFocus={terminalTakesPrompt}
                autoFocusKey={launchFocusKey}
              />
            ) : (
              <Composer
                key="chat"
                externalKeyboardShift
                agentId={draftKey}
                serverId={selectedServerId}
                isPaneFocused={true}
                onSubmitMessage={handleSubmitNewWorkspace}
                allowEmptySubmit={true}
                submitButtonAccessibilityLabel={t("newWorkspace.create")}
                submitButtonTestID="workspace-create-submit"
                submitIcon="return"
                isSubmitLoading={isPending}
                waitForForgeAutoAttachOnSubmit
                submitBehavior="preserve-and-lock"
                blurOnSubmit={true}
                value={chatDraft.text}
                onChangeText={chatDraft.editText}
                textReplacement={chatDraft.textReplacement}
                attachments={chatDraft.attachments}
                attachmentScopeKeys={visibleDraftContextScopeKeys}
                onChangeAttachments={chatDraft.setAttachments}
                onForgeChangeRequestDetected={handleForgeChangeRequestDetected}
                onForgeChangeRequestAutoAttach={handleForgeChangeRequestAutoAttach}
                cwd={selectedSourceDirectory ?? ""}
                clearDraft={handleClearDraft}
                autoFocus
                autoFocusKey={launchFocusKey}
                commandDraftConfig={composerState?.commandDraftConfig}
                agentControls={agentControlsWithDisabled}
              />
            )}
            {errorMessage ? (
              <p className="text-sm leading-5 text-destructive">{errorMessage}</p>
            ) : null}
          </KeyboardTranslateView>
        </div>
      </div>
    </FileDropZone>
  );
}

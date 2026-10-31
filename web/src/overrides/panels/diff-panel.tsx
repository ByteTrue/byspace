// Override of packages/app/src/panels/diff-panel.tsx: the Changes and Diff tabs and a commit's
// diff. Same descriptors and logic; the view is DOM.
// Generated from the Expo file by web/scripts/port/diff-pane.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileDiff, GitCommitHorizontal } from "lucide-react";
import invariant from "tiny-invariant";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useIsCompactFormFactor } from "@/constants/layout";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { isWeb } from "@/constants/platform";
import { DiffDocument } from "@/git/diff-document";
import { ChangesSurface, DiffLayoutToggle, resolveDiffLayout } from "@/git/diff-pane";
import { useCommitDiffFiles } from "@/git/use-diff-files";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { useAppSettings } from "@/hooks/use-settings";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor, type PanelPresentation } from "@/panels/panel-registry";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { defaultChangesState, changesStateSchema } from "@/panels/changes/state";
import { usePanelState } from "@/panels/use-panel-state";
import { RenderProfile } from "@/utils/render-profiler";

function useDiffPanelPreferences() {
  const { settings } = useAppSettings();
  const { preferences, updatePreferences } = useChangesPreferences();
  const isCompact = useIsCompactFormFactor();
  const canUseSplitLayout = isWeb && !isCompact;
  const effectiveLayout = resolveDiffLayout(preferences.layout, canUseSplitLayout);
  const displayPreferences = useMemo(
    () => ({
      layout: effectiveLayout,
      wrapLines: preferences.wrapLines,
      codeFontSize: settings.codeFontSize,
      monoFontFamily: settings.monoFontFamily,
    }),
    [effectiveLayout, preferences.wrapLines, settings.codeFontSize, settings.monoFontFamily],
  );
  const toggleLayout = useCallback(() => {
    void updatePreferences({ layout: preferences.layout === "unified" ? "split" : "unified" });
  }, [preferences.layout, updatePreferences]);
  const toggleWrapLines = useCallback(() => {
    void updatePreferences({ wrapLines: !preferences.wrapLines });
  }, [preferences.wrapLines, updatePreferences]);
  const toggleHideWhitespace = useCallback(() => {
    void updatePreferences({ hideWhitespace: !preferences.hideWhitespace });
  }, [preferences.hideWhitespace, updatePreferences]);
  return {
    preferences,
    isCompact,
    canUseSplitLayout,
    displayPreferences,
    toggleLayout,
    toggleWrapLines,
    toggleHideWhitespace,
  };
}

function PanelState({
  message,
  tone = "muted",
  testID,
}: {
  message: string;
  tone?: "muted" | "error";
  testID?: string;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-6 pt-16"
      data-testid={testID}
    >
      <span
        className={
          tone === "error"
            ? "text-center text-sm text-destructive"
            : "text-center text-sm text-muted-foreground"
        }
      >
        {message}
      </span>
    </div>
  );
}

function resolveChangesPresentation(
  isTree: boolean,
  inlineDiff: boolean,
): "tree" | "diff" | "combined" {
  if (!isTree) return "diff";
  return inlineDiff ? "combined" : "tree";
}

function ChangesPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, tabId, target, openPreferredTarget, openTargetToSide } =
    usePaneContext();
  const [changesState, setChangesState] = usePanelState(changesStateSchema, defaultChangesState);
  const { preferences } = useChangesPreferences();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const isActive = useRetainedPanelActive();
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  invariant(
    target.kind === "working_diff" || target.kind === "changes_tree",
    "ChangesPanel requires working_diff or changes_tree target",
  );
  const isTree = target.kind === "changes_tree";

  const handleOpenFile = useCallback(
    (path: string) => openPreferredTarget({ kind: "file", path }, isTree ? "diffs" : "diffFiles"),
    [isTree, openPreferredTarget],
  );

  const handleSelectDiffFile = useCallback(
    (path: string) =>
      openPreferredTarget(
        { kind: "working_diff", focusPath: path, focusRequestId: Date.now() },
        "diffs",
      ),
    [openPreferredTarget],
  );
  const handleOpenDiffToSide = useCallback(
    (path: string) =>
      openTargetToSide?.({ kind: "working_diff", focusPath: path, focusRequestId: Date.now() }),
    [openTargetToSide],
  );

  if (!cwd) {
    return <PanelState message={t("panels.diff.directoryMissing")} />;
  }

  const presentation = resolveChangesPresentation(isTree, preferences.inlineDiff);
  const testID = isTree ? "changes-tree-panel" : "working-diff-panel";
  const profileId = isTree ? `ChangesTreePanel:${tabId}` : `WorkingDiffPanel:${tabId}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={testID}>
      <RenderProfile id={profileId}>
        <ChangesSurface
          serverId={serverId}
          workspaceId={workspaceId}
          cwd={cwd}
          enabled={isActive}
          presentation={presentation}
          focusPath={target.kind === "working_diff" ? target.focusPath : undefined}
          focusRequestId={target.kind === "working_diff" ? target.focusRequestId : undefined}
          onSelectDiffFile={isTree ? handleSelectDiffFile : undefined}
          onOpenFile={handleOpenFile}
          onOpenToSide={isTree && openTargetToSide ? handleOpenDiffToSide : undefined}
          onAddToChat={canAddToChat ? addFile : undefined}
          state={changesState}
          onStateChange={setChangesState}
        />
      </RenderProfile>
    </div>
  );
}

function CommitDiffPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const panelPreferences = useDiffPanelPreferences();
  invariant(target.kind === "commit_diff", "CommitDiffPanel requires commit_diff target");
  const { files, isLoading, error, capabilityMissing } = useCommitDiffFiles({
    serverId,
    cwd: cwd ?? "",
    sha: target.sha,
    enabled: Boolean(cwd),
  });
  const mode = useMemo(() => ({ kind: "commit" as const }), []);

  let body: ReactNode;
  if (!cwd) {
    body = <PanelState message={t("panels.diff.directoryMissing")} />;
  } else if (capabilityMissing) {
    body = (
      <PanelState
        message={t("panels.diff.capabilityMissing")}
        testID="commit-diff-capability-missing"
      />
    );
  } else if (error) {
    body = (
      <PanelState message={t("panels.diff.loadError")} tone="error" testID="commit-diff-error" />
    );
  } else if (isLoading && files.length === 0) {
    body = <PanelState message={t("workspace.tabs.loading")} testID="commit-diff-loading" />;
  } else if (files.length === 0) {
    body = <PanelState message={t("panels.diff.empty")} testID="commit-diff-empty" />;
  } else {
    body = (
      <DiffDocument
        files={files}
        displayPreferences={panelPreferences.displayPreferences}
        mode={mode}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="commit-diff-panel">
      {panelPreferences.canUseSplitLayout ? (
        <PaneContentToolbar
          className="flex items-center justify-between gap-2 pr-2"
          testID="commit-diff-header"
        >
          <div
            className="flex flex-1 items-center justify-end gap-1"
            data-testid="commit-diff-toolbar"
          >
            <DiffLayoutToggle
              layout={panelPreferences.preferences.layout}
              isMobile={panelPreferences.isCompact}
              testID="commit-diff-toggle-layout"
              onToggle={panelPreferences.toggleLayout}
            />
          </div>
        </PaneContentToolbar>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  );
}

const workingDiffPresentation = {
  label: (t) => t("panels.diff.diffLabel"),
  subtitle: (t) => t("panels.diff.changesSubtitle"),
  tooltip: (t) => t("panels.diff.changesSubtitle"),
  icon: FileDiff,
} satisfies PanelPresentation;

const changesTreePresentation = {
  label: (t) => t("panels.diff.changesLabel"),
  subtitle: (t) => t("panels.diff.changesSubtitle"),
  tooltip: (t) => t("panels.diff.changesSubtitle"),
  icon: FileDiff,
} satisfies PanelPresentation;

function useCommitDiffPanelDescriptor(
  target: Extract<WorkspaceTabTarget, { kind: "commit_diff" }>,
): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: target.sha.slice(0, 7),
    subtitle: t("panels.diff.commitSubtitle"),
    tooltip: target.sha,
    titleState: "ready",
    icon: GitCommitHorizontal,
    statusBucket: null,
  };
}

export const workingDiffPanelRegistration = definePanel("working_diff", {
  component: ChangesPanel,
  presentation: workingDiffPresentation,
});

export const changesTreePanelRegistration = definePanel("changes_tree", {
  component: ChangesPanel,
  presentation: changesTreePresentation,
});

export const commitDiffPanelRegistration = definePanel("commit_diff", {
  component: CommitDiffPanel,
  useDescriptor: useCommitDiffPanelDescriptor,
});

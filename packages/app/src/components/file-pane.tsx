import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties } from "react";
import type { DaemonClient, FileReadResult } from "@bytetrue/byspace-client/internal/daemon-client";
import { Image as RNImage, ScrollView as RNScrollView, Text, View } from "react-native";
import { StyleSheet, UnistylesRuntime, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore, type ExplorerFile } from "@/stores/session-store";
import { highlightCode, type HighlightToken } from "@bytetrue/byspace-highlight";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { lineNumberGutterWidth } from "@/components/code-insets";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { isRenderedMarkdownFile } from "@/components/file-pane-render-mode";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { persistAttachmentFromBytes } from "@/attachments/service";
import { createPreviewAttachmentId, getFileNameFromPath } from "@/attachments/utils";
import { explorerFileFromReadResult } from "@/file-explorer/read-result";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useAppSettings } from "@/hooks/use-settings";
import { isFileQueryEnabled } from "@/components/file-pane-enabled";
import { isWeb } from "@/constants/platform";
import { useLiveFile } from "@/file-pane/live-file/hook";
import { FilePanelBar } from "@/file-pane/bar";
import {
  FileEditorModel,
  getFileConflictCallout,
  type FileConflictCallout,
} from "@/file-pane/editor/model";
import { createFileObservationSource } from "@/file-pane/editor/observation-source";
import { FileEditorView } from "@/file-pane/editor/view";
import type { FileConflictAlertState } from "@/file-pane/conflict-alert";
import type { LiveFileModel } from "@/file-pane/live-file/model";
import { confirmDialog } from "@/utils/confirm-dialog";
import { usePublishPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";
import type { Theme } from "@/styles/theme";
import { createHtmlPreviewDocument, isHtmlPreviewPath } from "@/file-pane/html-preview";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface CodeLineProps {
  tokens: HighlightToken[];
  lineNumber: number;
  gutterWidth: number;
  highlighted: boolean;
}

interface FilePreviewBodyProps {
  preview: ExplorerFile | null;
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  imagePreviewUri: string | null;
  mode?: "preview" | "source";
}

type TextExplorerFile = ExplorerFile & { kind: "text" };

const HTML_PREVIEW_FRAME_STYLE: CSSProperties = {
  width: "100%",
  height: "100%",
  border: 0,
  backgroundColor: "white",
};

function resolveRenderedTextPreview(input: {
  path: string;
  isText: boolean;
  mode?: "preview" | "source";
  lineStart?: number;
}): "markdown" | "html" | "source" {
  if (!input.isText || input.mode === "source" || input.lineStart) return "source";
  if (isRenderedMarkdownFile(input.path)) return "markdown";
  if (isWeb && isHtmlPreviewPath(input.path)) return "html";
  return "source";
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface FileLineSelection {
  lineStart: number;
  lineEnd: number;
}

function formatFileSize({ size }: { size: number }): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function createFilePanePreview(file: FileReadResult | null): Promise<{
  file: ExplorerFile | null;
  imageAttachment: AttachmentMetadata | null;
}> {
  if (!file) {
    return { file: null, imageAttachment: null };
  }

  const explorerFile = explorerFileFromReadResult(file);
  if (file.kind !== "image") {
    return { file: explorerFile, imageAttachment: null };
  }

  const imageAttachment = await persistAttachmentFromBytes({
    id: createPreviewAttachmentId({
      mimeType: file.mime,
      path: file.path,
      size: file.size,
      modifiedAt: file.modifiedAt,
      contentLength: file.bytes.byteLength,
    }),
    bytes: file.bytes,
    mimeType: file.mime,
    fileName: getFileNameFromPath(file.path),
  });

  return {
    file: explorerFile,
    imageAttachment,
  };
}

function clampLineSelection(input: {
  lineStart?: number;
  lineEnd?: number;
  lineCount: number;
}): FileLineSelection | null {
  if (!input.lineStart || input.lineStart <= 0 || input.lineCount <= 0) {
    return null;
  }
  const lineStart = Math.min(Math.floor(input.lineStart), input.lineCount);
  const rawLineEnd =
    input.lineEnd && input.lineEnd >= input.lineStart ? input.lineEnd : input.lineStart;
  const lineEnd = Math.min(Math.floor(rawLineEnd), input.lineCount);
  return { lineStart, lineEnd: Math.max(lineStart, lineEnd) };
}

const CodeLine = React.memo(function CodeLine({
  tokens,
  lineNumber,
  gutterWidth,
  highlighted,
}: CodeLineProps) {
  const gutterStyle = useMemo(
    () => [codeLineStyles.gutter, inlineUnistylesStyle({ width: gutterWidth })],
    [gutterWidth],
  );
  const lineStyle = useMemo(
    () => [codeLineStyles.line, highlighted && codeLineStyles.highlightedLine],
    [highlighted],
  );
  const keyedTokens = useMemo(
    () => tokens.map((token, index) => ({ key: `${index}-${token.text}`, token })),
    [tokens],
  );
  return (
    <View style={lineStyle}>
      <View style={gutterStyle}>
        <Text numberOfLines={1} style={codeLineStyles.gutterText}>
          {String(lineNumber)}
        </Text>
      </View>
      <Text selectable style={codeLineStyles.lineText}>
        {keyedTokens.map(({ key, token }) => (
          <CodeLineToken key={key} token={token} />
        ))}
      </Text>
    </View>
  );
});

interface CodeLineTokenProps {
  token: HighlightToken;
}

function CodeLineToken({ token }: CodeLineTokenProps) {
  return <Text style={syntaxTokenStyleFor(token.style)}>{token.text}</Text>;
}

const codeLineStyles = StyleSheet.create((theme) => ({
  line: {
    flexDirection: "row",
  },
  highlightedLine: {
    backgroundColor: theme.colors.accentBorder,
  },
  gutter: {
    alignItems: "flex-end",
    paddingRight: theme.spacing[3],
    flexShrink: 0,
  },
  gutterText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code * 1.45,
    opacity: 0.4,
    userSelect: "none",
  },
  lineText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code * 1.45,
    flex: 1,
  },
}));

function FilePreviewBody({
  preview,
  isLoading,
  isMobile,
  location,
  navigationRevision,
  imagePreviewUri,
  mode,
}: FilePreviewBodyProps) {
  const theme = UnistylesRuntime.getTheme();
  const { t } = useTranslation();
  const filePath = location.path;
  const renderedTextPreview = resolveRenderedTextPreview({
    path: filePath,
    isText: preview?.kind === "text",
    mode,
    lineStart: location.lineStart,
  });
  const isMarkdownFile = renderedTextPreview === "markdown";
  const isHtmlFile = renderedTextPreview === "html";

  const previewScrollRef = useRef<RNScrollView>(null);

  const highlightedLines = useMemo(() => {
    if (!preview || preview.kind !== "text" || isMarkdownFile || isHtmlFile) {
      return null;
    }

    return highlightCode(preview.content ?? "", filePath);
  }, [isHtmlFile, isMarkdownFile, preview, filePath]);

  const gutterWidth = useMemo(() => {
    if (!highlightedLines) return 0;
    return lineNumberGutterWidth(highlightedLines.length, theme.fontSize.code);
  }, [highlightedLines, theme.fontSize.code]);
  const lineHeight = theme.fontSize.code * 1.45;
  const lineSelection = useMemo(() => {
    if (!highlightedLines) {
      return null;
    }
    return clampLineSelection({
      lineStart: location.lineStart,
      lineEnd: location.lineEnd,
      lineCount: highlightedLines.length,
    });
  }, [highlightedLines, location.lineEnd, location.lineStart]);

  const imageSource = useMemo(
    () => (imagePreviewUri ? { uri: imagePreviewUri } : null),
    [imagePreviewUri],
  );

  useEffect(() => {
    if (!lineSelection) {
      return;
    }
    const timeout = setTimeout(() => {
      previewScrollRef.current?.scrollTo({
        y: Math.max(0, (lineSelection.lineStart - 1) * lineHeight),
        animated: false,
      });
    }, 0);
    return () => clearTimeout(timeout);
  }, [lineHeight, lineSelection, navigationRevision]);

  if (isLoading && !preview) {
    return (
      <View style={styles.centerState}>
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
        <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
      </View>
    );
  }

  if (!preview) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.emptyText}>{t("panels.file.noPreview")}</Text>
      </View>
    );
  }

  if (preview.kind === "text") {
    if (isHtmlFile) {
      return (
        <iframe
          data-testid="file-html-preview"
          sandbox="allow-scripts"
          srcDoc={createHtmlPreviewDocument(preview.content ?? "")}
          referrerPolicy="no-referrer"
          style={HTML_PREVIEW_FRAME_STYLE}
          title={`${t("panels.file.editor.preview")}: ${getFileNameFromPath(filePath) ?? filePath}`}
        />
      );
    }

    if (isMarkdownFile) {
      return (
        <View style={styles.previewScrollContainer}>
          <RNScrollView
            ref={previewScrollRef}
            style={styles.previewContent}
            contentContainerStyle={styles.previewMarkdownScrollContent}
            showsVerticalScrollIndicator
          >
            <MarkdownRenderer text={preview.content ?? ""} />
          </RNScrollView>
        </View>
      );
    }

    const lines = highlightedLines ?? [[{ text: preview.content ?? "", style: null }]];
    const keyedLines = lines.map((tokens, index) => ({
      key: `line-${index}`,
      tokens,
      lineNumber: index + 1,
    }));
    const codeLines = (
      <View dataSet={CODE_SURFACE_DATASET}>
        {keyedLines.map(({ key, tokens, lineNumber }) => (
          <CodeLine
            key={key}
            tokens={tokens}
            lineNumber={lineNumber}
            gutterWidth={gutterWidth}
            highlighted={
              Boolean(lineSelection) &&
              lineNumber >= (lineSelection?.lineStart ?? 0) &&
              lineNumber <= (lineSelection?.lineEnd ?? 0)
            }
          />
        ))}
      </View>
    );

    return (
      <View style={styles.previewScrollContainer}>
        <RNScrollView
          ref={previewScrollRef}
          style={styles.previewContent}
          showsVerticalScrollIndicator
        >
          {isMobile ? (
            <View style={styles.previewCodeScrollContent}>{codeLines}</View>
          ) : (
            <RNScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator
              contentContainerStyle={styles.previewCodeScrollContent}
            >
              {codeLines}
            </RNScrollView>
          )}
        </RNScrollView>
      </View>
    );
  }

  if (preview.kind === "image") {
    if (!imagePreviewUri) {
      return (
        <View style={styles.centerState}>
          <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
          <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
        </View>
      );
    }

    return (
      <View style={styles.previewScrollContainer}>
        <RNScrollView
          ref={previewScrollRef}
          style={styles.previewContent}
          contentContainerStyle={styles.previewImageScrollContent}
          showsVerticalScrollIndicator
        >
          <RNImage
            source={imageSource ?? undefined}
            style={styles.previewImage}
            resizeMode="contain"
          />
        </RNScrollView>
      </View>
    );
  }

  return (
    <View style={styles.centerState}>
      <Text style={styles.emptyText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
      <Text style={styles.binaryMetaText}>{formatFileSize({ size: preview.size })}</Text>
    </View>
  );
}

export function FilePane({
  serverId,
  workspaceRoot,
  location,
  navigationRevision = 0,
}: {
  serverId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  navigationRevision?: number;
}) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const [fileMode, setFileMode] = useState<"preview" | "source">("preview");
  const [resolvedPreview, setResolvedPreview] = useState<{
    key: string | null;
    file: ExplorerFile | null;
    imageAttachment: AttachmentMetadata | null;
  }>({ key: null, file: null, imageAttachment: null });

  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const lastClientRef = useRef<DaemonClient | null>(client);
  if (client) lastClientRef.current = client;
  const retainedClient = client ?? lastClientRef.current;
  // COMPAT(workspaceFileEditing): added in v0.2.0, remove after 2027-01-18 once daemon floor >= v0.2.0.
  const supportsEditing = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceFileEditing === true,
  );
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const normalizedFilePath = useMemo(() => trimNonEmpty(location.path), [location.path]);
  const readTarget = useMemo(
    () =>
      normalizedFilePath
        ? resolveFilePreviewReadTarget({
            path: normalizedFilePath,
            workspaceRoot: normalizedWorkspaceRoot,
          })
        : null,
    [normalizedFilePath, normalizedWorkspaceRoot],
  );

  // Re-read the file when this pane becomes visible again (#445). `isActive`
  // covers tab switches; active app visibility covers backgrounding and returning
  // from another window after an external edit. The gate lives in isFileQueryEnabled.
  const isActive = useRetainedPanelActive();
  const isAppVisible = useAppActivelyVisible();
  const enabled = isFileQueryEnabled({
    hasReadTarget: Boolean(client && readTarget),
    isTabActive: isActive,
    isAppVisible,
  });
  const liveFile = useLiveFile({
    client,
    cwd: readTarget?.cwd ?? null,
    path: readTarget?.path ?? null,
    enabled,
    liveUpdates: supportsEditing,
  });

  useEffect(() => {
    if (!liveFile.file) return;
    let active = true;
    const key = readTarget ? `${readTarget.cwd}:${readTarget.path}` : null;
    void (async () => {
      const nextPreview = await createFilePanePreview(liveFile.file);
      if (active) setResolvedPreview({ key, ...nextPreview });
    })();
    return () => {
      active = false;
    };
  }, [liveFile.file, readTarget]);

  useEffect(
    () => setFileMode(location.lineStart ? "source" : "preview"),
    [location.lineStart, readTarget?.path],
  );

  const previewKey = readTarget ? `${readTarget.cwd}:${readTarget.path}` : null;
  const preview = resolvedPreview.key === previewKey ? resolvedPreview.file : null;
  const imagePreviewUri = useAttachmentPreviewUrl(
    resolvedPreview.key === previewKey ? resolvedPreview.imageAttachment : null,
  );
  const isMarkdown = isMarkdownPreview(preview, location.path);
  const isHtml = isHtmlPreview(preview, location.path);
  const editable = isEditableTextFile({
    preview,
    supportsEditing,
  });
  const canToggleFileMode = canToggleFilePreviewMode({ isMarkdown, isHtml, editable });
  const lineCount =
    preview?.kind === "text" ? (preview.content ?? "").split("\n").length : undefined;
  const errorMessage = getFileErrorMessage(liveFile.error, t("panels.file.failedToLoad"));

  return (
    <FilePanePresentation
      serverId={serverId}
      client={retainedClient}
      readTarget={readTarget}
      preview={preview}
      liveFile={liveFile.model}
      onRetryRead={liveFile.refresh}
      retryingRead={liveFile.isRetrying}
      retryLabel={t("common.actions.retry")}
      filename={getFileNameFromPath(location.path) ?? location.path}
      markdownMode={canToggleFileMode ? fileMode : undefined}
      onMarkdownModeChange={canToggleFileMode ? setFileMode : undefined}
      lineCount={lineCount}
      editable={editable}
      disconnectedMessage={t("workspace.terminal.hostDisconnected")}
      errorMessage={errorMessage}
      isLoading={liveFile.isFetching}
      isMobile={isMobile}
      location={location}
      navigationRevision={navigationRevision}
      imagePreviewUri={imagePreviewUri}
    />
  );
}

function isMarkdownPreview(preview: ExplorerFile | null, path: string): boolean {
  return preview?.kind === "text" && isRenderedMarkdownFile(path);
}

function isHtmlPreview(preview: ExplorerFile | null, path: string): boolean {
  return isWeb && preview?.kind === "text" && isHtmlPreviewPath(path);
}

function canToggleFilePreviewMode(input: {
  isMarkdown: boolean;
  isHtml: boolean;
  editable: boolean;
}): boolean {
  return input.isHtml || (input.isMarkdown && input.editable);
}

function getFileErrorMessage(error: unknown, fallback: string): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : fallback;
}

function isEditableTextFile(input: {
  preview: ExplorerFile | null;
  supportsEditing: boolean;
}): boolean {
  return Boolean(
    isWeb &&
    input.supportsEditing &&
    input.preview?.kind === "text" &&
    input.preview.size <= 1024 * 1024,
  );
}

function FilePanePresentation({
  serverId,
  client,
  readTarget,
  preview,
  liveFile,
  onRetryRead,
  retryingRead,
  retryLabel,
  filename,
  markdownMode,
  onMarkdownModeChange,
  lineCount,
  editable,
  disconnectedMessage,
  errorMessage,
  isLoading,
  isMobile,
  location,
  navigationRevision,
  imagePreviewUri,
}: {
  serverId: string;
  client: DaemonClient | null;
  readTarget: { cwd: string; path: string } | null;
  preview: ExplorerFile | null;
  liveFile: LiveFileModel;
  onRetryRead: () => void;
  retryingRead: boolean;
  retryLabel: string;
  filename: string;
  markdownMode?: "preview" | "source";
  onMarkdownModeChange?: (mode: "preview" | "source") => void;
  lineCount?: number;
  editable: boolean;
  disconnectedMessage: string;
  errorMessage: string | null;
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  imagePreviewUri: string | null;
}) {
  if (!client && readTarget) {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{disconnectedMessage}</Text>
        </View>
      </View>
    );
  }

  if (editable && client && readTarget && preview?.kind === "text") {
    return (
      <ThemedEditableFilePane
        key={`${serverId}:${readTarget.cwd}:${readTarget.path}`}
        client={client}
        cwd={readTarget.cwd}
        path={readTarget.path}
        preview={preview as TextExplorerFile}
        liveFile={liveFile}
        onRetryRead={onRetryRead}
        retryingRead={retryingRead}
        filename={filename}
        mode={markdownMode}
        onModeChange={onMarkdownModeChange}
        isLoading={isLoading}
        isMobile={isMobile}
        location={location}
        navigationRevision={navigationRevision}
      />
    );
  }

  if (errorMessage) {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Button variant="outline" size="sm" onPress={onRetryRead} loading={retryingRead}>
            {retryLabel}
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="workspace-file-pane">
      {preview ? (
        <FilePanelBar
          size={preview.size}
          lineCount={lineCount}
          mode={markdownMode}
          onModeChange={onMarkdownModeChange}
        />
      ) : null}
      <AppearanceStyleBoundary>
        <FilePreviewBody
          preview={preview}
          isLoading={isLoading}
          isMobile={isMobile}
          location={location}
          navigationRevision={navigationRevision}
          imagePreviewUri={imagePreviewUri}
          mode={markdownMode}
        />
      </AppearanceStyleBoundary>
    </View>
  );
}

function EditableFilePane({
  client,
  cwd,
  path,
  preview,
  liveFile,
  onRetryRead,
  retryingRead,
  filename,
  mode,
  onModeChange,
  isLoading,
  isMobile,
  location,
  navigationRevision,
  appearanceTheme,
}: {
  client: DaemonClient;
  cwd: string;
  path: string;
  preview: TextExplorerFile;
  liveFile: LiveFileModel;
  onRetryRead: () => void;
  retryingRead: boolean;
  filename: string;
  mode?: "preview" | "source";
  onModeChange?: (mode: "preview" | "source") => void;
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  appearanceTheme?: Theme;
}) {
  const { settings } = useAppSettings();
  const { t } = useTranslation();
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [vimMode, setVimMode] = useState<string | null>(settings.vimKeybindings ? "NORMAL" : null);
  const session = useMemo(
    () => ({
      write(input: { content: string; expectedModifiedAt: string; expectedRevision?: string }) {
        return client.writeFile({ cwd, path, ...input });
      },
    }),
    [client, cwd, path],
  );
  const [model] = useState(() => {
    return new FileEditorModel({
      file: {
        content: preview.content ?? "",
        hasBom: preview.hasBom,
        version: {
          status: "ready",
          cwd,
          path,
          size: preview.size,
          modifiedAt: preview.modifiedAt,
          revision: preview.revision,
        },
      },
      session,
    });
  });
  useEffect(() => model.updateSession(session), [model, session]);
  useEffect(() => {
    const source = createFileObservationSource(liveFile);
    model.connectFileObservations(source);
    return () => model.disconnectFileObservations();
  }, [liveFile, model]);
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => {
    if (!snapshot.modified || typeof window === "undefined") return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [snapshot.modified]);
  const suspendPendingSave = useCallback(() => model.suspendAutosave(), [model]);
  usePublishPanelInstanceAttributes({ modified: snapshot.modified, suspendPendingSave });
  const theme = appearanceTheme ?? UnistylesRuntime.getTheme();
  const visualTheme = useMemo(
    () => ({
      colorScheme: theme.colorScheme,
      background: theme.colors.surface0,
      foreground: theme.colors.foreground,
      cursor: theme.colors.terminal.cursor,
      foregroundMuted: theme.colors.foregroundMuted,
      border: theme.colors.border,
      selection: theme.colors.terminal.selectionBackground,
      monoFont: theme.fontFamily.mono,
      codeFontSize: theme.fontSize.code,
      syntax: theme.colors.syntax,
    }),
    [
      theme.colors.border,
      theme.colors.foreground,
      theme.colors.foregroundMuted,
      theme.colors.surface0,
      theme.colors.syntax,
      theme.colors.terminal.cursor,
      theme.colors.terminal.selectionBackground,
      theme.colorScheme,
      theme.fontFamily.mono,
      theme.fontSize.code,
    ],
  );

  useEffect(() => () => model.dispose(), [model]);

  const handleReload = useCallback(() => {
    if (!snapshot.modified) {
      void model.reload();
      return;
    }
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("panels.file.editor.reloadTitle"),
        message: t("panels.file.editor.reloadMessage"),
        confirmLabel: t("panels.file.editor.reload"),
        destructive: true,
      });
      if (confirmed) void model.reload();
    })();
  }, [model, snapshot.modified, t]);
  const handleOverwrite = useCallback(() => void model.overwrite(), [model]);
  const conflict = fileConflictAlertState({
    callout: getFileConflictCallout(snapshot),
    onOverwrite: handleOverwrite,
    onReload: handleReload,
    onRetry: onRetryRead,
    retrying: retryingRead,
  });
  const handleVimModeChange = useCallback((nextMode: string | null) => setVimMode(nextMode), []);
  const renderedPreview = useMemo<ExplorerFile>(
    () => ({
      ...preview,
      content: snapshot.content,
      size: snapshot.version.status === "ready" ? snapshot.version.size : preview.size,
      modifiedAt:
        snapshot.version.status === "ready" ? snapshot.version.modifiedAt : preview.modifiedAt,
      revision: snapshot.version.status === "ready" ? snapshot.version.revision : preview.revision,
    }),
    [preview, snapshot.content, snapshot.version],
  );
  const showSource = mode !== "preview";

  return (
    <View style={styles.container} testID="workspace-file-pane">
      <FilePanelBar
        size={
          snapshot.observedVersion.status === "ready" ? snapshot.observedVersion.size : preview.size
        }
        lineCount={snapshot.content.split("\n").length}
        editorStatus={snapshot.status}
        cursor={showSource ? cursor : undefined}
        vimMode={showSource ? vimMode : null}
        conflict={conflict}
        mode={mode}
        onModeChange={onModeChange}
      />
      {showSource ? (
        <FileEditorView
          model={model}
          filename={filename}
          location={location}
          navigationRevision={navigationRevision}
          vimEnabled={settings.vimKeybindings}
          theme={visualTheme}
          onCursorChange={setCursor}
          onVimModeChange={handleVimModeChange}
        />
      ) : (
        <AppearanceStyleBoundary>
          <FilePreviewBody
            preview={renderedPreview}
            isLoading={isLoading}
            isMobile={isMobile}
            location={location}
            navigationRevision={navigationRevision}
            imagePreviewUri={null}
            mode="preview"
          />
        </AppearanceStyleBoundary>
      )}
    </View>
  );
}

function fileConflictAlertState(input: {
  callout: FileConflictCallout | null;
  onOverwrite(): void;
  onReload(): void;
  onRetry(): void;
  retrying: boolean;
}): FileConflictAlertState | undefined {
  if (!input.callout) return undefined;
  if (input.callout.kind === "deleted") return { kind: "deleted" };
  if (input.callout.kind === "checkFailed") {
    return { kind: "checkFailed", retrying: input.retrying, onRetry: input.onRetry };
  }
  return {
    kind: "changed",
    canOverwrite: input.callout.canOverwrite,
    onReload: input.onReload,
    onOverwrite: input.onOverwrite,
  };
}

const editorAppearanceMapping = (theme: Theme) => ({ appearanceTheme: theme });

const ThemedEditableFilePane = withUnistyles(EditableFilePane, editorAppearanceMapping);

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  loadingText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  binaryMetaText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  previewScrollContainer: {
    flex: 1,
    minHeight: 0,
  },
  previewContent: {
    flex: 1,
    minHeight: 0,
  },
  previewCodeScrollContent: {
    padding: theme.spacing[4],
  },
  previewMarkdownScrollContent: {
    padding: theme.spacing[4],
  },
  previewImageScrollContent: {
    flexGrow: 1,
    padding: theme.spacing[4],
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: 420,
  },
}));

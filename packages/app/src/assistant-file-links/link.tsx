import { useMemo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { MarkdownLinkText } from "@/components/markdown/link-text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { markdownCopyDataSet } from "@/assistant-selection-copy/markup";
import { useAssistantFileLinkResolverContext } from "./provider";
import type { AssistantFileLinkSource } from "./resolver";
import { useFileLink } from "./use-file-link";

interface AssistantMarkdownLinkProps {
  source: AssistantFileLinkSource;
  style: StyleProp<TextStyle>;
  monoSurface?: boolean;
  children: ReactNode;
}

const MARKDOWN_CODE_LINK_DATASET = {
  ...CODE_SURFACE_DATASET,
  ...markdownCopyDataSet.code,
} as const;

export function AssistantMarkdownLink({
  source,
  style,
  monoSurface,
  children,
}: AssistantMarkdownLinkProps) {
  const { target, onHoverIn, onPress } = useFileLink(source);
  const { configRef } = useAssistantFileLinkResolverContext();
  const workspaceRoot = configRef.current.workspaceRoot;
  const tooltipPath = useMemo(
    () => (target ? formatInlinePathTargetForTooltip(target, workspaceRoot) : null),
    [target, workspaceRoot],
  );
  const unwrapForMarkdownCopy = source.sourceType === "inline-code" || source.markup === "linkify";

  const anchor = (
    <a
      {...(unwrapForMarkdownCopy ? { "data-byspace-markdown-unwrap": "true" } : {})}
      href={source.href}
      title={source.title}
      onClickCapture={preventAnchorNavigation}
      onAuxClickCapture={preventAnchorNavigation}
      style={LINK_ANCHOR_STYLE}
    >
      <MarkdownLinkText
        dataSet={monoSurface ? MARKDOWN_CODE_LINK_DATASET : undefined}
        style={style}
        onPress={onPress}
        onHoverIn={onHoverIn}
      >
        {children}
      </MarkdownLinkText>
    </a>
  );

  return <FileLinkHoverTooltip filePath={tooltipPath}>{anchor}</FileLinkHoverTooltip>;
}

interface AssistantMarkdownCodeLinkProps {
  source: AssistantFileLinkSource;
  inheritedStyles: TextStyle;
  codeInlineStyle: TextStyle;
  linkStyle: TextStyle;
  children: ReactNode;
}

export function AssistantMarkdownCodeLink({
  source,
  inheritedStyles,
  codeInlineStyle,
  linkStyle,
  children,
}: AssistantMarkdownCodeLinkProps) {
  const style = useMemo(
    () => [inheritedStyles, codeInlineStyle, linkStyle],
    [inheritedStyles, codeInlineStyle, linkStyle],
  );
  return (
    <AssistantMarkdownLink source={source} style={style} monoSurface>
      {children}
    </AssistantMarkdownLink>
  );
}

function formatInlinePathTargetForTooltip(
  target: { path: string; lineStart?: number; lineEnd?: number },
  workspaceRoot: string | undefined,
): string {
  let result = relativizePathToWorkspace(target.path, workspaceRoot);
  if (target.lineStart) {
    result += `:${target.lineStart}`;
    if (target.lineEnd && target.lineEnd !== target.lineStart) {
      result += `-${target.lineEnd}`;
    }
  }
  return result;
}

function relativizePathToWorkspace(filePath: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot) {
    return filePath;
  }
  const root = workspaceRoot.replace(/\/+$/, "");
  if (!root) {
    return filePath;
  }
  if (filePath === root) {
    return ".";
  }
  const prefix = `${root}/`;
  if (filePath.startsWith(prefix)) {
    return filePath.slice(prefix.length);
  }
  return filePath;
}

interface AssistantInlineCodePathLinkProps {
  content: string;
  inheritedStyles: TextStyle;
  codeInlineStyle: TextStyle;
  linkStyle: TextStyle;
}

export function AssistantInlineCodePathLink({
  content,
  inheritedStyles,
  codeInlineStyle,
  linkStyle,
}: AssistantInlineCodePathLinkProps) {
  const source = useMemo<AssistantFileLinkSource>(
    () => ({
      href: content,
      text: content,
      sourceType: "inline-code",
    }),
    [content],
  );

  return (
    <AssistantMarkdownCodeLink
      source={source}
      inheritedStyles={inheritedStyles}
      codeInlineStyle={codeInlineStyle}
      linkStyle={linkStyle}
    >
      {content}
    </AssistantMarkdownCodeLink>
  );
}

const FILE_LINK_TOOLTIP_TRIGGER_STYLE: ViewStyle = {
  // RN doesn't type "inline-flex" but RN-web honors it at runtime, which keeps
  // the tooltip wrapper from breaking inline link flow.
  display: "inline-flex" as ViewStyle["display"],
};

function FileLinkHoverTooltip({
  filePath,
  children,
}: {
  filePath: string | null;
  children: ReactNode;
}) {
  if (!isWeb) {
    return children;
  }
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <View style={FILE_LINK_TOOLTIP_TRIGGER_STYLE}>{children}</View>
      </TooltipTrigger>
      {filePath ? (
        <TooltipContent side="top" align="start" maxWidth={520}>
          <Text selectable={false} style={styles.tooltipPath}>
            {filePath}
          </Text>
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

const LINK_ANCHOR_STYLE: CSSProperties = {
  display: "contents",
  color: "inherit",
  textDecoration: "none",
};

function preventAnchorNavigation(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
}

const styles = StyleSheet.create((theme) => ({
  tooltipPath: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));

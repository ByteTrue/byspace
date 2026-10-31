// Override of packages/app/src/assistant-file-links/link.tsx: links in agent prose. A link that
// resolves to a workspace file opens it in the workspace and shows its path on hover; anything
// else opens externally. The anchor keeps its href for copy, but navigation is ours.
import { useCallback, useMemo, type MouseEvent, type ReactNode } from "react";
import { MARKDOWN_COPY_UNWRAP_ATTRIBUTE } from "@/assistant-selection-copy/markup";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyTag } from "~/markdown/render";
import { useAssistantFileLinkResolverContext } from "@/assistant-file-links/provider";
import type { AssistantFileLinkSource } from "@/assistant-file-links/resolver";
import { useFileLink } from "@/assistant-file-links/use-file-link";

export function AssistantMarkdownLink({
  source,
  monoSurface = false,
  children,
}: {
  source: AssistantFileLinkSource;
  monoSurface?: boolean;
  children: ReactNode;
}) {
  const { target, onHoverIn, onPress } = useFileLink(source);
  const { configRef } = useAssistantFileLinkResolverContext();
  const workspaceRoot = configRef.current.workspaceRoot;
  const tooltipPath = useMemo(
    () => (target ? formatInlinePathTargetForTooltip(target, workspaceRoot) : null),
    [target, workspaceRoot],
  );
  const unwrapForMarkdownCopy = source.sourceType === "inline-code" || source.markup === "linkify";
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      onPress();
    },
    [onPress],
  );
  const anchor = (
    <a
      {...(unwrapForMarkdownCopy ? { [MARKDOWN_COPY_UNWRAP_ATTRIBUTE]: "true" } : {})}
      href={source.href}
      title={tooltipPath ? undefined : source.title}
      onClick={handleClick}
      onAuxClick={preventNavigation}
      onPointerEnter={onHoverIn}
    >
      {monoSurface ? (
        <code data-pmono="" {...copyTag("code")}>
          {children}
        </code>
      ) : (
        children
      )}
    </a>
  );
  if (!tooltipPath) return anchor;
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>{anchor}</TooltipTrigger>
      <TooltipContent side="top" align="start" maxWidth={520}>
        {tooltipPath}
      </TooltipContent>
    </Tooltip>
  );
}

export function AssistantMarkdownCodeLink({
  source,
  children,
}: {
  source: AssistantFileLinkSource;
  children: ReactNode;
}) {
  return (
    <AssistantMarkdownLink source={source} monoSurface>
      {children}
    </AssistantMarkdownLink>
  );
}

export function AssistantInlineCodePathLink({ content }: { content: string }) {
  const source = useMemo<AssistantFileLinkSource>(
    () => ({ href: content, text: content, sourceType: "inline-code" }),
    [content],
  );
  return <AssistantMarkdownCodeLink source={source}>{content}</AssistantMarkdownCodeLink>;
}

function preventNavigation(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
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
  if (!workspaceRoot) return filePath;
  const root = workspaceRoot.replace(/\/+$/, "");
  if (!root) return filePath;
  if (filePath === root) return ".";
  const prefix = `${root}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

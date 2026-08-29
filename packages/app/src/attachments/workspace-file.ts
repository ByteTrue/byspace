import type { AgentAttachment } from "@bytetrue/byspace-protocol/messages";
import type {
  UserComposerAttachment,
  WorkspaceFileComposerAttachment,
  WorkspaceFileSelection,
} from "./types";

interface CreateWorkspaceFileAttachmentInput {
  path: string;
  selection?: WorkspaceFileSelection;
}

function normalizePath(path: string): string | null {
  if (path.trim() !== path) return null;
  const candidate = path.replace(/^\.\//, "");
  if (
    !candidate ||
    candidate.startsWith("/") ||
    candidate.includes("\\") ||
    /^[A-Za-z]:/.test(candidate) ||
    Array.from(candidate).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    return null;
  }
  const segments = candidate.split("/");
  return segments.some((segment) => !segment || segment === "." || segment === "..")
    ? null
    : candidate;
}

export function isWorkspaceFileComposerAttachment(
  value: unknown,
): value is WorkspaceFileComposerAttachment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.kind !== "workspace_file" ||
    typeof record.path !== "string" ||
    normalizePath(record.path) !== record.path
  ) {
    return false;
  }
  const selection = record.selection;
  if (!selection || typeof selection !== "object") {
    return false;
  }
  const { kind, startLine, endLine } = selection as Record<string, unknown>;
  if (kind === "whole_file") {
    return true;
  }
  return (
    kind === "line_range" &&
    typeof startLine === "number" &&
    Number.isInteger(startLine) &&
    typeof endLine === "number" &&
    Number.isInteger(endLine) &&
    startLine > 0 &&
    endLine >= startLine
  );
}

export function createWorkspaceFileAttachment({
  path,
  selection = { kind: "whole_file" },
}: CreateWorkspaceFileAttachmentInput): WorkspaceFileComposerAttachment {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) {
    throw new Error("Workspace file path must be a canonical relative path");
  }
  return {
    kind: "workspace_file",
    path: normalizedPath,
    selection,
  };
}

export function getWorkspaceFileAttachmentKey(attachment: WorkspaceFileComposerAttachment): string {
  const selection = attachment.selection;
  const selectionKey =
    selection.kind === "whole_file"
      ? selection.kind
      : `${selection.kind}:${selection.startLine}-${selection.endLine}`;
  return `${normalizePath(attachment.path) ?? attachment.path}:${selectionKey}`;
}

export function appendWorkspaceFileAttachment(
  current: UserComposerAttachment[],
  attachment: WorkspaceFileComposerAttachment,
): UserComposerAttachment[] {
  const attachmentKey = getWorkspaceFileAttachmentKey(attachment);
  const alreadyAttached = current.some(
    (candidate) =>
      candidate.kind === "workspace_file" &&
      getWorkspaceFileAttachmentKey(candidate) === attachmentKey,
  );
  return alreadyAttached ? current : [...current, attachment];
}

export function workspaceFileAttachmentToAgentAttachment(
  attachment: WorkspaceFileComposerAttachment,
): Extract<AgentAttachment, { type: "text" }> {
  const fileName = attachment.path.split("/").pop() ?? attachment.path;
  const lines =
    attachment.selection.kind === "line_range"
      ? `\nLines: ${attachment.selection.startLine}-${attachment.selection.endLine}`
      : "";
  return {
    type: "text",
    mimeType: "text/plain",
    title: fileName,
    text: `Workspace file: ${attachment.path}${lines}`,
  };
}

export function getWorkspaceFileAttachmentSubtitle(
  attachment: WorkspaceFileComposerAttachment,
): string {
  if (attachment.selection.kind === "whole_file") {
    return attachment.path;
  }
  return `${attachment.path} · ${attachment.selection.startLine}-${attachment.selection.endLine}`;
}

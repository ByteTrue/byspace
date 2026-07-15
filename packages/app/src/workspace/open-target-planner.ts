import { buildGitHubBlobUrl, buildGitHubBranchTreeUrl } from "@/git/github-url";
import {
  type ResolvedWorkspaceFilePaths,
  resolveWorkspaceFilePaths,
  type WorkspaceFileLocation,
} from "@/workspace/file-open";

interface CheckoutStatusForOpenTarget {
  isGit: boolean;
  remoteUrl?: string | null;
  currentBranch?: string | null;
}

export interface PlannedGitHubOpenTarget {
  source: "github";
  id: "github";
  label: "GitHub";
  url: string;
}

export interface PlanWorkspaceOpenTargetsInput {
  workspaceDirectory: string;
  activeFile?: WorkspaceFileLocation | null;
  resolvedActiveFile?: ResolvedWorkspaceFilePaths | null;
  checkoutStatus?: CheckoutStatusForOpenTarget | null;
}

export function planWorkspaceOpenTargets(
  input: PlanWorkspaceOpenTargetsInput,
): PlannedGitHubOpenTarget[] {
  if (!input.checkoutStatus?.isGit) return [];
  let resolvedFile = input.resolvedActiveFile ?? null;
  if (input.resolvedActiveFile === undefined && input.activeFile) {
    resolvedFile = resolveWorkspaceFilePaths({
      path: input.activeFile.path,
      workspaceRoot: input.workspaceDirectory,
    });
  }
  const url = resolvedFile?.relativePath
    ? buildGitHubBlobUrl({
        remoteUrl: input.checkoutStatus.remoteUrl,
        branch: input.checkoutStatus.currentBranch,
        path: resolvedFile.relativePath,
        lineStart: input.activeFile?.lineStart,
        lineEnd: input.activeFile?.lineEnd,
      })
    : buildGitHubBranchTreeUrl({
        remoteUrl: input.checkoutStatus.remoteUrl,
        branch: input.checkoutStatus.currentBranch,
      });
  return url ? [{ source: "github", id: "github", label: "GitHub", url }] : [];
}

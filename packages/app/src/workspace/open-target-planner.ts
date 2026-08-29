import { type Forge, forgeFromRemoteUrl, getForgePresentation } from "@/git/forge";
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

export interface PlannedForgeOpenTarget {
  source: "forge";
  forge: Forge;
  id: Forge;
  label: string;
  url: string;
}

export interface PlanWorkspaceOpenTargetsInput {
  workspaceDirectory: string;
  activeFile?: WorkspaceFileLocation | null;
  resolvedActiveFile?: ResolvedWorkspaceFilePaths | null;
  checkoutStatus?: CheckoutStatusForOpenTarget | null;
  forge?: Forge | null;
}

function resolveActiveFileForOpenTargets(
  input: PlanWorkspaceOpenTargetsInput,
): ResolvedWorkspaceFilePaths | null {
  if (input.resolvedActiveFile !== undefined) return input.resolvedActiveFile;
  return input.activeFile
    ? resolveWorkspaceFilePaths({
        path: input.activeFile.path,
        workspaceRoot: input.workspaceDirectory,
      })
    : null;
}

function buildForgeWebUrl(
  forge: Forge,
  input: {
    remoteUrl: string | null | undefined;
    branch: string | null | undefined;
    path: string | null;
    lineStart?: number;
    lineEnd?: number;
  },
): string | null {
  const presentation = getForgePresentation(forge);
  if (input.path) {
    return (
      presentation.buildBlobUrl?.({
        remoteUrl: input.remoteUrl,
        branch: input.branch,
        path: input.path,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd,
      }) ?? null
    );
  }
  return (
    presentation.buildBranchTreeUrl?.({
      remoteUrl: input.remoteUrl,
      branch: input.branch,
    }) ?? null
  );
}

export function planWorkspaceOpenTargets(
  input: PlanWorkspaceOpenTargetsInput,
): PlannedForgeOpenTarget[] {
  if (!input.checkoutStatus?.isGit) return [];

  const forge = input.forge ?? forgeFromRemoteUrl(input.checkoutStatus.remoteUrl) ?? null;
  if (!forge) return [];

  const resolvedFile = resolveActiveFileForOpenTargets(input);
  const url = buildForgeWebUrl(forge, {
    remoteUrl: input.checkoutStatus.remoteUrl,
    branch: input.checkoutStatus.currentBranch,
    path: resolvedFile?.relativePath ?? null,
    lineStart: input.activeFile?.lineStart,
    lineEnd: input.activeFile?.lineEnd,
  });

  return url
    ? [
        {
          source: "forge",
          forge,
          id: forge,
          label: getForgePresentation(forge).brandLabel,
          url,
        },
      ]
    : [];
}
